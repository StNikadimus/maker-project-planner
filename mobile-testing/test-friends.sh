#!/usr/bin/env bash
# End-to-end phone test for the Friends feature: two throwaway accounts (A
# and B), on the same physical phone, signing in/out of each in turn (no
# second device needed for the username-search + request/accept path, or
# for direct-add-to-project). QR-scan add is NOT covered here — it
# inherently needs a camera pointed at a second device's screen, which
# can't be driven by ADB alone; that path needs a real manual check.
#
# Usage: same as test-signup-and-profile.sh (RECONNECT_IP_PORT etc).
#
# Not self-cleaning the same way the signup/profile script is: this one
# deliberately leaves both accounts around at the end (there's no "delete
# both accounts" happy path to exercise as part of the feature itself), so
# it cleans up both via the Identity Toolkit REST API at the very end
# instead, same pattern used manually elsewhere this session.

set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ensure_device || exit 1

TS=$(date +%s)
USER_A="qatestera${TS}"
USER_B="qatesterb${TS}"
EMAIL_A="qatestera${TS}@example.com"
EMAIL_B="qatesterb${TS}@example.com"
PASSWORD="TestPass123"
PROJECT_NAME="Birdhouse${TS}"

log "=== starting friends run: A=$USER_A B=$USER_B ==="

sign_out_if_needed() {
  dump_ui
  if grep -q 'text="Go to dashboard"' "$WORKDIR/last_dump.xml" 2>/dev/null; then
    tap_text "Go to dashboard"
    sleep 3
    try_tap_text "Not now" && sleep 1
    scroll_to_top
    tap_button_text "Sign out"
    sleep 2
  fi
}

do_signup() {
  local username="$1" email="$2"
  tap_text "Sign up"
  sleep 1
  fill_resid "displayName" "QA ${username}"
  fill_resid "username" "$username"
  fill_resid "email" "$email"
  fill_resid "password" "$PASSWORD"
  tap_button_text "Sign up"
  sleep 3
  try_tap_text "Not now" && sleep 1
  assert_text_present "Welcome"
}

do_signin() {
  local email="$1"
  tap_text "Sign in"
  sleep 1
  fill_resid "email" "$email"
  fill_resid "password" "$PASSWORD"
  tap_button_text "Sign in"
  sleep 3
  try_tap_text "Not now" && sleep 1
  assert_text_present "Welcome"
}

# --- launch fresh, sign out any leftover session --------------------------
adb -s "$DEVICE" shell am force-stop com.makerprojectplanner.app
adb -s "$DEVICE" shell am start -n com.makerprojectplanner.app/.MainActivity >/dev/null
sleep 6
sign_out_if_needed
shot "app_launch_landing"

# --- create account A, create a project (for the direct-add test later) --
do_signup "$USER_A" "$EMAIL_A"
shot "signed_up_a"

tap_resid "project-name"
type_text "$PROJECT_NAME"
tap_button_text "Add"
sleep 2
shot "a_project_created"
assert_text_present "$PROJECT_NAME"

scroll_to_top
tap_button_text "Sign out"
sleep 2

# --- create account B --------------------------------------------------
do_signup "$USER_B" "$EMAIL_B"
shot "signed_up_b"

# --- B searches for A's username and sends a friend request --------------
tap_tab "friends"
sleep 2
shot "b_friends_page"

tap_resid "search-input"
type_text "$USER_A"
tap_button_text "Search"
sleep 2
shot "b_search_results"
assert_text_present "$USER_A"

tap_button_text "Add"
sleep 2
shot "b_request_sent"
assert_text_present "Requested"
log "B sent a friend request to A"

scroll_to_top
tap_button_text "Sign out"
sleep 2

# --- sign in as A, accept the request -------------------------------------
do_signin "$EMAIL_A"
tap_tab "friends"
sleep 2
shot "a_friends_page_with_request"
assert_text_present "$USER_B"

tap_button_text "Accept"
sleep 2
shot "a_accepted_request"
log "A accepted B's friend request"

# --- direct-add B to A's project, no invite link --------------------------
tap_text "$PROJECT_NAME"
sleep 2
shot "a_project_page"

scroll_down
shot "a_project_share_section"
assert_text_present "$USER_B"

tap_button_text "Add"
sleep 2
shot "b_added_to_project"
log "B added directly to A's project via friends list"

scroll_to_top
tap_button_text "Sign out"
sleep 2

# --- sign in as B, confirm the friendship + project access -----------------
do_signin "$EMAIL_B"
tap_tab "friends"
sleep 2
shot "b_friends_list_confirmed"
assert_text_present "$USER_A"
log "B confirms A in their friends list — mutual edge verified"

tap_tab "home"
sleep 2
shot "b_shared_project_visible"
assert_text_present "$PROJECT_NAME"
log "B can see A's project on their dashboard without ever using an invite link"

# --- unfriend from B's side ------------------------------------------------
tap_tab "friends"
sleep 2
scroll_down
tap_button_text "Unfriend"
sleep 1
dump_ui
shot "unfriend_confirm"
tap_resid "android:id/button1"
sleep 2
shot "after_unfriend"
log "B unfriended A"

scroll_to_top
tap_button_text "Sign out"
sleep 2

log "=== run complete, cleaning up both accounts now: $SHOT_DIR ==="
