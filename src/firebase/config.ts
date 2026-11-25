import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { doc, Firestore, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

export const isFirebaseConfigured = Boolean(
  firebaseConfig &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'remixed-project-id' &&
    firebaseConfig.apiKey &&
    firebaseConfig.firestoreDatabaseId
);

export const firebaseProjectId = firebaseConfig.projectId;
export const firebaseStorageBucket = firebaseConfig.storageBucket || '';
export const isStorageConfigured = Boolean(isFirebaseConfigured && firebaseStorageBucket);

let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth: Auth = getAuth(app);
export const storage: FirebaseStorage = getStorage(app);
storage.maxUploadRetryTime = 180000;
storage.maxOperationRetryTime = 120000;

export async function testFirestoreConnection(): Promise<{ reachable: boolean; error?: string }> {
  if (!isFirebaseConfigured) {
    return { reachable: false, error: 'Firebase configuration is missing.' };
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { reachable: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('the client is offline')) {
        console.error('Please check your Firebase configuration.');
        return { reachable: false, error: 'Firestore client is offline. Check Firebase config.' };
      }
      // permission-denied on /test/connection means the Firestore server responded
      return { reachable: true };
    }
    return { reachable: true };
  }
}
