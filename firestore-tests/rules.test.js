import { before, beforeEach, after, describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OWNER_UID = "owner-uid";
const OTHER_UID = "other-uid";
const MEMBER_UID = "member-uid";

const DAY_MS = 24 * 60 * 60 * 1000;

const newProjectData = (ownerId) => ({
  name: "Birdhouse",
  category: "diy",
  ownerId,
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
function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seedProject(id = "project1") {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects", id), {
      name: "Birdhouse",
      category: "diy",
      ownerId: OWNER_UID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
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
  it("owner can create their own profile", async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), "users", OWNER_UID), {
        displayName: "Owner",
        email: "owner@example.com",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("a user cannot create a profile for someone else", async () => {
    await assertFails(
      setDoc(doc(otherDb(), "users", OWNER_UID), {
        displayName: "Hacker",
        email: "other@example.com",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("another authenticated user cannot read someone else's profile", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID), {
        displayName: "Owner",
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
        email: "owner@example.com",
        createdAt: new Date(),
      });
    });
    await assertFails(getDoc(doc(anonDb(), "users", OWNER_UID)));
  });
});

describe("projects/{projectId}", () => {
  it("owner can create their own project", async () => {
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
});
