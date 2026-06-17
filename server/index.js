import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchInstagramProfile,
  fetchInstagramReels,
  fetchInstagramStories,
  hasValidApiKey,
} from './instagram.js';
import { fetchImage } from './image.js';
import { relayThroughProxy } from './bskyProxy.js';
import { pushProfileImageToBsky } from './bskyProfilePush.js';
import { relayGraphRequest } from './graph.js';
import { runScheduledPublisher } from './scheduledPublisher.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: hasValidApiKey() });
});

app.post('/api/login', (req, res) => {
  const { passcode, password } = req.body ?? {};
  const provided = typeof password === 'string' ? password : passcode;
  const expected = process.env.APP_PASSCODE || 'heavenzy1997@gmail.com';
  if (typeof provided === 'string' && provided === expected) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Incorrect credentials' });
});

app.post('/api/profile', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username?.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    const data = await fetchInstagramProfile(username);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reels', async (req, res) => {
  try {
    const { username, maxId, pagination_token } = req.body;
    if (!username?.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    const data = await fetchInstagramReels(username, pagination_token || maxId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stories', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username?.trim()) {
      return res.status(400).json({ error: 'username is required' });
    }
    const data = await fetchInstagramStories(username);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/graph', async (req, res) => {
  try {
    const { status, data } = await relayGraphRequest(req.body ?? {});
    res.status(status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/bsky-proxy', async (req, res) => {
  try {
    const data = await relayThroughProxy(req.body ?? {});
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/bsky-profile-image', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({
      error: 'Invalid request body. For large images, pass imageUrl instead of imageBase64.',
    });
  }
  try {
    await pushProfileImageToBsky(body);
    res.status(200).json({ ok: true });
  } catch (err) {
    const message = err.message || 'Bluesky profile push failed';
    const status = /too large/i.test(message) ? 413 : 502;
    res.status(status).json({ error: message });
  }
});

app.get('/api/image', async (req, res) => {
  try {
    const { url } = req.query;
    const { contentType, buffer } = await fetchImage(url);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(err.statusCode || 502).json({ error: err.message });
  }
});

app.get('/api/cron/publish-scheduled', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  try {
    const result = await runScheduledPublisher();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  setInterval(() => {
    runScheduledPublisher().catch((err) =>
      console.error('Scheduled publish error:', err?.message || err),
    );
  }, 60_000);
}

const distPath = path.join(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Instatracker server running on http://localhost:${PORT}`);
  if (!hasValidApiKey()) {
    console.warn('Warning: RAPIDAPI_KEY is missing or invalid. Set it in .env to fetch Instagram data.');
  }
});
