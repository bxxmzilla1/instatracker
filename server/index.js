import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchInstagramProfile,
  fetchInstagramReels,
  hasValidApiKey,
} from './instagram.js';
import { fetchImage } from './image.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: hasValidApiKey() });
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
