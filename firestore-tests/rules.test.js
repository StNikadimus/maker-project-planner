import { before, beforeEach, after, describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, collection, collectionGroup, query, where, serverTimestamp } from "firebase/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OWNER_UID = "owner-uid";
const OTHER_UID = "other-uid";
const MEMBER_UID = "member-uid";
const TEACHER_UID = "teacher-uid";
const STUDENT_UID = "student-uid";

const DAY_MS = 24 * 60 * 60 * 1000;

const newProjectData = (ownerId, workspaceId = ownerId, linkedTeacherUid = null) => ({
  name: "Birdhouse",
  category: "diy",
  ownerId,
  workspaceId,
  linkedTeacherUid,
  visibleToTeam: false,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const newStepData = (createdBy) => ({
  title: "Cut wood",
  notes: "",
  materials: [],
  tools: [],
  done: false,
  order: 0,
  createdBy,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-maker-project-planner",
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

function ownerDb() {
  return testEnv.authenticatedContext(OWNER_UID, { email: "owner@example.com" }).firestore();
}
function otherDb() {
  return testEnv.authenticatedContext(OTHER_UID, { email: "other@example.com" }).firestore();
}
function memberDb() {
  return testEnv.authenticatedContext(MEMBER_UID, { email: "member@example.com" }).firestore();
}
function teacherDb() {
  return testEnv.authenticatedContext(TEACHER_UID, { email: "teacher@example.com" }).firestore();
}
function studentDb() {
  return testEnv.authenticatedContext(STUDENT_UID, { email: "student@example.com" }).firestore();
}
function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seedProject(id = "project1", overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects", id), {
      name: "Birdhouse",
      category: "diy",
      ownerId: OWNER_UID,
      workspaceId: OWNER_UID,
      linkedTeacherUid: null,
      visibleToTeam: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
  });
}

async function seedWorkspace(id, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "workspaces", id), {
      type: "business",
      ownerId: TEACHER_UID,
      createdAt: new Date(),
      ...overrides,
    });
  });
}

async function seedTeacherPin(pin, workspaceId, teacherUid = TEACHER_UID) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "teacherPins", pin), { workspaceId, teacherUid });
  });
}

async function seedRosterEntry(workspaceId, uid, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "workspaces", workspaceId, "students", uid), {
      uid,
      username: `${uid}-username`,
      displayName: `${uid}-name`,
      joinedAt: new Date(),
      ...overrides,
    });
  });
}

async function seedTeamEntry(workspaceId, uid, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "workspaces", workspaceId, "team", uid), {
      uid,
      username: `${uid}-username`,
      displayName: `${uid}-name`,
      addedAt: new Date(),
      ...overrides,
    });
  });
}

async function seedUser(uid, overrides = {}) {
  // Username must match isValidUsername's pattern (lowercase letters/digits/
  // underscores only, no hyphens) since the users/{userId} update rule
  // re-validates the merged document's username on every self-update, even
  // when username itself isn't the field being changed.
  const validUsername = uid.replace(/-/g, "").slice(0, 20);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", uid), {
      displayName: `${uid}-name`,
      username: validUsername,
      email: `${uid}@example.com`,
      createdAt: new Date(),
      photoURL: null,
      businessWorkspaceId: null,
      teacherWorkspaceId: null,
      studentOfTeacherUid: null,
      studentOfWorkspaceId: null,
      ...overrides,
    });
  });
}

async function seedLinkedStudent(studentUid, teacherUid, workspaceId) {
  await seedUser(studentUid, { studentOfTeacherUid: teacherUid, studentOfWorkspaceId: workspaceId });
}

async function seedStep(projectId = "project1", stepId = "step1") {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects", projectId, "steps", stepId), {
      title: "Cut wood",
      notes: "",
      materials: [],
      tools: [],
      done: false,
      order: 0,
      createdBy: OWNER_UID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
}

async function seedMember(projectId = "project1", uid = MEMBER_UID) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects", projectId, "members", uid), {
      uid,
      token: "seeded-token",
      joinedAt: new Date(),
    });
  });
}

async function seedFriendEdge(ownerUid, friendUid) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", ownerUid, "friends", friendUid), {
      uid: friendUid,
      username: `${friendUid}-username`,
      displayName: `${friendUid}-name`,
      photoURL: null,
      addedAt: new Date(),
    });
  });
}

async function seedBlocked(ownerUid, blockedUid) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", ownerUid, "blocked", blockedUid), {
      blockedAt: new Date(),
    });
  });
}

async function seedInvite(projectId, token, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects", projectId, "invites", token), {
      createdBy: OWNER_UID,
      expiresAt: new Date(Date.now() + DAY_MS),
      redeemedBy: null,
      redeemedAt: null,
      ...overrides,
    });
  });
}

describe("users/{userId}", () => {
  it("owner can create their own profile with a valid username", async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), "users", OWNER_UID), {
        displayName: "Owner",
        username: "owner1",
        email: "owner@example.com",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("cannot create a profile with an invalid username", async () => {
    await assertFails(
      setDoc(doc(ownerDb(), "users", OWNER_UID), {
        displayName: "Owner",
        username: "Not Valid!",
        email: "owner@example.com",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("a user cannot create a profile for someone else", async () => {
    await assertFails(
      setDoc(doc(otherDb(), "users", OWNER_UID), {
        displayName: "Hacker",
        username: "hacker1",
        email: "other@example.com",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("another authenticated user cannot read someone else's profile", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID), {
        displayName: "Owner",
        username: "owner1",
        email: "owner@example.com",
        createdAt: new Date(),
      });
    });
    await assertFails(getDoc(doc(otherDb(), "users", OWNER_UID)));
  });

  it("an unauthenticated request is denied", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID), {
        displayName: "Owner",
        username: "owner1",
        email: "owner@example.com",
        createdAt: new Date(),
      });
    });
    await assertFails(getDoc(doc(anonDb(), "users", OWNER_UID)));
  });

  it("owner can update their own username", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID), {
        displayName: "Owner",
        username: "owner1",
        email: "owner@example.com",
        createdAt: new Date(),
      });
    });
    await assertSucceeds(updateDoc(doc(ownerDb(), "users", OWNER_UID), { username: "owner2" }));
  });

  it("owner can delete their own profile", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID), {
        displayName: "Owner",
        username: "owner1",
        email: "owner@example.com",
        createdAt: new Date(),
      });
    });
    await assertSucceeds(deleteDoc(doc(ownerDb(), "users", OWNER_UID)));
  });

  it("another user cannot delete someone else's profile", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID), {
        displayName: "Owner",
        username: "owner1",
        email: "owner@example.com",
        createdAt: new Date(),
      });
    });
    await assertFails(deleteDoc(doc(otherDb(), "users", OWNER_UID)));
  });
});

