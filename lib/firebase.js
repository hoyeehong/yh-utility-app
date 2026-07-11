import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAi_DHGoIQCVGTcgHL67ERVnR72AwRkBOw",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "tangential-discipline-wqmt3.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "tangential-discipline-wqmt3",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "tangential-discipline-wqmt3.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "136591640415",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:136591640415:web:adf66537033f38defc18ea"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// If NEXT_PUBLIC_FIREBASE_PROJECT_ID is provided by user, connect to default Firestore database. Otherwise fallback to sandbox custom ID.
const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? "(default)" : "ai-studio-yhutilityapp-7c081442-4912-4352-9ae5-a763f0940395");
const db = databaseId === "(default)" ? getFirestore(app) : getFirestore(app, databaseId);

export { app, auth, googleProvider, db, signInWithPopup, signOut };
