import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  collection,
  collectionGroup,
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
const sharedProjectsListEl = document.getElementById("shared-projects-list");

let unsubscribeOwned = null;
let unsubscribeShared = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (unsubscribeOwned) unsubscribeOwned();
    if (unsubscribeShared) unsubscribeShared();
    window.location.href = "signin.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  nameEl.textContent = userSnap.exists() ? userSnap.data().displayName : user.email;

  const ownedQuery = query(collection(db, "projects"), where("ownerId", "==", user.uid));
  unsubscribeOwned = onSnapshot(
    ownedQuery,
    (snapshot) => renderProjectList(projectsListEl, snapshot.docs, { showDelete: true }),
    (err) => {
      console.error(err);
      projectsErrorEl.textContent = "Couldn't load projects.";
    }
  );

  const sharedQuery = query(collectionGroup(db, "members"), where("uid", "==", user.uid));
  unsubscribeShared = onSnapshot(
    sharedQuery,
    async (snapshot) => {
      const projectDocs = await Promise.all(snapshot.docs.map((memberDoc) => getDoc(memberDoc.ref.parent.parent)));
      renderProjectList(sharedProjectsListEl, projectDocs.filter((d) => d.exists()), { showDelete: false });
    },
    (err) => {
      console.error(err);
      projectsErrorEl.textContent = "Couldn't load shared projects.";
    }
  );

  loadingEl.hidden = true;
  dashboardEl.hidden = false;
});

function renderProjectList(listEl, docs, { showDelete }) {
  const sorted = [...docs].sort((a, b) => {
    const aTime = a.data().createdAt?.toMillis?.() ?? Date.now();
    const bTime = b.data().createdAt?.toMillis?.() ?? Date.now();
    return bTime - aTime;
  });

  listEl.innerHTML = "";

  if (sorted.length === 0) {
    listEl.innerHTML = `<li class="empty">${showDelete ? "No projects yet &mdash; add one above." : "No projects have been shared with you yet."}</li>`;
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

    if (showDelete) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn--danger btn--small";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => deleteProject(docSnap.id, project.name));
      li.appendChild(deleteBtn);
    }

    listEl.appendChild(li);
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
