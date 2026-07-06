import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAi_DHGoIQCVGTcgHL67ERVnR72AwRkBOw",
  authDomain: "tangential-discipline-wqmt3.firebaseapp.com",
  projectId: "tangential-discipline-wqmt3",
  storageBucket: "tangential-discipline-wqmt3.firebasestorage.app",
  messagingSenderId: "136591640415",
  appId: "1:136591640415:web:adf66537033f38defc18ea"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Initialize Firestore targeting the specific custom database ID correctly as the second parameter of getFirestore
const db = getFirestore(app, "ai-studio-yhutilityapp-7c081442-4912-4352-9ae5-a763f0940395");

export { app, auth, googleProvider, db, signInWithPopup, signOut };
