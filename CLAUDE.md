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
  email: string
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
  token: string             // the (now-spent) invite token used to join
  joinedAt: timestamp
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
   is on Blaze, see the invite-redemption note above.)

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
- **Currently**: a UI polish pass on top of the finished phases (e.g. a
  proper loading-spinner component replacing plain "Loading…" text) before
  starting Phase 7. Take direction from the user on what else to polish.
- **Phase 7 — AI step-time estimation**: not started. Needs a Cloud
  Function to call the Claude API without exposing the key client-side —
  will hit the same Blaze-plan wall as Phase 5 did. Raise that tradeoff
  again when this phase starts rather than assuming the answer has
  changed.
