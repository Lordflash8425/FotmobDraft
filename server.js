import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'public', 'players.json');
const INDEX_FILE = path.join(__dirname, 'public', 'index.html');
const FOTMOB_URL = 'https://www.fotmob.com/leagues/47/stats/season/36781/players/rating/premier-league-1000-players';
const ALLORIGINS = 'https://api.allorigins.win/raw?url=';
const SPORTSDB = 'https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', async (_req, res) => {
  try {
    let html = await fs.readFile(INDEX_FILE, 'utf8');
    if (!html.includes('/enhancements.js')) html = html.replace('</body>', '<script src="/enhancements.js"></script></body>');
    res.type('html').send(html);
  } catch {
    res.sendFile(INDEX_FILE);
  }
});

function slugId(name, index = 0) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `fotmob-${base || 'player'}${index ? `-${index}` : ''}`;
}

function parseFotMobHtml(html) {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ');

  const players = [];
  const seen = new Map();
  const re = /(?:^|\s)(\d+)\s+(?:\d+)\s+(.+?)\s+Player of the Match:\s+\d+\s+(\d+(?:\.\d+)?)(?=\s+\d+\s+\d+\s+|\s*$)/gi;
  let m;
  while ((m = re.exec(text))) {
    const name = m[2].trim();
    const rating = Number(m[3]);
    if (!name || !Number.isFinite(rating) || rating <= 0 || rating >= 10) continue;
    const base = slugId(name);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    players.push({ id: slugId(name, count), name, rating, teamId: null, teamName: null, position: null, appearances: null, photo: null });
  }

  const unique = new Map(players.map(p => [p.id, p]));
  return [...unique.values()].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

async function fetchSnapshot() {
  const proxy = ALLORIGINS + encodeURIComponent(FOTMOB_URL);
  const r = await fetch(proxy, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FotMobFantasyDraft/1.0)', 'Accept': 'text/html,text/plain,*/*' }
  });
  const html = await r.text();
  if (!r.ok) throw new Error(`Ratings proxy returned HTTP ${r.status}`);
  const players = parseFotMobHtml(html);
  if (players.length < 50) throw new Error(`Ratings proxy returned only ${players.length} players`);
  return { season: '36781', seasonName: '2026/2027', source: 'FotMob', sourceUrl: FOTMOB_URL, updatedAt: new Date().toISOString(), players };
}

let memory = null;
let memoryAt = 0;
async function readRatings() {
  try {
    const text = await fs.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(text);
    if (Array.isArray(data.players) && data.players.length >= 50) return data;
  } catch {}

  if (memory && Date.now() - memoryAt < 5 * 60 * 1000) return memory;
  const data = await fetchSnapshot();
  memory = data;
  memoryAt = Date.now();
  return data;
}

const metaCache = new Map();
function normalizeName(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

app.get('/api/player-meta', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (name.length < 2) return res.json({});
  const cacheKey = normalizeName(name);
  if (metaCache.has(cacheKey)) return res.json(metaCache.get(cacheKey));
  try {
    const r = await fetch(SPORTSDB + encodeURIComponent(name), { headers: { 'User-Agent': 'FotMobFantasyDraft/1.0' } });
    if (!r.ok) return res.json({});
    const data = await r.json();
    const people = Array.isArray(data.player) ? data.player : [];
    const target = people.sort((a,b)=>Number(normalizeName(a.strPlayer)===cacheKey)-Number(normalizeName(b.strPlayer)===cacheKey)).at(-1) || people[0];
    const meta = target ? { photo: target.strThumb || target.strCutout || target.strRender || null, position: target.strPosition || null } : {};
    metaCache.set(cacheKey, meta);
    res.json(meta);
  } catch {
    res.json({});
  }
});

app.get('/api/seasons', async (_req, res) => {
  try {
    const data = await readRatings();
    res.json({ seasons: [{ id: data.season, name: data.seasonName }], selected: data.season });
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: 'Could not load the current Premier League ratings.' });
  }
});

app.get('/api/players', async (_req, res) => {
  try {
    res.json(await readRatings());
  } catch (e) {
    console.error(e);
    res.status(503).json({ error: 'Could not load the current Premier League ratings.' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const term = String(req.query.term || '').trim().toLowerCase();
    if (term.length < 2) return res.json({ suggestions: [] });
    const data = await readRatings();
    res.json({ suggestions: data.players.filter(p => p.name.toLowerCase().includes(term)).slice(0, 20).map(p => ({ name: p.name, id: p.id })) });
  } catch (e) {
    res.status(503).json({ error: 'Could not load the current Premier League ratings.' });
  }
});

app.listen(PORT, () => console.log(`FotMob Fantasy Draft running on port ${PORT}`));
