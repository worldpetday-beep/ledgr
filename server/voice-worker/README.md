# Ledgr voice-entry proxy

A tiny Cloudflare Worker that holds the Anthropic API key and turns one
spoken transcript + the current product catalog into structured JSON for
Ledgr's voice-entry review screen. It never saves anything itself — Ledgr
always requires a manual "Confirm and record" tap before writing a sale.

This lives outside the main Vite app because Ledgr is deployed to GitHub
Pages (pure static hosting) and can't hold a secret. This is the one piece
of the whole project that needs a real server.

## One-time setup

1. Install dependencies:
   ```
   cd server/voice-worker
   npm install
   ```

2. Log into your Cloudflare account (free tier is enough):
   ```
   npx wrangler login
   ```

3. Set your Anthropic API key as a Worker secret — this is the step that
   keeps it out of git and out of the client bundle entirely:
   ```
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
   Paste your key (starts `sk-ant-...`) when prompted.

4. Open `wrangler.toml` and check `ALLOWED_ORIGINS` matches the real URL
   Ledgr is served from (your GitHub Pages URL, no trailing slash). Add a
   second origin comma-separated if you also test from `localhost` during
   development, e.g. `"https://worldpetday-beep.github.io,http://localhost:5173"`.

5. Deploy:
   ```
   npm run deploy
   ```
   Wrangler prints the Worker's URL when it finishes, something like
   `https://ledgr-voice-worker.<your-subdomain>.workers.dev`. Copy that.

6. In the Ledgr app itself, open Numbers → Setup → "Voice entry" and paste
   that URL in as the endpoint. (The app never calls Claude directly — it
   only ever calls this Worker.)

## Updating later

Any time you change `src/index.ts` (e.g. adjusting the parsing rules),
redeploy with `npm run deploy` — no new secret needed, it's still set.

## What it costs

Claude Haiku 4.5 is priced at $1/$5 per million input/output tokens. A
single day's voice entry is a handful of sentences plus the product
catalog (a few thousand tokens) — this should cost a small fraction of a
cent per use. Cloudflare Workers' free tier (100,000 requests/day) covers
this kind of usage with plenty of room.
