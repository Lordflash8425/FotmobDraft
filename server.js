import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3000;
const FOTMOB = 'https://www.fotmob.com';
const JINA = 'https://r.jina.ai/';
const LEAGUE_ID = 47;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function requestText(url, options = {}) {
  const cacheKey = `${url}|${options.mode || 'fotmob'}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FotMobFantasyDraft/1.0)',
      'Accept': 'text/html,application/json,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Request failed (${r.status}) at ${url}`);
  cache.set(cacheKey, { at: Date.now(), data: text });
  return text;
}

async function requestJina(url, mode = 'page') {
  const headers = mode === 'page'
    ? {
        'Accept': 'text/plain',
        'X-Engine': 'browser',
        'X-Respond-With': 'markdown',
        'X-Timeout': '30'
      }
    : {
        'Accept': 'application/json',
        'X-Respond-With': 'text'
      };
  return requestText(JINA + url, { mode: `jina-${mode}`, headers });
}

async function fotmob(pathname, params = {}) {
  const url = new URL(FOTMOB + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const text = await requestText(url.toString());
  try { return JSON.parse(text); }
  catch { throw new Error(`FotMob returned non-JSON data for ${pathname}`); }
}

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

function slugId(name, index = 0) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `fotmob-${base || 'player'}${index ? `-${index}` : ''}`;
}

function addPlayer(out, row, context = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return;
  const participant = row.participant && typeof row.participant === 'object' ? row.participant : {};
  const player = row.player && typeof row.player === 'object' ? row.player : {};
  const statValue = row.statValue && typeof row.statValue === 'object' ? row.statValue : {};
  const stat = row.stat && typeof row.stat === 'object' ? row.stat : {};
  const team = row.team && typeof row.team === 'object' ? row.team : {};

  const name = row.name ?? row.playerName ?? row.fullName ?? row.participantName
    ?? row.participant_name ?? participant.name ?? player.name ?? player.playerName ?? player.fullName;
  const id = normalizeId(row.id ?? row.playerId ?? row.participantId ?? row.particpiantId
    ?? row.participant_id ?? participant.id ?? player.id ?? player.playerId ?? player.participantId);
  const rawStatValue = row.statValue;
  const rating = num(row.rating ?? row.averageRating ?? row.avgRating ?? row.value
    ?? (typeof rawStatValue === 'number' || typeof rawStatValue === 'string' ? rawStatValue : null)
    ?? participant.value ?? statValue.value ?? stat.value
    ?? statValue.num ?? statValue.rating ?? statValue.averageRating
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

function parsePlayers(data) {
  const out = new Map();
  walk(data, out);
  return [...out.values()];
}

function extractJsonScripts(html) {
  const results = [];
  const re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { results.push(JSON.parse(m[1])); } catch {}
  }
  const next = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (next) {
    try { results.push(JSON.parse(next[1])); } catch {}
  }
  return results;
}

function parseJinaRatingPage(text) {
  const out = [];
  const seen = new Map();
  const lines = String(text).split(/\r?\n/);

  for (const line of lines) {
    const clean = line.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;

    let m = clean.match(/^\d+[.)]?\s+(?:\d+\s+)?(.+?)\s+Player of the Match:\s*\d+\s+(\d+(?:[.,]\d+)?)\s*$/i);
    if (!m) m = clean.match(/^\d+[.)]?\s+(?:\d+\s+)?(.+?)\s+(\d+[.,]\d{2})\s*$/);
    if (!m) continue;

    let name = m[1].trim().replace(/\s+Player of the Match:.*$/i, '').trim();
    const rating = num(m[2]);
    if (!name || rating === null || rating <= 0 || rating >= 10) continue;

    // Some renderers append a club name immediately after the player. Keep the
    // player name clean enough for search while retaining the rating exactly.
    const base = slugId(name);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    out.push({
      id: slugId(name, count),
      name,
      rating,
      teamId: null,
      teamName: null,
      position: null,
      appearances: null,
      photo: null
    });
  }

  const unique = new Map();
  for (const p of out) unique.set(p.id, p);
  return [...unique.values()].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
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

  const pageUrls = [
    `${FOTMOB}/leagues/${LEAGUE_ID}/stats/season/${canonical}/players/rating/premier-league-1000-players`,
    `${FOTMOB}/leagues/${LEAGUE_ID}/stats/season/${canonical}/players/rating/premier-league-players-1000`
  ];

  // FotMob currently protects ordinary server-side HTTP clients with anti-bot
  // challenges. Jina Reader uses a browser-backed fetch and gives us the same
  // public stats page without requiring cookies or a FotMob session.
  for (const pageUrl of pageUrls) {
    try {
      const text = await requestJina(pageUrl, 'page');
      const players = parseJinaRatingPage(text);
      if (players.length > 20) return { season: canonical, players };

      const scripts = extractJsonScripts(text);
      const merged = new Map();
      for (const script of scripts) {
        for (const p of parsePlayers(script)) {
          const existing = merged.get(p.id);
          if (!existing || p.rating > existing.rating) merged.set(p.id, p);
        }
      }
      const parsed = [...merged.values()].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
      if (parsed.length > 20) return { season: canonical, players: parsed };
    } catch (e) {
      console.warn('Jina/FotMob page fetch failed:', e.message);
    }
  }

  // Structured API fallback. This route is documented as the league-season
  // player-stat table and normally returns statsData/statValue.
  try {
    const data = await fotmob('/api/data/leagueseasondeepstats', {
      id: LEAGUE_ID, season: canonical, type: 'players', stat: 'rating'
    });
    const players = parsePlayers(data).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    if (players.length > 20) return { season: canonical, players };
  } catch (e) {
    console.warn('Direct FotMob API fallback failed:', e.message);
  }

  // Last resort: let Jina proxy the structured endpoint itself. This is useful
  // when FotMob serves JSON to browsers but challenges direct server requests.
  try {
    const apiUrl = `${FOTMOB}/api/data/leagueseasondeepstats?id=${LEAGUE_ID}&season=${encodeURIComponent(canonical)}&type=players&stat=rating`;
    const text = await requestJina(apiUrl, 'api');
    try {
      const data = JSON.parse(text);
      const players = parsePlayers(data).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
      if (players.length > 20) return { season: canonical, players };
    } catch {}
  } catch (e) {
    console.warn('Jina API fallback failed:', e.message);
  }

  throw new Error('FotMob is blocking server-side access to the player rating table.');
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
