#!/usr/bin/env bash
# Shared helpers for driving the Capacitor app on a real Android phone over
# ADB (wireless debugging or USB) and capturing screenshots at checkpoints.
#
# Why this exists: hardcoded pixel coordinates break constantly, because the
# on-screen keyboard opening/closing reflows the WebView layout every time.
# The only reliable pattern found this session is: dump the UI *immediately*
# before each tap, find the element's *current* bounds, tap its center. Never
# reuse coordinates from an earlier dump or a previous run.
#
# Usage: source this file from a test script, e.g.:
#   source "$(dirname "$0")/lib.sh"
#   dump_ui
#   tap_text "Sign up"

set -uo pipefail

DEVICE="${DEVICE:-adb-RF8M305107B-4UeSgb._adb-tls-connect._tcp}"
PLATFORM_TOOLS="$HOME/Android/Sdk/platform-tools"
export PATH="$PATH:$PLATFORM_TOOLS"

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
SHOT_DIR="$WORKDIR/screenshots/$RUN_ID"
LOG_FILE="$SHOT_DIR/log.txt"
mkdir -p "$SHOT_DIR"

SHOT_COUNT=0

log() {
  echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"
}

# --- device connection, with a fallback if wireless ADB dropped ----------

ensure_device() {
  if adb -s "$DEVICE" get-state >/dev/null 2>&1; then
    log "device $DEVICE already connected"
    return 0
  fi

  if [ -n "${RECONNECT_IP_PORT:-}" ]; then
    log "device not connected, trying adb connect $RECONNECT_IP_PORT"
    adb connect "$RECONNECT_IP_PORT" >/dev/null 2>&1
    sleep 2
    if adb -s "$DEVICE" get-state >/dev/null 2>&1; then
      log "reconnected via $RECONNECT_IP_PORT"
      return 0
    fi
  fi

  log "FALLBACK NEEDED: device '$DEVICE' is not reachable."
  log "Wireless debugging's IP:port changes on phone reboot / reconnect."
  log "On the phone: Settings > Developer options > Wireless debugging,"
  log "read the 'IP address & port' line, then either:"
  log "  - re-run this script with RECONNECT_IP_PORT=<ip:port> set, or"
  log "  - run: adb connect <ip:port>   and re-run this script."
  return 1
}

# --- screenshots -----------------------------------------------------------

# shot <short-description>
# Captures a screenshot AND records what step it belongs to, so a later
# review pass (reading screenshots in order) can tell what each one is
# checking without re-running anything.
shot() {
  local desc="$1"
  SHOT_COUNT=$((SHOT_COUNT + 1))
  local fname
  fname=$(printf "%s/%02d_%s.png" "$SHOT_DIR" "$SHOT_COUNT" "$(echo "$desc" | tr ' /' '__')")
  adb -s "$DEVICE" shell screencap -p > "$fname"
  log "screenshot $SHOT_COUNT: $desc -> $fname"
}

# --- UI dump + element lookup ----------------------------------------------

dump_ui() {
  adb -s "$DEVICE" shell uiautomator dump /sdcard/lib_dump.xml >/dev/null 2>&1
  adb -s "$DEVICE" pull /sdcard/lib_dump.xml "$WORKDIR/last_dump.xml" >/dev/null 2>&1
}

