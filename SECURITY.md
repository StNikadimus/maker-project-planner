# Security

This document explains, in plain language, the access-control guarantees
this app relies on, how they're tested, and what to tighten once real
domains/bundle IDs exist. See `CLAUDE.md` for the full Security Principles
this project follows.

## Access-control guarantees

- **`users/{userId}`** — a signed-in user can only read or write their own
  profile document, including deleting it (used by the "delete profile"
  flow in the Profile tab). No one can read, write, or delete anyone else's
  profile. Two fields are a deliberate exception to "only the owner writes
  their own doc": `businessWorkspaceId`/`teacherWorkspaceId` can each only
  be *set once, from null* (opening a Business or Education workspace), and
  a linked student's `studentOfTeacherUid`/`studentOfWorkspaceId` can be
  cleared — and only those two fields, together, to null — by the teacher
  currently named in `studentOfTeacherUid`. That second clause is the
  entire "release a student" mechanic (see Workspaces below): it's a
  narrow, explicit carve-out, not a general "teachers can edit students"
  rule.
- **`usernames/{username}`** — the doc ID *is* the unique, lowercase
  username, same "ID as the access-control mechanism" pattern as invites
  below. Anyone (even signed out) can `read` one exact, already-guessed
  username to check availability — that's the one deliberate exception to
  "everything requires auth" in this app, and it only reveals whether a
  single specific handle is taken, not the full list. Only a signed-in
  user can `create` a reservation, and only for their own uid. Firestore's
  create-vs-update routing means a `create` on an already-taken username
  has no matching rule and is denied — no read-then-write race is possible
  the way there would be with a manual "check if exists" step. `update` is
  never allowed; `delete` is owner-only (frees the handle when changing or
  deleting an account).
- **`users/{uid}/friends/{friendUid}`** — a mutual friendship edge, written
  to both users' subcollections. Either of the two named people (the
  subcollection owner or the friend referenced in the doc) can create or
  delete it on either side — that's what lets a single client write both
  sides at once for an instant QR-add or a request-accept. Blocked in
  either direction blocks creation. Only the subcollection owner can read
  their own list.
- **`users/{uid}/friendRequests/{requesterUid}`** — a pending request in
  the recipient's inbox. Only the requester can create it (never on
  someone else's behalf), and only if neither side has blocked the other
  and they're not already friends. Recipient and requester can each read
  it and delete it (decline / withdraw); no one else can.
- **`users/{uid}/blocked/{blockedUid}`** — self-only: only the list owner
  can create, read, or delete entries in their own blocked list.
- **`reports/{reportId}`** — create-only, and only as yourself
  (`reporterUid` must match the caller). No read access for anyone,
  including the reporter — intentionally minimal for now, see `CLAUDE.md`.
- **`projects/{projectId}`** — a signed-in user can only create a project
  they own (`ownerId` must be their own uid) and it must carry a
  `workspaceId` that's either their own uid (the Personal workspace, no
  `workspaces/{id}` doc needed) or a `workspaces/{id}` they actually own
  (Business/Education) — see Workspaces below. `workspaceId` is immutable
  after creation. Read and update are allowed for the owner **and** anyone
  with a `members/{uid}` document under that project (see below) — delete
  is owner-only, always. One more read grant: the owner's Education
  teacher, if any, can read (never write) the project — see
  "Teacher read access" below. `visibleToTeam` (the Business "Team" tab's
  bulk-visibility flag) can only be changed by the project's owner, never
  a collaborator — see "Business Team tab" below.
- **`projects/{projectId}/steps/{stepId}`** — the same owner-or-member
  check as the parent project applies to its steps, plus the same
  read-only teacher grant: owner and members can read/add/check off steps,
  but only the owner can delete a step, and a linked teacher can read but
  never write.
- **`workspaces/{workspaceId}`** — a Business or Education "profile" is
  really just a separate project workspace; see "Business/Education
  workspaces" below for the full model. Only the owner can read their own
  workspace doc; create requires the caller to not currently be someone
  else's linked student (the mandatory "students can't open their own
  Business/Education profile" rule); no update or delete — a workspace,
  once opened, is permanent.
