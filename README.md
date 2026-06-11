# Instatracker

A Progressive Web App to track Instagram accounts — followers, reels, and reel view counts over time.

Uses the [Instagram120 API](https://rapidapi.com/3205/api/instagram120) on RapidAPI.

## Features

- Add Instagram usernames to a watchlist
- Track follower count over time with history charts
- Fetch reels and monitor view, like, and comment counts
- Installable PWA with offline UI support
- Data stored locally in the browser (IndexedDB)

## Local development

### 1. Get a RapidAPI key

1. Sign up at [RapidAPI](https://rapidapi.com/) and subscribe to **Instagram120**.
2. Copy your API key from the RapidAPI dashboard.

### 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
RAPIDAPI_KEY=your_actual_key
```

### 3. Run locally

```bash
npm install
npm run dev
```

- App: http://localhost:5173
- API (local Express): http://localhost:3001

## Push to GitHub

From the project folder:

```bash
git init
git add .
git commit -m "Initial commit: Instatracker PWA"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/instatracker.git
git push -u origin main
```

Do not commit `.env` — it is already in `.gitignore`.

## Deploy to Vercel

### Option A: Vercel dashboard (recommended)

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Vercel auto-detects the Vite app via `vercel.json`.
4. Add an environment variable:
   - **Name:** `RAPIDAPI_KEY`
   - **Value:** your RapidAPI key
   - **Environments:** Production, Preview, Development
5. Click **Deploy**.

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel login
vercel
```

When prompted, link the project and add `RAPIDAPI_KEY` in the Vercel dashboard under **Settings → Environment Variables**, then redeploy.

### How deployment works

| Path | Handler |
|------|---------|
| `/` | Vite static build (`dist/`) |
| `/api/health` | Vercel serverless function |
| `/api/profile` | Vercel serverless function |
| `/api/reels` | Vercel serverless function |
| All other routes | SPA fallback to `index.html` |

API logic is shared between local dev (`server/`) and Vercel (`api/`).

## Usage

1. Enter an Instagram username (with or without `@`).
2. The app fetches profile + reels and stores a snapshot locally.
3. Use **Refresh** or **Refresh all** to capture new data points.
4. View follower history and per-reel view changes.

## Install as PWA

Open the deployed site in Chrome or Edge, then use **Install app** from the browser menu.

## Project structure

```
api/           Vercel serverless API routes
server/        Local Express server + shared Instagram client
src/           React PWA frontend
public/        Static assets and PWA icon
vercel.json    Vercel build and SPA routing config
```

## MCP (Cursor)

To use the Instagram MCP in Cursor, add this to `~/.cursor/mcp.json` and replace the API key:

```json
"RapidAPI Hub - instagram": {
  "command": "npx",
  "args": [
    "mcp-remote",
    "https://mcp.rapidapi.com",
    "--header",
    "x-api-host: instagram120.p.rapidapi.com",
    "--header",
    "x-api-key:YOUR_RAPIDAPI_KEY_HERE"
  ]
}
```

Restart Cursor after updating the key.
