import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CrashGuard} from './components/CrashGuard.tsx';
import './index.css';
import {reloadForNewBuild} from './lib/staleBuild.ts';

// Installing Remote from the phone must open the chat-led view, while the
// desktop IDE retains its own PWA entry. Both use the same origin and runtime.
if (new URLSearchParams(window.location.search).get('remote') === '1') {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/remote.webmanifest');
}

// Vite raises this when a lazy file of an older build is gone.
window.addEventListener('vite:preloadError',event=>{if(reloadForNewBuild())event.preventDefault();});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGuard>
      <App />
    </CrashGuard>
  </StrictMode>,
);
