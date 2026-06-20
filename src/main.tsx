import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { completeInstagramOAuthPopupIfNeeded } from './lib/instagramOAuth';

// The canonical production domain. Vercel preview URLs (instatracker-<hash>-…
// .vercel.app) are immutable snapshots pinned to one old commit AND sit behind
// Deployment Protection (the 401 on manifest.webmanifest). Employees who land
// on one run stale code and never receive updates — so always bounce them to
// the live domain that tracks the latest deployment.
const CANONICAL_HOST = 'drbossing.com';

function redirectToCanonicalHost(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, pathname, search, hash } = window.location;
  if (!hostname.endsWith('.vercel.app')) return false;
  window.location.replace(`https://${CANONICAL_HOST}${pathname}${search}${hash}`);
  return true;
}

// When this page is loaded inside the Instagram OAuth popup, forward the auth
// code back to the opener and close — never mount the full app in the popup.
if (completeInstagramOAuthPopupIfNeeded()) {
  document.body.innerHTML =
    '<p style="font-family:system-ui,sans-serif;color:#aaa;padding:24px;text-align:center">Instagram connected. You can close this window.</p>';
} else if (!redirectToCanonicalHost()) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
