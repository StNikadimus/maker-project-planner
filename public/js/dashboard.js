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
  getDocs,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { isBusinessWorkspaceActive } from "./active-workspace.js";

const loadingEl = document.getElementById("loading");
const dashboardEl = document.getElementById("dashboard");
const nameEl = document.getElementById("name");
const signOutBtn = document.getElementById("signout");
const projectForm = document.getElementById("project-form");
const projectNameInput = document.getElementById("project-name");
const projectsListEl = document.getElementById("projects-list");
const projectsErrorEl = document.getElementById("projects-error");
const sharedProjectsListEl = document.getElementById("shared-projects-list");
const workspaceSelectEl = document.getElementById("workspace-select");
const studentsSectionEl = document.getElementById("students-section");
const studentsListEl = document.getElementById("students-list");
const studentsErrorEl = document.getElementById("students-error");
const teamTabEl = document.getElementById("team-tab");

let unsubscribeOwned = null;
let unsubscribeShared = null;
let unsubscribeStudents = null;
let currentUser = null;
let userData = null;
let activeWorkspaceId = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (unsubscribeOwned) unsubscribeOwned();
    if (unsubscribeShared) unsubscribeShared();
    if (unsubscribeStudents) unsubscribeStudents();
    window.location.href = "signin.html";
    return;
  }
  currentUser = user;

  const userSnap = await getDoc(doc(db, "users", user.uid));
  userData = userSnap.exists() ? userSnap.data() : { displayName: user.email };
  nameEl.textContent = userData.displayName;

  activeWorkspaceId = readStoredWorkspaceId(user.uid);
  renderWorkspaceOptions();
  refreshForWorkspace();

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

function workspaceOptions() {
  const options = [{ id: currentUser.uid, label: "Personal" }];
  if (userData.businessWorkspaceId) options.push({ id: userData.businessWorkspaceId, label: "Business" });
  if (userData.teacherWorkspaceId) options.push({ id: userData.teacherWorkspaceId, label: "Education (Teacher)" });
  return options;
}

function readStoredWorkspaceId(uid) {
  return window.localStorage.getItem(`activeWorkspace:${uid}`);
}

function renderWorkspaceOptions() {
  const options = workspaceOptions();
  if (!options.some((o) => o.id === activeWorkspaceId)) {
    activeWorkspaceId = currentUser.uid;
  }
  window.localStorage.setItem(`activeWorkspace:${currentUser.uid}`, activeWorkspaceId);

  workspaceSelectEl.innerHTML = "";
  for (const option of options) {
    const optionEl = document.createElement("option");
    optionEl.value = option.id;
    optionEl.textContent = option.label;
    workspaceSelectEl.appendChild(optionEl);
  }
  workspaceSelectEl.value = activeWorkspaceId;

  // Nothing to switch between with only Personal open — no point showing
  // a dropdown of one.
  workspaceSelectEl.hidden = options.length <= 1;
}

workspaceSelectEl.addEventListener("change", () => {
  activeWorkspaceId = workspaceSelectEl.value;
  window.localStorage.setItem(`activeWorkspace:${currentUser.uid}`, activeWorkspaceId);
  refreshForWorkspace();
});

function refreshForWorkspace() {
  watchOwnedProjects();
  watchStudents();
  teamTabEl.hidden = !isBusinessWorkspaceActive(currentUser.uid, userData.businessWorkspaceId);
}

function watchOwnedProjects() {
  if (unsubscribeOwned) unsubscribeOwned();
  const ownedQuery = query(
    collection(db, "projects"),
    where("ownerId", "==", currentUser.uid),
    where("workspaceId", "==", activeWorkspaceId)
  );
  unsubscribeOwned = onSnapshot(
    ownedQuery,
    (snapshot) => renderProjectList(projectsListEl, snapshot.docs, { showDelete: true }),
    (err) => {
      console.error(err);
      projectsErrorEl.textContent = "Couldn't load projects.";
    }
  );
}

function watchStudents() {
  if (unsubscribeStudents) unsubscribeStudents();
  const isTeacherWorkspace = !!userData.teacherWorkspaceId && activeWorkspaceId === userData.teacherWorkspaceId;
  studentsSectionEl.hidden = !isTeacherWorkspace;
  if (!isTeacherWorkspace) return;

  const studentsQuery = collection(db, "workspaces", userData.teacherWorkspaceId, "students");
  unsubscribeStudents = onSnapshot(
    studentsQuery,
    (snapshot) => renderStudentsList(snapshot.docs),
    (err) => {
      console.error(err);
      studentsErrorEl.textContent = "Couldn't load students.";
    }
  );
}

