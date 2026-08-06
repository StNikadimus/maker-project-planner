import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  addDoc,
  writeBatch,
  collection,
  query,
  orderBy,
  startAt,
  endAt,
  limit,
  documentId,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import QRCode from "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm";

const loadingEl = document.getElementById("loading");
const friendsEl = document.getElementById("friends");
const signOutBtn = document.getElementById("signout");

const requestsListEl = document.getElementById("requests-list");
const requestsErrorEl = document.getElementById("requests-error");

const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchResultsEl = document.getElementById("search-results");
const searchErrorEl = document.getElementById("search-error");

const showQrBtn = document.getElementById("show-qr-btn");
const scanQrBtn = document.getElementById("scan-qr-btn");
const stopScanBtn = document.getElementById("stop-scan-btn");
const myQrWrap = document.getElementById("my-qr-wrap");
const myQrCanvas = document.getElementById("my-qr-canvas");
const scanWrap = document.getElementById("scan-wrap");
const scanVideo = document.getElementById("scan-video");
const scanCanvas = document.getElementById("scan-canvas");
const qrErrorEl = document.getElementById("qr-error");

const friendsListEl = document.getElementById("friends-list");
const friendsErrorEl = document.getElementById("friends-error");

let userData = null;
let unsubscribeRequests = null;
let unsubscribeFriends = null;
let scanStream = null;
let scanning = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (unsubscribeRequests) unsubscribeRequests();
    if (unsubscribeFriends) unsubscribeFriends();
    stopScan();
    window.location.href = "signin.html";
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    userData = snap.exists() ? snap.data() : { displayName: user.email, username: "", email: user.email, photoURL: null };
  } catch (err) {
    console.error(err);
    userData = { displayName: user.email, username: "", email: user.email, photoURL: null };
  }

  unsubscribeRequests = onSnapshot(
    collection(db, "users", user.uid, "friendRequests"),
    (snapshot) => renderRequests(snapshot.docs),
    (err) => {
      console.error(err);
      requestsErrorEl.textContent = "Couldn't load friend requests.";
    }
  );

  unsubscribeFriends = onSnapshot(
    collection(db, "users", user.uid, "friends"),
    (snapshot) => renderFriends(snapshot.docs),
    (err) => {
      console.error(err);
      friendsErrorEl.textContent = "Couldn't load friends.";
    }
  );

  loadingEl.hidden = true;
  friendsEl.hidden = false;
});

signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "signin.html";
});

// --- friend requests (username-search path) ---------------------------

function renderRequests(docs) {
  requestsListEl.innerHTML = "";
  if (docs.length === 0) {
    requestsListEl.innerHTML = `<li class="empty">No pending requests.</li>`;
    return;
  }
  for (const docSnap of docs) {
    const req = docSnap.data();
    const requesterUid = docSnap.id;
    const li = document.createElement("li");
    li.className = "project-item";

    const label = document.createElement("span");
    label.textContent = `${req.displayName} (@${req.username})`;
    li.appendChild(label);

    const actions = document.createElement("span");

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn btn--small";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", () => acceptRequest(requesterUid, req));
    actions.appendChild(acceptBtn);

    const declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "btn btn--secondary btn--small";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", () => declineRequest(requesterUid));
    actions.appendChild(declineBtn);

    li.appendChild(actions);
    requestsListEl.appendChild(li);
  }
}

async function acceptRequest(requesterUid, req) {
  requestsErrorEl.textContent = "";
  try {
    const me = auth.currentUser;
    const now = serverTimestamp();
    const batch = writeBatch(db);
    batch.set(doc(db, "users", me.uid, "friends", requesterUid), {
      uid: requesterUid,
      username: req.username,
      displayName: req.displayName,
      photoURL: req.photoURL ?? null,
      addedAt: now,
    });
    batch.set(doc(db, "users", requesterUid, "friends", me.uid), {
      uid: me.uid,
      username: userData.username,
      displayName: userData.displayName,
      photoURL: userData.photoURL ?? null,
      addedAt: now,
    });
    batch.delete(doc(db, "users", me.uid, "friendRequests", requesterUid));
    await batch.commit();
  } catch (err) {
    console.error(err);
    requestsErrorEl.textContent = "Couldn't accept request.";
  }
}