describe("usernames/{username}", () => {
  it("a signed-in user can claim an unused username", async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), "usernames", "owner1"), { uid: OWNER_UID, displayName: "Owner", photoURL: null })
    );
  });

  it("cannot claim a username already taken by someone else", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "usernames", "owner1"), { uid: OWNER_UID });
    });
    await assertFails(setDoc(doc(otherDb(), "usernames", "owner1"), { uid: OTHER_UID }));
  });

  it("cannot claim a username for someone else's uid", async () => {
    await assertFails(setDoc(doc(ownerDb(), "usernames", "owner1"), { uid: OTHER_UID }));
  });

  it("anyone, even unauthenticated, can read a username doc to check availability", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "usernames", "owner1"), { uid: OWNER_UID });
    });
    await assertSucceeds(getDoc(doc(anonDb(), "usernames", "owner1")));
  });

  it("cannot update a username doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "usernames", "owner1"), { uid: OWNER_UID });
    });
    await assertFails(updateDoc(doc(ownerDb(), "usernames", "owner1"), { uid: OTHER_UID }));
  });

  it("the owning uid can delete their username doc to free it", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "usernames", "owner1"), { uid: OWNER_UID });
    });
    await assertSucceeds(deleteDoc(doc(ownerDb(), "usernames", "owner1")));
  });

  it("another user cannot delete someone else's username doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "usernames", "owner1"), { uid: OWNER_UID });
    });
    await assertFails(deleteDoc(doc(otherDb(), "usernames", "owner1")));
  });
});

describe("projects/{projectId}", () => {
  it("owner can create their own project", async () => {
    await seedUser(OWNER_UID);
    await assertSucceeds(setDoc(doc(ownerDb(), "projects", "p1"), newProjectData(OWNER_UID)));
  });

  it("a user cannot create a project claiming someone else as owner", async () => {
    await assertFails(setDoc(doc(otherDb(), "projects", "p1"), newProjectData(OWNER_UID)));
  });

  it("owner can read, update and delete their own project", async () => {
    await seedProject();
    await assertSucceeds(getDoc(doc(ownerDb(), "projects", "project1")));
    await assertSucceeds(
      updateDoc(doc(ownerDb(), "projects", "project1"), { name: "Treehouse", updatedAt: serverTimestamp() })
    );
    await assertSucceeds(deleteDoc(doc(ownerDb(), "projects", "project1")));
  });

  it("another authenticated user cannot read, update or delete someone else's project", async () => {
    await seedProject();
    await assertFails(getDoc(doc(otherDb(), "projects", "project1")));
    await assertFails(updateDoc(doc(otherDb(), "projects", "project1"), { name: "Hacked" }));
    await assertFails(deleteDoc(doc(otherDb(), "projects", "project1")));
  });

  it("an unauthenticated request is denied", async () => {
    await seedProject();
    await assertFails(getDoc(doc(anonDb(), "projects", "project1")));
    await assertFails(deleteDoc(doc(anonDb(), "projects", "project1")));
  });
});

describe("projects/{projectId} with a member", () => {
  it("a member can read and update the project, but not delete it", async () => {
    await seedProject();
    await seedMember();
    await assertSucceeds(getDoc(doc(memberDb(), "projects", "project1")));
    await assertSucceeds(
      updateDoc(doc(memberDb(), "projects", "project1"), { name: "Treehouse", updatedAt: serverTimestamp() })
    );
    await assertFails(deleteDoc(doc(memberDb(), "projects", "project1")));
  });

  it("a non-member still cannot read the project", async () => {
    await seedProject();
    await seedMember();
    await assertFails(getDoc(doc(otherDb(), "projects", "project1")));
  });
});

