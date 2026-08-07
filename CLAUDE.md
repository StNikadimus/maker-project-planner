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
invite link. Project owners can also remove a collaborator from the
Project page at any time.

Every account can additionally open a **Business** and/or an
**Education** profile from the Profile tab — fully separate project
workspaces from Personal, switchable via a dropdown at the top of the
dashboard. While a Business profile is active, a **Team** tab appears in
the bottom tab bar: the owner adds/removes people (must already be
friends) from a team roster and picks which of their Business projects
the whole team can see — see Security Principles for how this reuses the
existing collaborator mechanism rather than being a new access-control
system. Education gives the opener (the teacher) a permanent 8-digit PIN;
new signups can enter a teacher's PIN to link their account to that
teacher's class, which lets the teacher see (read-only) that student's
projects from their dashboard's "My Students" section. A teacher can
release a student at any time, which only removes them from the roster —
the student keeps their account and data and regains the ability to open
their own Business/Education profile. See Security Principles for the
full design and its tradeoffs.

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
  businessWorkspaceId: string | null   // set once, from null, when opened
  teacherWorkspaceId: string | null    // set once, from null, when opened
  studentOfTeacherUid: string | null   // linked teacher, set at signup only
  studentOfWorkspaceId: string | null  // that teacher's workspace id

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

workspaces/{workspaceId}          // auto-ID; Personal has NO doc — it's
  type: "business" | "education"  // just the owner's own uid, see below
  ownerId: uid
  createdAt: timestamp
  teacherPin: string              // education only, 8 digits

workspaces/{workspaceId}/students/{uid}   // education only, teacher's roster
  uid: uid
  username, displayName: denormalized snapshot of the student
  joinedAt: timestamp

workspaces/{workspaceId}/team/{uid}   // business only, owner-managed roster
  uid: uid
  username, displayName: denormalized snapshot of the team member
  addedAt: timestamp

teacherPins/{pin}                 // doc ID *is* the 8-digit PIN itself
  workspaceId: string
  teacherUid: uid

projects/{projectId}
  name: string
  category: "diy"
  ownerId: uid
  workspaceId: string        // own uid for Personal; a workspaces/{id} for
                              // Business/Education; immutable after create
  linkedTeacherUid: uid | null  // denormalized copy of the owner's
                                 // studentOfTeacherUid *at creation time* —
                                 // see Security Principles for why
  visibleToTeam: boolean    // business "team" bulk-visibility flag; always
                             // written (false) even on Personal/Education
                             // projects — see Security Principles
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
  viewWorkspaceId: uid | string  // invite path only — the JOINER's own
                                   // choice of which of THEIR OWN tabs this
                                   // shows under, picked at accept time;
                                   // absent on the direct-add path, client
                                   // defaults a missing value to Personal
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
- **Remove collaborator (decided 2026-08-06)**: `projects/{id}/members/{uid}`
  delete, previously `if false` ("permanent for MVP"), is now owner-only
  (`allow delete: if isProjectOwner(projectId)`), surfaced as a "Remove"
  button per collaborator on the Project page. A member can't remove
  themself or anyone else — only the project owner can.
