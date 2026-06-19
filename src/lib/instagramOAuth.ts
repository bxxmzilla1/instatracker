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
  // Full-page redirect: ensure no stale popup flag makes the return trip look
  // like a popup callback (which would close the main window).
  try {
    localStorage.removeItem('instagram_oauth_popup');
    localStorage.removeItem('instagram_oauth_result');
  } catch {
    // ignore
  }
  window.location.assign(buildInstagramAuthorizeUrl(accountUsername));
}

const INSTAGRAM_OAUTH_MESSAGE = 'instagram-oauth-result';
const OAUTH_POPUP_FLAG_KEY = 'instagram_oauth_popup';
const OAUTH_RESULT_KEY = 'instagram_oauth_result';
const OAUTH_CHANNEL = 'instagram_oauth';
const OAUTH_POPUP_TIMEOUT_MS = 3 * 60 * 1000;

interface InstagramOAuthResultPayload {
  type: typeof INSTAGRAM_OAUTH_MESSAGE;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
  ts: number;
}

function safeBroadcastChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(OAUTH_CHANNEL) : null;
  } catch {
    return null;
  }
}

function clearOAuthPopupArtifacts(): void {
  try {
    localStorage.removeItem(OAUTH_RESULT_KEY);
    localStorage.removeItem(OAUTH_POPUP_FLAG_KEY);
  } catch {
    // ignore
  }
}

/** Opens the Instagram login in a centered native popup window. */
export function openInstagramOAuthPopup(accountUsername: string): Window | null {
  const url = buildInstagramAuthorizeUrl(accountUsername);
  clearOAuthPopupArtifacts();
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
  const popup = window.open(url, 'instagram_oauth', features);
  if (popup) {
    // Marks this origin as expecting an OAuth popup. Set only after the popup
    // actually opens so the full-page redirect fallback isn't mistaken for one.
    try {
      localStorage.setItem(
        OAUTH_POPUP_FLAG_KEY,
        JSON.stringify({ account: accountUsername, ts: Date.now() }),
      );
    } catch {
      // ignore
    }
  }
  return popup;
}

/**
 * Runs inside the OAuth popup after Instagram redirects back. If this page is the
 * OAuth callback (carries `code`/`error` and was opened as our popup), it stores
 * the result via channels that survive COOP (localStorage + BroadcastChannel,
 * plus postMessage when the opener link is intact) and closes itself. Returns
 * true when handled so the main app never renders inside the popup.
 */
export function completeInstagramOAuthPopupIfNeeded(): boolean {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return false;

  const opener = window.opener as Window | null;
  const hasOpener = Boolean(opener && opener !== window);
  let hasPopupFlag = false;
  try {
    hasPopupFlag = Boolean(localStorage.getItem(OAUTH_POPUP_FLAG_KEY));
  } catch {
    hasPopupFlag = false;
  }
  // Only treat this as the popup callback when we have evidence it was opened as
  // one. Otherwise it's the full-page redirect fallback, handled by the app.
  if (!hasOpener && !hasPopupFlag) return false;

  const payload: InstagramOAuthResultPayload = {
    type: INSTAGRAM_OAUTH_MESSAGE,
    code: code ?? undefined,
    state: params.get('state') ?? undefined,
    error: error ?? undefined,
    errorDescription:
      params.get('error_description') ?? params.get('error_reason') ?? undefined,
    ts: Date.now(),
  };

  // localStorage is the reliable, COOP-proof channel: it persists even after the
  // popup closes, and fires a `storage` event in the opener window.
  try {
    localStorage.setItem(OAUTH_RESULT_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }

  const channel = safeBroadcastChannel();
  if (channel) {
    try {
      channel.postMessage(payload);
    } catch {
      // ignore
    }
    try {
      channel.close();
    } catch {
      // ignore
    }
  }

  if (hasOpener) {
    try {
      opener!.postMessage(payload, window.location.origin);
    } catch {
      // ignore — opener link severed by COOP
    }
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
  popup: Window | null,
): Promise<{ code: string; state: string | null }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let closedSince = 0;
    const startedAt = Date.now();
    const channel = safeBroadcastChannel();

    const cleanup = () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
      if (channel) {
        try {
          channel.close();
        } catch {
          // ignore
        }
      }
      clearInterval(poll);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      clearOAuthPopupArtifacts();
      try {
        if (popup && !popup.closed) popup.close();
      } catch {
        // ignore
      }
      fn();
    };

    const consume = (raw: unknown) => {
      if (settled || raw == null) return;
      let data: InstagramOAuthResultPayload | null = null;
      try {
        data = typeof raw === 'string' ? JSON.parse(raw) : (raw as InstagramOAuthResultPayload);
      } catch {
        return;
      }
      if (!data || data.type !== INSTAGRAM_OAUTH_MESSAGE) return;
      if (data.error) {
        settle(() =>
          reject(new Error(data!.errorDescription || data!.error || 'Instagram login was cancelled.')),
        );
      } else if (data.code) {
        settle(() => resolve({ code: data!.code as string, state: data!.state ?? null }));
      } else {
        settle(() => reject(new Error('Instagram did not return an authorization code.')));
      }
    };

    const readStored = (): string | null => {
      try {
        return localStorage.getItem(OAUTH_RESULT_KEY);
      } catch {
        return null;
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === OAUTH_RESULT_KEY && event.newValue) consume(event.newValue);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      consume(event.data);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('message', onMessage);
    if (channel) channel.onmessage = (event) => consume(event.data);

    const poll = window.setInterval(() => {
      const stored = readStored();
      if (stored) {
        consume(stored);
        return;
      }

      let closed = false;
      try {
        closed = Boolean(popup && popup.closed);
      } catch {
        closed = false;
      }
      if (closed) {
        if (!closedSince) {
          closedSince = Date.now();
        } else if (Date.now() - closedSince > 1500) {
          // Give the stored result one last chance before giving up.
          const last = readStored();
          if (last) {
            consume(last);
            return;
          }
          settle(() =>
            reject(new Error('Instagram login window was closed before completing.')),
          );
        }
      } else {
        closedSince = 0;
      }

      if (Date.now() - startedAt > OAUTH_POPUP_TIMEOUT_MS) {
        settle(() => reject(new Error('Instagram login timed out. Please try again.')));
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
