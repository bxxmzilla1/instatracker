import { fetchImage } from '../server/image.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.query ?? {};
    const { contentType, buffer } = await fetchImage(url);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.status(200).send(buffer);
  } catch (err) {
    res.status(err.statusCode || 502).json({ error: err.message });
  }
}
