export const INSTAGRAM_OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
].join(',');

const OAUTH_ACCOUNT_KEY = 'instagram_oauth_account';

export interface InstagramOAuthResult {
  userId: string;
  username?: string;
  accessToken: string;
  expiresIn?: number;
}

export function isInstagramOAuthConfigured(): boolean {
  return Boolean(import.meta.env.VITE_INSTAGRAM_APP_ID);
}

export function getInstagramOAuthRedirectUri(): string {
  const configured = import.meta.env.VITE_INSTAGRAM_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/`;
  }
  return 'https://www.drbossing.com/';
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
  const clientId = import.meta.env.VITE_INSTAGRAM_APP_ID;
  if (!clientId) {
    throw new Error('Instagram login is not configured (missing VITE_INSTAGRAM_APP_ID).');
  }

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
