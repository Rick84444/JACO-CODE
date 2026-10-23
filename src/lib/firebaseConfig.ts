export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
}

// Firebase settings are the operator's configuration, not source: set them as VITE_FIREBASE_* variables
// (for example in a local .env that is not committed). Without them the Google Keep sign-in is not available.
const env = ((import.meta as any).env || {}) as Record<string, string | undefined>;
const value = (name: string) => String(env[name] || '');

export const firebaseConfig: FirebaseAppletConfig = {
  projectId: value('VITE_FIREBASE_PROJECT_ID'),
  appId: value('VITE_FIREBASE_APP_ID'),
  apiKey: value('VITE_FIREBASE_API_KEY'),
  authDomain: value('VITE_FIREBASE_AUTH_DOMAIN'),
  storageBucket: value('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: value('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  measurementId: value('VITE_FIREBASE_MEASUREMENT_ID'),
  oAuthClientId: value('VITE_FIREBASE_OAUTH_CLIENT_ID'),
  recaptchaSiteKey: value('VITE_FIREBASE_RECAPTCHA_SITE_KEY'),
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

export default firebaseConfig;
