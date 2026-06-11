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
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': process.env.RAPIDAPI_KEY.trim(),
    },
  });

  const data = await response.json().catch(() => ({}));
  const apiError = extractApiError(data);

  if (!response.ok) {
    throw new Error(apiError || `API request failed (${response.status})`);
  }

  if (apiError) {
    throw new Error(apiError);
  }

  if (data.success === false) {
    throw new Error(apiError || 'Instagram API request failed');
  }

  return data;
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