- **`workspaces/{workspaceId}/students/{uid}`** — the teacher's class
  roster. A student can create their own entry (self-service — reaching
  this point already required knowing the teacher's PIN, see below) and
  read it; the teacher (workspace owner) can read the whole roster and is
  the *only* one who can delete an entry — deleting it is what "release"
  means. No update.
- **`workspaces/{workspaceId}/team/{uid}`** — the Business workspace's
  team roster (see "Business Team tab" below). Owner-only create, and only
  for someone already on the owner's friends list; owner-only delete; the
  member themselves and the owner can both read an entry. No update.
- **`teacherPins/{pin}`** — doc ID is the permanent 8-digit join code.
  Publicly readable by exact code (never listable) because signup needs to
  resolve one before an account — and therefore an auth token — exists.
  Only the workspace's own owner can create the PIN doc for their
  Education workspace; no update or delete.
- **`projects/{projectId}/invites/{token}`** — this is how sharing works
  without a Cloud Function (see "Invite mechanism" below for the full
  explanation). Only the project owner can create one. No one — not even
  the owner — can ever directly *read* an invite (`allow read: if false`),
  which is what stops anyone from browsing/enumerating them. The only
  write operations allowed are a narrow *update* that flips it from
  unredeemed-and-unexpired to redeemed-by-the-caller — once — and *delete*,
  owner-only, for cleaning up spent/expired invites.
- **`projects/{projectId}/members/{uid}`** — this is what actually grants
  collaborator access, via one of two mutually-exclusive creation shapes.
  Either a user creates the document with their *own* uid as the ID, only
  by proving server-side that they already hold a matching redeemed invite
  for this exact project — or the project **owner** creates it directly
  for anyone already in their own `users/{ownerUid}/friends` subcollection,
  no invite needed. The two shapes stay distinguishable in the data itself
  (`token` vs `addedVia: "friend"`). The invite-redemption shape also
  requires `viewWorkspaceId` — the joiner's own choice of which of *their*
  workspace tabs to file this share under (validated against their own
  `businessWorkspaceId`/`teacherWorkspaceId`, so they can't claim a tab
  they don't have) — see "Shared projects and workspace tabs" below.
- Everything not explicitly listed above is denied by default — the rules
  file (`firestore.rules`) starts from deny-all and only opens the narrow
  cases above.

## Invite mechanism (no Cloud Function)

The original plan for Phase 5 was a top-level `invites/{inviteId}`
collection redeemed only through a `redeemInvite` Cloud Function using the
Admin SDK — the safest possible design, since a trusted server can
atomically validate-and-consume a token in one step. That code still
exists in `functions/index.js` but isn't deployed, because Cloud Functions
require the Blaze (pay-as-you-go) plan, and this project deliberately
stays on the free Spark plan (see `CLAUDE.md` > Security Principles for the
full reasoning).

Instead, sharing is implemented with Security Rules alone:

1. The invite document's ID **is** the random token — e.g.
   `projects/{projectId}/invites/6f3a...`. Rules allow `get` (fetch by
   exact known ID) but never `list`, so an invite can only ever be reached
   by someone who already has the exact link — there's no way to browse or
   guess your way to one.
2. **Redeeming** is a single-document update: flip `redeemedBy` from
   `null` to your own uid. Firestore serializes concurrent writes to the
   same document, so if two people race to redeem the same link, only the
   first one can win — that's what makes it single-use.
3. Only after that update succeeds can the redeemer create
   `projects/{projectId}/members/{their-own-uid}` — the rule for that
   creation independently re-checks, server-side, that a matching invite
   really was redeemed by that exact uid.

**Known limitation**: steps 2 and 3 are two separate writes, not one atomic
transaction (a transaction can't see its own pending writes when it calls
`get()` inside a rule, so this couldn't be collapsed into one step without
a trusted server). If a client crashes between them, that invite is spent
but membership wasn't granted — the owner would need to issue a fresh
invite. This is a UX rough edge, not a security hole: it cannot be used to
gain unauthorized access, only to "waste" a single invite link.

## Business / Education workspaces

A Business or Education "profile" (opened from the Profile tab) is a
**fully separate project workspace**, not a relabeled view of the same
projects — see `CLAUDE.md` for the product-level design. Each user can
open at most one of each, enforced by `businessWorkspaceId`/
`teacherWorkspaceId` on their own `users/{uid}` doc only being settable
once, from null.

**Education join codes work like invite links, deliberately.** A teacher's
8-digit PIN (`teacherPins/{pin}`, doc ID = the PIN itself) is the same
"ID as the whole access-control mechanism" pattern as invite tokens: it's
never listable, only readable by exact, already-known code, and it's
publicly readable (not just signed-in) because a brand-new signup needs to
resolve it *before* an account exists. **Accepted tradeoff**: unlike an
invite token (a random UUID), an 8-digit numeric PIN is small enough to be
brute-forceable in principle, and there's no rate-limiting on read
attempts — that would need a Cloud Function, which hits the same Blaze-plan
wall documented in `CLAUDE.md`. This is the same security level as a
typical classroom join code (Kahoot/Google Classroom-style) and was a
deliberate, informed choice, not an oversight.

**Teacher access to a student's work is read-only and non-destructive by
design.** A linked student's projects and steps never move — they stay in
the student's own Personal workspace the whole time. The `steps` read
grant is `isTeacherOfProject()` in `firestore.rules`, a `get()`-based
check against the student's own `studentOfTeacherUid` field — this works
for both `get` and `list` because the `get()` path it builds only depends
on the fixed `projectId` path segment, never on a step's own data. The
`projects` read grant is different: a `get()` the same shape as
`isTeacherOfProject()` works for opening one specific project by ID, but
Firestore silently fails a `list`/query whenever a rule's `get()` path is
built from a *candidate document's own field* (confirmed empirically,
2026-08-07, from a live bug report — see `CLAUDE.md`'s Firestore rules
gotchas for the full writeup) — exactly what listing "every project this
teacher's student owns" needs. The fix is a denormalized
`linkedTeacherUid` field directly on `projects/{id}` (a copy of the
owner's `studentOfTeacherUid` *at creation time*), so the `list` rule is a
plain field comparison with no `get()` at all. `get` and `list` are
separate rule bodies for `projects` specifically because of this (`allow
get: ...` keeps the owner/member/teacher `get()`-based check; `allow
list: ...` only ever needs owner and `linkedTeacherUid`, both plain field
comparisons). A teacher can never create, update, or delete a student's
project or steps, with one narrow exception (see release, next).

**"Release" clears the student's link, then cascades to their projects.**
The teacher clears `studentOfTeacherUid`/`studentOfWorkspaceId` (both
together, no other field) on the student's own `users/{uid}` doc, deletes
the roster entry at `workspaces/{teacherWorkspaceId}/students/{uid}` —
and now (as of the `linkedTeacherUid` fix above) additionally queries and
batch-clears `linkedTeacherUid` on every one of that student's projects
it was ever set on, since that field doesn't track the live
`studentOfTeacherUid` value the way the old `get()`-based check did —
without this cascade, the teacher would keep read access to old projects
forever. The rule allowing this is deliberately the narrowest possible
grant: the teacher currently named in a project's own `linkedTeacherUid`
may update *that exact field to null and nothing else* — mirroring the
same shape as the `studentOfTeacherUid` release clause on `users/{uid}`.
No data is copied, moved, or deleted in any of this — the student owned
their projects the whole time.

## Business Team tab

The Team tab (only shown while a Business workspace is active — a
client-only check, see `CLAUDE.md`) lets the owner manage a team roster
and pick which of their Business projects the whole team can see.
**Deliberately not a new access-control primitive**: the
`workspaces/{id}/team/{uid}` roster and each project's `visibleToTeam`
flag are just a bulk-management layer over the *already-existing*
per-project `members/{uid}` mechanism (the same one "Add a friend
directly" on the Project page has always used). Adding someone to the
team, or turning a project's `visibleToTeam` on, writes ordinary
`members/{uid}` docs client-side via the existing friend-direct-add
create rule (unchanged); removing someone, or turning `visibleToTeam`
off, deletes those same docs via the existing owner-only delete rule
(also unchanged). This means the actual project/step read rules needed
**zero** changes for this feature — the only rule additions are the
`team/{uid}` subcollection itself and one guard on the `projects` update
rule so only the owner (never a collaborator) can flip `visibleToTeam`.

By design (confirmed with the user, not assumed): visibility is
**team-wide**, not configurable per person — one shared list of projects
the whole team sees. Removing someone from the team **always fully
revokes their access to every Business project** in that workspace,
regardless of how they got access (team-granted or otherwise) — this is
implemented client-side (`team.js`) as a query over the workspace's own
projects (`ownerId`/`workspaceId`, both plain fields — safe for `list`,
see the workspace-scoping section above) followed by a batched delete of
that person's `members/{uid}` doc on each one.

## Shared projects and workspace tabs

`viewWorkspaceId` on an invite-redeemed `members/{uid}` doc is **the
joiner's own choice**, made once at accept time in `join.html`/`join.js`,
of which of *their own* tabs (Personal/Business/Education) a shared
project should appear under — it has nothing to do with which workspace
the *sharing* owner used. `join.js` only shows a picker when the joiner
actually has more than one tab open; otherwise it silently defaults to
Personal, same as before this feature existed. The create rule validates
the choice against the joiner's own `users/{uid}` doc
(`businessWorkspaceId`/`teacherWorkspaceId`) so no one can claim a tab
they haven't opened themselves. The direct-add path (an owner adding a
friend or Team member straight to a project, no invite link) never sets
this field at all — the owner has no way to know the recipient's
preference — so `dashboard.js` treats a missing value as Personal when
filtering the "Shared with you" list.

## Automated rules test suite

`firestore-tests/` contains an automated test suite (Node's built-in test
runner + `@firebase/rules-unit-testing`) that exercises `firestore.rules`
against the Firestore emulator — no real project, no real user data. For
every collection above it checks all three guarantees:

1. The **owner** can read/write their own data.
2. **Another signed-in user** cannot read or write someone else's data.
3. An **unauthenticated** request is denied everywhere.

### Running the tests

Requires a JDK (the Firestore emulator runs on the JVM) and Node.js.

```
cd firestore-tests
npm install        # first time only
cd ..
firebase emulators:exec --only firestore --project demo-maker-project-planner "npm --prefix firestore-tests test"
```

This starts a local Firestore emulator, runs the test suite against it, and
shuts the emulator down afterward. No network calls to the real Firebase
project are made. All 117 tests currently pass, including the invite/member
rules described above (single-use redemption, expiry, cross-user token
misuse, self-only membership creation, the friend-direct-add shape), the
username uniqueness rules (create-once-wins, public read, owner-only
delete), the friends/friendRequests/blocked/reports rules (two-party
create, block prevents new edges/requests, self-only inboxes, report is
write-only for everyone including the reporter), the workspaces/
teacherPins/students rules (workspace creation and the student-restriction
check, PIN creation scoped to the owning teacher's own Education
workspace, roster self-service and teacher-only release, workspace-scoped
project creation with immutable `workspaceId`, the teacher's read-only
grant into a linked student's projects/steps, and the release mechanic
including that it stops the teacher's read access afterward), and the
Business Team tab rules (owner-only team roster add/remove requiring
friendship, business-only, a roster `list` test matching `team.js`'s real
query, and that only the project owner — never a collaborator — can
toggle `visibleToTeam`), and the invite-accept `viewWorkspaceId` rules
(accepting on Personal, accepting on a Business/Education workspace the
joiner actually has open, and rejecting a claimed workspace they don't).

## App Check

Firebase App Check (reCAPTCHA v3 provider) is wired into `firebase-init.js`
so the client attaches an App Check token to its requests. **Enforcement is
not yet turned on** for Firestore in the Firebase Console — this is
intentional: enforcement should only be flipped on after confirming (via
the App Check metrics page) that the app is successfully sending valid
tokens, to avoid locking out real users due to a misconfiguration. Turn on
enforcement once that's confirmed.

## API key restriction (do this once real domains/bundle IDs exist)

The Firebase client config (`apiKey` etc. in `public/js/firebaseConfig.js`)
and the App Check reCAPTCHA site key are not secrets — see
`CLAUDE.md` > Security Principles. Access control is enforced by Security
Rules and Cloud Functions, not by hiding these values. Still, once the app
has its real production domain and mobile bundle IDs, restrict the API
keys in Google Cloud Console (APIs & Services > Credentials) as
defense-in-depth:

- **Web API key**: restrict by HTTP referrer to the production domain(s).
- **iOS key**: restrict by bundle ID.
- **Android key**: restrict by package name (and SHA-1 fingerprint).

This is not required for the app to function securely today (Security
Rules already enforce access control), but it reduces the chance of the
key being used to make unrelated Firebase API calls from outside the app.
