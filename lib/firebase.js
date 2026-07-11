import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  // Web Client SDK keys
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,

  // Service Account JSON keys (`yh-utility-app-firebase-adminsdk-fbsvc-e49d793f17.json`)
  type: process.env.NEXT_PUBLIC_FIREBASE_TYPE || process.env.FIREBASE_TYPE,
  project_id: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.NEXT_PUBLIC_FIREBASE_PRIVATE_KEY_ID || process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.NEXT_PUBLIC_FIREBASE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY,
  client_email: process.env.NEXT_PUBLIC_FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.NEXT_PUBLIC_FIREBASE_CLIENT_ID || process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.NEXT_PUBLIC_FIREBASE_AUTH_URI || process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.NEXT_PUBLIC_FIREBASE_TOKEN_URI || process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.NEXT_PUBLIC_FIREBASE_AUTH_PROVIDER_X509_CERT_URL || process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.NEXT_PUBLIC_FIREBASE_CLIENT_X509_CERT_URL || process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.NEXT_PUBLIC_FIREBASE_UNIVERSE_DOMAIN || process.env.FIREBASE_UNIVERSE_DOMAIN
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let auth = null;
let googleProvider = null;
let db = null;

try {
  if (firebaseConfig.apiKey) {
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "(default)";
    db = databaseId === "(default)" ? getFirestore(app) : getFirestore(app, databaseId);
  }
} catch (e) {
  console.warn("Firebase SDK initialization skipped during static build due to unset env vars:", e.message);
}

export { app, auth, googleProvider, db, signInWithPopup, signOut };
