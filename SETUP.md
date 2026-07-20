# Civic Log — Setup Guide

This turns the prototype into a real, working app. You only need to create three
free accounts (Supabase, Render, Vercel) and supply credentials for **three
APIs**: OpenAI, Gmail, X (Twitter). Everything else — database schema, backend
code, frontend — is already built.

**The app works before you fill anything in.** Every external call (OpenAI,
Gmail, X) has a dry-run fallback: if a credential is missing, the backend
simulates that step (logs it, returns success) so you can test the entire
flow end-to-end first, then flip on real sending whenever you're ready — no
code changes needed, just add the env var on Render and it goes live.

---

## What you're filling in — quick reference

| # | Service | You need | Where it's used |
|---|---------|----------|------------------|
| 1 | OpenAI | `OPENAI_API_KEY` | Photo/severity analysis, email + X drafts |
| 2 | Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Sending the actual grievance emails |
| 3 | X (Twitter) | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | Posting the actual alert tweets |

Plus one-time infrastructure values that only exist after you create the free
accounts below: Supabase URL/keys, and your Render/Vercel URLs.

---

## Step 1 — Supabase (database, file storage, live feed)

1. Go to [supabase.com](https://supabase.com) → New project. Pick any name/region, set a database password (save it somewhere).
2. Once it's provisioned: **SQL Editor → New query** → paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. This creates all tables, seed data (district contacts, fabricated NGO list), and security policies.
3. **Storage → New bucket** → name it exactly `evidence` → toggle **Public bucket** → Create.
4. **Project Settings → API** → copy three values, you'll need them shortly:
   - `Project URL` → this is `SUPABASE_URL`
   - `anon` `public` key → this is `SUPABASE_ANON_KEY`
   - `service_role` key (click "Reveal") → this is `SUPABASE_SERVICE_ROLE_KEY` — **keep this secret**, it goes on the backend only, never in frontend code.

## Step 2 — OpenAI

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → Create new secret key.
2. Copy it → this is `OPENAI_API_KEY`. Make sure the account has billing enabled (image analysis needs `gpt-4o`, which isn't available on a totally unfunded account).

## Step 3 — Gmail API (sends as shaakyatyagi@gmail.com)

Gmail has no simple "API key" for sending mail — it requires OAuth2 signed in
as the sending account. One-time setup:

1. [console.cloud.google.com](https://console.cloud.google.com) → create a new project (any name).
2. **APIs & Services → Library** → search "Gmail API" → Enable.
3. **APIs & Services → OAuth consent screen** → User type "External" → fill in app name (e.g. "Civic Log") and your email → Save. Under **Test users**, add `shaakyatyagi@gmail.com`.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type **Desktop app** → Create. Copy the **Client ID** and **Client Secret** — these are `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. On your own machine (not Render):
   ```
   cd backend
   npm install
   GOOGLE_CLIENT_ID=<paste> GOOGLE_CLIENT_SECRET=<paste> node scripts/get-gmail-token.js
   ```
6. It prints a URL — open it, **sign in as shaakyatyagi@gmail.com**, approve access. The terminal then prints `GOOGLE_REFRESH_TOKEN=...` — copy that value.
7. `GMAIL_SENDER=shaakyatyagi@gmail.com` (already the default).

## Step 4 — X (Twitter) API (posts as @shakyatyagi)

1. [developer.x.com](https://developer.x.com) → sign in as the `@shakyatyagi` account → create a Project + App (free tier is fine for testing).
2. In the App's **Settings → User authentication settings** → enable OAuth 1.0a, set **App permissions** to **Read and Write**, add any placeholder callback URL/website (required by the form, not actually used by this app).
3. **Keys and tokens** tab → generate/copy:
   - API Key & Secret → `X_API_KEY` / `X_API_SECRET`
   - Access Token & Secret (**regenerate these after setting permissions to Read+Write**, otherwise they'll be read-only) → `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`

Note: X's free tier caps how many posts/month you can make — fine for testing, worth upgrading if this gets real traffic.

## Step 5 — Render (backend)

1. Push this project to a GitHub repo (Render deploys from git).
2. [render.com](https://render.com) → New → Web Service → connect your repo.
3. **Root Directory**: `backend`. **Build Command**: `npm install`. **Start Command**: `npm start`.
4. Under **Environment**, add every variable from `backend/.env.example`, filled in with the real values from Steps 1–4:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GMAIL_SENDER`
   - `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`
   - `CORS_ORIGIN` — set this to your Vercel URL once you have it (Step 6); you can leave it blank initially and come back.
5. Deploy. Once live, note the URL (e.g. `https://civic-log-backend.onrender.com`) — check `https://<that-url>/health` in a browser; it should return JSON showing which integrations are still in dry-run mode.

*(Render's free tier spins down when idle — the first request after a while takes ~30–60s to wake up. Fine for testing; upgrade if you need instant responses.)*

## Step 6 — Vercel (frontend)

1. [vercel.com](https://vercel.com) → New Project → same repo, **Root Directory**: `frontend`. Framework preset: "Other" (it's plain static HTML, no build step).
2. Deploy. Note the resulting URL (e.g. `https://civic-log.vercel.app`).
3. Go back to Render and set `CORS_ORIGIN` to that exact Vercel URL, then redeploy the backend (or it'll block requests from your frontend).
4. Edit [`frontend/config.js`](frontend/config.js) in your repo:
   ```js
   window.CIVIC_CONFIG = {
     API_BASE: "https://civic-log-backend.onrender.com",   // your Render URL
     SUPABASE_URL: "https://xxxx.supabase.co",              // from Step 1
     SUPABASE_ANON_KEY: "eyJ...",                            // from Step 1 (anon key — safe to expose)
   };
   ```
5. Commit and push — Vercel redeploys automatically.

---

## Verifying it works

1. Visit your Vercel URL. The home page's live feed should connect (check the browser console for Supabase errors if it doesn't).
2. File a report on the **Report** page with a photo. You should see the AI verdict banner and editable drafts appear (even before any of the 3 API keys are filled in — it'll say "[DRY RUN]" in the AI reasoning and drafts).
3. Click **Confirm & Send** — it'll say "simulated (dry-run)" until you add real Gmail/X credentials on Render.
4. Check the **Issue Log** — your report should appear grouped under its State → District → Category → Unsolved.
5. Open it, enter the 6-digit code shown on the Report page, click **Still Unsolved** — this triggers the escalation path (higher-authority email + ALERT post), and on the 3rd time also tags NGOs.
6. Once you've added the real `OPENAI_API_KEY`, Gmail, and X credentials to Render and redeployed, file one real report and confirm an actual email lands in your inbox and an actual tweet posts from @shakyatyagi.

## Customizing later (no code changes needed)

- **Real NGOs**: Supabase → Table Editor → `ngos` — edit/add rows (name, district, twitter_handle, email).
- **Real per-district authority emails**: Supabase → Table Editor → `district_contacts`.
