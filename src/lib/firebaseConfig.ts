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

export const firebaseConfig: FirebaseAppletConfig = {
  projectId: 'gen-lang-client-0940572256',
  appId: '1:689772220489:web:389f3a507cfe63cc34ef98',
  apiKey: 'AIzaSyCU-NV_8LsEvTR0wONUw2VEnJV40rZt3GI',
  authDomain: 'gen-lang-client-0940572256.firebaseapp.com',
  storageBucket: 'gen-lang-client-0940572256.firebasestorage.app',
  messagingSenderId: '689772220489',
  measurementId: '',
  oAuthClientId: '689772220489-u6pdgk8s3ttrnh4gm1e402oc62lc57hv.apps.googleusercontent.com',
  recaptchaSiteKey: '',
};

export default firebaseConfig;
