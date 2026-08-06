#!/usr/bin/env bash
# End-to-end phone test: sign up (with the new username field) through the
# full Profile page flow (change username, change password, reset password
# email, delete profile). Self-cleaning by design — delete-profile at the
# end removes the throwaway account and its data, so there's normally
# nothing left to clean up manually afterward.
#
# Usage:
#   ./test-signup-and-profile.sh
#   RECONNECT_IP_PORT=192.168.1.135:NNNNN ./test-signup-and-profile.sh
#     (use this form when wireless ADB dropped — get the current IP:port
#     from the phone's Settings > Developer options > Wireless debugging)
#
# Review afterward: open mobile-testing/screenshots/<run-id>/ in order —
# filenames are numbered and named after the step, log.txt has the full
# command trail. A failed run stops immediately and its last screenshot is
# named *_FAILURE_STATE.png.

set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ensure_device || exit 1

TS=$(date +%s)
USERNAME="qatester${TS}"
NEW_USERNAME="qatester${TS}x"
EMAIL="qatest${TS}@example.com"
PASSWORD="TestPass123"
NEW_PASSWORD="TestPass456"

log "=== starting run: username=$USERNAME email=$EMAIL ==="

# --- launch fresh ------------------------------------------------------
# Firebase Auth sessions persist across app restarts, so a previous run
# that didn't reach its own delete-profile step (e.g. it failed partway)
# leaves the app signed in — index.html then shows "Go to dashboard"
# instead of "Sign up"/"Sign in", which breaks every coordinate below. Sign
# out unconditionally first; harmless no-op if already signed out.
adb -s "$DEVICE" shell am force-stop com.makerprojectplanner.app
adb -s "$DEVICE" shell am start -n com.makerprojectplanner.app/.MainActivity >/dev/null
sleep 6
dump_ui
if grep -q 'text="Go to dashboard"' "$WORKDIR/last_dump.xml" 2>/dev/null; then
  log "already signed in from a previous run — signing out first"
  tap_text "Go to dashboard"
  sleep 3
  try_tap_text "Not now" && sleep 1
  tap_button_text "Sign out"
  sleep 2
fi
shot "app_launch_landing"

# --- sign up -------------------------------------------------------------
tap_text "Sign up"
sleep 1
shot "signup_form_empty"

fill_resid "displayName" "QA Tester"
fill_resid "username" "$USERNAME"
fill_resid "email" "$EMAIL"
fill_resid "password" "$PASSWORD"
shot "signup_form_filled"

tap_button_text "Sign up"
sleep 3

# Samsung Pass may offer to save the password — dismiss if present, but
# it's transient/optional, so a miss here must not abort the whole run.
try_tap_text "Not now" && sleep 1
shot "dashboard_after_signup"
assert_text_present "Welcome, QA Tester"
assert_text_present "Home"
assert_text_present "Profile"
log "tab bar present on dashboard"

# --- go to profile tab ----------------------------------------------------
tap_tab "profile"
sleep 2
shot "profile_page_initial"
assert_text_present "$USERNAME"
log "profile page shows the username set at signup"

# --- change username -------------------------------------------------------
fill_resid "new-username" "$NEW_USERNAME"
shot "username_form_filled"
tap_button_text "Update username"
sleep 2
shot "username_updated"
assert_text_present "$NEW_USERNAME"
log "username change confirmed on screen"

# --- change password -------------------------------------------------------
fill_resid "current-password" "$PASSWORD"
fill_resid "new-password" "$NEW_PASSWORD"
shot "password_form_filled"
tap_button_text "Update password"
sleep 2
shot "password_updated"
assert_text_present "Password updated."

# --- reset password email ---------------------------------------------------
tap_button_text "Send reset email"
sleep 2
shot "reset_email_sent"
assert_text_present "Reset email sent"

# --- sign out, sign back in with the NEW password to prove it took --------
scroll_to_top
tap_button_text "Sign out"
sleep 2
shot "signed_out"
assert_text_present "Sign in"

tap_resid "email"
type_text "$EMAIL"
fill_resid "password" "$NEW_PASSWORD"
shot "signin_with_new_password_filled"
tap_button_text "Sign in"
sleep 3
try_tap_text "Not now" && sleep 1
shot "signed_in_with_new_password"
assert_text_present "Welcome, QA Tester"
log "new password confirmed working"

# --- delete profile (also the cleanup step) --------------------------------
tap_tab "profile"
sleep 2
scroll_down
tap_button_text "Delete profile"
sleep 1
dump_ui
shot "delete_confirm_dialog"
tap_resid "android:id/button1"
sleep 1
shot "delete_password_prompt"

dump_ui
# No resource-id on this dialog's input (window.prompt() dialogs often
# don't carry one) — find by class instead. Safe to assume a single match:
# a modal native dialog excludes the underlying WebView content from the
# dump while it holds focus.
PROMPT_BOUNDS=$(find_bounds_by_class "android.widget.EditText")
if [ -z "$PROMPT_BOUNDS" ]; then
  fail "expected a password prompt (window.prompt) after confirming delete, but found no EditText field — dialog markup may differ, check delete_password_prompt screenshot"
fi
PROMPT_XY=$(_bounds_center "$PROMPT_BOUNDS")
tap_xy $PROMPT_XY
type_text "$NEW_PASSWORD"
shot "delete_password_filled"
tap_resid "android:id/button1"
sleep 3
shot "after_delete_profile"
assert_text_present "Sign in"
assert_text_present "Sign up"
log "account deleted, back on the landing page — no manual cleanup needed"

log "=== run complete: $SHOT_DIR ==="
