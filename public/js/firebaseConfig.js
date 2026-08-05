// The Firebase client config below is NOT a secret — it's safe to ship in
// frontend code and commit to git. Access control is enforced server-side
// by Firestore Security Rules and Cloud Functions, not by hiding this
// object. See CLAUDE.md > Security Principles.
//
// Replace these placeholder values with the real config from:
// Firebase Console > Project settings > General > Your apps > SDK setup.
export const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID",
};
