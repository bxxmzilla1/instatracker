import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { completeInstagramOAuthPopupIfNeeded } from './lib/instagramOAuth';

// When this page is loaded inside the Instagram OAuth popup, forward the auth
// code back to the opener and close — never mount the full app in the popup.
if (completeInstagramOAuthPopupIfNeeded()) {
  document.body.innerHTML =
    '<p style="font-family:system-ui,sans-serif;color:#aaa;padding:24px;text-align:center">Instagram connected. You can close this window.</p>';
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
