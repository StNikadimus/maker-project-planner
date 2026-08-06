# Maker Project Planner

A Reminders-style planner for DIY/maker projects, built as a plain HTML/CSS/JS
web app (also the public website) that will later be wrapped with Capacitor
for native iOS and Android apps. Backend is Firebase (Auth, Firestore, Cloud
Functions, Hosting, App Check).

This file is read automatically at the start of every Claude Code session in
this repo. It contains the Product Brief, Data Model, Security Principles,
current build status, and the operating notes needed to pick up exactly
where any previous session left off — treat it as the source of truth, not
just background reading. Do not re-derive or contradict it — update this
file itself if a decision changes.

## Working with the user

- The user (Nik / StNikadimus) prefers to communicate in **Slovenian**.
  Reply in Slovenian by default in this repo. All code, comments, commit
  messages, and file content stay in **English** regardless — only the
  conversational replies are Slovenian.
- The user is building this by directing Claude Code through each phase
  conversationally, not by writing code themselves — explain what you did
  and why in plain terms, and proactively flag tradeoffs (like the Blaze
  billing decision below) rather than silently picking one.
- The user explicitly likes the current minimal visual style (see
  `public/css/style.css`: blue `#2d6cdf` primary / red `#c0362c` danger,
  pill-shaped `.btn` buttons, plain list rows with a bottom border instead
  of boxed per-item cards, the `.spinner`/`.loading-state` components).
  Extend this existing CSS vocabulary for new UI rather than introducing a
  new visual language.
- The user won't add a billing method to the Firebase project even where
  the free tier would almost certainly mean $0/month (see the Blaze note
  under Security Principles) — this is a considered preference, not
  something to re-litigate casually. If a future feature (e.g. Phase 7)
  hits the same wall, surface the choice again briefly rather than
  assuming, but expect the same answer and have a non-Cloud-Functions
  fallback in mind if one is feasible.
- After every deploy, tell the user to hard-refresh (Ctrl+Shift+R) or use
  a private window before testing. Firebase Hosting caches JS/CSS, and a
  stale cached script has more than once looked exactly like a real bug
  (confusing "it doesn't work" reports that were actually just the old
  file). Rule out caching first.
- Before asking the user to manually test something you could
  smoke-test yourself first: create disposable throwaway Firebase Auth
  accounts via the Identity Toolkit REST API
  (`identitytoolkit.googleapis.com/v1/accounts:signUp`, using the public,
  non-secret `apiKey` from `firebaseConfig.js`), replicate the *exact*
  sequence of client calls (including reads that only exist for UI
  branching, not just the security-critical writes — a shortcut here has
  hidden real bugs twice already), then delete the test docs and accounts
  (`accounts:delete`) afterward. For `serverTimestamp()`-bearing writes,
  replicate via the Firestore REST `:commit` API with `updateTransforms` /
  `setToServerValue: REQUEST_TIME` — a plain hardcoded timestamp will not
  equal `request.time` in rules and gives a false-negative denial.

## Product Brief

What it is: A Reminders-style planner for DIY/maker projects. A user creates
Projects; each Project contains an ordered list of Steps (a checklist). Steps
can optionally note materials/tools needed. A Project can be shared with
collaborators via an invite — everyone with access can add and check off
steps, and sees changes live. A later phase adds an AI-generated time
estimate per step.

Every account has a unique `username` (separate from the free-form
`displayName`), set at signup and changeable from the Profile tab. A
Friends tab lets users add each other either instantly by scanning a QR
code, or by searching a username (which sends a request the other person
must accept) — see Security Principles for why those two paths have
different consent models. Friends can block or report each other, and a
project owner can add a friend directly as a collaborator without an
invite link.

Platforms: one responsive web app codebase, which also serves as the public
website, wrapped with Capacitor to produce native iOS and Android apps.

UI language: English.

Backend: Firebase — Authentication, Firestore, Cloud Functions, Hosting, App
Check.

