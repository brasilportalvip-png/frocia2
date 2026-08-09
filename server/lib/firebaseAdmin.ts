import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

export const isFirebaseAdminConfigured = (): boolean => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  return Boolean(
    projectId &&
    clientEmail &&
    privateKey &&
    !projectId.includes('MY_') &&
    !clientEmail.includes('MY_')
  );
};

let app: App;

if (!getApps().length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY;

  if (isFirebaseAdminConfigured() && rawKey) {
    const privateKey = rawKey.replace(/\\n/g, '\n');
    try {
      app = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      console.log(`✅ Firebase Admin SDK inicializado para o projeto: ${projectId}`);
    } catch (error: any) {
      console.error('❌ Erro ao inicializar Firebase Admin SDK com credenciais:', error?.message || error);
      app = initializeApp({ projectId: projectId || 'froc-ia-dev' });
    }
  } else {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('⚠️ Credenciais completas do Firebase Admin não foram fornecidas. Inicializando modo fallback de projeto.');
    }
    app = initializeApp({ projectId: projectId || 'froc-ia-dev' });
  }
} else {
  app = getApps()[0];
}

export const adminAuth: Auth = getAuth(app);

// Os testes devem simular somente os serviços externos utilizados.
// O runtime sempre utiliza o cliente oficial do Firestore.
export const adminDb: Firestore = getFirestore(app);

export default app;
