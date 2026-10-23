import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { firebaseConfig, firebaseConfigured } from './firebaseConfig';
import { GoogleKeepUser, KeepNote } from '../types';

// Firebase starts on first use, and only when VITE_FIREBASE_* is configured; importing this module never throws.
let authInstance: ReturnType<typeof getAuth> | null = null;
const getKeepAuth = () => {
  if (!firebaseConfigured) throw new Error('FIREBASE_NOT_CONFIGURED: set VITE_FIREBASE_* to enable Google Keep sign-in');
  if (!authInstance) authInstance = getAuth(getApps().length > 0 ? getApp() : initializeApp(firebaseConfig));
  return authInstance;
};

const provider = new GoogleAuthProvider();

// Workspace scopes for Tasks & Drive File + Keep
provider.addScope('https://www.googleapis.com/auth/tasks');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initKeepAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  if (!firebaseConfigured) {
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }
  return onAuthStateChanged(getKeepAuth(), async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const signInWithGoogleKeep = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(getKeepAuth(), provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken || null;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Google Keep Auth error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getKeepAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const logoutGoogleKeep = async () => {
  if (authInstance) await signOut(authInstance);
  cachedAccessToken = null;
};

// Fetch Google Tasks / Keep sync notes if OAuth token is present
export const fetchGoogleTasksNotes = async (accessToken: string): Promise<Partial<KeepNote>[]> => {
  try {
    const response = await fetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!data.items) return [];

    const notesList: Partial<KeepNote>[] = [];
    for (const list of data.items.slice(0, 5)) {
      const tasksRes = await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (tasksRes.ok) {
        const tasksData = await tasksRes.json();
        const items = (tasksData.items || []).map((t: any) => ({
          id: t.id,
          text: t.title || 'Namnlös uppgift',
          checked: t.status === 'completed',
        }));

        notesList.push({
          id: list.id,
          title: list.title || 'Google Keep Checklista',
          listItems: items,
          color: 'yellow',
          isPinned: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          googleKeepId: list.id,
        });
      }
    }
    return notesList;
  } catch (err) {
    console.error('Error fetching Google Tasks/Keep data:', err);
    return [];
  }
};