Explicitly NOT in MVP: payments, push notifications, offline mode, AI
estimation (that's the stretch phase at the end).

## Data Model

```
users/{uid}
  displayName: string
  username: string          // unique handle, lowercase [a-z][a-z0-9_]{2,19}
  email: string
  createdAt: timestamp
  photoURL: string | null   // always null today — see Security Principles

usernames/{username}        // doc ID *is* the lowercase username
  uid: uid                  // the owning user
  displayName: string       // denormalized copy, see Security Principles
  photoURL: string | null   // denormalized copy, always null today

users/{uid}/friends/{friendUid}      // mutual edge, written to BOTH sides
  uid: uid                  // = friendUid
  username, displayName, photoURL: denormalized snapshot of the friend
  addedAt: timestamp

users/{uid}/friendRequests/{requesterUid}   // pending, recipient's inbox
  username, displayName, photoURL: denormalized snapshot of the requester
  requestedAt: timestamp

users/{uid}/blocked/{blockedUid}
  blockedAt: timestamp

reports/{reportId}          // auto-ID; write-only, no read/processing yet
  reporterUid, reportedUid: uid
  reason: string
  createdAt: timestamp

projects/{projectId}
  name: string
  category: "diy"
  ownerId: uid
  createdAt, updatedAt: timestamp

projects/{projectId}/steps/{stepId}
  title: string
  notes: string
  materials: array<string>
  tools: array<string>
  done: boolean
  order: number
  createdBy: uid
  createdAt, updatedAt: timestamp

projects/{projectId}/invites/{token}   // doc ID *is* the random token
  createdBy: uid
  expiresAt: timestamp
  redeemedBy: uid | null
  redeemedAt: timestamp | null

projects/{projectId}/members/{uid}     // doc ID = the collaborator's own uid
  uid: uid
  joinedAt: timestamp
  // exactly one of the next two, depending on how they joined:
  token: string              // invite path — the now-spent invite token
  addedVia: "friend"         // direct-add path — owner added them from friends
```

Note: this deviates from the original plan, which had a single top-level
`invites/{inviteId}` collection with a `projectId` field, redeemed only via
a `redeemInvite` Cloud Function. See Security Principles below for why, and
`SECURITY.md` for exactly how access control is enforced instead.

## Security Principles (non-negotiable — apply from Phase 1 onward)

- The Firebase client config (apiKey etc.) is safe to ship in frontend code —
  it is not a secret. Access control is enforced server-side by Security
  Rules + Auth, not by hiding this key. Do not put it in a "secret" env file
  and don't treat it as sensitive.
- Firestore Security Rules default-deny everything. Every collection gets an
  explicit, narrow allow rule.
- **Deliberate exception, decided 2026-08-05:** invite creation/redemption
  is implemented via Security Rules only, with no Cloud Function, because
  Cloud Functions require the Firebase project to be on the Blaze
  (pay-as-you-go) plan, and the user chose to stay on the free Spark plan
  rather than add a billing method. The originally-planned design (a
  top-level `invites/{inviteId}` collection, redeemed only via a
  `redeemInvite` Cloud Function using the Admin SDK) would have been
  strictly more secure and is still written and ready to deploy in
  `functions/index.js` — it's just not currently active. The rules-only
  replacement (see Data Model above) uses the invite document's ID as the
  unguessable secret (`allow get` but never `allow list`, so invites can't
  be enumerated) and Firestore's per-document write serialization to make
  redemption single-use (`allow update` only if `redeemedBy` is still
  `null`). It is well-tested (`firestore-tests/`) but has one known,
  accepted gap: it isn't a single atomic operation the way a transactional
  Cloud Function would be, so if a client crashes between claiming the
  invite and being granted membership, that one invite is burned and the
  owner needs to issue a new one. If the project ever moves to Blaze
  (Phase 7 will require it anyway, for the Claude API key), prefer
  switching back to the Cloud Function version.
- **Username uniqueness (decided 2026-08-06)** reuses the exact same
  "document ID is the whole access-control mechanism" trick as invite
  tokens: `usernames/{username}` doc IDs are the lowercase handle itself,
  and Firestore only routes a write through the `allow create` branch (not
  `allow update`) when the doc doesn't already exist — so a taken username
  naturally has no matching rule and gets denied, no Cloud Function needed.
  Read is public (`allow read: if true`), unlike every other collection in
  this app, because signup needs to availability-check a candidate username
  *before* the account (and its auth token) exists — it only reveals
  whether one exact, already-guessed handle is taken, not the full list, so
  this doesn't weaken anything. Changing your username (already
  authenticated) is a single atomic `writeBatch` — old handle freed, new
  handle claimed, `users/{uid}.username` updated, all-or-nothing. Signup
  itself has one unavoidable non-atomic seam, same shape as the invite
  tradeoff above: Firebase Auth account creation and the Firestore
  username-claim batch are two separate calls, so a race loss on the
  username *after* the account was created is possible. Unlike the invite
  case, this is handled with a clean rollback rather than an accepted gap:
  `signup.js` calls `deleteUser()` on the just-created account immediately
  (the session is seconds old, no reauth needed) and asks the user to
  retry, so signup never leaves an orphaned account.