describe("projects/{projectId}/steps/{stepId}", () => {
  it("owner can create, read, update and delete a step", async () => {
    await seedProject();
    await assertSucceeds(setDoc(doc(ownerDb(), "projects", "project1", "steps", "s1"), newStepData(OWNER_UID)));

    await seedStep();
    await assertSucceeds(getDoc(doc(ownerDb(), "projects", "project1", "steps", "step1")));
    await assertSucceeds(
      updateDoc(doc(ownerDb(), "projects", "project1", "steps", "step1"), {
        done: true,
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(deleteDoc(doc(ownerDb(), "projects", "project1", "steps", "step1")));
  });

  it("another authenticated user cannot read or write steps in someone else's project", async () => {
    await seedProject();
    await seedStep();
    await assertFails(getDoc(doc(otherDb(), "projects", "project1", "steps", "step1")));
    await assertFails(setDoc(doc(otherDb(), "projects", "project1", "steps", "s2"), newStepData(OTHER_UID)));
    await assertFails(updateDoc(doc(otherDb(), "projects", "project1", "steps", "step1"), { done: true }));
    await assertFails(deleteDoc(doc(otherDb(), "projects", "project1", "steps", "step1")));
  });

  it("an unauthenticated request is denied", async () => {
    await seedProject();
    await seedStep();
    await assertFails(getDoc(doc(anonDb(), "projects", "project1", "steps", "step1")));
  });
});

describe("projects/{projectId}/steps/{stepId} with a member", () => {
  it("a member can create, read and update steps, but not delete them", async () => {
    await seedProject();
    await seedMember();
    const db = memberDb();
    await assertSucceeds(setDoc(doc(db, "projects", "project1", "steps", "s1"), newStepData(MEMBER_UID)));

    await seedStep();
    await assertSucceeds(getDoc(doc(db, "projects", "project1", "steps", "step1")));
    await assertSucceeds(
      updateDoc(doc(db, "projects", "project1", "steps", "step1"), { done: true, updatedAt: serverTimestamp() })
    );
    await assertFails(deleteDoc(doc(db, "projects", "project1", "steps", "step1")));
  });

  it("a non-member still cannot read or write steps", async () => {
    await seedProject();
    await seedMember();
    await seedStep();
    await assertFails(getDoc(doc(otherDb(), "projects", "project1", "steps", "step1")));
  });
});

describe("projects/{projectId}/invites/{token}", () => {
  it("the owner can create an invite for their own project", async () => {
    await seedProject();
    await assertSucceeds(
      setDoc(doc(ownerDb(), "projects", "project1", "invites", "tok1"), {
        createdBy: OWNER_UID,
        expiresAt: new Date(Date.now() + DAY_MS),
        redeemedBy: null,
        redeemedAt: null,
      })
    );
  });

  it("a non-owner cannot create an invite for someone else's project", async () => {
    await seedProject();
    await assertFails(
      setDoc(doc(otherDb(), "projects", "project1", "invites", "tok1"), {
        createdBy: OTHER_UID,
        expiresAt: new Date(Date.now() + DAY_MS),
        redeemedBy: null,
        redeemedAt: null,
      })
    );
  });

  it("no one can directly read an invite, not even the owner", async () => {
    await seedProject();
    await seedInvite("project1", "tok1");
    await assertFails(getDoc(doc(ownerDb(), "projects", "project1", "invites", "tok1")));
  });

  it("a signed-in user can redeem a fresh, unexpired invite by updating it", async () => {
    await seedProject();
    await seedInvite("project1", "tok1");
    await assertSucceeds(
      updateDoc(doc(otherDb(), "projects", "project1", "invites", "tok1"), {
        redeemedBy: OTHER_UID,
        redeemedAt: serverTimestamp(),
      })
    );
  });

  it("an already-redeemed invite cannot be redeemed again", async () => {
    await seedProject();
    await seedInvite("project1", "tok1", { redeemedBy: OTHER_UID, redeemedAt: new Date() });
    await assertFails(
      updateDoc(doc(memberDb(), "projects", "project1", "invites", "tok1"), {
        redeemedBy: MEMBER_UID,
        redeemedAt: serverTimestamp(),
      })
    );
  });

  it("an expired invite cannot be redeemed", async () => {
    await seedProject();
    await seedInvite("project1", "tok1", { expiresAt: new Date(Date.now() - DAY_MS) });
    await assertFails(
      updateDoc(doc(otherDb(), "projects", "project1", "invites", "tok1"), {
        redeemedBy: OTHER_UID,
        redeemedAt: serverTimestamp(),
      })
    );
  });

  it("an unauthenticated request cannot redeem an invite", async () => {
    await seedProject();
    await seedInvite("project1", "tok1");
    await assertFails(
      updateDoc(doc(anonDb(), "projects", "project1", "invites", "tok1"), {
        redeemedBy: "whoever",
        redeemedAt: serverTimestamp(),
      })
    );
  });

  it("the owner can delete a spent invite; another user cannot", async () => {
    await seedProject();
    await seedInvite("project1", "tok1", { redeemedBy: OTHER_UID, redeemedAt: new Date() });
    await assertFails(deleteDoc(doc(otherDb(), "projects", "project1", "invites", "tok1")));
    await assertSucceeds(deleteDoc(doc(ownerDb(), "projects", "project1", "invites", "tok1")));
  });
});

describe("dashboard 'shared with you' collectionGroup query", () => {
  it("a member can find their own membership via a collectionGroup query on members", async () => {
    await seedProject();
    await seedMember();
    const q = query(collectionGroup(memberDb(), "members"), where("uid", "==", MEMBER_UID));
    const snap = await assertSucceeds(getDocs(q));
    if (snap.size !== 1) throw new Error(`expected 1 result, got ${snap.size}`);
  });
});

describe("projects/{projectId}/members/{uid}", () => {
  it("a first-time joiner can read their own (not yet existing) membership doc", async () => {
    await seedProject();
    // Not a member, not the owner — this is the pre-redemption check join.js
    // does. It must resolve to "doesn't exist", not permission-denied.
    const snap = await assertSucceeds(getDoc(doc(otherDb(), "projects", "project1", "members", OTHER_UID)));
    if (snap.exists()) throw new Error("expected the membership doc not to exist yet");
  });

  it("a user cannot read someone else's non-existent membership doc as a fishing check", async () => {
    await seedProject();
    await assertFails(getDoc(doc(otherDb(), "projects", "project1", "members", MEMBER_UID)));
  });

  it("a user who redeemed a matching invite can create their own membership", async () => {
    await seedProject();
    await seedInvite("project1", "tok1", { redeemedBy: OTHER_UID, redeemedAt: new Date() });
    await assertSucceeds(
      setDoc(doc(otherDb(), "projects", "project1", "members", OTHER_UID), {
        uid: OTHER_UID,
        token: "tok1",
        displayName: "Other",
        username: "other1",
        joinedAt: serverTimestamp(),
      })
    );
  });

  it("cannot create membership by pointing at a token that was never redeemed by you", async () => {
    await seedProject();
    await seedInvite("project1", "tok1"); // still unredeemed
    await assertFails(
      setDoc(doc(otherDb(), "projects", "project1", "members", OTHER_UID), {
        uid: OTHER_UID,
        token: "tok1",
        joinedAt: serverTimestamp(),
      })
    );
  });

  it("cannot create membership by pointing at a token redeemed by someone else", async () => {
    await seedProject();
    await seedInvite("project1", "tok1", { redeemedBy: MEMBER_UID, redeemedAt: new Date() });
    await assertFails(
      setDoc(doc(otherDb(), "projects", "project1", "members", OTHER_UID), {
        uid: OTHER_UID,
        token: "tok1",
        joinedAt: serverTimestamp(),
      })
    );
  });

  it("cannot create a membership document for someone else", async () => {
    await seedProject();
    await seedInvite("project1", "tok1", { redeemedBy: OTHER_UID, redeemedAt: new Date() });
    await assertFails(
      setDoc(doc(otherDb(), "projects", "project1", "members", MEMBER_UID), {
        uid: MEMBER_UID,
        token: "tok1",
        joinedAt: serverTimestamp(),
      })
    );
  });

  it("the owner can directly add a friend to the project, no invite needed", async () => {
    await seedProject();
    await seedFriendEdge(OWNER_UID, OTHER_UID);
    await assertSucceeds(
      setDoc(doc(ownerDb(), "projects", "project1", "members", OTHER_UID), {
        uid: OTHER_UID,
        addedVia: "friend",
        displayName: "Other",
        username: "other1",
        joinedAt: serverTimestamp(),
      })
    );
  });

  it("the owner can remove a collaborator", async () => {
    await seedProject();
    await seedMember("project1", OTHER_UID);
    await assertSucceeds(deleteDoc(doc(ownerDb(), "projects", "project1", "members", OTHER_UID)));
  });

  it("a non-owner cannot remove a collaborator", async () => {
    await seedProject();
    await seedMember("project1", OTHER_UID);
    await assertFails(deleteDoc(doc(memberDb(), "projects", "project1", "members", OTHER_UID)));
  });

  it("a member cannot remove themself", async () => {
    await seedProject();
    await seedMember("project1", OTHER_UID);
    await assertFails(deleteDoc(doc(otherDb(), "projects", "project1", "members", OTHER_UID)));
  });

  it("the owner cannot direct-add someone who isn't their friend", async () => {
    await seedProject();
    await assertFails(
      setDoc(doc(ownerDb(), "projects", "project1", "members", OTHER_UID), {
        uid: OTHER_UID,
        addedVia: "friend",
        joinedAt: serverTimestamp(),
      })
    );
  });

  it("a non-owner cannot direct-add their own friend to someone else's project", async () => {
    await seedProject();
    await seedFriendEdge(MEMBER_UID, OTHER_UID);
    await assertFails(
      setDoc(doc(memberDb(), "projects", "project1", "members", OTHER_UID), {
        uid: OTHER_UID,
        addedVia: "friend",
        joinedAt: serverTimestamp(),
      })
    );
  });
});

describe("users/{uid}/friends/{friendUid}", () => {
  it("either named party can create the mutual edge on either side", async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), "users", OWNER_UID, "friends", OTHER_UID), {
        uid: OTHER_UID,
        username: "other1",
        displayName: "Other",
        photoURL: null,
        addedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      setDoc(doc(ownerDb(), "users", OTHER_UID, "friends", OWNER_UID), {
        uid: OWNER_UID,
        username: "owner1",
        displayName: "Owner",
        photoURL: null,
        addedAt: serverTimestamp(),
      })
    );
  });

  it("a third party cannot create an edge between two other people", async () => {
    await assertFails(
      setDoc(doc(memberDb(), "users", OWNER_UID, "friends", OTHER_UID), {
        uid: OTHER_UID,
        username: "other1",
        displayName: "Other",
        photoURL: null,
        addedAt: serverTimestamp(),
      })
    );
  });

  it("cannot create a friend edge if either side has blocked the other", async () => {
    await seedBlocked(OWNER_UID, OTHER_UID);
    await assertFails(
      setDoc(doc(ownerDb(), "users", OWNER_UID, "friends", OTHER_UID), {
        uid: OTHER_UID,
        username: "other1",
        displayName: "Other",
        photoURL: null,
        addedAt: serverTimestamp(),
      })
    );
  });

  it("only the subcollection owner can read their own friends list", async () => {
    await seedFriendEdge(OWNER_UID, OTHER_UID);
    await assertSucceeds(getDocs(collection(ownerDb(), "users", OWNER_UID, "friends")));
    await assertFails(getDocs(collection(otherDb(), "users", OWNER_UID, "friends")));
  });

  it("either named party can delete the edge (unfriend)", async () => {
    await seedFriendEdge(OWNER_UID, OTHER_UID);
    await assertSucceeds(deleteDoc(doc(otherDb(), "users", OWNER_UID, "friends", OTHER_UID)));
  });

  it("an unrelated user cannot delete someone else's friend edge", async () => {
    await seedFriendEdge(OWNER_UID, OTHER_UID);
    await assertFails(deleteDoc(doc(memberDb(), "users", OWNER_UID, "friends", OTHER_UID)));
  });
});

