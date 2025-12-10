import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCE2HgQa4LGYpQnz18f0ecOut0HUmIBclA",
  authDomain: "gen-lang-client-0901687565.firebaseapp.com",
  projectId: "gen-lang-client-0901687565",
  storageBucket: "gen-lang-client-0901687565.firebasestorage.app",
  messagingSenderId: "341073070252",
  appId: "1:341073070252:web:f1f6a15fefceb0272a7709"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);