async function declineRequest(requesterUid) {
  requestsErrorEl.textContent = "";
  try {
    await deleteDoc(doc(db, "users", auth.currentUser.uid, "friendRequests", requesterUid));
  } catch (err) {
    console.error(err);
    requestsErrorEl.textContent = "Couldn't decline request.";
  }
}

// --- add by username search ---------------------------------------------

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  searchErrorEl.textContent = "";
  searchResultsEl.innerHTML = "";

  const prefix = searchInput.value.trim().toLowerCase();
  if (!prefix) return;

  try {
    const q = query(
      collection(db, "usernames"),
      orderBy(documentId()),
      startAt(prefix),
      endAt(prefix + ""),
      limit(10)
    );
    const snap = await getDocs(q);
    renderSearchResults(snap.docs.filter((d) => d.id !== userData.username));
  } catch (err) {
    console.error(err);
    searchErrorEl.textContent = "Search failed.";
  }
});

function renderSearchResults(docs) {
  searchResultsEl.innerHTML = "";
  if (docs.length === 0) {
    searchResultsEl.innerHTML = `<li class="empty">No matching usernames.</li>`;
    return;
  }
  for (const docSnap of docs) {
    const result = docSnap.data();
    const targetUid = result.uid;
    const targetUsername = docSnap.id;
    const li = document.createElement("li");
    li.className = "project-item";

    const label = document.createElement("span");
    label.textContent = `${result.displayName} (@${targetUsername})`;
    li.appendChild(label);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn--small";
    addBtn.textContent = "Add";
    addBtn.addEventListener("click", async () => {
      addBtn.disabled = true;
      try {
        await setDoc(doc(db, "users", targetUid, "friendRequests", auth.currentUser.uid), {
          username: userData.username,
          displayName: userData.displayName,
          photoURL: userData.photoURL ?? null,
          requestedAt: serverTimestamp(),
        });
        addBtn.textContent = "Requested";
      } catch (err) {
        console.error(err);
        addBtn.disabled = false;
        searchErrorEl.textContent = "Couldn't send friend request.";
      }
    });
    li.appendChild(addBtn);

    searchResultsEl.appendChild(li);
  }
}

// --- QR: show mine ---------------------------------------------------------

showQrBtn.addEventListener("click", () => {
  qrErrorEl.textContent = "";
  stopScan();
  const willShow = myQrWrap.hidden;
  myQrWrap.hidden = !willShow;
  if (willShow) {
    QRCode.toCanvas(myQrCanvas, userData.username, { width: 220 }, (err) => {
      if (err) {
        console.error(err);
        qrErrorEl.textContent = "Couldn't render QR code.";
      }
    });
  }
});

// --- QR: scan someone else's ------------------------------------------

scanQrBtn.addEventListener("click", startScan);
stopScanBtn.addEventListener("click", stopScan);

async function startScan() {
  qrErrorEl.textContent = "";
  myQrWrap.hidden = true;
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    scanVideo.srcObject = scanStream;
    await scanVideo.play();
    scanWrap.hidden = false;
    scanQrBtn.hidden = true;
    stopScanBtn.hidden = false;
    scanning = true;
    requestAnimationFrame(scanFrame);
  } catch (err) {
    console.error(err);
    qrErrorEl.textContent = "Couldn't access the camera.";
  }
}

function stopScan() {
  scanning = false;
  if (scanStream) {
    scanStream.getTracks().forEach((track) => track.stop());
    scanStream = null;
  }
  scanWrap.hidden = true;
  scanQrBtn.hidden = false;
  stopScanBtn.hidden = true;
}

function scanFrame() {
  if (!scanning) return;
  if (scanVideo.readyState === scanVideo.HAVE_ENOUGH_DATA) {
    scanCanvas.width = scanVideo.videoWidth;
    scanCanvas.height = scanVideo.videoHeight;
    const ctx = scanCanvas.getContext("2d");
    ctx.drawImage(scanVideo, 0, 0, scanCanvas.width, scanCanvas.height);
    const imageData = ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);
    if (result && result.data) {
      const scannedUsername = result.data.trim().toLowerCase();
      stopScan();
      handleScannedUsername(scannedUsername);
      return;
    }
  }
  requestAnimationFrame(scanFrame);
}

