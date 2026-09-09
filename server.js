import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3000;
const FOTMOB = 'https://www.fotmob.com';
const DATA = 'https://data.fotmob.com';
const LEAGUE_ID = 47;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function getJson(base, pathname, params = {}) {
  const url = new URL(base + pathname);
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

const fotmob = (pathname, params) => getJson(FOTMOB, pathname, params);

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.').replace(/[^0-9.+-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeId(v) {
  return v === undefined || v === null ? null : String(v);
}

function addPlayer(out, row, context = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return;
  const participant = row.participant && typeof row.participant === 'object' ? row.participant : {};
  const player = row.player && typeof row.player === 'object' ? row.player : {};
  const statValue = row.statValue && typeof row.statValue === 'object' ? row.statValue : {};
  const team = row.team && typeof row.team === 'object' ? row.team : {};

  const name = row.name ?? row.playerName ?? row.fullName ?? row.participantName
    ?? row.participant_name ?? participant.name ?? player.name ?? player.playerName ?? player.fullName;
  const id = normalizeId(row.id ?? row.playerId ?? row.participantId ?? row.particpiantId
    ?? row.participant_id ?? participant.id ?? player.id ?? player.playerId ?? player.participantId);
  const rating = num(row.rating ?? row.averageRating ?? row.avgRating ?? row.value
    ?? participant.value ?? participant.statValue
    ?? (typeof row.statValue === 'string' ? row.statValue : null)
    ?? statValue.value ?? statValue.num ?? statValue.rating ?? statValue.averageRating
    ?? statValue.displayValue ?? statValue.formatted);

  if (!name || !id || rating === null || rating <= 0 || rating >= 10) return;

  const existing = out.get(id);
  if (!existing || rating > existing.rating) {
    out.set(id, {
      id,
      name,
      rating,
      teamId: row.teamId ?? participant.teamId ?? team.id ?? player.teamId ?? player.team?.id ?? context.teamId ?? null,
      teamName: row.teamName ?? participant.teamName ?? team.name ?? player.teamName ?? player.team?.name ?? context.teamName ?? null,
      position: row.position ?? row.pos ?? player.position ?? player.pos ?? context.position ?? null,
      appearances: num(row.appearances ?? row.matches ?? row.gamesPlayed ?? row.played ?? participant.matchesPlayed ?? player.appearances ?? player.matches),
      photo: row.photo ?? row.image ?? row.img ?? player.photo ?? player.image ?? player.img ?? null
    });
  }
}

function parsePlayers(data) {
  const out = new Map();
  const statsData = Array.isArray(data?.statsData) ? data.statsData : [];
  for (const row of statsData) addPlayer(out, row);

  // data.fotmob.com season files use TopLists -> StatList.
  for (const board of (Array.isArray(data?.TopLists) ? data.TopLists : [])) {
    const rows = Array.isArray(board?.StatList) ? board.StatList : [];
    for (const row of rows) addPlayer(out, row);
  }

  if (out.size < 20) walk(data, out);
  return [...out.values()];
}

function walk(node, out, context = {}) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, out, context);
    return;
  }
  const next = { ...context };
  for (const key of ['teamId', 'teamName', 'position', 'pos']) {
    if (node[key] !== undefined && node[key] !== null) next[key] = node[key];
  }
  addPlayer(out, node, next);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'rating' || k === 'averageRating' || k === 'avgRating') continue;
    if (v && typeof v === 'object') walk(v, out, next);
  }
}

async function getSeasonData() {
  return fotmob('/api/data/leagues', { id: LEAGUE_ID });
}

async function getRatings(season) {
  const meta = await getSeasonData();
  const seasons = Array.isArray(meta.seasons) ? meta.seasons : [];
  const requested = String(season || meta?.details?.selectedSeason || '').replace('-', '/');
  const match = seasons.find(x => String(x.id ?? '').replace('-', '/') === requested)
    || seasons.find(x => String(x.name ?? '').replace('-', '/') === requested);
  const canonical = String(match?.id || requested);

  // This is the important path: FotMob publishes the complete season stat
  // board as data.fotmob.com/stats/<league>/season/<season>/rating.json.
  // Unlike leagueseasondeepstats, this feed is not the truncated ~62-row
  // table we were receiving before.
  const candidates = [canonical, canonical.replace('-', '/')];
  for (const seasonId of candidates) {
    try {
      const data = await getJson(DATA, `/stats/${LEAGUE_ID}/season/${seasonId}/rating.json`);
      const players = parsePlayers(data)
        .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
      if (players.length > 20) return { season: canonical, players };
    } catch (e) {
      console.warn(e.message);
    }
  }

  // Fallback to the API endpoint if the CDN season file is unavailable.
  const data = await fotmob('/api/data/leagueseasondeepstats', {
    id: LEAGUE_ID, season: canonical, type: 'players', stat: 'rating'
  });
  const players = parsePlayers(data).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  if (players.length > 20) return { season: canonical, players };
  throw new Error('Could not find the complete Premier League player rating table from FotMob.');
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
    res.json(await fotmob('/api/data/search/suggest', { term, hits: 20, lang: 'en' }));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`FotMob Fantasy Draft running on port ${PORT}`));
