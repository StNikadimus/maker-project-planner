import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { doc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const projectId = new URLSearchParams(window.location.search).get("id");

const loadingEl = document.getElementById("loading");
const projectEl = document.getElementById("project");
const nameEl = document.getElementById("project-name");
const metaEl = document.getElementById("project-meta");
const errorEl = document.getElementById("error");
const deleteBtn = document.getElementById("delete-project");

if (!projectId) {
  showError("No project specified.");
} else {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.href = "signin.html";
      return;
    }
    loadProject(projectId);
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