- **Delete-profile does not cascade into other people's projects.** It
  deletes each project the user owns (same shallow delete the dashboard's
  existing "Delete" button already does — leaves that project's `steps`/
  `invites`/`members` subcollections orphaned, a pre-existing accepted
  tradeoff, not something this feature changes), their own `users/{uid}`
  doc, and their `usernames/{username}` doc. It does **not** remove their
  `members/{uid}` doc from projects owned by *other* people — that path is
  `allow update, delete: if false` ("permanent for MVP", see
  `firestore.rules`), and enabling it is really a separate "remove
  collaborator" feature decision, not part of account deletion.
- **Friends (decided 2026-08-06)**: two different consent models for
  adding a friend, chosen by the user — QR-scan is instant (in-person
  scanning implies consent), username search creates a
  `friendRequests` doc the recipient must accept. Both end up creating the
  exact same `users/{uid}/friends/{friendUid}` mutual-edge shape (written
  to both users' subcollections in one `writeBatch`), so a single Firestore
  rule covers both: either of the two named parties may create or delete
  the edge on either side (`request.auth.uid == ownerUid ||
  request.auth.uid == friendUid`). That rule can't distinguish *why* a
  write is happening, so a client could technically skip the intended
  request/accept UX and instant-add a stranger found via search — accepted
  tradeoff, same "rules are the boundary, the UI is only UX" shape as
  everywhere else in this app; worst case is an unwanted friends-list
  entry, a one-tap unfriend/block, not a privilege escalation.
  `users/{uid}` stays exactly as private as before (no other user may ever
  read it, email included) — anything another user needs to see
  (username, displayName, photoURL) is **denormalized** into the already-
  public `usernames/{username}` doc and copied again into the
  `friends`/`friendRequests` edge docs at write time, so rendering a
  friends list or search result never reads anyone else's private profile.
  Blocking (`users/{uid}/blocked/{blockedUid}`, self-only) is checked by
  both the `friends` and `friendRequests` create rules in both directions.
  Report (`reports/{reportId}`) is deliberately minimal per product
  decision: write-only, capturing the signal only — no read access, no
  admin UI, no processing; that's future work.
  QR generation/scanning is pure web (a CDN-loaded `qrcode` library to
  render your own code, `getUserMedia` + a CDN-loaded `jsQR` decoder to
  read someone else's), not a native Capacitor barcode plugin — avoids a
  new native dependency and any `AndroidManifest` intent-filter work
  beyond the `CAMERA` permission itself. The QR payload is just the plain
  username string; scanning happens entirely inside the already-open app,
  so there's no reason to involve OS-level deep linking.
  Direct-add-to-project (`projects/{id}/members/{uid}` with `addedVia:
  "friend"` instead of `token`) extends the existing invite-redemption
  create rule with a second, mutually exclusive shape: the project owner
  may create the doc directly for anyone in their own
  `users/{ownerUid}/friends` subcollection, no invite involved.
- **Profile pictures were built, then deliberately dropped, 2026-08-06.**
  A working version existed (Cloud Storage upload, `storage.rules`,
  `profile.js` upload UI) but Storage had never been enabled on this
  Firebase project, and enabling it requires a one-time manual "Get
  Started" click in the console — the user chose to skip the feature
  entirely rather than take that step, the same instinct as the
  Blaze-plan avoidance above even though Storage's free tier doesn't
  actually require billing. All of that code was removed again (see git
  history around this date if it's ever wanted back). The `photoURL: string
  | null` field on `users/{uid}` and the `photoURL` denormalized copies on
  `usernames/{username}` and the friends/friendRequests edges were **kept**
  in the data model and rules — they cost nothing sitting at `null` and
  keep the door open for re-adding this later without another rules
  migration — but nothing in the client ever sets them to non-null right
  now.
- Real secrets — the Firebase Admin service account, and later the
  Claude/LLM API key — live only in Cloud Functions config/secret manager.
  Never in client code, never committed to git.
- Enable Firebase App Check as soon as Auth exists (Phase 4).
- Once real domains/bundle IDs exist, restrict the web API key by HTTP
  referrer and mobile keys by bundle ID / package name in Google Cloud
  Console.
- Validate and sanitize all input server-side (Security Rules and/or Cloud
  Functions) — client-side validation is UX only, never the security
  boundary.
- **Firestore rules gotcha worth remembering**: a nested `match` block
  (e.g. `match /projects/{projectId} { match /members/{uid} { allow read:
  ... } } }`) governs `get()` on a fully-known path fine, but is **not**
  considered at all for `list`/collection-group query operations (the
  dashboard's "Shared with you" `collectionGroup(db, "members")` query hit
  this — see `firestore.rules`). Collection-group `list` support needs its
  own top-level rule using the `{path=**}` recursive wildcard, and that
  rule's condition must reference a `resource.data` field that correlates
  with the query's own `where()` filter (not a path wildcard) — path
  wildcards aren't resolved yet when Firestore checks whether a `list` is
  safe, and using one throws a `Null value error`.

## Project structure

- `public/` — the Firebase Hosting root. All browser-facing code lives here
  (`index.html`, `css/`, `js/`). This is also the Capacitor `webDir` — the
  same static site is wrapped as-is for the iOS/Android builds, no build
  step or separate mobile codebase.
- `capacitor.config.json` — Capacitor config (appId `com.makerprojectplanner.app`).
  `android/` and `ios/` are the generated native platform projects — commit
  them (that's normal for Capacitor; only their build output is
  gitignored). After changing anything in `public/`, run `npx cap sync` to
  copy the changes into both native projects before rebuilding.
- Root `package.json` / `node_modules/` — Capacitor CLI and platform
  packages only (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
  `@capacitor/ios`). Unrelated to `functions/` or `firestore-tests/`, which
  keep their own `package.json`.
- `src/` — reserved for shared, non-browser source (e.g. code shared between
  tooling/scripts) added in later phases. Empty for now.
- `functions/` — Cloud Functions source (Admin SDK code, callable functions
  added from Phase 5 onward).
- `firestore.rules` / `firestore.indexes.json` — Firestore Security Rules and
  index definitions.
- `firebase.json` / `.firebaserc` — Firebase project configuration.
- `firestore-tests/` — automated test suite for `firestore.rules`, run
  against the Firestore emulator. See `SECURITY.md` for how to run it.
- `SECURITY.md` — plain-language access-control guarantees, how to run the
  rules test suite, and the API key restriction reminder.
- `mobile-testing/` — reusable ADB-driving helpers (`lib.sh`) plus runnable
  end-to-end phone test scripts, built because hand-driving ADB taps by
  hardcoded pixel coordinates kept breaking (the on-screen keyboard reflows
  the WebView layout every time it opens/closes). The pattern that actually
  works: dump the UI immediately before every tap, find the element's
  *current* bounds, tap its center — never reuse coordinates from an
  earlier dump. See the comments at the top of `lib.sh` before writing a
  new test script; extend it rather than re-deriving the pattern by hand
  again.

## Local development

No build step is required (plain HTML/CSS/JS). To preview `public/` locally:

```
npx serve public
```

or open `public/index.html` directly in a browser. You can also use:

```
npx firebase-tools emulators:start
```

The `firestore-tests/` rules suite needs a JDK on `PATH` (the Firestore
emulator runs on the JVM) — see `SECURITY.md` for the exact run command.

Building/running the Android app (`android/`) needs Android
Studio/SDK/platform-tools and, for the emulator specifically, hardware
acceleration (KVM on Linux, verify with
`$ANDROID_HOME/emulator/emulator -accel-check`; if this is itself a VM,
the host hypervisor must support nested virtualization or the emulator
will refuse to run x86_64 images at all). iOS (`ios/`) needs Xcode on a
real Mac — not available yet, so it's untested; the platform files are
generated and ready whenever a Mac is available (`npx cap sync ios` after
any `public/` change, then open in Xcode).

## Deploying

The real Firebase project (`maker-project-planner`) already exists and
`public/js/firebaseConfig.js` / `.firebaserc` already point at it — nothing
to fill in.

`firebase login` does **not** work from Claude Code's Bash tool (no
interactive browser/TTY) — it fails outright, and even piping it through
`!<command>` into the user's own terminal hits the same problem. The
working non-interactive path:

1. Ask the user to run `npx firebase-tools login:ci` themselves in their
   own real terminal (not through the agent) — it opens a browser, then
   prints a CI token. (On Windows this needed `npx.cmd` specifically,
   since plain `npx` as a `.ps1` script can be blocked by PowerShell's
   execution policy — shouldn't apply on Linux/macOS.)
2. The user pastes that token into the chat.
3. Run deploys with it set inline for that one command only — never write
   it to a file or commit it:
   ```
   FIREBASE_TOKEN="<pasted token>" npx firebase-tools deploy --only hosting,firestore --token "$FIREBASE_TOKEN"
   ```
   (`--only` can be `hosting`, `firestore` (rules+indexes), `firestore:rules`,
   or `functions` as needed — functions deploy will fail until the project
   is on Blaze, see the invite-redemption note above. No `storage` target —
   Cloud Storage was deliberately never enabled on this project, see
   Security Principles.)

`login:ci` is deprecated but functional; firebase-tools itself suggests a
service account + `GOOGLE_APPLICATION_CREDENTIALS` as the modern
replacement — worth switching to if deploys become frequent enough that
regenerating a CI token each session gets old (a service account key is a
real secret though: never commit it, keep it out of the repo entirely,
`.gitignore` already covers `*serviceAccountKey*.json`).

## Git workflow

- After finishing a phase and confirming it works (manually, per that
  phase's "done when" checklist), commit with a clear message:
  `git add .` then `git commit -m "Phase N: <short description>"`.
- Push with `git push -u origin main` every time (not just the first
  push) — using `-u` repeatedly is harmless and prevents ever hitting a
  missing-upstream error again.
- Before every commit, check `git status` (and diff if unsure) and make
  sure nothing sensitive is staged — no `.env` files, no
  `serviceAccountKey.json` or other Admin SDK credentials, no API keys of
  any kind. (The Firebase client `apiKey` in `firebaseConfig.js` is the
  one exception — see Security Principles above, it's not a secret.)
- `.gitignore` must at minimum exclude: `node_modules/`, `.env`, `.env.*`,
  `*serviceAccountKey*.json`, `.DS_Store`, and any build output folders.
- Never commit a real secret "temporarily, to fix in the next commit" —
  if something sensitive is accidentally staged, stop and tell the user
  instead of committing it. Removing it in a later commit does not remove
  it from git history.
- If a commit or push fails, show the exact error instead of retrying
  blindly or suggesting a new repo.

## Build phases

The app is built in 8 phases (0 through 7). Work through phases in order;
each has explicit manual "done when" acceptance checks (including
cross-account access checks) that must be verified by hand, not just by a
successful build. Status as of 2026-08-05:

- **Phase 0 — Setup**: done. Firebase Hosting/Firestore/Functions
  scaffolded, deployed.
- **Phase 1 — Auth**: done. Email/password sign-up/in/out, protected
  dashboard, confirmed working by the user.
- **Phase 2 — Projects CRUD**: done. Create/list/open/delete, cross-account
  isolation confirmed.
- **Phase 3 — Steps CRUD**: done. Add/check/delete/reorder steps inside a
  project, confirmed working.
- **Phase 4 — Security hardening**: done. Emulator rules test suite (grew
  to 31 tests through later phases), App Check (reCAPTCHA v3) wired in but
  **not yet enforced** in the console (deliberate — flip it on once token
  delivery is confirmed via the App Check metrics page).
- **Phase 5 — Collaboration via invites**: done, confirmed working. Built
  **without Cloud Functions** (see Security Principles above for why) —
  invites/membership enforced entirely by `firestore.rules`. Hit and fixed
  two real bugs post-"done": a `members/{uid}` read rule that blocked a
  first-time joiner's own pre-check, and the collection-group `list` rule
  gotcha noted above.
- **Phase 6 — Capacitor wrap**: done for Android (built, installed, and
  manually verified — sign-up, dashboard, project/step CRUD, native
  `window.confirm()` dialogs — inside a real Android emulator against the
  live Firebase project). iOS platform files generated but **never built
  or tested** — no Mac available yet.
- **Currently**: past the initial UI polish pass (loading-spinner component
  done — including a real bug fix, see below). Built, in order: a bottom
  tab bar (Home / Friends / Profile), a Profile page (change username,
  change password, reset password by email, delete profile), and the
  Friends feature itself (QR-instant-add, username-search-add with
  request/accept, block, unfriend, report, and adding a friend directly to
  a project without an invite link) — see Security Principles above for
  the design. Profile-picture upload was also built and then deliberately
  removed again (Cloud Storage was never enabled on this project and the
  user chose to skip it rather than enable it — see Security Principles);
  `photoURL` fields remain in the data model at `null` for later.
  `firestore.rules` and `hosting` are now deployed to the live project
  (2026-08-06). The Firestore rules test suite is green (64 tests). On the
  real phone, against the live deployed rules,
  `mobile-testing/test-signup-and-profile.sh` passes clean end-to-end:
  sign up with username, tab bar nav, change username, change password,
  reset-password email, sign out, sign back in with the new password, and
  delete-profile (with reauth) all confirmed working — that script is
  self-cleaning (its own delete-profile step removes the throwaway
  account) and safe to re-run any time. The Friends feature itself (QR
  add, username-search request/accept, block, unfriend, report,
  direct-add-to-project) is written and rules-tested but **not yet
  verified on-device** — that's the very next thing to do. Two real ADB
  automation gotchas were hit and fixed while writing that first script,
  both now handled in `mobile-testing/lib.sh` — worth reading before
  writing the Friends test script rather than rediscovering them: (1) the
  `.tab-bar`'s `position: fixed` links report `[0,0][0,0]` bounds for
  their `text=` nodes in the accessibility dump, but the same `<nav>`
  landmark is *also* exposed as a second accessibility node near the
  bottom of the screen with a working `content-desc` and correct bounds —
  `tap_tab()` uses that. (2) elements below the fold on a freshly-loaded
  page can report `[0,0][0,0]` too, until scrolled into view at least once
  — `scroll_down`/`scroll_to_top` exist for this.
  `mobile-testing/test-friends.sh` is written (two throwaway accounts,
  covers username-search request/accept, direct-add-to-project, unfriend —
  QR-scan itself isn't automatable, it needs a camera pointed at a second
  device) but got interrupted mid-run on 2026-08-06: after roughly two
  hours of continuous heavy on-device automation, the WebView's `.tab-bar`
  stopped rendering *and* stopped being tappable at its known coordinates
  — reproduced after a full app uninstall+reinstall too, which rules out
  app-level state/cache as the cause. This looks like a device/System
  WebView-level degradation from the sheer amount of testing done in one
  sitting, not a code bug (the same tab bar rendered and worked correctly
  dozens of times earlier the same session, including a full clean
  `test-signup-and-profile.sh` pass). The user is restarting the test
  phone and taking over verification manually from here. If this recurs
  after a fresh restart, it's worth treating as a real lead rather than
  dismissing it again. Take direction from the user on what comes after
  that.
- **2026-08-06 bug fixes**: found via a real end-to-end pass on a physical
  Android phone (not the emulator — see the note under Local development
  about nested-virtualization emulator flakiness on this dev VM). Two real
  bugs, both fixed: (1) `.loading-state { display: flex }` in
  `style.css` had the same CSS specificity as the browser's default
  `[hidden] { display: none }` and always won since it's declared later in
  the cascade, so `loadingEl.hidden = true` never actually hid the spinner
  on the dashboard or project page — fixed with an explicit
  `.loading-state[hidden] { display: none; }` override. (2) Invite-link
  creation intermittently failed with `permission-denied`: `project.js`
  computed `expiresAt` as the *client's* `Date.now() + 7d`, but
  `firestore.rules` compared it against `request.time` (the *server's*
  clock) with zero tolerance for the same 7-day span, so any clock skew or
  network latency flipped the comparison — fixed by giving the rule a
  10-minute buffer.
- **Phase 7 — AI step-time estimation**: not started. Needs a Cloud
  Function to call the Claude API without exposing the key client-side —
  will hit the same Blaze-plan wall as Phase 5 did. Raise that tradeoff
  again when this phase starts rather than assuming the answer has
  changed.
