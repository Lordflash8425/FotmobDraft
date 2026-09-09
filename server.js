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
    const cleaned = v.replace(',', '.').replace(/[^0-9.+-]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeId(v) { return v === undefined || v === null ? null : String(v); }

function addPlayer(out, row, context = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return;

  const player = row.player && typeof row.player === 'object' ? row.player : {};
  const statValue = row.statValue && typeof row.statValue === 'object' ? row.statValue : {};
  const team = row.team && typeof row.team === 'object' ? row.team : {};

  const name = row.name ?? row.playerName ?? row.fullName
    ?? player.name ?? player.playerName ?? player.fullName;
  const id = normalizeId(row.id ?? row.playerId ?? player.id ?? player.playerId);
  const rating = num(
    row.rating ?? row.averageRating ?? row.avgRating
    ?? row.value
    ?? (typeof row.statValue === 'string' ? row.statValue : null)
    ?? statValue.value ?? statValue.num ?? statValue.rating
    ?? statValue.averageRating ?? statValue.displayValue ?? statValue.formatted
  );

  if (!name || !id || rating === null || rating <= 0 || rating >= 10) return;

  const existing = out.get(id);
  if (!existing || rating > existing.rating) {
    out.set(id, {
      id,
      name,
      rating,
      teamId: row.teamId ?? team.id ?? player.teamId ?? player.team?.id ?? context.teamId ?? null,
      teamName: row.teamName ?? team.name ?? player.teamName ?? player.team?.name ?? context.teamName ?? null,
      position: row.position ?? row.pos ?? player.position ?? player.pos ?? context.position ?? null,
      appearances: num(row.appearances ?? row.matches ?? row.gamesPlayed ?? row.played ?? player.appearances ?? player.matches),
      photo: row.photo ?? row.image ?? row.img ?? player.photo ?? player.image ?? player.img ?? null
    });
  }
}

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
  addPlayer(out, node, merged);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'rating' || k === 'averageRating' || k === 'avgRating') continue;
    if (v && typeof v === 'object') walkForPlayers(v, out, merged);
  }
}

function parsePlayers(data) {
  const out = new Map();
  const statsData = Array.isArray(data?.statsData) ? data.statsData : [];
  for (const row of statsData) addPlayer(out, row);
  if (out.size < 20) walkForPlayers(data, out);
  return [...out.values()];
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
  const merged = new Map();

  // FotMob's table can return a limited first page. Request several common
  // pagination shapes and merge the rows so the draft sees the full player pool.
  const variants = [
    {},
    { page: 1 },
    { page: 2 },
    { page: 3 },
    { page: 4 },
    { page: 5 },
    { page: 6 },
    { page: 7 },
    { page: 8 },
    { limit: 100 },
    { limit: 200 },
    { limit: 500 },
    { limit: 1000 },
    { page: 1, limit: 100 },
    { page: 2, limit: 100 },
    { page: 3, limit: 100 },
    { page: 4, limit: 100 },
    { page: 5, limit: 100 },
    { page: 6, limit: 100 }
  ];

  for (const candidate of candidates) {
    for (const extra of variants) {
      try {
        const data = await fotmob('/api/data/leagueseasondeepstats', {
          id: LEAGUE_ID,
          season: candidate,
          type: 'players',
          stat: 'rating',
          ...extra
        });
        for (const p of parsePlayers(data)) {
          const existing = merged.get(p.id);
          if (!existing || p.rating > existing.rating) merged.set(p.id, p);
        }
      } catch (e) {
        lastError = e;
      }
    }
    if (merged.size > 20) {
      return {
        season: canonical,
        players: [...merged.values()].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
      };
    }
  }

  for (const candidate of candidates) {
    try {
      const data = await fotmob('/api/data/leagues', { id: LEAGUE_ID, season: candidate });
      const players = parsePlayers(data).filter(p => p.rating !== null);
      if (players.length > 20) {
        return { season: canonical, players: players.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name)) };
      }
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
