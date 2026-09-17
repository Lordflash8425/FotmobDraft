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

function n(v) {
  if (typeof v === 'object' && v !== null) return n(v.value ?? v.num ?? v.rating);
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function cleanName(v) {
  return String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseStatsData(data) {
  if (!Array.isArray(data?.statsData)) throw new Error('FotMob response did not contain statsData');
  const map = new Map();
  for (const row of data.statsData) {
    if (!row || typeof row !== 'object') continue;
    const person = row.player && typeof row.player === 'object' ? row.player : {};
    const name = row.name || row.playerName || person.name || person.fullName;
    const rating = n(row.statValue);
    const id = row.playerId ?? row.id ?? person.id;
    if (!name || rating === null || rating <= 0 || rating >= 10) continue;
    const key = id ? `id:${id}` : `name:${cleanName(name)}`;
    if (!map.has(key)) {
      map.set(key, {
        id: String(id || `name-${cleanName(name)}`),
        name: String(name),
        rating,
        teamId: row.teamId ?? person.teamId ?? null,
        teamName: row.teamName ?? person.teamName ?? null,
        position: row.position ?? person.position ?? null,
        photo: id ? `https://images.fotmob.com/image_resources/playerimages/${id}.png` : null
      });
    }
  }
  const players = [...map.values()].sort((a,b)=>b.rating-a.rating || a.name.localeCompare(b.name));
  if (players.length < 100) throw new Error(`FotMob returned only ${players.length} rated players`);
  return {season:SEASON_ID,seasonName:SEASON_NAME,source:'FotMob API',sourceUrl:RATING_URL,updatedAt:new Date().toISOString(),players};
}

let cache = null;
let cacheAt = 0;
const CACHE_MS = 60 * 1000;

async function getRatings(force = false) {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const data = parseStatsData(await fotmobJson(RATING_URL));
  cache = data;
  cacheAt = Date.now();
  return data;
}

app.get('/api/players', async (req,res) => {
  try {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getRatings(force);
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma','no-cache');
    res.set('Expires','0');
    res.json(data);
  } catch(e) {
    console.error('FotMob ratings error:',e);
    res.status(502).json({error:`Could not load FotMob ratings: ${e.message}`});
  }
});

app.get('/api/seasons',(_req,res)=>res.json({seasons:[{id:SEASON_ID,name:SEASON_NAME}],selected:SEASON_ID}));

app.listen(PORT,()=>console.log(`FotMob Fantasy Draft running on port ${PORT}`));
