# FotMob Fantasy Draft

A lightweight Premier League fantasy-draft board that uses current FotMob season ratings.

## Architecture

- `public/index.html` — static, dependency-free frontend served directly by Vercel.
- `api/players.js` — Vercel serverless function that fetches FotMob's league-season rating endpoint in one batch.
- `api/seasons.js` — season metadata endpoint.
- No Express server, custom rewrite, or build step is required.

This structure deliberately avoids the previous `Cannot GET /` failure: Vercel serves `public/index.html` as the site root and `/api/*` as native functions.

## Data behavior

The player list is live from FotMob rather than a permanently bundled ratings file. Requests use a five-minute function cache plus Vercel CDN caching. The manual **Refresh ratings** action requests a no-store live refresh. If FotMob temporarily fails, the function returns the most recent in-memory result when available.

FotMob's internal web-data endpoint is not presented as an official public API, so the app should use it conservatively and cache heavily. No user login or private account data is used.

## Draft behavior

- 4-3-3 starting XI.
- Search by player or club.
- Multiple draft teams.
- A player can only be drafted once across all teams in the browser.
- Team average is the arithmetic mean of drafted players' FotMob ratings.
- Draft state is saved in browser local storage.

## Deployment

Connect the GitHub repository to Vercel with the `main` branch as production. No `vercel.json` is needed. Every push to `main` can then create a new deployment through the connected Vercel project.

## Important limitation

FotMob does not provide a documented public API for this use case. Its web application exposes JSON routes that this project reads. Those routes can change or become protected, so the API includes validation, caching, and graceful failure handling rather than silently serving stale ratings as if they were current.
