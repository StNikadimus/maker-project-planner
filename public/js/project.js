import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const projectId = new URLSearchParams(window.location.search).get("id");

const loadingEl = document.getElementById("loading");
const projectEl = document.getElementById("project");
const nameEl = document.getElementById("project-name");
const metaEl = document.getElementById("project-meta");
const errorEl = document.getElementById("error");
const deleteBtn = document.getElementById("delete-project");

const shareSection = document.getElementById("share-section");
const createInviteBtn = document.getElementById("create-invite");
const inviteResultEl = document.getElementById("invite-result");
const inviteLinkInput = document.getElementById("invite-link");
const copyInviteBtn = document.getElementById("copy-invite");
const inviteErrorEl = document.getElementById("invite-error");
const friendsAddListEl = document.getElementById("friends-add-list");
const friendsAddErrorEl = document.getElementById("friends-add-error");
const collaboratorsListEl = document.getElementById("collaborators-list");
const collaboratorsErrorEl = document.getElementById("collaborators-error");

const stepForm = document.getElementById("step-form");
const stepTitleInput = document.getElementById("step-title");
const stepNotesInput = document.getElementById("step-notes");
const stepMaterialsInput = document.getElementById("step-materials");
const stepToolsInput = document.getElementById("step-tools");
const stepsErrorEl = document.getElementById("steps-error");
const stepsListEl = document.getElementById("steps-list");

let currentSteps = [];
let unsubscribeSteps = null;
let unsubscribeMembers = null;
let isOwner = false;
let isReadOnly = false;
let currentMemberUids = new Set();
let currentMembers = [];
let ownerFriends = [];

if (!projectId) {
  showError("No project specified.");
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      if (unsubscribeSteps) unsubscribeSteps();
      if (unsubscribeMembers) unsubscribeMembers();
      window.location.href = "signin.html";
      return;
    }
    loadProject(projectId);
    watchSteps(projectId);
  });
}

async function loadProject(id) {
  try {
    const snap = await getDoc(doc(db, "projects", id));
    if (!snap.exists()) {
      showError("Project not found.");
      return;
    }
    const project = snap.data();
    nameEl.textContent = project.name;
    metaEl.textContent = `Category: ${project.category}`;

    isOwner = project.ownerId === auth.currentUser.uid;
    deleteBtn.hidden = !isOwner;
    shareSection.hidden = !isOwner;

    if (isOwner) {
      isReadOnly = false;
      watchMembers(id);
      loadOwnerFriends();
    } else {
      // Not the owner: could be a redeemed collaborator (full read/write on
      // steps) or the owner's Education teacher viewing read-only (see
      // isTeacherOf() in firestore.rules — teachers can read but never
      // write a student's project). Distinguish by checking our own
      // membership doc.
      const memberSnap = await getDoc(doc(db, "projects", id, "members", auth.currentUser.uid));
      isReadOnly = !memberSnap.exists();
    }
    stepForm.hidden = isReadOnly;

    loadingEl.hidden = true;
    projectEl.hidden = false;
    renderSteps();
  } catch (err) {
    console.error(err);
    showError("You don't have access to this project.");
  }
}

function showError(message) {
  loadingEl.hidden = true;
  errorEl.textContent = message;
}

