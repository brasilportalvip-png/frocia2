import React, {
  createContext,
  useContext,
  useEffect,
  useState
} from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  auth,
  isFirebaseClientConfigured
} from '../lib/firebase';
import { apiClient } from '../services/apiClient';
import { UserProfile } from '../types';

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  user: UserProfile | null;
  loading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  profileError: string | null;
  register: (
    name: string,
    email: string,
    pass: string
  ) => Promise<void>;
  login: (
    email: string,
    pass: string
  ) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  updateUserProfile: (displayName: string, avatarUrl: string) => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

interface ProfileResponse {
  profile: UserProfile;
}

const AuthContext =
  createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] =
    useState<FirebaseUser | null>(null);
  const [profile, setProfile] =
    useState<UserProfile | null>(null);
  const [loading, setLoading] =
    useState<boolean>(true);
  const [profileError, setProfileError] =
    useState<string | null>(null);

  const createOrLoadProfile = async (
    fbUser: FirebaseUser
  ): Promise<UserProfile> => {
    let cleanAvatar = fbUser.photoURL || '';
    if (cleanAvatar && !cleanAvatar.startsWith('https://')) {
      cleanAvatar = '';
    }

    try {
      const response = await apiClient<ProfileResponse>(
        '/api/users/profile',
        {
          method: 'POST',
          body: JSON.stringify({
            displayName:
              fbUser.displayName?.trim() ||
              fbUser.email?.split('@')[0] ||
              'Usuário',
            avatarUrl: cleanAvatar
          })
        }
      );

      if (response?.profile) {
        return response.profile;
      }
    } catch (err) {
      // Retry via GET /api/users/me if POST endpoint fails
    }

    const fallbackRes = await apiClient<ProfileResponse>('/api/users/me');
    if (fallbackRes?.profile) {
      return fallbackRes.profile;
    }

    throw new Error(
      'O servidor não retornou o perfil do usuário.'
    );
  };

  useEffect(() => {
    if (!isFirebaseClientConfigured()) {
      setFirebaseUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (fbUser) => {
        if (cancelled) return;

        setLoading(true);
        setFirebaseUser(fbUser);
        setProfileError(null);

        try {
          if (!fbUser) {
            setProfile(null);
            return;
          }

          const syncedProfile =
            await createOrLoadProfile(fbUser);

          if (!cancelled) {
            setProfile(syncedProfile);
          }
        } catch (error: any) {
          console.warn(
            'Não foi possível sincronizar o perfil com o servidor:',
            error?.message || error
          );

          if (!cancelled) {
            setProfile(null);
            setProfileError('Não foi possível carregar seu perfil e saldo do servidor. Verifique sua conexão e tente novamente.');
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const refreshProfile = async () => {
    if (!auth.currentUser) {
      setProfile(null);
      return;
    }

    setProfileError(null);
    try {
      const response = await apiClient<ProfileResponse>(
        '/api/users/me'
      );

      if (!response?.profile) {
        throw new Error(
          'O servidor não retornou o perfil atualizado.'
        );
      }

      setProfile(response.profile);
    } catch (err: any) {
      setProfileError('Serviço temporariamente indisponível');
    }
  };

  const sendVerificationEmail = async (): Promise<void> => {
    if (!auth.currentUser) {
      throw new Error('Nenhum usuário autenticado.');
    }
    await sendEmailVerification(auth.currentUser);
  };

  const updateUserProfile = async (displayName: string, avatarUrl: string): Promise<void> => {
    if (!auth.currentUser) {
      throw new Error('Nenhum usuário autenticado.');
    }

    await updateProfile(auth.currentUser, {
      displayName,
      photoURL: avatarUrl || undefined,
    });

    const response = await apiClient<ProfileResponse>('/api/users/profile', {
      method: 'POST',
      body: JSON.stringify({ displayName, avatarUrl })
    });

    if (response?.profile) {
      setProfile(response.profile);
    }
  };

  const getIdToken =
    async (): Promise<string | null> => {
      if (!auth.currentUser) return null;

      return auth.currentUser.getIdToken(true);
    };

  const register = async (
    name: string,
    emailStr: string,
    passStr: string
  ) => {
    const normalizedName = name.trim();
    const normalizedEmail =
      emailStr.trim().toLowerCase();

    if (!normalizedName) {
      throw new Error('Informe seu nome.');
    }

    if (!normalizedEmail) {
      throw new Error('Informe seu e-mail.');
    }

    setLoading(true);

    try {
      const credentials =
        await createUserWithEmailAndPassword(
          auth,
          normalizedEmail,
          passStr
        );

      await updateProfile(credentials.user, {
        displayName: normalizedName
      });

      const syncedProfile =
        await createOrLoadProfile(credentials.user);

      setFirebaseUser(credentials.user);
      setProfile(syncedProfile);
    } catch (error: unknown) {
      throw new Error(mapFirebaseError(error));
    } finally {
      setLoading(false);
    }
  };

  const login = async (
    emailStr: string,
    passStr: string
  ) => {
    const normalizedEmail =
      emailStr.trim().toLowerCase();

    setLoading(true);

    try {
      const credentials =
        await signInWithEmailAndPassword(
          auth,
          normalizedEmail,
          passStr
        );

      const syncedProfile =
        await createOrLoadProfile(credentials.user);

      setFirebaseUser(credentials.user);
      setProfile(syncedProfile);
    } catch (error: unknown) {
      setProfile(null);
      throw new Error(mapFirebaseError(error));
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();

      provider.setCustomParameters({
        prompt: 'select_account'
      });

      const credentials =
        await signInWithPopup(auth, provider);

      const syncedProfile =
        await createOrLoadProfile(credentials.user);

      setFirebaseUser(credentials.user);
      setProfile(syncedProfile);
    } catch (error: unknown) {
      setProfile(null);
      throw new Error(mapFirebaseError(error));
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);

    try {
      await signOut(auth);
      setProfile(null);
      setFirebaseUser(null);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (
    emailStr: string
  ) => {
    const normalizedEmail =
      emailStr.trim().toLowerCase();

    if (!normalizedEmail) {
      throw new Error('Informe seu e-mail.');
    }

    try {
      await sendPasswordResetEmail(
        auth,
        normalizedEmail
      );
    } catch (error: unknown) {
      throw new Error(mapFirebaseError(error));
    }
  };

  const isAuthenticated = Boolean(
    firebaseUser && profile
  );
  const isAdmin =
    profile?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        user: profile,
        loading,
        isAuthenticated,
        isAdmin,
        profileError,
        register,
        login,
        loginWithGoogle,
        logout,
        resetPassword,
        refreshProfile,
        sendVerificationEmail,
        updateUserProfile,
        getIdToken
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      'useAuth deve ser usado dentro de um AuthProvider'
    );
  }

  return context;
};

function mapFirebaseError(
  error: unknown
): string {
  const firebaseError = error as {
    code?: string;
    message?: string;
  };

  switch (firebaseError?.code) {
    case 'auth/invalid-email':
      return 'Formato de e-mail inválido.';

    case 'auth/user-disabled':
      return 'Esta conta foi desativada.';

    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'E-mail ou senha incorretos.';

    case 'auth/email-already-in-use':
      return 'Este e-mail já está cadastrado.';

    case 'auth/weak-password':
      return 'A senha deve conter no mínimo 6 caracteres.';

    case 'auth/popup-closed-by-user':
      return 'O login com Google foi cancelado.';

    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela de login do Google.';

    case 'auth/network-request-failed':
      return 'Falha de conexão com o serviço de autenticação.';

    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

    default:
      return (
        firebaseError?.message ||
        'Ocorreu um erro na autenticação.'
      );
  }
}