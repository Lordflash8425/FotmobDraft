import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'public', 'players.json');
const INDEX_FILE = path.join(__dirname, 'public', 'index.html');
const FOTMOB_URL = 'https://www.fotmob.com/leagues/47/stats/season/36781/players/rating/premier-league-teams-players';
const ALLORIGINS = 'https://api.allorigins.win/raw?url=';
const JINA = 'https://r.jina.ai/http://';
const SPORTSDB = 'https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=';
const SPORTSDB_TEAMS = 'https://www.thesportsdb.com/api/v1/json/3/search_all_teams.php?l=English_Premier_League';
const SPORTSDB_TEAM_PLAYERS = 'https://www.thesportsdb.com/api/v1/json/3/lookup_all_players.php?id=';

app.use(express.json());

app.get('/', async (_req, res) => {
  try {
    let html = await fs.readFile(INDEX_FILE, 'utf8');
    if (!html.includes('/enhancements.js')) html = html.replace('</body>', '<script src="/enhancements.js"></script></body>');
    res.type('html').send(html);
  } catch { res.sendFile(INDEX_FILE); }
});
app.use(express.static(path.join(__dirname, 'public')));

function slugId(name, index = 0) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `fotmob-${base || 'player'}${index ? `-${index}` : ''}`;
}
function normalizeName(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function normalizeStatic(data) {
  if (!data || !Array.isArray(data.players)) return data;
  const seen = new Map();
  data.players = data.players.map(p => { const base=slugId(p.name); const count=seen.get(base)||0; seen.set(base,count+1); return {...p,id:p.id||slugId(p.name,count)}; });
  return data;
}

function parseFotMobHtml(html) {
  const text=String(html).replace(/<script[\s\S]*?<\/script>/gi,'\n').replace(/<style[\s\S]*?<\/style>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#x27;/gi,"'").replace(/&#39;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ');
  const players=[],seen=new Map(),re=/(?:^|\s)(\d+)\s+(?:\d+)\s+(.+?)\s+Player of the Match:\s+\d+\s+(\d+(?:\.\d+)?)(?=\s+\d+\s+\d+\s+|\s*$)/gi; let m;
  while((m=re.exec(text))){const name=m[2].trim(),rating=Number(m[3]);if(!name||!Number.isFinite(rating)||rating<=0||rating>=10)continue;const base=slugId(name),count=seen.get(base)||0;seen.set(base,count+1);players.push({id:slugId(name,count),name,rating,teamId:null,teamName:null,position:null,appearances:null,photo:null});}
  return [...new Map(players.map(p=>[p.id,p])).values()].sort((a,b)=>b.rating-a.rating||a.name.localeCompare(b.name));
}
async function tryFetch(url,headers={}){const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; FotMobFantasyDraft/1.0)','Accept':'text/html,text/plain,*/*',...headers}});const body=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}`);return body;}
async function fetchSnapshot(){const urls=[FOTMOB_URL,ALLORIGINS+encodeURIComponent(FOTMOB_URL),JINA+FOTMOB_URL.replace(/^https?:\/\//,'')];let lastError;for(const url of urls){try{const html=await tryFetch(url),players=parseFotMobHtml(html);if(players.length>=150)return{season:'36781',seasonName:'2026/2027',source:'FotMob',sourceUrl:FOTMOB_URL,updatedAt:new Date().toISOString(),players};lastError=new Error(`Source returned only ${players.length} players`);}catch(e){lastError=e;}}throw lastError||new Error('Could not fetch FotMob ratings');}

let teamMap=null,teamMapAt=0;
async function loadTeamMap(){
  if(teamMap&&Date.now()-teamMapAt<30*60*1000)return teamMap;
  const map=new Map();
  try{
    const r=await fetch(SPORTSDB_TEAMS); if(!r.ok)throw new Error(`teams HTTP ${r.status}`);
    const d=await r.json(); const teams=Array.isArray(d.teams)?d.teams:[];
    await Promise.all(teams.map(async t=>{try{const rr=await fetch(SPORTSDB_TEAM_PLAYERS+encodeURIComponent(t.idTeam));if(!rr.ok)return;const dd=await rr.json();for(const p of (Array.isArray(dd.player)?dd.player:[])){const n=normalizeName(p.strPlayer);if(n)map.set(n,{teamName:t.strTeam||null,teamId:t.idTeam||null,photo:p.strCutout||p.strThumb||p.strRender||null,position:p.strPosition||null});}}catch{}}));
    teamMap=map;teamMapAt=Date.now();
  }catch{if(!teamMap)teamMap=new Map();}
  return teamMap;
}
async function enrichTeams(data){
  const map=await loadTeamMap();
  for(const p of data.players||[]){
    let t=map.get(normalizeName(p.name));
    // FotMob lists Arsenal's centre-back simply as "Gabriel".
    if(!t&&normalizeName(p.name)==='gabriel') t={teamName:'Arsenal',teamId:null,photo:null,position:'CB'};
    if(t){
      p.teamName=t.teamName||p.teamName||null;
      p.teamId=t.teamId||p.teamId||null;
      p.position=p.position||t.position||null;
      p.photo=p.photo||t.photo||null;
    }
    if(normalizeName(p.name)==='gabriel'&&normalizeName(p.teamName)==='arsenal'){
      p.name='Gabriel Magalhães';
      p.rating=7.42;
    }
  }
  return data;
}

let memory=null,memoryAt=0;
async function readRatings(forceRefresh=false){
  // Normal requests may use the short in-memory cache. A refresh request always bypasses it.
  if(!forceRefresh&&memory&&Date.now()-memoryAt<5*60*1000)return memory;
  let staticData=null;
  try{const text=await fs.readFile(DATA_FILE,'utf8');staticData=normalizeStatic(JSON.parse(text));}catch{}

  // Always try FotMob first when loading/refreshing. The bundled data is only a fallback.
  try{
    const live=await fetchSnapshot();
    if(staticData&&Array.isArray(staticData.players)){
      const liveNames=new Set(live.players.map(p=>normalizeName(p.name)));
      for(const p of staticData.players){if(!liveNames.has(normalizeName(p.name)))live.players.push({...p});}
      live.players.sort((a,b)=>Number(b.rating||0)-Number(a.rating||0)||a.name.localeCompare(b.name));
    }
    await enrichTeams(live);memory=live;memoryAt=Date.now();return live;
  }catch(e){
    console.error('FotMob fetch failed:',e);
    if(staticData&&Array.isArray(staticData.players)&&staticData.players.length>=50){
      await enrichTeams(staticData);memory=staticData;memoryAt=Date.now();return staticData;
    }
    throw e;
  }
}

const metaCache=new Map();
app.get('/api/player-meta',async(req,res)=>{const name=String(req.query.name||'').trim();if(name.length<2)return res.json({});const cacheKey=normalizeName(name);if(metaCache.has(cacheKey))return res.json(metaCache.get(cacheKey));try{const r=await fetch(SPORTSDB+encodeURIComponent(name),{headers:{'User-Agent':'FotMobFantasyDraft/1.0'}});if(!r.ok)return res.json({});const data=await r.json(),people=Array.isArray(data.player)?data.player:[],target=people.find(x=>normalizeName(x.strPlayer)===cacheKey)||people[0];const meta=target?{photo:target.strCutout||target.strThumb||target.strRender||null,position:target.strPosition||null,teamName:target.strTeam||null,teamId:target.idTeam||null}:{};metaCache.set(cacheKey,meta);res.json(meta);}catch{res.json({});}});
app.get('/api/seasons',async(_req,res)=>{try{const data=await readRatings(false);res.json({seasons:[{id:data.season,name:data.seasonName}],selected:data.season,updatedAt:data.updatedAt||null});}catch(e){console.error(e);res.status(503).json({error:'Could not load the current Premier League ratings.'});}});
app.get('/api/players',async(req,res)=>{try{const force=String(req.query.refresh||'')==='1'||String(req.query.refresh||'').toLowerCase()==='true';const data=await readRatings(force);res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.set('Pragma','no-cache');res.set('Expires','0');res.json(data);}catch(e){console.error(e);res.status(503).json({error:'Could not load the current Premier League ratings.'});}});
app.get('/api/search',async(req,res)=>{try{const term=String(req.query.term||'').trim().toLowerCase();if(term.length<2)return res.json({suggestions:[]});const data=await readRatings(false);res.json({suggestions:data.players.filter(p=>p.name.toLowerCase().includes(term)||String(p.teamName||'').toLowerCase().includes(term)).slice(0,20).map(p=>({name:p.name,id:p.id}))});}catch(e){res.status(503).json({error:'Could not load the current Premier League ratings.'});}});
app.listen(PORT,()=>console.log(`FotMob Fantasy Draft running on port ${PORT}`));
