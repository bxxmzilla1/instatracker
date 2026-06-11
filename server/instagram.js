export const RAPIDAPI_HOST = 'instagram120.p.rapidapi.com';

export function normalizeUsername(username) {
  return username.trim().replace(/^@/, '');
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

export async function callInstagram(endpoint, body) {
  const apiKey = process.env.RAPIDAPI_KEY;

  if (!apiKey) {
    throw new Error('RAPIDAPI_KEY is not set. Add it to your environment variables.');
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
  const response = await fetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(normalized)}`,
    {
      headers: {
        'x-ig-app-id': '936619743392459',
        'x-requested-with': 'XMLHttpRequest',
        'user-agent': 'Mozilla/5.0',
      },
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`@${normalized} was not found. Check the username or account visibility.`);
    }
    throw new Error(extractApiError(data) || `Profile lookup failed (${response.status})`);
  }

  if (!data?.data?.user) {
    throw new Error(`@${normalized} was not found or the account is private.`);
  }

  return data;
}

export async function fetchInstagramProfile(username) {
  const body = { username: normalizeUsername(username) };
  const endpoints = ['/api/instagram/userInfo', '/api/instagram/profile'];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const data = await callInstagram(endpoint, body);
      if (hasProfilePayload(data)) return data;
      lastError = new Error('Profile response did not include user data');
    } catch (err) {
      lastError = err;
      const message = err.message?.toLowerCase() ?? '';
      const retryable =
        message.includes('download link') ||
        message.includes('not found') ||
        message.includes('no user') ||
        message.includes('failed');

      if (!retryable) throw err;
    }
  }

  try {
    return await fetchWebProfile(username);
  } catch (webError) {
    throw lastError ?? webError;
  }
}

export async function fetchInstagramReels(username, maxId) {
  const body = { username: normalizeUsername(username) };
  if (maxId) body.maxId = maxId;

  try {
    return await callInstagram('/api/instagram/reels', body);
  } catch (err) {
    const message = err.message?.toLowerCase() ?? '';
    if (message.includes('download link')) {
      throw new Error('Reels could not be loaded right now. Profile data may still be available — try refresh again later.');
    }
    throw err;
  }
}
