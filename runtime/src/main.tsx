import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CrashGuard} from './components/CrashGuard.tsx';
import './index.css';
import {reloadForNewBuild} from './lib/staleBuild.ts';

// Vite raises this when a lazy file of an older build is gone.
window.addEventListener('vite:preloadError',event=>{if(reloadForNewBuild())event.preventDefault();});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGuard>
      <App />
    </CrashGuard>
  </StrictMode>,
);
