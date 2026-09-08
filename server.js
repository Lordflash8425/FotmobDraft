import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;
const FOTMOB = 'https://www.fotmob.com';
const LEAGUE_ID = 47;

app.use(express.json());
app.use(express.static('public'));

const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;

async function fotmob(path, params = {}) {
  const url = new URL(FOTMOB + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const r = await fetch(key, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FotMobFantasyDraft/1.0)', 'Accept': 'application/json,text/plain,*/*' } });
  if (!r.ok) throw new Error(`FotMob request failed (${r.status})`);
  const data = await r.json();
  cache.set(key, { at: Date.now(), data });
  return data;
}
function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : null; }
  return null;
}
function normalizeId(v) { return v === undefined || v === null ? null : String(v); }
function isLikelyPlayer(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const name = obj.name ?? obj.playerName ?? obj.fullName;
  const id = obj.id ?? obj.playerId;
  if (!name || !id) return false;
  const rating = obj.rating ?? obj.averageRating ?? obj.avgRating ?? obj.value;
  return num(rating) !== null;
}
function walkForPlayers(node, out, context = {}) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) walkForPlayers(item, out, context); return; }
  const merged = { ...context };
  for (const key of ['teamId', 'teamName', 'position', 'pos']) if (node[key] !== undefined && node[key] !== null) merged[key] = node[key];
  if (isLikelyPlayer(node)) {
    const name = node.name ?? node.playerName ?? node.fullName;
    const id = normalizeId(node.id ?? node.playerId);
    const rating = num(node.rating ?? node.averageRating ?? node.avgRating ?? node.value);
    const existing = out.get(id);
    if (!existing || rating > existing.rating || !existing.rating) out.set(id, { id, name, rating, teamId: node.teamId ?? node.team?.id ?? merged.teamId ?? null, teamName: node.teamName ?? node.team?.name ?? merged.teamName ?? null, position: node.position ?? node.pos ?? merged.position ?? null, appearances: num(node.appearances ?? node.matches ?? node.gamesPlayed ?? node.played) ?? null, photo: node.photo ?? node.image ?? node.img ?? null });
  }
  for (const [k, v] of Object.entries(node)) { if (k === 'rating' || k === 'averageRating' || k === 'avgRating' || k === 'value') continue; if (v && typeof v === 'object') walkForPlayers(v, out, merged); }
}
function parseDeepStats(data) {
  const out = new Map(); walkForPlayers(data, out);
  return [...out.values()].filter(p => p.name && p.rating !== null).sort((a,b) => b.rating-a.rating || a.name.localeCompare(b.name));
}
async function getSeasonData() { return fotmob('/api/leagues', { id: LEAGUE_ID }); }
function seasonCandidates(input) {
  const s = String(input || '').trim(); const parts = s.match(/^(\d{4})[\/-](\d{4})$/); if (!parts) return [s];
  const a=parts[1], b=parts[2]; return [s, `${a}/${b}`, `${a}-${b}`, `${a}${b}`];
}
async function getRatings(season) {
  const meta = await getSeasonData(); const seasons = Array.isArray(meta.seasons) ? meta.seasons : [];
  const wanted = String(season || meta?.details?.selectedSeason || '').replace('-', '/');
  const match = seasons.find(x => String(x.id || '').replace('-', '/') === wanted) || seasons.find(x => String(x.name || '').includes(wanted.slice(2,4) + '/' + wanted.slice(7,9)));
  const canonical = match?.id || wanted; const candidates = seasonCandidates(canonical); let lastError = null;
  for (const candidate of candidates) for (const base of ['/api/data/leagueseasondeepstats','/api/leagueseasondeepstats']) {
    try { const data = await fotmob(base, { id: LEAGUE_ID, season: candidate, type: 'players', stat: 'rating' }); const players = parseDeepStats(data); if (players.length > 20) return { season: canonical, players }; } catch(e) { lastError=e; }
  }
  for (const candidate of candidates) { try { const data=await fotmob('/api/leagues',{id:LEAGUE_ID,season:candidate}); const players=parseDeepStats(data); if(players.length>20)return{season:canonical,players}; } catch(e){lastError=e;} }
  throw new Error(lastError?.message || 'Could not find Premier League player ratings for that season.');
}
app.get('/api/seasons', async (_req,res)=>{ try { const data=await getSeasonData(); const seasons=(data.seasons||[]).map(s=>({id:s.id,name:s.name})); res.json({seasons,selected:data?.details?.selectedSeason||seasons[0]?.id}); } catch(e){res.status(502).json({error:e.message});} });
app.get('/api/players', async (req,res)=>{ try { const result=await getRatings(req.query.season); res.json(result); } catch(e){res.status(502).json({error:e.message});} });
app.get('/api/search', async (req,res)=>{ try { const term=String(req.query.term||'').trim(); if(term.length<2)return res.json({suggestions:[]}); const data=await fotmob('/api/data/search/suggest',{term,hits:20,lang:'en'}); res.json(data); } catch(e){res.status(502).json({error:e.message});} });
app.listen(PORT,()=>console.log(`FotMob Fantasy Draft running on port ${PORT}`));
