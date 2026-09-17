import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const FOTMOB = 'https://www.fotmob.com';
const LEAGUE_ID = 47;
const SEASON_ID = '36781';
const SEASON_NAME = '2026/2027';
const RATING_URL = `${FOTMOB}/api/data/leagueseasondeepstats?id=${LEAGUE_ID}&season=${SEASON_ID}&type=players&stat=rating`;

app.use(express.static('public'));

async function fotmobJson(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Referer': `${FOTMOB}/leagues/47/premier-league`
    },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error(`FotMob returned HTTP ${r.status}`);
  return r.json();
}

function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeName(v) {
  return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function playerFromObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const name = o.name || o.playerName || o.fullName || o.player?.name || o.player?.fullName;
  const rating = number(o.rating?.num ?? o.rating?.value ?? o.rating ?? o.stats?.rating ?? o.value);
  if (!name || rating === null || rating <= 0 || rating >= 10) return null;
  const player = o.player && typeof o.player === 'object' ? o.player : o;
  const team = o.team && typeof o.team === 'object' ? o.team : {};
  const id = player.id ?? o.id ?? o.playerId ?? null;
  return {
    id: id ? String(id) : `name-${normalizeName(name)}`,
    name: String(name),
    rating,
    teamId: player.teamId ?? o.teamId ?? team.id ?? team.idTeam ?? null,
    teamName: player.teamName ?? o.teamName ?? team.name ?? team.teamName ?? null,
    position: player.position ?? o.position ?? o.positionName ?? null,
    photo: id ? `https://images.fotmob.com/image_resources/playerimages/${id}.png` : null
  };
}

function collectPlayers(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const item of node) {
      const p = playerFromObject(item);
      if (p) out.push(p);
      collectPlayers(item, out);
    }
    return out;
  }
  if (typeof node === 'object') {
    const p = playerFromObject(node);
    if (p) out.push(p);
    for (const value of Object.values(node)) collectPlayers(value, out);
  }
  return out;
}

function parseRatingData(data) {
  const raw = collectPlayers(data);
  const map = new Map();
  for (const p of raw) {
    const key = p.id.startsWith('name-') ? `name:${normalizeName(p.name)}` : `id:${p.id}`;
    if (!map.has(key)) map.set(key, p);
  }
  const players = [...map.values()].filter(p => p.rating !== null);
  if (players.length < 100) throw new Error(`FotMob rating endpoint returned only ${players.length} usable players`);
  players.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  return { season: SEASON_ID, seasonName: SEASON_NAME, source: 'FotMob API', sourceUrl: RATING_URL, updatedAt: new Date().toISOString(), players };
}

let cache = null;
let cacheAt = 0;
const CACHE_MS = 60 * 1000;

async function getRatings(force = false) {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const data = parseRatingData(await fotmobJson(RATING_URL));
  cache = data;
  cacheAt = Date.now();
  return data;
}

app.get('/api/players', async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getRatings(force);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(data);
  } catch (e) {
    console.error('FotMob ratings error:', e);
    res.status(502).json({ error: `Could not load FotMob ratings: ${e.message}` });
  }
});

app.get('/api/seasons', (_req, res) => {
  res.json({ seasons: [{ id: SEASON_ID, name: SEASON_NAME }], selected: SEASON_ID });
});

app.listen(PORT, () => console.log(`FotMob Fantasy Draft running on port ${PORT}`));