# bounds_center "x0,y0][x1,y1" -> "x y"
_bounds_center() {
  echo "$1" | python3 -c "
import sys, re
m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', sys.stdin.read().strip())
x0,y0,x1,y1 = map(int, m.groups())
print((x0+x1)//2, (y0+y1)//2)
"
}

# find_bounds_by_text "exact text" [nth=1]
find_bounds_by_text() {
  local pattern="$1"
  local nth="${2:-1}"
  grep -oE "text=\"$(printf '%s' "$pattern" | sed 's/[.[\*^$/]/\\&/g')\"[^>]*bounds=\"[^\"]*\"" "$WORKDIR/last_dump.xml" \
    | grep -oE 'bounds="[^"]*"' | sed -E 's/bounds="(.*)"/\1/' | sed -n "${nth}p"
}

# find_bounds_by_resid "resource-id-value"
find_bounds_by_resid() {
  local id="$1"
  grep -oE "resource-id=\"$id\"[^>]*bounds=\"[^\"]*\"" "$WORKDIR/last_dump.xml" \
    | grep -oE 'bounds="[^"]*"' | sed -E 's/bounds="(.*)"/\1/' | head -1
}

# find_bounds_by_class "android.widget.EditText"
# Useful for native dialog input fields (e.g. a window.prompt()'s text
# box) which often carry no resource-id at all — unlike find_bounds_by_*
# above, this only makes sense when you expect exactly one match (e.g. a
# modal native dialog, which excludes the underlying WebView content from
# the dump while it has focus).
find_bounds_by_class() {
  local class="$1"
  grep -oE "class=\"$(printf '%s' "$class" | sed 's/[.[\*^$/]/\\&/g')\"[^>]*bounds=\"[^\"]*\"" "$WORKDIR/last_dump.xml" \
    | grep -oE 'bounds="[^"]*"' | sed -E 's/bounds="(.*)"/\1/' | head -1
}

# find_bounds_by_content_desc "Profile"
find_bounds_by_content_desc() {
  local pattern="$1"
  grep -oE "content-desc=\"$(printf '%s' "$pattern" | sed 's/[.[\*^$/]/\\&/g')\"[^>]*bounds=\"[^\"]*\"" "$WORKDIR/last_dump.xml" \
    | grep -oE 'bounds="[^"]*"' | sed -E 's/bounds="(.*)"/\1/' | head -1
}

# find_bounds_by_button_text "Sign up"
# Headings and links often share the exact same text as the button you
# actually want (e.g. an H1 "Sign up" above a "Sign up" submit button) —
# this only matches real android.widget.Button nodes, which removes the
# guesswork of picking the right "nth" match.
find_bounds_by_button_text() {
  local pattern="$1"
  grep -oE "text=\"$(printf '%s' "$pattern" | sed 's/[.[\*^$/]/\\&/g')\"[^>]*class=\"android\.widget\.Button\"[^>]*bounds=\"[^\"]*\"" "$WORKDIR/last_dump.xml" \
    | grep -oE 'bounds="[^"]*"' | sed -E 's/bounds="(.*)"/\1/' | head -1
}

# --- tapping / typing --------------------------------------------------

tap_xy() {
  adb -s "$DEVICE" shell input tap "$1" "$2"
  # Tapping a text field doesn't focus it instantaneously — typing right
  # away can silently land nowhere (this bit the email field once: the tap
  # coordinates were correct but `input text` fired before the field had
  # focus, and the field was just empty afterward, no error of any kind).
  sleep 0.4
}

# tap_text "Sign up" [nth]
# Dumps fresh, fails loudly (with a diagnostic screenshot) if not found.
tap_text() {
  local pattern="$1"
  local nth="${2:-1}"
  dump_ui
  local bounds
  bounds=$(find_bounds_by_text "$pattern" "$nth")
  if [ -z "$bounds" ]; then
    fail "could not find element with text '$pattern' (nth=$nth)"
  fi
  local xy
  xy=$(_bounds_center "$bounds")
  log "tap_text '$pattern' -> $xy"
  tap_xy $xy
}

# try_tap_text "Not now" — like tap_text, but for optional/transient UI
# (system dialogs that may or may not appear, e.g. Samsung Pass offering to
# save a password). Dumps fresh and taps if found; silently returns 1
# (non-fatal) if not, instead of calling fail().
try_tap_text() {
  local pattern="$1"
  local nth="${2:-1}"
  dump_ui
  local bounds
  bounds=$(find_bounds_by_text "$pattern" "$nth")
  if [ -z "$bounds" ]; then
    return 1
  fi
  local xy
  xy=$(_bounds_center "$bounds")
  log "try_tap_text '$pattern' -> $xy"
  tap_xy $xy
  return 0
}

# tap_button_text "Sign up" — see find_bounds_by_button_text.
tap_button_text() {
  local pattern="$1"
  dump_ui
  local bounds
  bounds=$(find_bounds_by_button_text "$pattern")
  if [ -z "$bounds" ]; then
    fail "could not find a Button with text '$pattern'"
  fi
  local xy
  xy=$(_bounds_center "$bounds")
  log "tap_button_text '$pattern' -> $xy"
  tap_xy $xy
}

# tap_resid "displayName"
tap_resid() {
  local id="$1"
  dump_ui
  local bounds
  bounds=$(find_bounds_by_resid "$id")
  if [ -z "$bounds" ]; then
    fail "could not find element with resource-id '$id'"
  fi
  local xy
  xy=$(_bounds_center "$bounds")
  log "tap_resid '$id' -> $xy"
  tap_xy $xy
}

# scroll_to_top
# On a long scrollable page (e.g. Profile, after filling in several forms
# down the page), an element near the top like "Sign out" can end up
# partially scrolled out of view with unreliable/clipped reported bounds —
# this bit a real run (a "Sign out" tap landed at y=117, near the status
# bar, and actually hit whatever was left at the top of the viewport
# instead). Swipe down (finger moves top-to-bottom, content scrolls up
# toward its start) a few times before tapping anything known to live near
# the top of a page you may have scrolled down on.
scroll_to_top() {
  for _ in 1 2 3; do
    adb -s "$DEVICE" shell input swipe 540 500 540 2000 100
  done
  sleep 0.5
}

# scroll_down
# The opposite case from scroll_to_top: right after navigating to a fresh
# page, elements further down (below the fold) can report [0,0][0,0]
# bounds in the accessibility dump until they've actually been scrolled
# into view at least once — looks like Chromium doesn't finish measuring
# off-screen accessibility nodes immediately on load. Bit "Delete profile"
# (near the bottom of a long Profile page) right after tap_tab navigated
# there. Swipe up (finger moves bottom-to-top, content scrolls down) a few
# times before tapping anything known to live below the fold on a
# freshly-loaded page.
scroll_down() {
  for _ in 1 2 3; do
    adb -s "$DEVICE" shell input swipe 540 2000 540 500 100
  done
  sleep 0.5
}

# type_text "some text with spaces"
# adb shell input text mangles literal spaces (only the first word gets
# through) — must use the %s space encoding instead. Learned the hard way
# this session: without this, "Cut wood panels" becomes just "Cut".
type_text() {
  local encoded
  encoded=$(printf '%s' "$1" | sed 's/ /%s/g')
  adb -s "$DEVICE" shell input text "$encoded"
}

# fill_resid "displayName" "QA Tester"
# Tap the field by resource-id, type into it, then re-dump and verify the
# field actually holds what was typed — retries once on mismatch before
# failing loudly. Does NOT clear existing content first — use clear_resid
# before this if the field might already have text (e.g. a retry path).
# Skips verification for password fields (masked, can't read the value
# back) and just trusts the type happened after the tap_xy settle delay.
fill_resid() {
  local id="$1"
  local value="$2"
  local attempt

  for attempt in 1 2; do
    tap_resid "$id"
    type_text "$value"

    if [ "$id" = "password" ] || [ "$id" = "current-password" ] || [ "$id" = "new-password" ]; then
      return 0
    fi

    dump_ui
    if grep -q "text=\"$(printf '%s' "$value" | sed 's/[.[\*^$/]/\\&/g')\"[^>]*resource-id=\"$id\"" "$WORKDIR/last_dump.xml"; then
      return 0
    fi
    log "fill_resid '$id': value not confirmed after attempt $attempt, retrying"
  done

  fail "fill_resid '$id': field still doesn't contain '$value' after 2 attempts"
}

# clear_resid "password" [max_chars=40]
# Taps the field, moves cursor to end, backspaces up to max_chars times.
# Use before fill_resid on a field that might already have text (e.g. a
# retry), since adb has no reliable "select all" gesture here.
clear_resid() {
  local id="$1"
  local n="${2:-40}"
  tap_resid "$id"
  adb -s "$DEVICE" shell input keyevent KEYCODE_MOVE_END
  for _ in $(seq 1 "$n"); do
    adb -s "$DEVICE" shell input keyevent KEYCODE_DEL
  done
}

# tap_tab "home" | "friends" | "profile"
# The bottom .tab-bar uses `position: fixed` in CSS. Chromium's
# accessibility-tree export reports [0,0][0,0] bounds for the visible
# `text="Home"/"Friends"/"Profile"` TextView nodes inside it — a real
# tooling limitation, not an app bug (it renders and taps fine for an
# actual human; screenshots confirm the bar is visible in the right
# place). BUT the same `<nav>` landmark also gets exposed a second way, as
# a NavigationView-like accessibility node near the very bottom of the
# screen with `content-desc="Home"/"Friends"/"Profile"` (not `text=`) and
# *correct*, non-zero bounds — use that instead. Confirmed on this test
# phone: those bounds sit right at the bottom edge (~y 2100-2119 on a
# 1080x2280 screen), well below where the tab bar is actually painted —
# tap the reported bounds, not where it visually looks like it should be.
# Retries a few times on [0,0][0,0]: right after a fresh page load (e.g.
# straight off a signup redirect), this landmark node can report
# degenerate bounds for a moment before Chromium finishes measuring it —
# same underlying "not settled yet" issue as scroll_down's docstring.
tap_tab() {
  local label
  case "$1" in
    home) label="Home" ;;
    friends) label="Friends" ;;
    profile) label="Profile" ;;
    *) fail "tap_tab: unknown tab '$1' (expected home|friends|profile)" ;;
  esac
  local bounds attempt
  for attempt in 1 2 3 4; do
    dump_ui
    bounds=$(find_bounds_by_content_desc "$label")
    if [ -n "$bounds" ] && [ "$bounds" != "[0,0][0,0]" ]; then
      local xy
      xy=$(_bounds_center "$bounds")
      log "tap_tab '$1' -> $xy"
      tap_xy $xy
      return 0
    fi
    log "tap_tab '$1': got bounds '$bounds' on attempt $attempt, waiting for layout to settle"
    sleep 1
  done
  fail "tap_tab: content-desc=\"$label\" never got real bounds after $attempt attempts — the nav landmark's accessibility shape may have changed, recalibrate"
}

