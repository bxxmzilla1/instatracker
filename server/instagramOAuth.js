const GRAPH_API_VERSION = 'v23.0';

export const INSTAGRAM_OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
].join(',');

function getClientId() {
  return process.env.INSTAGRAM_APP_ID || process.env.VITE_INSTAGRAM_APP_ID || '';
}

function getClientSecret() {
  return process.env.INSTAGRAM_APP_SECRET || '';
}

export function getDefaultRedirectUri() {
  return process.env.INSTAGRAM_OAUTH_REDIRECT_URI || 'https://www.drbossing.com/';
}

export function isInstagramOAuthConfigured() {
  return Boolean(getClientId() && getClientSecret());
}

function cleanAuthorizationCode(code) {
  return String(code || '')
    .trim()
    .replace(/#_$/, '');
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data.error_message ||
      data.error?.message ||
      data.error?.error_user_msg ||
      `Instagram OAuth failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

/** Exchange an authorization code for a long-lived Instagram Graph access token. */
export async function exchangeAuthorizationCode(code, redirectUri) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error('Instagram OAuth is not configured on the server (missing app secret).');
  }

  const normalizedRedirect = redirectUri || getDefaultRedirectUri();
  const form = new URLSearchParams();
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
  form.set('grant_type', 'authorization_code');
  form.set('redirect_uri', normalizedRedirect);
  form.set('code', cleanAuthorizationCode(code));

  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const shortData = await readJsonResponse(shortRes);
  const shortToken = shortData.access_token;
  const userId = String(shortData.user_id ?? '');
  if (!shortToken || !userId) {
    throw new Error('Instagram did not return an access token.');
  }

  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', clientSecret);
  longUrl.searchParams.set('access_token', shortToken);

  const longRes = await fetch(longUrl.toString());
  const longData = await readJsonResponse(longRes);
  const accessToken = longData.access_token;
  if (!accessToken) {
    throw new Error('Instagram did not return a long-lived access token.');
  }

  const meUrl = new URL(`https://graph.instagram.com/${GRAPH_API_VERSION}/me`);
  meUrl.searchParams.set('fields', 'user_id,username');
  meUrl.searchParams.set('access_token', accessToken);

  const meRes = await fetch(meUrl.toString());
  const me = await readJsonResponse(meRes);

  return {
    userId: String(me.user_id ?? userId),
    username: me.username ?? undefined,
    accessToken,
    expiresIn: longData.expires_in ?? undefined,
  };
}
