import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

export function getServiceAccountCredentials(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountRaw) {
    try {
      const parsed = typeof serviceAccountRaw === 'string' ? JSON.parse(serviceAccountRaw) : serviceAccountRaw;
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch (err: any) {
      console.error('❌ Erro ao analisar FIREBASE_SERVICE_ACCOUNT_KEY:', err?.message || err);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;

  if (
    projectId &&
    clientEmail &&
    rawKey &&
    !projectId.includes('MY_') &&
    !clientEmail.includes('MY_')
  ) {
    return {
      projectId,
      clientEmail,
      privateKey: rawKey.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

export function hasFullServiceAccountCredentials(): boolean {
  return getServiceAccountCredentials() !== null;
}

export const isFirebaseAdminConfigured = (): boolean => {
  return hasFullServiceAccountCredentials() || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
};

const DEFAULT_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  'frocia-e07a5';

let app: App;

if (!getApps().length) {
  const creds = getServiceAccountCredentials();

  if (creds) {
    try {
      app = initializeApp({
        credential: cert(creds),
      });
      console.log(`✅ Firebase Admin SDK inicializado com credenciais para o projeto: ${creds.projectId}`);
    } catch (error: any) {
      console.error('❌ Erro ao inicializar Firebase Admin SDK com credenciais:', error?.message || error);
      app = initializeApp({ projectId: creds.projectId || DEFAULT_PROJECT_ID });
    }
  } else {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`⚠️ Credenciais completas do Firebase Admin não foram fornecidas. Inicializando modo fallback para o projeto: ${DEFAULT_PROJECT_ID}`);
    }
    app = initializeApp({ projectId: DEFAULT_PROJECT_ID });
  }
} else {
  app = getApps()[0];
}

export const adminAuth: Auth = getAuth(app);

export const adminDb: Firestore = getFirestore(app);

export default app;

