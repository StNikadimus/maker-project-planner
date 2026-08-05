import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const loadingEl = document.getElementById("loading");
const dashboardEl = document.getElementById("dashboard");
const nameEl = document.getElementById("name");
const signOutBtn = document.getElementById("signout");
const projectForm = document.getElementById("project-form");
const projectNameInput = document.getElementById("project-name");
const projectsListEl = document.getElementById("projects-list");
const projectsErrorEl = document.getElementById("projects-error");

let unsubscribeProjects = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (unsubscribeProjects) unsubscribeProjects();
    window.location.href = "signin.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  nameEl.textContent = userSnap.exists() ? userSnap.data().displayName : user.email;

  const projectsQuery = query(collection(db, "projects"), where("ownerId", "==", user.uid));
  unsubscribeProjects = onSnapshot(
    projectsQuery,
    (snapshot) => renderProjects(snapshot.docs),
    (err) => {
      console.error(err);
      projectsErrorEl.textContent = "Couldn't load projects.";
    }
  );

  loadingEl.hidden = true;
  dashboardEl.hidden = false;
});

function renderProjects(docs) {
  const sorted = [...docs].sort((a, b) => {
    const aTime = a.data().createdAt?.toMillis?.() ?? Date.now();
    const bTime = b.data().createdAt?.toMillis?.() ?? Date.now();
    return bTime - aTime;
  });

  projectsListEl.innerHTML = "";

  if (sorted.length === 0) {
    projectsListEl.innerHTML = '<li class="empty">No projects yet &mdash; add one above.</li>';
    return;
  }

  for (const docSnap of sorted) {
    const project = docSnap.data();
    const li = document.createElement("li");
    li.className = "project-item";

    const link = document.createElement("a");
    link.href = `project.html?id=${docSnap.id}`;
    link.textContent = project.name;
    li.appendChild(link);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn--danger btn--small";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteProject(docSnap.id, project.name));
    li.appendChild(deleteBtn);

    projectsListEl.appendChild(li);
  }
}

async function deleteProject(projectId, name) {
  if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, "projects", projectId));
  } catch (err) {
    console.error(err);
    projectsErrorEl.textContent = "Couldn't delete project.";
  }
}

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  projectsErrorEl.textContent = "";

  const name = projectNameInput.value.trim();
  if (!name) return;

  try {
    await addDoc(collection(db, "projects"), {
      name,
      category: "diy",
      ownerId: auth.currentUser.uid,
      collaboratorIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    projectForm.reset();
  } catch (err) {
    console.error(err);
    projectsErrorEl.textContent = "Couldn't create project.";
  }
});

signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "signin.html";
});
