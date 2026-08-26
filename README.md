# Signal HQ — X Brand & Job Hunter (MVP)

A small dashboard that reads your public X (Twitter) profile and posts via
TwitterAPIs.com, and uses an AI model to help with Web3 personal branding and
job hunting: a brand score, gap analysis, job-fit checks, outreach drafts, and
a free-form assistant chat.

Read-only. It never posts, likes, follows, or DMs on your behalf — it only
reads public data.

## How it's built

- `public/index.html` — the whole frontend. Plain HTML/CSS/JS, no build step.
- `netlify/functions/x-data.js` — serverless function that calls TwitterAPIs.com.
  Holds `TWITTERAPIS_KEY` server-side; the browser never sees it.
- `netlify/functions/ai-assistant.js` — serverless function that calls the AI
  API with your X data as context. Holds `OPENAI_API_KEY` server-side.

The browser only ever talks to your own `/.netlify/functions/*` endpoints —
never directly to TwitterAPIs or the AI provider.

## 1. Required environment variables

Set these in **Netlify → Site settings → Environment variables** (not in code,
not in the repo):

| Variable | Required | Description |
|---|---|---|
| `TWITTERAPIS_KEY` | Yes | Your bearer key from the [TwitterAPIs.com dashboard](https://twitterapis.com). |
| `OPENAI_API_KEY` | Yes | Your API key from your AI provider (OpenAI by default). |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` if unset. |

`.env.example` shows the same list for local development — copy it to `.env`
and fill in real values there. `.env` is already in `.gitignore`, so it won't
be committed.

**The key you pasted in chat earlier should be treated as compromised** —
generate a fresh one in the TwitterAPIs dashboard and use that instead.

## 2. Run locally

You'll need the [Netlify CLI](https://docs.netlify.com/cli/get-started/):

```bash
npm install -g netlify-cli
cp .env.example .env   # then fill in your real keys in .env
netlify dev
```

This serves the frontend and runs the functions locally (typically at
`http://localhost:8888`), reading env vars from `.env` automatically.

## 3. Deploy to Netlify

1. Push this project to a GitHub repo.
2. In Netlify: **Add new site → Import an existing project** → pick the repo.
3. Build settings: no build command needed; publish directory `public`,
   functions directory `netlify/functions` (already set in `netlify.toml`,
   Netlify should pick this up automatically).
4. Add the environment variables from the table above under **Site settings →
   Environment variables**.
5. Deploy. You'll get a URL like `https://your-site-name.netlify.app`.
6. To use your own domain later: **Site settings → Domain management → Add a
   custom domain**.

## 4. Using it

1. Open the site → **Settings** → enter your X username (no `@`) → Save.
2. **Dashboard** / **X Profile** / **Posts** show your pulled public data.
3. **Brand Analysis** → click "Analyze my brand" for a score + specific
   strengths/gaps/positioning suggestions.
4. **Job Hunter** → paste a job description → check fit %, draft outreach, or
   draft an application answer.
5. **AI Assistant** → free-form chat with your profile/posts as context.

## Notes on the TwitterAPIs.com integration

This uses TwitterAPIs.com's `GET /user/info` and `GET /user/tweets` endpoints
(base URL `https://api.twitterapis.com/twitter`, Bearer auth), which is what's
documented at `docs.twitterapis.com` as of this build. Third-party X data APIs
iterate quickly — if a call starts failing, check the current docs at
`docs.twitterapis.com` for parameter or response-shape changes before assuming
the code is broken.

## What's intentionally not in v1

- No database — nothing persists server-side between sessions; only your
  username is remembered, in your own browser's local storage.
- No write actions (posting, liking, following, DMs) — read-only by design.
- No auth/login system — this is built for a single user (you) running your
  own deployment with your own keys.
