// Firebase client SDK initialization — BROWSER-SIDE ONLY.
//
// This module is imported by client components (auth-provider, auth-view)
// when `NEXT_PUBLIC_AUTH_BACKEND === 'firebase'`. In local-dev mode
// (`NEXT_PUBLIC_AUTH_BACKEND === 'nextauth'`) this module is never imported,
// so the Firebase JS SDK is never bundled into the local-dev client.
//
// SECURITY:
//   - All values here come from `NEXT_PUBLIC_*` env vars and are SAFE to
//     expose to the browser. The Firebase web `apiKey` is a public identifier,
//     not a secret — it's designed to ship in client bundles. Real
//     authentication authority lives server-side: the client signs in via
//     Firebase, obtains an ID token, and POSTs it to /api/auth/firebase-login,
//     which verifies it via `firebase-admin` `verifyIdToken()` using
//     service-account credentials that NEVER touch the browser.
//   - Service-account JSON / private keys are server-only (Secret Manager /
//     ADC). They are never imported here, never in `NEXT_PUBLIC_*` vars, and
//     never in the client bundle.
//
// PUBLIC CONFIG (per https://firebase.google.com/docs/web/learn-setup):
//   NEXT_PUBLIC_FIREBASE_API_KEY
//   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN       (projectId.firebaseapp.com)
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID
//
// Optional (only if you enable Analytics — we don't):
//   NEXT_PUBLIC_FIREBASE_APP_ID
//   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
//
// This module is a single exported singleton — `firebaseAuthInstance`. The
// auth-provider wraps `onAuthStateChanged`, `signInWithEmailAndPassword`,
// `createUserWithEmailAndPassword`, and `signOut` around it.

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  type Auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

function resolveApp(): FirebaseApp {
  if (getApps().length) return getApp();
  return initializeApp(firebaseConfig);
}

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

/** Returns the lazily-initialized Firebase Auth singleton for the browser.
 *  Throws if the public config is missing — this is a deployment error, not
 *  a runtime condition the app can recover from. */
export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  if (!firebaseConfig.apiKey) {
    throw new Error(
      "[firebase/client] NEXT_PUBLIC_FIREBASE_API_KEY is not set. Configure the public Firebase web config to use Firebase client auth."
    );
  }
  _app = resolveApp();
  _auth = getAuth(_app);
  return _auth;
}

/** True when the public Firebase config looks configured (used by the
 *  auth-provider to decide whether to attempt Firebase init). */
export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId
  );
}

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  fbSignOut,
  type FirebaseUser,
};