describe("users/{uid}/friendRequests/{requesterUid}", () => {
  it("the requester can create a pending request in the recipient's inbox", async () => {
    await assertSucceeds(
      setDoc(doc(otherDb(), "users", OWNER_UID, "friendRequests", OTHER_UID), {
        username: "other1",
        displayName: "Other",
        photoURL: null,
        requestedAt: serverTimestamp(),
      })
    );
  });

  it("cannot create a request on someone else's behalf", async () => {
    await assertFails(
      setDoc(doc(memberDb(), "users", OWNER_UID, "friendRequests", OTHER_UID), {
        username: "other1",
        displayName: "Other",
        photoURL: null,
        requestedAt: serverTimestamp(),
      })
    );
  });

  it("cannot request someone who has already blocked you", async () => {
    await seedBlocked(OWNER_UID, OTHER_UID);
    await assertFails(
      setDoc(doc(otherDb(), "users", OWNER_UID, "friendRequests", OTHER_UID), {
        username: "other1",
        displayName: "Other",
        photoURL: null,
        requestedAt: serverTimestamp(),
      })
    );
  });

  it("cannot request someone you're already friends with", async () => {
    await seedFriendEdge(OWNER_UID, OTHER_UID);
    await assertFails(
      setDoc(doc(otherDb(), "users", OWNER_UID, "friendRequests", OTHER_UID), {
        username: "other1",
        displayName: "Other",
        photoURL: null,
        requestedAt: serverTimestamp(),
      })
    );
  });

  it("recipient can read their inbox, requester can read their own outgoing request, a third party cannot", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID, "friendRequests", OTHER_UID), {
        username: "other1",
        displayName: "Other",
        photoURL: null,
        requestedAt: new Date(),
      });
    });
    await assertSucceeds(getDoc(doc(ownerDb(), "users", OWNER_UID, "friendRequests", OTHER_UID)));
    await assertSucceeds(getDoc(doc(otherDb(), "users", OWNER_UID, "friendRequests", OTHER_UID)));
    await assertFails(getDoc(doc(memberDb(), "users", OWNER_UID, "friendRequests", OTHER_UID)));
  });

  it("recipient can decline (delete) and requester can withdraw (delete)", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID, "friendRequests", OTHER_UID), {
        username: "other1",
        displayName: "Other",
        photoURL: null,
        requestedAt: new Date(),
      });
    });
    await assertSucceeds(deleteDoc(doc(ownerDb(), "users", OWNER_UID, "friendRequests", OTHER_UID)));
  });
});

