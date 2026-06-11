export const RAPIDAPI_HOST = 'instagram120.p.rapidapi.com';

const WEB_PROFILE_URLS = [
  'https://www.instagram.com/api/v1/users/web_profile_info/',
  'https://i.instagram.com/api/v1/users/web_profile_info/',
];

export function normalizeUsername(username) {
  return username.trim().replace(/^@/, '').toLowerCase();
}

function extractApiError(data) {
  if (!data || typeof data !== 'object') return null;

  const record = data;
  const message = [record.message, record.error, record.msg, record.detail]
    .find((value) => typeof value === 'string' && value.trim());

  if (message) return message;

  if (record.status === 'error' || record.success === false) {
    return typeof record.message === 'string' ? record.message : 'Instagram API returned an error';
  }

  return null;
}

function hasProfilePayload(data) {
  if (!data || typeof data !== 'object') return false;

  const root = data;
  const result = root.result ?? root.data ?? root.user ?? root;
  const user = result?.user ?? result;

  if (!user || typeof user !== 'object') return false;

  return Boolean(
    user.username ||
      user.full_name ||
      user.follower_count ||
      user.followers ||
      user.edge_followed_by?.count,
  );
}

function buildWebHeaders(username) {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'x-ig-app-id': '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    referer: `https://www.instagram.com/${username}/`,
    origin: 'https://www.instagram.com',
  };
}

export async function callInstagram(endpoint, body) {
  const apiKey = process.env.RAPIDAPI_KEY;

  if (!apiKey) {
    throw new Error('RAPIDAPI_KEY is not set. Add it in Vercel Environment Variables.');
  }

  const response = await fetch(`https://${RAPIDAPI_HOST}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  const apiError = extractApiError(data);

  if (!response.ok) {
    throw new Error(apiError || `API request failed (${response.status})`);
  }

  if (apiError) {
    throw new Error(apiError);
  }

  return data;
}

async function fetchWebProfile(username) {
  const normalized = normalizeUsername(username);
  let lastError = null;

  for (const baseUrl of WEB_PROFILE_URLS) {
    try {
      const response = await fetch(
        `${baseUrl}?username=${encodeURIComponent(normalized)}`,
        { headers: buildWebHeaders(normalized) },
      );

      const data = await response.json().catch(() => ({}));

      if (response.status === 404) {
        throw new Error(`@${normalized} was not found. Check the username.`);
      }

      if (!response.ok) {
        throw new Error(
          extractApiError(data) || `Instagram profile lookup failed (${response.status})`,
        );
      }

      if (data?.data?.user) {
        return data;
      }

      throw new Error(`@${normalized} was not found or the account is private.`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('Could not load profile from Instagram.');
}

async function fetchRapidApiProfile(username) {
  const normalized = normalizeUsername(username);
  const attempts = [
    { endpoint: '/api/instagram/userInfo', body: { username: normalized } },
    { endpoint: '/api/instagram/profile', body: { username: normalized } },
    {
      endpoint: '/api/instagram/profile',
      body: { url: `https://www.instagram.com/${normalized}/` },
    },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    try {
      const data = await callInstagram(attempt.endpoint, attempt.body);
      if (hasProfilePayload(data)) return data;
      lastError = new Error('Profile response did not include user data');
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('RapidAPI profile lookup failed.');
}

export async function fetchInstagramProfile(username) {
  const errors = [];

  try {
    return await fetchWebProfile(username);
  } catch (err) {
    errors.push(`Instagram: ${err.message}`);
  }

  if (process.env.RAPIDAPI_KEY) {
    try {
      return await fetchRapidApiProfile(username);
    } catch (err) {
      errors.push(`RapidAPI: ${err.message}`);
    }
  } else {
    errors.push('RapidAPI: RAPIDAPI_KEY is not configured');
  }

  throw new Error(
    errors.join(' | ') ||
      'Could not load profile. Verify the username is public and try again.',
  );
}

export async function fetchInstagramReels(username, maxId) {
  const body = { username: normalizeUsername(username) };
  if (maxId) body.maxId = maxId;

  try {
    return await callInstagram('/api/instagram/reels', body);
  } catch (err) {
    const message = err.message?.toLowerCase() ?? '';
    if (message.includes('download link')) {
      throw new Error(
        'Reels could not be loaded right now. Profile data may still be available — try refresh again later.',
      );
    }
    throw err;
  }
}
