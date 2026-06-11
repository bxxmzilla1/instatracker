export const RAPIDAPI_HOST = 'instagram-api-followers-following-stories-info.p.rapidapi.com';

const INVALID_API_KEYS = new Set([
  '',
  'undefined',
  'null',
  'your_rapidapi_key_here',
  'your_actual_key',
]);

export function normalizeUsername(username) {
  return username.trim().replace(/^@/, '').toLowerCase();
}

export function hasValidApiKey() {
  const key = process.env.RAPIDAPI_KEY?.trim();
  if (!key) return false;
  return !INVALID_API_KEYS.has(key.toLowerCase());
}

function extractApiError(data) {
  if (!data || typeof data !== 'object') return null;

  const record = data;
  const message = [record.message, record.error, record.msg, record.detail]
    .find((value) => typeof value === 'string' && value.trim());

  if (message) return message;

  if (record.success === false) {
    return typeof record.message === 'string' ? record.message : 'Instagram API returned an error';
  }

  return null;
}

const MAX_ATTEMPTS = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimited(status, message) {
  if (status === 429 || status === 503) return true;
  const lower = (message || '').toLowerCase();
  return lower.includes('rate limit') || lower.includes('too many requests');
}

async function callInstagramGet(endpoint, params = {}) {
  if (!hasValidApiKey()) {
    throw new Error(
      'RAPIDAPI_KEY is missing or invalid. Add your real RapidAPI key in Vercel Environment Variables.',
    );
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  const url = `https://${RAPIDAPI_HOST}${endpoint}${query.size ? `?${query}` : ''}`;
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(700 * attempt);
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': RAPIDAPI_HOST,
        'x-rapidapi-key': process.env.RAPIDAPI_KEY.trim(),
      },
    });

    const data = await response.json().catch(() => ({}));
    const apiError = extractApiError(data);

    if (isRateLimited(response.status, apiError)) {
      lastError = new Error('Instagram API is rate-limited. Retrying…');
      continue;
    }

    if (!response.ok) {
      throw new Error(apiError || `API request failed (${response.status})`);
    }

    if (data.success === false) {
      lastError = new Error(apiError || 'Instagram API request failed');
      continue;
    }

    if (apiError && data.success !== true) {
      throw new Error(apiError);
    }

    return data;
  }

  throw lastError ?? new Error('Instagram API request failed after multiple attempts.');
}

export async function fetchInstagramProfile(username) {
  const normalized = normalizeUsername(username);
  const data = await callInstagramGet('/api/v1/user/profile', { username: normalized });

  if (!data?.data) {
    throw new Error(`@${normalized} was not found or the account is private.`);
  }

  return data;
}

export async function fetchInstagramReels(username, paginationToken) {
  const normalized = normalizeUsername(username);
  return callInstagramGet('/api/v1/user/reels', {
    username: normalized,
    pagination_token: paginationToken,
  });
}

export async function fetchInstagramStories(username) {
  const normalized = normalizeUsername(username);
  return callInstagramGet('/api/v1/user/stories', { username: normalized });
}
