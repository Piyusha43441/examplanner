import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { InstitutionProfile, UserProfile } from '../core/types';
import { auth, isFirebaseConfigured, testFirestoreConnection } from '../firebase/config';
import { fetchUserAndInstitution } from '../firebase/service';

interface AuthContextValue {
  firebaseUser: User | null;
  userProfile: UserProfile | null;
  institution: InstitutionProfile | null;
  authReady: boolean;
  loadingProfile: boolean;
  dbReachable: boolean;
  configError: string | null;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  userProfile: null,
  institution: null,
  authReady: false,
  loadingProfile: false,
  dbReachable: true,
  configError: null,
  refreshProfile: async () => {}
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [dbReachable, setDbReachable] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const loadProfile = useCallback(async (uid: string) => {
    setLoadingProfile(true);
    try {
      const { user, institution: inst } = await fetchUserAndInstitution(uid);
      setUserProfile(user);
      setInstitution(inst);
    } catch (err) {
      console.error('Failed loading user profile:', err);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    testFirestoreConnection().then((res) => {
      setDbReachable(res.reachable);
      if (!res.reachable && res.error) {
        setConfigError(res.error);
      }
    });

    if (!isFirebaseConfigured) {
      setAuthReady(true);
      setConfigError('Firebase configuration is incomplete.');
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await loadProfile(user.uid);
      } else {
        setUserProfile(null);
        setInstitution(null);
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (firebaseUser) {
      await loadProfile(firebaseUser.uid);
    }
  }, [firebaseUser, loadProfile]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        institution,
        authReady,
        loadingProfile,
        dbReachable,
        configError,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
