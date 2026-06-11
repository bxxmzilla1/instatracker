export const RAPIDAPI_HOST = 'instagram120.p.rapidapi.com';

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

  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText;
    throw new Error(message || `API request failed (${response.status})`);
  }

  return data;
}

export function normalizeUsername(username) {
  return username.trim().replace(/^@/, '');
}