- **QR code library (fixed 2026-08-06)**: the `qrcode` npm package has no
  prebuilt classic-`<script>` browser bundle at the path jsDelivr's naive
  CDN URL implied (`qrcode@1.5.3/build/qrcode.min.js` 404s — that version
  ships no `build/` directory at all). Fixed by importing it as a real ES
  module via jsDelivr's `+esm` auto-bundler
  (`https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm`) instead. `jsQR` (the
  scanning side) genuinely does ship a classic UMD bundle and stays a
  plain `<script src>` tag — don't "fix" that one the same way.
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
- **Business/Education workspaces (decided 2026-08-06)**: Business and
  Education are **fully separate project workspaces**, not a relabeled
  view of Personal — confirmed explicitly with the user rather than
  assumed. The smallest change that achieves this: every project gains a
  required, immutable `workspaceId` (own uid for Personal — no
  `workspaces/{id}` doc needed at all for the common case — or a real
  `workspaces/{id}` for Business/Education), and the dashboard's project
  query adds `where('workspaceId','==',activeWorkspaceId)` on top of the
  existing `ownerId` filter. `activeWorkspaceId` is a client-only
  preference (localStorage, keyed per-uid), not synced through Firestore —
  simplest option, defaults back to Personal if unset or no longer valid.
  A user can open at most one Business and one Education workspace each,
  enforced by `users/{uid}.businessWorkspaceId`/`teacherWorkspaceId` only
  being settable once, from null. Business's "team" is the **existing
  Friends system**, unmodified — no new roster type, "adding a teammate"
  is just direct-add-to-project reused on a Business-workspace project.
  Education's teacher PIN is a **permanent, numeric, 8-digit** join code
  (`teacherPins/{pin}`, doc ID = the PIN) — deliberately digits, not
  arbitrary characters, matching familiar classroom-code UX
  (Kahoot/Google Classroom style), and using the exact same "ID as the
  whole access-control mechanism" pattern as invite tokens/usernames: no
  `list`, public `get` only (needed pre-auth, during signup), no
  rate-limiting since that would need a Cloud Function (the Blaze wall
  again) — an accepted tradeoff at the same security level as any
  classroom join code. A linked student's own project data **never
  moves** — the teacher's "see student tasks" ability
  (`isTeacherOf()`/`isTeacherOfProject()` in `firestore.rules`) is a pure
  **read grant** into the student's Personal-workspace projects/steps,
  checked against `studentOfTeacherUid` on the student's own doc; the
  teacher can never write. This is exactly why **release** — mandatory
  per the user, so a student keeps using the app after class ends — is
  safe and non-destructive: it's nothing more than the teacher clearing
  `studentOfTeacherUid`/`studentOfWorkspaceId` (both together, no other
  field) on the student's own `users/{uid}` doc, paired client-side with
  deleting the `workspaces/{teacherWorkspaceId}/students/{uid}` roster
  entry. The other mandatory rule — a linked student can't open their own
  Business/Education profile — is enforced directly in the
  `workspaces/{workspaceId}` create rule (`get()`-checks the caller's own
  `studentOfTeacherUid` is null), not just hidden client-side, though
  `profile.js` also hides the buttons for UX. `project.js` renders
  **read-only** (no step form, no checkbox/reorder/delete actions) when
  the viewer is neither the project's owner nor a `members/{uid}` —
  distinguishing that from "has read access via being the teacher"
  requires one extra `getDoc` on the viewer's own membership doc.
- **Business "Team" tab (decided 2026-08-07)**: appears in the bottom tab
  bar only while the Business workspace is active (a client-only check —
  `active-workspace.js` compares the `activeWorkspace:{uid}` localStorage
  key to `users/{uid}.businessWorkspaceId` — reused across
  `dashboard.js`/`friends.js`/`profile.js`/`team.js` since it's the same
  four lines in each). Confirmed with the user: project visibility is
  **team-wide** (one shared list of projects, not configurable per
  person), and removing someone from the team **immediately revokes their
  access to every Business project**, not just the ones the team roster
  granted. The team roster (`workspaces/{id}/team/{uid}`, owner-only
  add/remove, target must already be a friend — same `isFriend()`
  requirement as direct-add-to-project) is deliberately **not itself an
  access grant** — it's a bulk-management layer over the *existing*
  per-project `members/{uid}` mechanism, which is entirely unchanged.
  Projects gain `visibleToTeam: boolean` (the owner-only toggle); the
  client (`team.js`) mirrors team-roster and visibility changes into
  ordinary `members/{uid}` create/delete batches — add-to-team grants
  access to every currently-`visibleToTeam` project, remove-from-team
  revokes access to every project in the workspace, toggling a project's
  `visibleToTeam` grants/revokes it for the whole current roster. No new
  project/steps *read* rule logic exists because of this — the only rule
  changes are the `team/{uid}` subcollection itself and one added guard
  (`visibleToTeam` can only be changed by the project's owner, not a
  collaborator). The `team/{uid}` read rule's `get(workspaces/$(workspaceId))`
  call is safe for `list` because, unlike the `projects` list-safety bug
  fixed earlier the same day, `$(workspaceId)` here is *fixed* for the
  whole query (the client only ever lists one already-known workspace's
  own subcollection) — same reasoning that already made the `students`
  roster listing and `isTeacherOfProject()` safe.
