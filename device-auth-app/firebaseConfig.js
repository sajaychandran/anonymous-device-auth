import { initializeApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

/**
 * Replace with YOUR main project's web config
 * (Firebase Console > Project Settings > General > Your apps > Web app).
 * This is a public client identifier, not a secret — but it should point
 * to your own Firebase project, not a shared/example one.
 */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');

export const callFunction = (functionName) => {
  return httpsCallable(functions, functionName);
};

export default app;
