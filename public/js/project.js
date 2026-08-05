import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  getDoc,
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

const stepForm = document.getElementById("step-form");
const stepTitleInput = document.getElementById("step-title");
const stepNotesInput = document.getElementById("step-notes");
const stepMaterialsInput = document.getElementById("step-materials");
const stepToolsInput = document.getElementById("step-tools");
const stepsErrorEl = document.getElementById("steps-error");
const stepsListEl = document.getElementById("steps-list");

let currentSteps = [];
let unsubscribeSteps = null;
let isOwner = false;

if (!projectId) {
  showError("No project specified.");
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      if (unsubscribeSteps) unsubscribeSteps();
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

    loadingEl.hidden = true;
    projectEl.hidden = false;
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

    stepsListEl.appendChild(li);
  });
}

stepForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  stepsErrorEl.textContent = "";

  const title = stepTitleInput.value.trim();
  if (!title) return;

  const materials = splitList(stepMaterialsInput.value);
  const tools = splitList(stepToolsInput.value);

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
  }
});

copyInviteBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(inviteLinkInput.value);
  copyInviteBtn.textContent = "Copied!";
  setTimeout(() => (copyInviteBtn.textContent = "Copy"), 1500);
});

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