describe("users/{uid}/blocked/{blockedUid}", () => {
  it("a user can block someone", async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), "users", OWNER_UID, "blocked", OTHER_UID), {
        blockedAt: serverTimestamp(),
      })
    );
  });

  it("cannot create a block entry in someone else's list", async () => {
    await assertFails(
      setDoc(doc(otherDb(), "users", OWNER_UID, "blocked", OTHER_UID), {
        blockedAt: serverTimestamp(),
      })
    );
  });

  it("only the owner can read their own blocked list", async () => {
    await seedBlocked(OWNER_UID, OTHER_UID);
    await assertSucceeds(getDocs(collection(ownerDb(), "users", OWNER_UID, "blocked")));
    await assertFails(getDocs(collection(otherDb(), "users", OWNER_UID, "blocked")));
  });
});

describe("reports/{reportId}", () => {
  it("a signed-in user can file a report on someone", async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), "reports", "report1"), {
        reporterUid: OWNER_UID,
        reportedUid: OTHER_UID,
        reason: "spam",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("cannot file a report claiming to be someone else", async () => {
    await assertFails(
      setDoc(doc(otherDb(), "reports", "report1"), {
        reporterUid: OWNER_UID,
        reportedUid: MEMBER_UID,
        reason: "spam",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("no one can read reports, not even the reporter", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "reports", "report1"), {
        reporterUid: OWNER_UID,
        reportedUid: OTHER_UID,
        reason: "spam",
        createdAt: new Date(),
      });
    });
    await assertFails(getDoc(doc(ownerDb(), "reports", "report1")));
  });

  it("an unauthenticated request cannot file a report", async () => {
    await assertFails(
      setDoc(doc(anonDb(), "reports", "report1"), {
        reporterUid: OWNER_UID,
        reportedUid: OTHER_UID,
        reason: "spam",
        createdAt: serverTimestamp(),
      })
    );
  });
});

describe("users/{userId} self-update: business/teacher workspace fields", () => {
  it("can set businessWorkspaceId once, from null", async () => {
    await seedUser(OWNER_UID);
    await assertSucceeds(updateDoc(doc(ownerDb(), "users", OWNER_UID), { businessWorkspaceId: "ws1" }));
  });

  it("cannot change businessWorkspaceId once already set", async () => {
    await seedUser(OWNER_UID, { businessWorkspaceId: "ws1" });
    await assertFails(updateDoc(doc(ownerDb(), "users", OWNER_UID), { businessWorkspaceId: "ws2" }));
  });
});

