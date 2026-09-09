import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3000;
const FOTMOB = 'https://www.fotmob.com';
const LEAGUE_ID = 47;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function fotmob(pathname, params = {}) {
  const url = new URL(FOTMOB + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const r = await fetch(key, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FotMobFantasyDraft/1.0)',
      'Accept': 'application/json,text/plain,*/*'
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`FotMob request failed (${r.status}) at ${pathname}`);
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`FotMob returned non-JSON data for ${pathname}`); }
  cache.set(key, { at: Date.now(), data });
  return data;
}

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeId(v) { return v === undefined || v === null ? null : String(v); }

function walkForPlayers(node, out, context = {}) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walkForPlayers(item, out, context);
    return;
  }

  const merged = { ...context };
  for (const key of ['teamId', 'teamName', 'position', 'pos']) {
    if (node[key] !== undefined && node[key] !== null) merged[key] = node[key];
  }

  // FotMob's deep-stat table stores the player identity separately from the
  // stat value. Support both the old flat shape and the current nested shape.
  const player = node.player && typeof node.player === 'object' ? node.player : {};
  const statValue = node.statValue && typeof node.statValue === 'object' ? node.statValue : {};

  const name = node.name ?? node.playerName ?? node.fullName
    ?? player.name ?? player.playerName ?? player.fullName;
  const id = normalizeId(node.id ?? node.playerId ?? player.id ?? player.playerId);
  const rating = num(
    node.rating ?? node.averageRating ?? node.avgRating
    ?? statValue.value ?? statValue.rating ?? statValue.averageRating
  );

  if (name && id && rating !== null && rating > 0 && rating < 10) {
    const existing = out.get(id);
    if (!existing || rating > existing.rating) {
      out.set(id, {
        id,
        name,
        rating,
        teamId: node.teamId ?? node.team?.id ?? player.teamId ?? player.team?.id ?? merged.teamId ?? null,
        teamName: node.teamName ?? node.team?.name ?? player.teamName ?? player.team?.name ?? merged.teamName ?? null,
        position: node.position ?? node.pos ?? player.position ?? player.pos ?? merged.position ?? null,
        appearances: num(node.appearances ?? node.matches ?? node.gamesPlayed ?? node.played ?? player.appearances ?? player.matches),
        photo: node.photo ?? node.image ?? node.img ?? player.photo ?? player.image ?? player.img ?? null
      });
    }
  }

  for (const [k, v] of Object.entries(node)) {
    if (k === 'rating' || k === 'averageRating' || k === 'avgRating') continue;
    if (v && typeof v === 'object') walkForPlayers(v, out, merged);
  }
}

function parsePlayers(data) {
  const out = new Map();
  walkForPlayers(data, out);
  return [...out.values()].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

async function getSeasonData() {
  return fotmob('/api/data/leagues', { id: LEAGUE_ID });
}

function seasonCandidates(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(\d{4})[\/-](\d{4})$/);
  if (!m) return [s];
  const a = m[1], b = m[2];
  return [s, `${a}/${b}`, `${a}-${b}`, `${a}${b}`];
}

async function getRatings(season) {
  const meta = await getSeasonData();
  const seasons = Array.isArray(meta.seasons) ? meta.seasons : [];
  const requested = String(season || meta?.details?.selectedSeason || '').replace('-', '/');
  const match = seasons.find(x => String(x.id ?? '').replace('-', '/') === requested)
    || seasons.find(x => String(x.name ?? '').replace('-', '/') === requested);
  const canonical = match?.id || requested;
  const candidates = seasonCandidates(canonical);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const data = await fotmob('/api/data/leagueseasondeepstats', {
        id: LEAGUE_ID,
        season: candidate,
        type: 'players',
        stat: 'rating'
      });
      const players = parsePlayers(data).filter(p => p.rating !== null);
      if (players.length > 20) return { season: canonical, players };
    } catch (e) {
      lastError = e;
    }
  }

  for (const candidate of candidates) {
    try {
      const data = await fotmob('/api/data/leagues', { id: LEAGUE_ID, season: candidate });
      const players = parsePlayers(data).filter(p => p.rating !== null);
      if (players.length > 20) return { season: canonical, players };
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(lastError?.message || 'Could not find Premier League player ratings for that season.');
}

app.get('/api/seasons', async (_req, res) => {
  try {
    const data = await getSeasonData();
    const seasons = (data.seasons || []).map(s => ({ id: s.id, name: s.name }));
    res.json({ seasons, selected: data?.details?.selectedSeason || seasons[0]?.id });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/players', async (req, res) => {
  try {
    res.json(await getRatings(req.query.season));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (term.length < 2) return res.json({ suggestions: [] });
    const data = await fotmob('/api/data/search/suggest', { term, hits: 20, lang: 'en' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`FotMob Fantasy Draft running on port ${PORT}`));
