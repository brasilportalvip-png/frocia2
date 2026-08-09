import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyA8O_D-hrsqGkKbRwYzanxjBRHcQbwgvXg',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'frocia-e07a5.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'frocia-e07a5',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'frocia-e07a5.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '127221403489',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:127221403489:web:008708c3ab1187422abf20',
};

export const isFirebaseClientConfigured = (): boolean => {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
};

let app: FirebaseApp;

if (!getApps().length) {
  if (!isFirebaseClientConfigured()) {
    console.warn(
      '⚠️ Firebase Client SDK não configurado no Frontend. Configure as variáveis VITE_FIREBASE_* nas configurações do ambiente.'
    );
  }
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const storage: FirebaseStorage = getStorage(app);

export const getIdToken = async (): Promise<string | null> => {
  if (!auth.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch (err) {
    console.error('Erro ao obter token de ID do Firebase:', err);
    return null;
  }
};
