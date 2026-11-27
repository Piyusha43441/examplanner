import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import { InstitutionProfile, UserProfile } from '../core/types';
import { auth, isFirebaseConfigured, testFirebaseConnection } from '../firebase/config';
import { fetchUserAndInstitution } from '../firebase/service';

interface AuthContextValue {
  authUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  institution: InstitutionProfile | null;
  authReady: boolean;
  loadingProfile: boolean;
  dbReachable: boolean;
  configError: string | null;
  isPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  authUser: null,
  userProfile: null,
  institution: null,
  authReady: false,
  loadingProfile: false,
  dbReachable: true,
  configError: null,
  isPasswordRecovery: false,
  clearPasswordRecovery: () => {},
  refreshProfile: async () => {}
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [institution, setInstitution] = useState<InstitutionProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [dbReachable, setDbReachable] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  const loadProfile = useCallback(async (user: FirebaseUser) => {
    setLoadingProfile(true);
    try {
      const { user: profile, institution: inst } = await fetchUserAndInstitution(user);
      setUserProfile(profile);
      setInstitution(inst);
    } catch (err) {
      console.error('Failed loading user profile:', err);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    testFirebaseConnection().then((res) => {
      if (!active) return;
      setDbReachable(res.reachable);
      if (!res.reachable && res.error) {
        setConfigError(res.error);
      }
    });

    if (!isFirebaseConfigured) {
      setAuthReady(true);
      setConfigError('Firebase configuration is incomplete. Set VITE_FIREBASE_* variables.');
      return () => {
        active = false;
      };
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setAuthUser(user);
      if (user) {
        await loadProfile(user);
      } else {
        setUserProfile(null);
        setInstitution(null);
      }
      setAuthReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadProfile]);

  const clearPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (authUser) {
      await loadProfile(authUser);
    }
  }, [authUser, loadProfile]);

  return (
    <AuthContext.Provider
      value={{
        authUser,
        userProfile,
        institution,
        authReady,
        loadingProfile,
        dbReachable,
        configError,
        isPasswordRecovery,
        clearPasswordRecovery,
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