# NOTE on the keyboard: there is deliberately no "dismiss keyboard" helper.
# Every tap_* function above dumps the UI fresh immediately before tapping,
# which is what actually matters — an element's bounds are correct for
# whatever the *current* layout is, keyboard open or not. Don't use
# KEYCODE_BACK to close the keyboard: on a page with no WebView navigation
# history (e.g. reached by a direct `am start`, not a link click),
# Capacitor's default back-button behavior exits the app entirely, which
# happened more than once this session.

# --- assertions / fallback --------------------------------------------------

# assert_text_present "some text" — dumps fresh, fails with a screenshot if
# the text isn't anywhere on screen. Use this after an action to confirm it
# actually worked before moving on, instead of assuming.
assert_text_present() {
  local pattern="$1"
  dump_ui
  if ! grep -q "text=\"$(printf '%s' "$pattern" | sed 's/[.[\*^$/]/\\&/g')" "$WORKDIR/last_dump.xml"; then
    fail "expected text '$pattern' not found on screen"
  fi
  log "confirmed present: '$pattern'"
}

# fail "message" — screenshots the current (broken) state, logs clearly,
# and exits. This is the fallback: whoever reads the run's screenshots/log
# afterward can see exactly which step broke and what the screen looked
# like at that moment, instead of a silent hang or a confusing later error.
fail() {
  log "FAIL: $*"
  shot "FAILURE_STATE"
  log "Stopping here. Check $SHOT_DIR for the failure screenshot and last_dump.xml for the live element tree."
  exit 1
}