describe("workspaces/{workspaceId}", () => {
  it("a user can open a Business workspace for themselves", async () => {
    await seedUser(TEACHER_UID);
    await assertSucceeds(
      setDoc(doc(teacherDb(), "workspaces", "ws1"), {
        type: "business",
        ownerId: TEACHER_UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("a pre-existing account whose profile doc predates this feature (no studentOfTeacherUid key at all) can still open a Business workspace", async () => {
    // Caught by a real user on a live account, not this suite: a profile
    // doc created before 2026-08-06 has no studentOfTeacherUid key at all,
    // and the create rule's plain `.data.studentOfTeacherUid` access threw
    // instead of treating a missing key as unset, denying every "Open
    // Business/Education profile" click for that account. Reproduces the
    // exact old-shape doc (only the fields signup.js wrote before this
    // feature existed) rather than using seedUser(), which always writes
    // the full modern field set and would never have caught this.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", TEACHER_UID), {
        displayName: "Gozdne",
        username: "gozd",
        email: "teacher-uid@example.com",
        createdAt: new Date(),
        photoURL: null,
      });
    });
    await assertSucceeds(
      setDoc(doc(teacherDb(), "workspaces", "ws1"), {
        type: "business",
        ownerId: TEACHER_UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("a user can open an Education workspace with a valid 8-digit PIN", async () => {
    await seedUser(TEACHER_UID);
    await assertSucceeds(
      setDoc(doc(teacherDb(), "workspaces", "ws1"), {
        type: "education",
        ownerId: TEACHER_UID,
        createdAt: serverTimestamp(),
        teacherPin: "12345678",
      })
    );
  });

  it("cannot open an Education workspace with a PIN that isn't exactly 8 digits", async () => {
    await seedUser(TEACHER_UID);
    await assertFails(
      setDoc(doc(teacherDb(), "workspaces", "ws1"), {
        type: "education",
        ownerId: TEACHER_UID,
        createdAt: serverTimestamp(),
        teacherPin: "123",
      })
    );
  });

  it("cannot create a workspace claiming someone else as owner", async () => {
    await seedUser(OTHER_UID);
    await assertFails(
      setDoc(doc(otherDb(), "workspaces", "ws1"), {
        type: "business",
        ownerId: TEACHER_UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("a linked student cannot open a Business or Education workspace of their own", async () => {
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await assertFails(
      setDoc(doc(studentDb(), "workspaces", "ws2"), {
        type: "business",
        ownerId: STUDENT_UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("the owner can read their own workspace; another user cannot", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "business" });
    await assertSucceeds(getDoc(doc(teacherDb(), "workspaces", "ws1")));
    await assertFails(getDoc(doc(otherDb(), "workspaces", "ws1")));
  });

  it("a workspace can never be updated or deleted", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "business" });
    await assertFails(updateDoc(doc(teacherDb(), "workspaces", "ws1"), { type: "education" }));
    await assertFails(deleteDoc(doc(teacherDb(), "workspaces", "ws1")));
  });
});

describe("workspaces/{workspaceId}/students/{uid}", () => {
  it("a student can create their own roster doc", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "education", teacherPin: "12345678" });
    await assertSucceeds(
      setDoc(doc(studentDb(), "workspaces", "ws1", "students", STUDENT_UID), {
        uid: STUDENT_UID,
        username: "student1",
        displayName: "Student",
        joinedAt: serverTimestamp(),
      })
    );
  });

  it("cannot create a roster doc for someone else", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "education", teacherPin: "12345678" });
    await assertFails(
      setDoc(doc(studentDb(), "workspaces", "ws1", "students", OTHER_UID), {
        uid: OTHER_UID,
        username: "other1",
        displayName: "Other",
        joinedAt: serverTimestamp(),
      })
    );
  });

  it("the teacher (workspace owner) can read the full roster; a stranger cannot", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "education", teacherPin: "12345678" });
    await seedRosterEntry("ws1", STUDENT_UID);
    await assertSucceeds(getDoc(doc(teacherDb(), "workspaces", "ws1", "students", STUDENT_UID)));
    await assertFails(getDoc(doc(otherDb(), "workspaces", "ws1", "students", STUDENT_UID)));
  });

  it("a student can read their own roster entry", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "education", teacherPin: "12345678" });
    await seedRosterEntry("ws1", STUDENT_UID);
    await assertSucceeds(getDoc(doc(studentDb(), "workspaces", "ws1", "students", STUDENT_UID)));
  });

  it("only the teacher can remove (release) a student from the roster", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "education", teacherPin: "12345678" });
    await seedRosterEntry("ws1", STUDENT_UID);
    await assertFails(deleteDoc(doc(studentDb(), "workspaces", "ws1", "students", STUDENT_UID)));
    await assertSucceeds(deleteDoc(doc(teacherDb(), "workspaces", "ws1", "students", STUDENT_UID)));
  });
});

describe("workspaces/{workspaceId}/team/{uid}", () => {
  it("the owner can add an existing friend to the team", async () => {
    await seedWorkspace("wsbiz", { ownerId: OWNER_UID, type: "business" });
    await seedFriendEdge(OWNER_UID, OTHER_UID);
    await assertSucceeds(
      setDoc(doc(ownerDb(), "workspaces", "wsbiz", "team", OTHER_UID), {
        uid: OTHER_UID,
        username: "other1",
        displayName: "Other",
        addedAt: serverTimestamp(),
      })
    );
  });

  it("cannot add someone who isn't a friend", async () => {
    await seedWorkspace("wsbiz", { ownerId: OWNER_UID, type: "business" });
    await assertFails(
      setDoc(doc(ownerDb(), "workspaces", "wsbiz", "team", OTHER_UID), {
        uid: OTHER_UID,
        username: "other1",
        displayName: "Other",
        addedAt: serverTimestamp(),
      })
    );
  });

  it("a non-owner cannot add anyone to someone else's team", async () => {
    await seedWorkspace("wsbiz", { ownerId: OWNER_UID, type: "business" });
    await seedFriendEdge(MEMBER_UID, OTHER_UID);
    await assertFails(
      setDoc(doc(memberDb(), "workspaces", "wsbiz", "team", OTHER_UID), {
        uid: OTHER_UID,
        username: "other1",
        displayName: "Other",
        addedAt: serverTimestamp(),
      })
    );
  });

  it("cannot add to the team of a non-business (education) workspace", async () => {
    await seedWorkspace("wsedu", { ownerId: OWNER_UID, type: "education", teacherPin: "12345678" });
    await seedFriendEdge(OWNER_UID, OTHER_UID);
    await assertFails(
      setDoc(doc(ownerDb(), "workspaces", "wsedu", "team", OTHER_UID), {
        uid: OTHER_UID,
        username: "other1",
        displayName: "Other",
        addedAt: serverTimestamp(),
      })
    );
  });

  it("the owner can read the full team roster; a stranger cannot", async () => {
    await seedWorkspace("wsbiz", { ownerId: OWNER_UID, type: "business" });
    await seedTeamEntry("wsbiz", OTHER_UID);
    await assertSucceeds(getDoc(doc(ownerDb(), "workspaces", "wsbiz", "team", OTHER_UID)));
    await assertFails(getDoc(doc(memberDb(), "workspaces", "wsbiz", "team", OTHER_UID)));
  });

  it("a team member can read their own entry", async () => {
    await seedWorkspace("wsbiz", { ownerId: OWNER_UID, type: "business" });
    await seedTeamEntry("wsbiz", OTHER_UID);
    await assertSucceeds(getDoc(doc(otherDb(), "workspaces", "wsbiz", "team", OTHER_UID)));
  });

  it("the owner can list the whole team roster (team.js's watchTeam)", async () => {
    await seedWorkspace("wsbiz", { ownerId: OWNER_UID, type: "business" });
    await seedTeamEntry("wsbiz", OTHER_UID);
    await seedTeamEntry("wsbiz", MEMBER_UID);
    const snap = await assertSucceeds(getDocs(collection(ownerDb(), "workspaces", "wsbiz", "team")));
    if (snap.size !== 2) throw new Error(`expected 2 results, got ${snap.size}`);
  });

  it("only the owner can remove someone from the team", async () => {
    await seedWorkspace("wsbiz", { ownerId: OWNER_UID, type: "business" });
    await seedTeamEntry("wsbiz", OTHER_UID);
    await assertFails(deleteDoc(doc(otherDb(), "workspaces", "wsbiz", "team", OTHER_UID)));
    await assertSucceeds(deleteDoc(doc(ownerDb(), "workspaces", "wsbiz", "team", OTHER_UID)));
  });

  it("a team roster entry cannot be updated", async () => {
    await seedWorkspace("wsbiz", { ownerId: OWNER_UID, type: "business" });
    await seedTeamEntry("wsbiz", OTHER_UID);
    await assertFails(
      updateDoc(doc(ownerDb(), "workspaces", "wsbiz", "team", OTHER_UID), { displayName: "Renamed" })
    );
  });
});

