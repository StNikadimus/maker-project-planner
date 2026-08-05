import { before, beforeEach, after, describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OWNER_UID = "owner-uid";
const OTHER_UID = "other-uid";

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
function anonDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seedProject(id = "project1") {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects", id), {
      name: "Birdhouse",
      category: "diy",
      ownerId: OWNER_UID,
      collaboratorIds: [],
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

  it("owner can read their own profile", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users", OWNER_UID), {
        displayName: "Owner",
        email: "owner@example.com",
        createdAt: new Date(),
      });
    });
    await assertSucceeds(getDoc(doc(ownerDb(), "users", OWNER_UID)));
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
  const newProjectData = (ownerId) => ({
    name: "Birdhouse",
    category: "diy",
    ownerId,
    collaboratorIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

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

describe("projects/{projectId}/steps/{stepId}", () => {
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
