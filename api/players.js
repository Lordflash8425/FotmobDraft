const FOTMOB = 'https://www.fotmob.com';
const LEAGUE_ID = 47;
const SEASON_ID = '36781';
const SEASON_NAME = '2026/2027';
const RATING_URL = `${FOTMOB}/api/data/leagueseasondeepstats?id=${LEAGUE_ID}&season=${SEASON_ID}&type=players&stat=rating`;

let memoryCache = null;
let memoryCacheAt = 0;
const TTL_MS = 5 * 60 * 1000;

function numberValue(value) {
  if (value && typeof value === 'object') return numberValue(value.value ?? value.num ?? value.rating);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeDisplayName(name, teamName) {
  if (name === 'Gabriel' && /Arsenal/i.test(teamName || '')) return 'Gabriel Magalhães';
  return name;
}

function parseFotMob(data) {
  if (!Array.isArray(data?.statsData)) throw new Error('FotMob did not return statsData');

  const players = [];
  const seen = new Set();

  for (const row of data.statsData) {
    if (!row || typeof row !== 'object') continue;
    const person = row.player && typeof row.player === 'object' ? row.player : {};
    const rawName = row.name || row.playerName || person.name || person.fullName;
    const rating = numberValue(row.statValue);
    const id = row.playerId ?? row.id ?? person.id;
    const teamId = row.teamId ?? person.teamId ?? null;
    const teamName = row.teamName ?? person.teamName ?? '';

    if (!rawName || rating === null || rating <= 0 || rating >= 10) continue;
    const key = id ? `id:${id}` : `name:${normalizeName(rawName)}|team:${normalizeName(teamName)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const name = normalizeDisplayName(String(rawName), String(teamName));
    players.push({
      id: String(id || `name-${normalizeName(name)}-${normalizeName(teamName)}`),
      name,
      teamId: teamId == null ? null : String(teamId),
      teamName: String(teamName || 'Unknown'),
      position: row.position ?? person.position ?? null,
      rating: Math.round(rating * 100) / 100,
      photoUrl: id ? `https://images.fotmob.com/image_resources/playerimages/${id}.png` : null
    });
  }

  players.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  if (players.length < 100) throw new Error(`FotMob returned only ${players.length} rated players`);

  return {
    season: SEASON_ID,
    seasonName: SEASON_NAME,
    source: 'FotMob',
    sourceUrl: RATING_URL,
    updatedAt: new Date().toISOString(),
    players
  };
}

async function fetchFotMob() {
  const response = await fetch(RATING_URL, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FotMobFantasyDraft/1.0)',
      'Accept': 'application/json,text/plain,*/*',
      'Referer': `${FOTMOB}/leagues/47/premier-league`
    },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`FotMob HTTP ${response.status}`);
  return parseFotMob(await response.json());
}

async function readSnapshot() {
  try {
    const url = new URL('../public/players.json', import.meta.url);
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(url, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data?.players) && data.players.length >= 100) return data;
    if (Array.isArray(data) && data.length >= 100) {
      return { season: SEASON_ID, seasonName: SEASON_NAME, source: 'Cached snapshot', updatedAt: null, players: data };
    }
  } catch (_) {}
  return null;
}

async function getData(force) {
  if (!force && memoryCache && Date.now() - memoryCacheAt < TTL_MS) return { ...memoryCache, cached: true };

  try {
    const live = await fetchFotMob();
    memoryCache = live;
    memoryCacheAt = Date.now();
    return { ...live, cached: false };
  } catch (error) {
    if (memoryCache) return { ...memoryCache, stale: true, warning: `Live FotMob refresh failed: ${error.message}` };
    const snapshot = await readSnapshot();
    if (snapshot) return { ...snapshot, stale: true, warning: `Live FotMob refresh failed: ${error.message}` };
    throw error;
  }
}

export default async function handler(req, res) {
  const force = req.query?.refresh === '1' || req.query?.refresh === 'true';
  try {
    const data = await getData(force);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', force ? 'no-store' : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400');
    res.status(200).json(data);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: `Could not load FotMob ratings: ${error.message}` });
  }
}