describe("projects/{projectId} visibleToTeam", () => {
  it("visibleToTeam must be a boolean on create", async () => {
    await seedUser(OWNER_UID);
    await assertFails(
      setDoc(doc(ownerDb(), "projects", "p1"), {
        name: "Birdhouse",
        category: "diy",
        ownerId: OWNER_UID,
        workspaceId: OWNER_UID,
        linkedTeacherUid: null,
        visibleToTeam: "yes",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("the owner can toggle visibleToTeam", async () => {
    await seedProject("project1", { visibleToTeam: false });
    await assertSucceeds(
      updateDoc(doc(ownerDb(), "projects", "project1"), { visibleToTeam: true, updatedAt: serverTimestamp() })
    );
  });

  it("a member cannot toggle visibleToTeam", async () => {
    await seedProject("project1", { visibleToTeam: false });
    await seedMember("project1", MEMBER_UID);
    await assertFails(
      updateDoc(doc(memberDb(), "projects", "project1"), { visibleToTeam: true, updatedAt: serverTimestamp() })
    );
  });

  it("a member can still update other fields as long as visibleToTeam is unchanged", async () => {
    await seedProject("project1", { visibleToTeam: false });
    await seedMember("project1", MEMBER_UID);
    await assertSucceeds(
      updateDoc(doc(memberDb(), "projects", "project1"), { name: "Treehouse", updatedAt: serverTimestamp() })
    );
  });
});

describe("teacherPins/{pin}", () => {
  it("the teacher can create a PIN pointing at their own Education workspace", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "education", teacherPin: "12345678" });
    await assertSucceeds(
      setDoc(doc(teacherDb(), "teacherPins", "12345678"), { workspaceId: "ws1", teacherUid: TEACHER_UID })
    );
  });

  it("cannot create a PIN pointing at a workspace you don't own", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "education", teacherPin: "12345678" });
    await assertFails(
      setDoc(doc(otherDb(), "teacherPins", "12345678"), { workspaceId: "ws1", teacherUid: OTHER_UID })
    );
  });

  it("cannot create a PIN pointing at a Business (non-Education) workspace", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "business" });
    await assertFails(
      setDoc(doc(teacherDb(), "teacherPins", "12345678"), { workspaceId: "ws1", teacherUid: TEACHER_UID })
    );
  });

  it("anyone, even unauthenticated, can read a teacherPin doc to resolve it during signup", async () => {
    await seedTeacherPin("12345678", "ws1", TEACHER_UID);
    await assertSucceeds(getDoc(doc(anonDb(), "teacherPins", "12345678")));
  });

  it("a teacherPin can never be updated or deleted", async () => {
    await seedTeacherPin("12345678", "ws1", TEACHER_UID);
    await assertFails(updateDoc(doc(teacherDb(), "teacherPins", "12345678"), { teacherUid: OTHER_UID }));
    await assertFails(deleteDoc(doc(teacherDb(), "teacherPins", "12345678")));
  });
});

describe("opening an Education workspace end-to-end (profile.js sequence)", () => {
  // Caught by a live smoke test, not this suite originally: get() inside a
  // security rule cannot see another write still pending in the same
  // batch/transaction, so creating workspaces/{id} and teacherPins/{pin}
  // (whose create rule does get(workspaces/{id})) in a single writeBatch
  // fails. profile.js does two sequential writes instead — this documents
  // both the failure mode and the correct sequence, so it can't regress
  // silently the way it did before this test existed.
  it("creating the workspace and its teacherPin in ONE batch fails", async () => {
    await seedUser(TEACHER_UID);
    const db = teacherDb();
    const batch = writeBatch(db);
    batch.set(doc(db, "workspaces", "ws1"), {
      type: "education",
      ownerId: TEACHER_UID,
      createdAt: serverTimestamp(),
      teacherPin: "12345678",
    });
    batch.set(doc(db, "teacherPins", "12345678"), {
      workspaceId: "ws1",
      teacherUid: TEACHER_UID,
    });
    await assertFails(batch.commit());
  });

  it("creating the workspace first, then the teacherPin + user update, succeeds", async () => {
    await seedUser(TEACHER_UID);
    const db = teacherDb();
    await assertSucceeds(
      setDoc(doc(db, "workspaces", "ws1"), {
        type: "education",
        ownerId: TEACHER_UID,
        createdAt: serverTimestamp(),
        teacherPin: "12345678",
      })
    );

    const batch = writeBatch(db);
    batch.set(doc(db, "teacherPins", "12345678"), {
      workspaceId: "ws1",
      teacherUid: TEACHER_UID,
    });
    batch.update(doc(db, "users", TEACHER_UID), { teacherWorkspaceId: "ws1" });
    await assertSucceeds(batch.commit());
  });
});

describe("projects/{projectId} workspace scoping", () => {
  it("the owner can create a project inside a workspace they own", async () => {
    await seedUser(TEACHER_UID);
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "business" });
    await assertSucceeds(setDoc(doc(teacherDb(), "projects", "p1"), newProjectData(TEACHER_UID, "ws1")));
  });

  it("cannot create a project inside a workspace someone else owns", async () => {
    await seedWorkspace("ws1", { ownerId: TEACHER_UID, type: "business" });
    await assertFails(setDoc(doc(otherDb(), "projects", "p1"), newProjectData(OTHER_UID, "ws1")));
  });

  it("workspaceId is immutable after creation", async () => {
    await seedWorkspace("ws1", { ownerId: OWNER_UID, type: "business" });
    await seedProject("project1", { workspaceId: OWNER_UID });
    await assertFails(
      updateDoc(doc(ownerDb(), "projects", "project1"), { workspaceId: "ws1", updatedAt: serverTimestamp() })
    );
  });
});

