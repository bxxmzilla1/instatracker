# Instatracker

A Progressive Web App to track Instagram accounts — followers, reels, and reel view counts over time.

Uses the [Instagram API Followers/Following/Stories/Info](https://rapidapi.com/hub) on RapidAPI.

## Features

- Passcode-protected login screen
- Sidebar dashboard with total followers, reel views, accounts, and a monthly bar chart
- Add Instagram usernames to a watchlist
- Track follower count and reel views over time
- Fetch reels and monitor view, like, and comment counts
- Top profile / top reel highlights
- Installable PWA with offline UI support
- Data stored in **Supabase** (falls back to local browser storage if not configured)

## Login passcode

The app opens to a passcode screen. The passcode is verified server-side against the
`APP_PASSCODE` environment variable, defaulting to `heavenzy1997@gmail.com`.
Set `APP_PASSCODE` in Vercel to change it.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the contents of [`supabase/schema.sql`](supabase/schema.sql).
3. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
4. Set these environment variables (locally in `.env`, and in Vercel):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

If these are not set, the app automatically falls back to local browser storage (IndexedDB).

## Local development

### 1. Get a RapidAPI key

1. Sign up at [RapidAPI](https://rapidapi.com/) and subscribe to **Instagram API Followers/Following/Stories/Info**.
2. Copy your API key from the RapidAPI dashboard.

### 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
RAPIDAPI_KEY=your_actual_key
APP_PASSCODE=heavenzy1997@gmail.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
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
4. Add these environment variables (Production, Preview, Development):
   - `RAPIDAPI_KEY` — your RapidAPI key for **Instagram API Followers/Following/Stories/Info**
   - `APP_PASSCODE` — the login passcode (defaults to `heavenzy1997@gmail.com`)
   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase anon public key
5. Click **Deploy**.
6. Use your **production URL** (`instatracker.vercel.app`), not preview links. Preview URLs with Vercel Deployment Protection return 401 for PWA assets.

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
| `/api/profile` | `GET /api/v1/user/profile` via RapidAPI |
| `/api/reels` | `GET /api/v1/user/reels` via RapidAPI |
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
"RapidAPI Hub - Instagram API Followers/Following/Stories/Info": {
  "command": "npx",
  "args": [
    "mcp-remote",
    "https://mcp.rapidapi.com",
    "--header",
    "x-api-host: instagram-api-followers-following-stories-info.p.rapidapi.com",
    "--header",
    "x-api-key:YOUR_RAPIDAPI_KEY_HERE"
  ]
}
```

Restart Cursor after updating the key.
