export const INSTAGRAM_OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
].join(',');

const OAUTH_ACCOUNT_KEY = 'instagram_oauth_account';

/** Dr. Bossing Meta app — used when VITE_INSTAGRAM_APP_ID is not set at build time. */
export const DEFAULT_INSTAGRAM_APP_ID = '2210054946503834';
export const DEFAULT_INSTAGRAM_OAUTH_REDIRECT_URI = 'https://www.drbossing.com/';

export interface InstagramOAuthResult {
  userId: string;
  username?: string;
  accessToken: string;
  expiresIn?: number;
}

export function getInstagramAppId(): string {
  return import.meta.env.VITE_INSTAGRAM_APP_ID?.trim() || DEFAULT_INSTAGRAM_APP_ID;
}

export function isInstagramOAuthConfigured(): boolean {
  return Boolean(getInstagramAppId());
}

export function getInstagramOAuthRedirectUri(): string {
  const configured = import.meta.env.VITE_INSTAGRAM_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host === 'drbossing.com' || host === 'www.drbossing.com') {
      return DEFAULT_INSTAGRAM_OAUTH_REDIRECT_URI;
    }
    return `${window.location.origin}/`;
  }
  return DEFAULT_INSTAGRAM_OAUTH_REDIRECT_URI;
}

export function buildInstagramOAuthState(accountUsername: string): string {
  const payload = {
    account: accountUsername.trim().replace(/^@/, '').toLowerCase(),
    nonce: crypto.randomUUID(),
  };
  return btoa(JSON.stringify(payload));
}

export function parseInstagramOAuthState(state: string | null): { account?: string } | null {
  if (!state) return null;
  try {
    const parsed = JSON.parse(atob(state)) as { account?: string };
    if (parsed?.account) {
      return { account: parsed.account.trim().replace(/^@/, '').toLowerCase() };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildInstagramAuthorizeUrl(accountUsername: string): string {
  const clientId = getInstagramAppId();
  const redirectUri = getInstagramOAuthRedirectUri();
  const state = buildInstagramOAuthState(accountUsername);
  sessionStorage.setItem(OAUTH_ACCOUNT_KEY, accountUsername.trim().replace(/^@/, '').toLowerCase());

  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('force_reauth', 'true');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', INSTAGRAM_OAUTH_SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

export function startInstagramOAuth(accountUsername: string): void {
  window.location.assign(buildInstagramAuthorizeUrl(accountUsername));
}

const INSTAGRAM_OAUTH_MESSAGE = 'instagram-oauth-result';

interface InstagramOAuthPopupMessage {
  type: typeof INSTAGRAM_OAUTH_MESSAGE;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

/** Opens the Instagram login in a centered native popup window. */
export function openInstagramOAuthPopup(accountUsername: string): Window | null {
  const url = buildInstagramAuthorizeUrl(accountUsername);
  const width = 600;
  const height = 760;
  const dualLeft = window.screenLeft ?? window.screenX ?? 0;
  const dualTop = window.screenTop ?? window.screenY ?? 0;
  const viewportW = window.innerWidth || document.documentElement.clientWidth || screen.width;
  const viewportH = window.innerHeight || document.documentElement.clientHeight || screen.height;
  const left = Math.max(0, dualLeft + (viewportW - width) / 2);
  const top = Math.max(0, dualTop + (viewportH - height) / 2);
  const features = [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'menubar=no',
    'toolbar=no',
    'location=yes',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');
  return window.open(url, 'instagram_oauth', features);
}

/**
 * Runs inside the OAuth popup after Instagram redirects back. If this window was
 * opened by our app and carries an auth `code`/`error`, it forwards the result
 * to the opener via postMessage and closes itself. Returns true when handled so
 * the main app doesn't render inside the popup.
 */
export function completeInstagramOAuthPopupIfNeeded(): boolean {
  if (typeof window === 'undefined') return false;
  const opener = window.opener as Window | null;
  if (!opener || opener === window) return false;

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return false;

  const message: InstagramOAuthPopupMessage = {
    type: INSTAGRAM_OAUTH_MESSAGE,
    code: code ?? undefined,
    state: params.get('state') ?? undefined,
    error: error ?? undefined,
    errorDescription:
      params.get('error_description') ?? params.get('error_reason') ?? undefined,
  };

  try {
    opener.postMessage(message, window.location.origin);
  } catch {
    // ignore — opener may be gone
  }

  try {
    window.close();
  } catch {
    // ignore — some browsers block programmatic close
  }
  return true;
}

/** Resolves with the auth code once the OAuth popup reports back. */
export function awaitInstagramOAuthPopupResult(
  popup: Window,
): Promise<{ code: string; state: string | null }> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
    };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (!popup.closed) popup.close();
      } catch {
        // ignore
      }
      fn();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as InstagramOAuthPopupMessage | undefined;
      if (!data || data.type !== INSTAGRAM_OAUTH_MESSAGE) return;
      if (data.error) {
        finish(() =>
          reject(new Error(data.errorDescription || data.error || 'Instagram login was cancelled.')),
        );
      } else if (data.code) {
        finish(() => resolve({ code: data.code as string, state: data.state ?? null }));
      } else {
        finish(() => reject(new Error('Instagram did not return an authorization code.')));
      }
    };

    window.addEventListener('message', onMessage);

    const closedTimer = window.setInterval(() => {
      if (popup.closed && !settled) {
        finish(() => reject(new Error('Instagram login window was closed before completing.')));
      }
    }, 500);
  });
}

export function readPendingInstagramOAuthAccount(): string | null {
  try {
    return sessionStorage.getItem(OAUTH_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function clearPendingInstagramOAuthAccount(): void {
  try {
    sessionStorage.removeItem(OAUTH_ACCOUNT_KEY);
  } catch {
    // ignore
  }
}

export function clearInstagramOAuthQueryParams(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_reason');
  url.searchParams.delete('error_description');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, '', next);
}

export async function exchangeInstagramOAuthCode(
  code: string,
  redirectUri = getInstagramOAuthRedirectUri(),
): Promise<InstagramOAuthResult> {
  const response = await fetch('/api/instagram-oauth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.accessToken || !data?.userId) {
    throw new Error(data?.error || 'Could not exchange Instagram authorization code.');
  }
  return {
    userId: String(data.userId),
    username: data.username,
    accessToken: String(data.accessToken),
    expiresIn: data.expiresIn,
  };
}
