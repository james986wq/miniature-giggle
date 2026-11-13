# Lunaar - by james :)

Unblocked games + Ultraviolet proxy.

## Run locally

```bash
npm install
npm start
```

## Luna AI (optional)

Add `GROQ_API_KEY=your_key` to `.env` (or to Vercel environment variables).

## Vercel

Import the repo, leave the framework as "Other". `vercel.json` handles everything.
Vercel has no WebSockets, so the proxy uses the Bare transport there. For the faster
Libcurl/Epoxy transports, host on Render, Railway, Fly.io or a VPS (`npm start`).