function renderStudentsList(docs) {
  studentsListEl.innerHTML = "";

  if (docs.length === 0) {
    studentsListEl.innerHTML = `<li class="empty">No students have joined with your PIN yet.</li>`;
    return;
  }

  for (const docSnap of docs) {
    const student = docSnap.data();

    const li = document.createElement("li");
    li.className = "project-item";

    const label = document.createElement("span");
    label.textContent = `${student.displayName} (@${student.username})`;
    li.appendChild(label);

    const actions = document.createElement("div");

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "btn btn--secondary btn--small";
    viewBtn.textContent = "View projects";
    actions.appendChild(viewBtn);

    const releaseBtn = document.createElement("button");
    releaseBtn.type = "button";
    releaseBtn.className = "btn btn--danger btn--small";
    releaseBtn.textContent = "Release";
    releaseBtn.addEventListener("click", () => releaseStudent(docSnap.id, student.displayName));
    actions.appendChild(releaseBtn);

    li.appendChild(actions);
    studentsListEl.appendChild(li);

    const projectsLi = document.createElement("li");
    const projectsListInner = document.createElement("ul");
    projectsListInner.className = "projects-list";
    projectsListInner.hidden = true;
    projectsLi.appendChild(projectsListInner);
    studentsListEl.appendChild(projectsLi);

    viewBtn.addEventListener("click", () => toggleStudentProjects(docSnap.id, projectsListInner, viewBtn));
  }
}

async function toggleStudentProjects(studentUid, listEl, toggleBtn) {
  if (!listEl.hidden) {
    listEl.hidden = true;
    toggleBtn.textContent = "View projects";
    return;
  }

  toggleBtn.classList.add("is-loading");
  try {
    // The query's own where() filter must include linkedTeacherUid — it's
    // the field the projects list rule actually grants teacher access on;
    // Firestore's list-safety check silently denies a rule clause that
    // doesn't correlate with the query's filter field, even though the
    // same clause works fine for a plain getDoc(). See firestore.rules.
    const snap = await getDocs(
      query(
        collection(db, "projects"),
        where("linkedTeacherUid", "==", auth.currentUser.uid),
        where("ownerId", "==", studentUid)
      )
    );
    listEl.innerHTML = "";
    if (snap.empty) {
      listEl.innerHTML = `<li class="empty">No projects yet.</li>`;
    } else {
      for (const docSnap of snap.docs) {
        const project = docSnap.data();
        const li = document.createElement("li");
        li.className = "project-item";
        const link = document.createElement("a");
        link.href = `project.html?id=${docSnap.id}`;
        link.textContent = project.name;
        li.appendChild(link);
        listEl.appendChild(li);
      }
    }
    listEl.hidden = false;
    toggleBtn.textContent = "Hide projects";
  } catch (err) {
    console.error(err);
    studentsErrorEl.textContent = "Couldn't load that student's projects.";
  } finally {
    toggleBtn.classList.remove("is-loading");
  }
}

async function releaseStudent(studentUid, name) {
  studentsErrorEl.textContent = "";
  if (!window.confirm(`Release ${name}? They'll keep their account and projects but leave your class.`)) return;

  try {
    // Clear the denormalized linkedTeacherUid on every project of theirs it
    // was ever set on — otherwise those projects would keep granting this
    // teacher read access forever, since nothing else ever changes it
    // after creation (see firestore.rules).
    const linkedProjectsSnap = await getDocs(
      query(
        collection(db, "projects"),
        where("linkedTeacherUid", "==", auth.currentUser.uid),
        where("ownerId", "==", studentUid)
      )
    );

    const batch = writeBatch(db);
    for (const projectDoc of linkedProjectsSnap.docs) {
      batch.update(projectDoc.ref, { linkedTeacherUid: null });
    }
    batch.delete(doc(db, "workspaces", userData.teacherWorkspaceId, "students", studentUid));
    batch.update(doc(db, "users", studentUid), { studentOfTeacherUid: null, studentOfWorkspaceId: null });
    await batch.commit();
  } catch (err) {
    console.error(err);
    studentsErrorEl.textContent = "Couldn't release student.";
  }
}

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

const addProjectBtn = projectForm.querySelector('button[type="submit"]');

projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  projectsErrorEl.textContent = "";

  const name = projectNameInput.value.trim();
  if (!name) return;

  addProjectBtn.classList.add("is-loading");
  try {
    await addDoc(collection(db, "projects"), {
      name,
      category: "diy",
      ownerId: auth.currentUser.uid,
      workspaceId: activeWorkspaceId,
      linkedTeacherUid: userData.studentOfTeacherUid ?? null,
      visibleToTeam: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    projectForm.reset();
  } catch (err) {
    console.error(err);
    projectsErrorEl.textContent = "Couldn't create project.";
  } finally {
    addProjectBtn.classList.remove("is-loading");
  }
});

signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "signin.html";
});