async function handleScannedUsername(scannedUsername) {
  qrErrorEl.textContent = "";

  if (scannedUsername === userData.username) {
    qrErrorEl.textContent = "That's your own QR code.";
    return;
  }

  try {
    const targetSnap = await getDoc(doc(db, "usernames", scannedUsername));
    if (!targetSnap.exists()) {
      qrErrorEl.textContent = "That QR code doesn't match a known user.";
      return;
    }
    const target = targetSnap.data();
    const me = auth.currentUser;
    const now = serverTimestamp();
    const batch = writeBatch(db);
    batch.set(doc(db, "users", me.uid, "friends", target.uid), {
      uid: target.uid,
      username: scannedUsername,
      displayName: target.displayName,
      photoURL: target.photoURL ?? null,
      addedAt: now,
    });
    batch.set(doc(db, "users", target.uid, "friends", me.uid), {
      uid: me.uid,
      username: userData.username,
      displayName: userData.displayName,
      photoURL: userData.photoURL ?? null,
      addedAt: now,
    });
    await batch.commit();
  } catch (err) {
    console.error(err);
    qrErrorEl.textContent = "Couldn't add friend from QR code.";
  }
}

// --- friends list: unfriend / block / report ----------------------------

function renderFriends(docs) {
  friendsListEl.innerHTML = "";
  if (docs.length === 0) {
    friendsListEl.innerHTML = `<li class="empty">No friends yet &mdash; add one above.</li>`;
    return;
  }
  for (const docSnap of docs) {
    const friend = docSnap.data();
    const friendUid = docSnap.id;
    const li = document.createElement("li");
    li.className = "project-item";

    const label = document.createElement("span");
    label.textContent = `${friend.displayName} (@${friend.username})`;
    li.appendChild(label);

    const actions = document.createElement("span");

    const unfriendBtn = document.createElement("button");
    unfriendBtn.type = "button";
    unfriendBtn.className = "btn btn--secondary btn--small";
    unfriendBtn.textContent = "Unfriend";
    unfriendBtn.addEventListener("click", () => unfriend(friendUid, friend.displayName));
    actions.appendChild(unfriendBtn);

    const blockBtn = document.createElement("button");
    blockBtn.type = "button";
    blockBtn.className = "btn btn--danger btn--small";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", () => blockUser(friendUid, friend.displayName));
    actions.appendChild(blockBtn);

    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.className = "btn btn--secondary btn--small";
    reportBtn.textContent = "Report";
    reportBtn.addEventListener("click", () => reportUser(friendUid));
    actions.appendChild(reportBtn);

    li.appendChild(actions);
    friendsListEl.appendChild(li);
  }
}

async function unfriend(friendUid, name) {
  friendsErrorEl.textContent = "";
  if (!window.confirm(`Remove ${name} from your friends?`)) return;
  try {
    const me = auth.currentUser;
    const batch = writeBatch(db);
    batch.delete(doc(db, "users", me.uid, "friends", friendUid));
    batch.delete(doc(db, "users", friendUid, "friends", me.uid));
    await batch.commit();
  } catch (err) {
    console.error(err);
    friendsErrorEl.textContent = "Couldn't remove friend.";
  }
}

async function blockUser(friendUid, name) {
  friendsErrorEl.textContent = "";
  if (!window.confirm(`Block ${name}? They won't be able to add you again.`)) return;
  try {
    const me = auth.currentUser;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", me.uid, "blocked", friendUid), { blockedAt: serverTimestamp() });
    batch.delete(doc(db, "users", me.uid, "friends", friendUid));
    batch.delete(doc(db, "users", friendUid, "friends", me.uid));
    batch.delete(doc(db, "users", me.uid, "friendRequests", friendUid));
    batch.delete(doc(db, "users", friendUid, "friendRequests", me.uid));
    await batch.commit();
  } catch (err) {
    console.error(err);
    friendsErrorEl.textContent = "Couldn't block user.";
  }
}

async function reportUser(uid) {
  friendsErrorEl.textContent = "";
  const reason = window.prompt("Reason for reporting (optional):") || "";
  try {
    await addDoc(collection(db, "reports"), {
      reporterUid: auth.currentUser.uid,
      reportedUid: uid,
      reason,
      createdAt: serverTimestamp(),
    });
    window.alert("Report submitted.");
  } catch (err) {
    console.error(err);
    friendsErrorEl.textContent = "Couldn't submit report.";
  }
}
