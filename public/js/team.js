import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  writeBatch,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const loadingEl = document.getElementById("loading");
const noBusinessEl = document.getElementById("no-business");
const teamEl = document.getElementById("team");

const teamListEl = document.getElementById("team-list");
const teamErrorEl = document.getElementById("team-error");
const teamAddListEl = document.getElementById("team-add-list");
const teamAddErrorEl = document.getElementById("team-add-error");
const teamProjectsListEl = document.getElementById("team-projects-list");
const teamProjectsErrorEl = document.getElementById("team-projects-error");

let businessWorkspaceId = null;
let currentTeam = [];
let currentTeamUids = new Set();
let ownerFriends = [];
let unsubscribeTeam = null;
let unsubscribeProjects = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (unsubscribeTeam) unsubscribeTeam();
    if (unsubscribeProjects) unsubscribeProjects();
    window.location.href = "signin.html";
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    businessWorkspaceId = userData.businessWorkspaceId ?? null;

    if (!businessWorkspaceId) {
      loadingEl.hidden = true;
      noBusinessEl.hidden = false;
      return;
    }

    watchTeam();
    watchTeamProjects();
    await loadOwnerFriends();

    loadingEl.hidden = true;
    teamEl.hidden = false;
  } catch (err) {
    console.error(err);
    loadingEl.hidden = true;
    teamErrorEl.textContent = "Couldn't load your team.";
  }
});

function watchTeam() {
  unsubscribeTeam = onSnapshot(
    collection(db, "workspaces", businessWorkspaceId, "team"),
    (snapshot) => {
      currentTeam = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      currentTeamUids = new Set(currentTeam.map((m) => m.id));
      renderTeamList();
      renderTeamAddList();
    },
    (err) => {
      console.error(err);
      teamErrorEl.textContent = "Couldn't load your team.";
    }
  );
}

function renderTeamList() {
  teamListEl.innerHTML = "";
  if (currentTeam.length === 0) {
    teamListEl.innerHTML = '<li class="empty">No one on your team yet.</li>';
    return;
  }

  for (const member of currentTeam) {
    const li = document.createElement("li");
    li.className = "project-item";

    const label = document.createElement("span");
    label.textContent = `${member.displayName} (@${member.username})`;
    li.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn--danger btn--small";
    removeBtn.textContent = "Remove from team";
    removeBtn.addEventListener("click", () => removeFromTeam(member.id, member.displayName));
    li.appendChild(removeBtn);

    teamListEl.appendChild(li);
  }
}

async function loadOwnerFriends() {
  try {
    const snap = await getDocs(collection(db, "users", auth.currentUser.uid, "friends"));
    ownerFriends = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTeamAddList();
  } catch (err) {
    console.error(err);
    teamAddErrorEl.textContent = "Couldn't load your friends list.";
  }
}

function renderTeamAddList() {
  const addable = ownerFriends.filter((f) => !currentTeamUids.has(f.id));

  teamAddListEl.innerHTML = "";
  if (addable.length === 0) {
    teamAddListEl.innerHTML = '<li class="empty">No friends to add (or they\'re all already on your team).</li>';
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
    addBtn.textContent = "Add to team";
    addBtn.addEventListener("click", () => addToTeam(friend, addBtn));
    li.appendChild(addBtn);

    teamAddListEl.appendChild(li);
  }
}

async function addToTeam(friend, btn) {
  teamAddErrorEl.textContent = "";
  btn.disabled = true;
  try {
    // Grant access to whatever's currently shared with the team, so a new
    // member immediately sees it — see CLAUDE.md for why this is a plain
    // batch of ordinary members/{uid} writes rather than a new access-
    // control primitive.
    const sharedSnap = await getDocs(
      query(
        collection(db, "projects"),
        where("ownerId", "==", auth.currentUser.uid),
        where("workspaceId", "==", businessWorkspaceId),
        where("visibleToTeam", "==", true)
      )
    );

    const batch = writeBatch(db);
    batch.set(doc(db, "workspaces", businessWorkspaceId, "team", friend.id), {
      uid: friend.id,
      username: friend.username,
      displayName: friend.displayName,
      addedAt: serverTimestamp(),
    });
    for (const projectDoc of sharedSnap.docs) {
      batch.set(doc(db, "projects", projectDoc.id, "members", friend.id), {
        uid: friend.id,
        addedVia: "friend",
        displayName: friend.displayName,
        username: friend.username,
        joinedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    teamAddErrorEl.textContent = "Couldn't add to team.";
  }
}

async function removeFromTeam(uid, name) {
  teamErrorEl.textContent = "";
  if (!window.confirm(`Remove ${name} from your team? This revokes their access to every Business project.`)) return;

  try {
    const allProjectsSnap = await getDocs(
      query(
        collection(db, "projects"),
        where("ownerId", "==", auth.currentUser.uid),
        where("workspaceId", "==", businessWorkspaceId)
      )
    );

    const batch = writeBatch(db);
    batch.delete(doc(db, "workspaces", businessWorkspaceId, "team", uid));
    for (const projectDoc of allProjectsSnap.docs) {
      batch.delete(doc(db, "projects", projectDoc.id, "members", uid));
    }
    await batch.commit();
  } catch (err) {
    console.error(err);
    teamErrorEl.textContent = "Couldn't remove from team.";
  }
}

function watchTeamProjects() {
  const projectsQuery = query(
    collection(db, "projects"),
    where("ownerId", "==", auth.currentUser.uid),
    where("workspaceId", "==", businessWorkspaceId)
  );
  unsubscribeProjects = onSnapshot(
    projectsQuery,
    (snapshot) => renderTeamProjectsList(snapshot.docs),
    (err) => {
      console.error(err);
      teamProjectsErrorEl.textContent = "Couldn't load your projects.";
    }
  );
}

function renderTeamProjectsList(docs) {
  teamProjectsListEl.innerHTML = "";
  if (docs.length === 0) {
    teamProjectsListEl.innerHTML = '<li class="empty">No Business projects yet.</li>';
    return;
  }

  for (const docSnap of docs) {
    const project = docSnap.data();
    const li = document.createElement("li");
    li.className = "project-item";

    const label = document.createElement("label");
    label.className = "checkbox-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!project.visibleToTeam;
    checkbox.addEventListener("change", () => toggleVisibleToTeam(docSnap.id, checkbox.checked, checkbox));

    const nameSpan = document.createElement("span");
    nameSpan.textContent = project.name;

    label.appendChild(checkbox);
    label.appendChild(nameSpan);
    li.appendChild(label);

    teamProjectsListEl.appendChild(li);
  }
}

async function toggleVisibleToTeam(projectId, visible, checkbox) {
  teamProjectsErrorEl.textContent = "";
  checkbox.disabled = true;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "projects", projectId), { visibleToTeam: visible, updatedAt: serverTimestamp() });
    for (const member of currentTeam) {
      const memberRef = doc(db, "projects", projectId, "members", member.id);
      if (visible) {
        batch.set(memberRef, {
          uid: member.id,
          addedVia: "friend",
          displayName: member.displayName,
          username: member.username,
          joinedAt: serverTimestamp(),
        });
      } else {
        batch.delete(memberRef);
      }
    }
    await batch.commit();
  } catch (err) {
    console.error(err);
    checkbox.checked = !visible;
    teamProjectsErrorEl.textContent = "Couldn't update team visibility.";
  } finally {
    checkbox.disabled = false;
  }
}