deleteBtn.addEventListener("click", async () => {
  if (!window.confirm(`Delete "${nameEl.textContent}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, "projects", projectId));
    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Couldn't delete project.";
  }
});

function watchSteps(id) {
  const stepsQuery = query(collection(db, "projects", id, "steps"), orderBy("order"));
  unsubscribeSteps = onSnapshot(
    stepsQuery,
    (snapshot) => {
      currentSteps = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderSteps();
    },
    (err) => {
      console.error(err);
      stepsErrorEl.textContent = "Couldn't load steps.";
    }
  );
}

function renderSteps() {
  stepsListEl.innerHTML = "";

  if (currentSteps.length === 0) {
    stepsListEl.innerHTML = '<li class="empty">No steps yet &mdash; add the first one above.</li>';
    return;
  }

  currentSteps.forEach((step, index) => {
    const li = document.createElement("li");
    li.className = "step-item";

    const label = document.createElement("label");
    label.className = "step-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = step.done;
    checkbox.disabled = isReadOnly;
    checkbox.addEventListener("change", () => toggleDone(step.id, checkbox.checked));

    const titleSpan = document.createElement("span");
    titleSpan.className = "step-title";
    titleSpan.textContent = step.title;
    if (step.done) titleSpan.classList.add("step-title--done");

    label.appendChild(checkbox);
    label.appendChild(titleSpan);
    li.appendChild(label);

    const details = [];
    if (step.notes) details.push(step.notes);
    if (step.materials?.length) details.push(`Materials: ${step.materials.join(", ")}`);
    if (step.tools?.length) details.push(`Tools: ${step.tools.join(", ")}`);
    if (details.length > 0) {
      const detailsEl = document.createElement("p");
      detailsEl.className = "step-details muted";
      detailsEl.textContent = details.join(" — ");
      li.appendChild(detailsEl);
    }

    if (!isReadOnly) {
      const actions = document.createElement("div");
      actions.className = "step-actions";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "btn btn--small";
      upBtn.textContent = "↑";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => moveStep(index, -1));

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "btn btn--small";
      downBtn.textContent = "↓";
      downBtn.disabled = index === currentSteps.length - 1;
      downBtn.addEventListener("click", () => moveStep(index, 1));

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);

      if (isOwner) {
        const deleteStepBtn = document.createElement("button");
        deleteStepBtn.type = "button";
        deleteStepBtn.className = "btn btn--small btn--danger";
        deleteStepBtn.textContent = "Delete";
        deleteStepBtn.addEventListener("click", () => deleteStep(step.id, step.title));
        actions.appendChild(deleteStepBtn);
      }

      li.appendChild(actions);
    }

    stepsListEl.appendChild(li);
  });
}

const addStepBtn = stepForm.querySelector('button[type="submit"]');

stepForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  stepsErrorEl.textContent = "";

  const title = stepTitleInput.value.trim();
  if (!title) return;

  const materials = splitList(stepMaterialsInput.value);
  const tools = splitList(stepToolsInput.value);

  addStepBtn.classList.add("is-loading");
  try {
    await addDoc(collection(db, "projects", projectId, "steps"), {
      title,
      notes: stepNotesInput.value.trim(),
      materials,
      tools,
      done: false,
      order: currentSteps.length,
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    stepForm.reset();
  } catch (err) {
    console.error(err);
    stepsErrorEl.textContent = "Couldn't add step.";
  } finally {
    addStepBtn.classList.remove("is-loading");
  }
});

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function toggleDone(stepId, done) {
  try {
    await updateDoc(doc(db, "projects", projectId, "steps", stepId), {
      done,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error(err);
    stepsErrorEl.textContent = "Couldn't update step.";
  }
}

async function deleteStep(stepId, title) {
  if (!window.confirm(`Delete step "${title}"?`)) return;
  try {
    await deleteDoc(doc(db, "projects", projectId, "steps", stepId));
  } catch (err) {
    console.error(err);
    stepsErrorEl.textContent = "Couldn't delete step.";
  }
}

createInviteBtn.addEventListener("click", async () => {
  inviteErrorEl.textContent = "";
  createInviteBtn.disabled = true;
  createInviteBtn.classList.add("is-loading");
  try {
    const token = crypto.randomUUID();
    await setDoc(doc(db, "projects", projectId, "invites", token), {
      createdBy: auth.currentUser.uid,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      redeemedBy: null,
      redeemedAt: null,
    });
    const link = `${window.location.origin}/join.html?projectId=${projectId}&token=${token}`;
    inviteLinkInput.value = link;
    inviteResultEl.hidden = false;
  } catch (err) {
    console.error(err);
    inviteErrorEl.textContent = "Couldn't create invite link.";
  } finally {
    createInviteBtn.disabled = false;
    createInviteBtn.classList.remove("is-loading");
  }
});

copyInviteBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(inviteLinkInput.value);
  copyInviteBtn.textContent = "Copied!";
  setTimeout(() => (copyInviteBtn.textContent = "Copy"), 1500);
});

function watchMembers(id) {
  unsubscribeMembers = onSnapshot(
    collection(db, "projects", id, "members"),
    (snapshot) => {
      currentMembers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      currentMemberUids = new Set(currentMembers.map((m) => m.id));
      renderFriendsAddList();
      renderCollaboratorsList();
    },
    (err) => {
      console.error(err);
      friendsAddErrorEl.textContent = "Couldn't load collaborators.";
    }
  );
}

async function loadOwnerFriends() {
  try {
    const snap = await getDocs(collection(db, "users", auth.currentUser.uid, "friends"));
    ownerFriends = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderFriendsAddList();
  } catch (err) {
    console.error(err);
    friendsAddErrorEl.textContent = "Couldn't load your friends list.";
  }
}

function renderFriendsAddList() {
  const addable = ownerFriends.filter((f) => !currentMemberUids.has(f.id));

  friendsAddListEl.innerHTML = "";
  if (addable.length === 0) {
    friendsAddListEl.innerHTML = '<li class="empty">No friends to add (or they\'re all already collaborators).</li>';
    return;
  }

  for (const friend of addable) {
    const li = document.createElement("li");
    li.className = "project-item";

    const label = document.createElement("span");
    label.textContent = `${friend.displayName} (@${friend.username})`;
    li.appendChild(label);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn--small";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", () => addFriendToProject(friend, addBtn));
    li.appendChild(addBtn);

    friendsAddListEl.appendChild(li);
  }
}

async function addFriendToProject(friend, btn) {
  friendsAddErrorEl.textContent = "";
  btn.disabled = true;
  try {
    await setDoc(doc(db, "projects", projectId, "members", friend.id), {
      uid: friend.id,
      addedVia: "friend",
      displayName: friend.displayName,
      username: friend.username,
      joinedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    friendsAddErrorEl.textContent = "Couldn't add friend to project.";
  }
}

function renderCollaboratorsList() {
  collaboratorsListEl.innerHTML = "";
  if (currentMembers.length === 0) {
    collaboratorsListEl.innerHTML = '<li class="empty">No collaborators yet.</li>';
    return;
  }

  for (const member of currentMembers) {
    const li = document.createElement("li");
    li.className = "project-item";

    const label = document.createElement("span");
    label.textContent = member.username ? `${member.displayName} (@${member.username})` : member.displayName || member.id;
    li.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn--danger btn--small";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeCollaborator(member.id, member.displayName || member.id));
    li.appendChild(removeBtn);

    collaboratorsListEl.appendChild(li);
  }
}

async function removeCollaborator(memberUid, name) {
  collaboratorsErrorEl.textContent = "";
  if (!window.confirm(`Remove ${name} as a collaborator on this project?`)) return;
  try {
    await deleteDoc(doc(db, "projects", projectId, "members", memberUid));
  } catch (err) {
    console.error(err);
    collaboratorsErrorEl.textContent = "Couldn't remove collaborator.";
  }
}

async function moveStep(index, direction) {
  const otherIndex = index + direction;
  if (otherIndex < 0 || otherIndex >= currentSteps.length) return;

  const current = currentSteps[index];
  const other = currentSteps[otherIndex];

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "projects", projectId, "steps", current.id), {
      order: other.order,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, "projects", projectId, "steps", other.id), {
      order: current.order,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    console.error(err);
    stepsErrorEl.textContent = "Couldn't reorder steps.";
  }
}
