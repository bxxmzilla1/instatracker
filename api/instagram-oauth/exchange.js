import { exchangeAuthorizationCode, getDefaultRedirectUri } from '../../server/instagramOAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, redirectUri } = req.body ?? {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Authorization code is required.' });
    }

    const result = await exchangeAuthorizationCode(
      code,
      typeof redirectUri === 'string' && redirectUri.trim() ? redirectUri.trim() : getDefaultRedirectUri(),
    );
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Instagram OAuth exchange failed';
    return res.status(502).json({ error: message });
  }
}