- **Team tab CSS bug (fixed 2026-08-07)**: the exact same specificity bug
  as the 2026-08-06 loading-spinner fix, on a different element —
  `.tab-bar a { display: flex }` has higher specificity than the
  browser's default `[hidden] { display: none }`, so `#team-tab`'s
  `hidden` attribute was visually ignored and the Team tab stayed visible
  even outside a Business workspace. Fixed with the same pattern:
  `.tab-bar a[hidden] { display: none; }`. Worth checking for this
  specificity trap on any future `hidden`-toggled element sharing a class
  with other cascade rules.
- **Shared projects respect the joiner's own workspace tab, not the
  sharer's (decided 2026-08-07)**: previously the dashboard's "Shared
  with you" list showed every project you're a collaborator on,
  regardless of which of your own tabs (Personal/Business/Education) was
  active — so a project someone shared with you from *their* Business
  workspace showed up even while you were looking at your own Personal
  tab. Fixed by adding `members/{uid}.viewWorkspaceId`, set once at
  accept-time and never the *sharer's* workspace at all — it's entirely
  the *joiner's own* choice of which of their own tabs to file the share
  under. `join.html`/`join.js` now shows a picker ("Accept this on which
  profile?") whenever the joiner has more than just Personal open
  (skipped, defaulting straight to Personal, when there's no real
  choice); the `members/{uid}` create rule (invite-redemption path only)
  validates the choice is either their own uid or a workspace they've
  actually opened (`get(users/{their-uid}).businessWorkspaceId`/
  `teacherWorkspaceId`) — you can't claim a tab you don't have.
  Direct-add (friend or Team, no invite link — the owner creates the
  `members/{uid}` doc themselves) **never sets this field**, because the
  owner doesn't know the recipient's preference; `dashboard.js` defaults
  a missing value to the viewer's own uid (Personal) when filtering,
  matching the pre-existing behavior for that path. `renderSharedProjects()`
  re-filters both when the underlying `members` data changes *and* when
  the active tab changes (the two are independent triggers — switching
  tabs doesn't produce a new Firestore snapshot).
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
- **Three more `list`-specific Firestore rules gotchas, found 2026-08-07
  via a live bug report** ("teacher can't see student's projects" — the
  emulator suite didn't catch any of these; a live smoke test with a
  proper `getDocs(query(...))`, not just `getDoc()`, did): (1) `get()`/
  `exists()` calls whose **path is built from a `resource.data` value**
  (e.g. `isTeacherOf(resource.data.ownerId)`, a `get(users/{...})` where
  `{...}` comes from the document currently being evaluated) silently
  fail for `list` — works fine for `get()` by known ID, and on the
  emulator throws the exact same `Null value error` as the wildcard case
  above, but on live prod it's just a clean `permission-denied`, not a
  crash — same practical lesson either way: *don't build a `get()` path
  from `resource.data` inside anything that might ever be `list`ed.* The
  fix here was denormalization: `projects/{id}` gained a `linkedTeacherUid`
  field (a plain copy of the owner's `studentOfTeacherUid` *at creation
  time*, since the field is only ever set at signup), so the rule became a
  pure `resource.data.linkedTeacherUid == request.auth.uid` comparison —
  no `get()` at all. (2) A **path-wildcard** `get()`/`exists()` call
  (`exists(projects/$(projectId)/members/$(request.auth.uid))`, using the
  match block's own `{projectId}`) *also* breaks `list` the same way,
  even outside the collection-group case the first bullet above already
  covered — confirmed on both emulator and live. Since `get`/`list` are
  separate sub-operations of `read`, and can have **separate rule bodies**
  (`allow get: if ...` / `allow list: if ...` instead of one combined
  `allow read: if ...`), the fix was splitting them: `get` keeps the full
  owner/member/teacher check (fine for a single known-ID fetch — this is
  how `project.html` opens a specific project), `list` drops the
  problematic `exists()` clause entirely (the app never actually lists
  `projects` filtered *as a member* — the "Shared with you" dashboard
  section queries the `members` collection group instead, then does one
  `get` per project). (3) Even a `list`-safe `resource.data` comparison
  clause is silently ignored unless the **query's own `where()` filter is
  on that same field** — `resource.data.linkedTeacherUid ==
  request.auth.uid` only actually grants a `list` when the query itself
  includes `where('linkedTeacherUid', '==', teacherUid)`; the *exact same
  rule clause*, with a query filtered only by `where('ownerId', '==',
  studentUid)` instead, is denied. `dashboard.js`'s "My Students → View
  projects" query now filters on both fields for this reason. **General
  lesson for next time a `list`/query needs a new access grant**: write a
  rules-suite test using `getDocs(query(...))` (matching the client's
  *actual* query shape, filters included) — never validate a new `list`
  path with only `getDoc()`/`assertSucceeds(getDoc(...))`, which cannot
  catch any of these three failure modes; all three only manifest on
  `list`.

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

**Primary method (decided 2026-08-07): a service account key.** The user
doesn't have a password manager set up in this dev VM, so re-authenticating
interactively for a fresh `login:ci` token every session was enough friction
to be worth a one-time fix. The key lives at
`/home/nik/.secrets/maker-project-planner-firebase-adminsdk-fbsvc-109488d550.json`
on this machine — **outside the repo entirely**, never read its contents
into a commit or into chat, only ever reference it by path via the env var
below. It's the default Firebase Admin SDK service account
(`firebase-adminsdk-fbsvc@maker-project-planner.iam.gserviceaccount.com`);
that account's default IAM roles cover Firestore data access but not
deploy operations, so the user manually added the **Editor** role to it in
Google Cloud Console (IAM & Admin > IAM) before this worked — a 403 on
`firebaserules.googleapis.com` the first time was exactly that missing
role, and the fix took a few minutes to propagate. Deploys:
```
GOOGLE_APPLICATION_CREDENTIALS="/home/nik/.secrets/maker-project-planner-firebase-adminsdk-fbsvc-109488d550.json" npx firebase-tools deploy --only hosting,firestore --project maker-project-planner
```
(`--only` can be `hosting`, `firestore` (rules+indexes), `firestore:rules`,
or `functions` as needed — functions deploy will fail until the project
is on Blaze, see the invite-redemption note above. No `storage` target —
Cloud Storage was deliberately never enabled on this project, see
Security Principles.) This key doesn't expire the way a `login:ci` token
does — no need to ask the user for anything before a future deploy from
this same machine, unless the key is later revoked.

**Fallback: `login:ci` token**, still useful on a different machine or if
the service account key is ever unavailable. `firebase login` does **not**
work from Claude Code's Bash tool (no interactive browser/TTY) — it fails
outright, and even piping it through `!<command>` into the user's own
terminal hits the same problem.

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

## App releases (APK on GitHub)

**Decided 2026-08-07, standing instruction for every future APK build**:
whenever a new debug APK is built and ready for the user to test, publish
it on GitHub **two ways** (both, not either/or — confirmed with the user
after initially only doing the first one):

1. A **GitHub Release** with the APK attached: `gh release create <tag>
   <apk-path> --title <tag> --notes "..."` (`gh` is already authenticated
   in this environment as the same account used for git push, see Git
   workflow below).
2. A commit on the real `releases` **branch** (`git branch -a` — it
   already exists, tracks `origin/releases`) adding the new versioned APK
   file. This branch's history is deliberately unrelated to `main`'s (it
   started as the user's own empty orphan-style commit) — it exists
   purely to accumulate binary APK files release over release, not to
   track source. Workflow for a new version, from a clean `main`:
   ```
   cp android/app/build/outputs/apk/debug/app-debug.apk ./maker-project-planner-vX.Y.apk
   git checkout releases
   git fetch origin releases && git rebase origin/releases   # in case it moved
   git add maker-project-planner-vX.Y.apk
   git commit -m "Add maker-project-planner-vX.Y.apk"
   git push origin releases
   git checkout main   # always switch back — ongoing work happens on main
   ```
   The `cp` must happen *before* `git checkout releases`, since checking
   out a different branch can change what's on disk. Everything else
   present in the working tree on that branch (node_modules/, android/,
   ios/, etc.) is untracked *on this branch specifically* and harmless to
   leave alone — never `git add -A`/`git clean` there, only ever add the
   one new APK file by name.

Both of these are in addition to, not instead of, installing the APK on
the test phone via `adb install -r`.

- **Versioning**: `vMAJOR.MINOR`, tracked here so a future session knows
  where to continue without re-deriving it from tags:
  - Bump **MINOR** for a normal build (bug fixes, small features):
    v1.0 → v1.1 → v1.2 → v1.3 …
  - Bump **MAJOR** (reset MINOR to 0) only for a genuinely big new
    feature — the user's own judgment call each time, not a fixed rule
    (e.g. v1.3 → v2.0).
  - **Current version: v1.1** (2026-08-07 — Team-tab CSS-hidden bug fix,
    shared-projects now scoped to the joiner's own chosen workspace tab
    via the new invite-accept picker). v1.0 (same day) was Business/
    Education workspaces + the Business Team tab, the first versioned
    release; earlier builds this session were installed directly via
    `adb install` with no formal release.
- **File naming**: `maker-project-planner-vX.Y.apk`.
- **Tag/release title**: `vX.Y`, matching the file name's version.

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
- **2026-08-06, remove-collaborator + QR fix**: pushed to GitHub and
  installed on the test phone at the user's explicit request (`git push`
  done; the user took over on-device verification personally from there —
  no confirmed-working report back yet as of this writing).
- **2026-08-06/07, Business/Education workspaces feature**: implemented in
  full per the design above — `firestore.rules` (workspaces, teacherPins,
  the students roster, the projects/steps/users updates), `signup.js`/
  `signup.html` (student PIN field), `profile.js`/`profile.html` (Open
  Business/Education profile actions), `dashboard.js`/`dashboard.html`
  (workspace switcher — hidden entirely when only Personal is open, since
  there's nothing to switch between — scoped project queries, "My
  Students" section with release + read-only project drill-in), and
  `project.js` (read-only mode for a teacher viewing a student's project).
  Deployed to the live project and **confirmed working end-to-end**, both
  via a scripted live smoke test (throwaway accounts through the
  Identity Toolkit + Firestore REST APIs: teacher opens Education, gets a
  PIN, a student signs up with it, is blocked from opening their own
  Business/Education, teacher gets read-only access to the student's
  project, release revokes that access and unblocks the student) and by
  the user manually on the real phone.
  Three real bugs were found and fixed along the way — worth reading
  before touching this feature again, since two of them share one root
  cause that's easy to reintroduce:
  1. (Caught by the rules test suite) The `users/{userId}` self-update
     rule's null-check on `businessWorkspaceId`/`teacherWorkspaceId` used
     plain dot-field access, which throws (denying the whole update, even
     for unrelated fields like changing your username) against an
     older-shape profile doc that predates this feature and never had
     those keys — fixed with `resource.data.get('field', null)` instead
     of `resource.data.field`.
  2. (Caught by a live smoke test against the real project, not the
     emulator suite) `profile.js`'s "Open Education profile" handler
     created `workspaces/{id}` and `teacherPins/{pin}` in a **single**
     `writeBatch` — but the `teacherPins` create rule does
     `get(workspaces/{id})` to check the workspace's owner/type, and a
     `get()` inside a security rule cannot see another write still
     pending in the *same* batch/transaction. Fixed by splitting it into
     two sequential writes (create the workspace, `await` it, *then*
     batch the PIN + user update) — a regression test now covers both the
     single-batch failure and the correct two-step sequence, in the
     `firestore-tests/rules.test.js` describe block named exactly for
     this. **The same same-batch-visibility gotcha will bite any future
     write that both creates a document and, in one batch, creates/updates
     another document whose rule does `get()` on the first — check for
     this before batching.**
  3. (Caught by the user on-device, on their own real, pre-existing
     "gozd" account — *not* one of the smoke test's synthetic accounts,
     which is exactly why it slipped through) The exact same "older-shape
     doc predates this feature" bug as #1, but in the `workspaces/{id}`
     create rule this time — `get(users/uid).data.studentOfTeacherUid ==
     null` threw for any account created before 2026-08-06, denying every
     "Open Business/Education profile" click for every pre-existing
     account (which, on a live project, is most of them). Same fix
     (`.get('studentOfTeacherUid', null)`), also applied to the two other
     places `firestore.rules` read that same field the same unsafe way
     (`isTeacherOf()`, and the release clause on the `users/{userId}`
     update rule) even though only the workspace-create one had a
     confirmed live report — a new regression test seeds an
     intentionally-old-shape profile doc (only the fields `signup.js`
     wrote before this feature existed) to catch this specific shape of
     bug going forward, since `seedUser()` always writes the full modern
     field set and would never have caught it. **Lesson for next time**:
     any rule field added to an existing collection needs a test seeded
     with the *pre-change* document shape, not just the current one —
     `seedUser()`/`newProjectData()`/etc. only ever exercise "this field
     was always there."
- **2026-08-07, three bugs found by the user on-device, all fixed**:
  (1) The exact `studentOfTeacherUid`-plain-dot-access bug described
  above, but in the `workspaces/{id}` create rule this time — denied
  every "Open Business/Education profile" click for every real,
  pre-existing account (i.e. most real accounts on a live project).
  (2) "Teacher can't see student's projects" (`dashboard.js`'s "My
  Students → View projects" threw "Couldn't load that student's
  projects") — the real root cause, and the fix (`linkedTeacherUid`
  denormalization, splitting `projects/{id}`'s `allow read` into
  separate `allow get`/`allow list`, and the "query filter must match the
  rule's granting field" gotcha), is written up in full under Security
  Principles above and in `SECURITY.md` — worth reading before touching
  teacher/student project access again. Confirmed fixed live via REST
  (`getDocs`-shaped query, matching `dashboard.js` exactly) both before
  and after a release-cascade update, then redeployed
  (`firestore.rules` + `hosting`) and reinstalled on the test phone.
  (3) Reported but **not yet root-caused**: QR-code friend-add and
  sending a friend request both failed on-device. The friends/
  friendRequests rules are untouched this session and the emulator suite
  (102 tests, includes those rules) is green, so this is unlikely to be
  a rules regression — more likely either a pre-existing bug never
  caught before (the Friends feature's on-device verification was
  interrupted by the WebView-degradation issue in an earlier session and
  never completed a clean pass) or a recurrence of that same WebView
  state issue. The user is restarting the phone and retesting, per the
  same recovery step that worked last time — pick this up from their
  findings rather than assuming either cause.
- **2026-08-07, WebView-state theory confirmed**: the user restarted the
  phone and reported everything working correctly afterward, including
  QR-add and friend requests — so that was in fact a recurrence of the
  same WebView-level degradation documented earlier in this file, not a
  code bug. Worth remembering if friend-related features ever seem to
  mysteriously stop working again on this same test phone.
- **2026-08-07, Business "Team" tab**: implemented per the design in
  Security Principles above — `firestore.rules` (`team/{uid}` roster,
  `visibleToTeam` on projects), `active-workspace.js` (new shared helper),
  `team.html`/`team.js` (new page), and the Team tab wired into
  `dashboard.js`/`friends.js`/`profile.js`. Rules test suite green at
  **115 tests**. Deployed and live-smoke-tested the same way as the
  workspace bugs earlier today — see the test output/verification notes
  in the session this was built, or just trust the deploy timestamp and
  re-verify if anything about the Team tab seems off.
- **Phase 7 — AI step-time estimation**: not started. Needs a Cloud
  Function to call the Claude API without exposing the key client-side —
  will hit the same Blaze-plan wall as Phase 5 did. Raise that tradeoff
  again when this phase starts rather than assuming the answer has
  changed.