describe("teacher read-only access to a linked student's projects", () => {
  it("the linked teacher can read but not write a student's Personal-workspace project", async () => {
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await seedProject("sp1", { ownerId: STUDENT_UID, workspaceId: STUDENT_UID, linkedTeacherUid: TEACHER_UID });
    await assertSucceeds(getDoc(doc(teacherDb(), "projects", "sp1")));
    await assertFails(updateDoc(doc(teacherDb(), "projects", "sp1"), { name: "Hacked" }));
    await assertFails(deleteDoc(doc(teacherDb(), "projects", "sp1")));
  });

  it("the linked teacher can list every project owned by their student (dashboard.js 'My Students')", async () => {
    // Regression test for a real live bug: get()-based rules (the old
    // isTeacherOf() check) work fine for a get() by known ID but silently
    // fail every `list`/query call, because Firestore can't prove a list
    // request "safe" when a get() call's path is built from a
    // per-candidate-document field. linkedTeacherUid replaced that get()
    // with a plain resource.data comparison specifically so this works.
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await seedProject("sp1", { ownerId: STUDENT_UID, workspaceId: STUDENT_UID, linkedTeacherUid: TEACHER_UID });
    await seedProject("sp2", { ownerId: STUDENT_UID, workspaceId: STUDENT_UID, linkedTeacherUid: TEACHER_UID });
    // The query's own where() filter must be on the SAME field the rule's
    // list-granting clause checks (linkedTeacherUid) — Firestore's
    // list-safety check only "trusts" a rule clause that correlates with
    // the query's filter field; a clause on an unrelated field (ownerId
    // alone, without also filtering on it) is silently denied for list
    // even though the exact same clause works fine for get().
    const q = query(
      collection(teacherDb(), "projects"),
      where("linkedTeacherUid", "==", TEACHER_UID),
      where("ownerId", "==", STUDENT_UID)
    );
    const snap = await assertSucceeds(getDocs(q));
    if (snap.size !== 2) throw new Error(`expected 2 results, got ${snap.size}`);
  });

  it("an unrelated user cannot read a student's project just by being a teacher elsewhere", async () => {
    await seedProject("sp1", { ownerId: STUDENT_UID, workspaceId: STUDENT_UID });
    await assertFails(getDoc(doc(teacherDb(), "projects", "sp1")));
  });

  it("the linked teacher can read but not write a student's steps", async () => {
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await seedProject("sp1", { ownerId: STUDENT_UID, workspaceId: STUDENT_UID, linkedTeacherUid: TEACHER_UID });
    await seedStep("sp1", "step1");
    await assertSucceeds(getDoc(doc(teacherDb(), "projects", "sp1", "steps", "step1")));
    await assertFails(updateDoc(doc(teacherDb(), "projects", "sp1", "steps", "step1"), { done: true }));
    await assertFails(setDoc(doc(teacherDb(), "projects", "sp1", "steps", "step2"), newStepData(TEACHER_UID)));
  });
});

describe("the teacher-release mechanic (users/{uid} update)", () => {
  it("the linked teacher can clear a student's studentOf* fields (release)", async () => {
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await assertSucceeds(
      updateDoc(doc(teacherDb(), "users", STUDENT_UID), {
        studentOfTeacherUid: null,
        studentOfWorkspaceId: null,
      })
    );
  });

  it("a non-teacher cannot clear another user's studentOf* fields", async () => {
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await assertFails(
      updateDoc(doc(otherDb(), "users", STUDENT_UID), {
        studentOfTeacherUid: null,
        studentOfWorkspaceId: null,
      })
    );
  });

  it("the teacher cannot sneak in another field change while releasing", async () => {
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await assertFails(
      updateDoc(doc(teacherDb(), "users", STUDENT_UID), {
        studentOfTeacherUid: null,
        studentOfWorkspaceId: null,
        displayName: "Renamed",
      })
    );
  });

  it("after release (user-doc clear + the project-side cascade), the former teacher can no longer read the student's project", async () => {
    // linkedTeacherUid on a project is NOT automatically cleared by
    // releasing the student on their users/{uid} doc alone — release is a
    // two-part client operation (dashboard.js releaseStudent): clear
    // studentOf* on the user, AND clear linkedTeacherUid on each of their
    // projects. This test exercises both, matching the real client flow.
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await seedProject("sp1", { ownerId: STUDENT_UID, workspaceId: STUDENT_UID, linkedTeacherUid: TEACHER_UID });
    await assertSucceeds(getDoc(doc(teacherDb(), "projects", "sp1")));

    await updateDoc(doc(teacherDb(), "users", STUDENT_UID), {
      studentOfTeacherUid: null,
      studentOfWorkspaceId: null,
    });
    await assertSucceeds(updateDoc(doc(teacherDb(), "projects", "sp1"), { linkedTeacherUid: null }));

    await assertFails(getDoc(doc(teacherDb(), "projects", "sp1")));
  });

  it("a non-linked user cannot clear someone else's linkedTeacherUid on a project", async () => {
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await seedProject("sp1", { ownerId: STUDENT_UID, workspaceId: STUDENT_UID, linkedTeacherUid: TEACHER_UID });
    await assertFails(updateDoc(doc(otherDb(), "projects", "sp1"), { linkedTeacherUid: null }));
  });

  it("the linked teacher cannot sneak in another field change while clearing linkedTeacherUid", async () => {
    await seedLinkedStudent(STUDENT_UID, TEACHER_UID, "ws-teacher");
    await seedProject("sp1", { ownerId: STUDENT_UID, workspaceId: STUDENT_UID, linkedTeacherUid: TEACHER_UID });
    await assertFails(
      updateDoc(doc(teacherDb(), "projects", "sp1"), { linkedTeacherUid: null, name: "Hacked" })
    );
  });
});
