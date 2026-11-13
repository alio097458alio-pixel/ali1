// public/js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBB_yZ_q7UAbM1-uaE-XoAy3g-tuyr14wo",
  authDomain: "ali1-2ac52.firebaseapp.com",
  databaseURL: "https://ali1-2ac52-default-rtdb.firebaseio.com",
  projectId: "ali1-2ac52",
  storageBucket: "ali1-2ac52.appspot.com",
  messagingSenderId: "868134603145",
  appId: "1:868134603145:web:REPLACE_WITH_YOUR_WEB_APP_ID"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
