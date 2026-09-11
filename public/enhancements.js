(()=>{
  const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const keepers=new Set(['konstantinos tzolakis','emiliano martinez','lukas hornicek','jordan pickford','caoimhin kelleher','djordje petrovic','james trafford','kjell scherpen','david raya','gianluigi donnarumma','marco bizot','robin roefs','senne lammens','zion suzuki','matz sels','bernd leno','carl rushworth','alisson becker','antonin kinsky','dean henderson','robert sanchez','bart verbruggen']);
  const injuryStatus={'jack hinshelwood':'out','mats wieffer':'out','mathias jensen':'out','georginio rutter':'back','nathan collins':'doubt','moises caicedo':'doubt','edward nketiah':'doubt','james garner':'out','hidemasa morita':'out','marcus rashford':'back','william osula':'out','amar dedic':'doubt','ibrahim sangare':'back','james maddison':'back','cristhian mosquera':'doubt','matty cash':'doubt','cody gakpo':'doubt','daniel james':'back','william saliba':'out','jurrien timber':'doubt','gabriel jesus':'out','gabriel martinelli':'out','reiss nelson':'out','ethan nwaneri':'out','fabio vieira':'out','amadau onana':'out','amadou onana':'out','johan manzambi':'doubt','brian madjo':'out','leon goretzka':'out','eli kroupi':'out','amine adli':'out','julian araujo':'out','joe gomez':'doubt','cheick doucoure':'back','kaoru mitoma':'out','evan ferguson':'out','xavi simons':'out','dejan kulusevski':'out','matthijs de ligt':'out','amad diallo':'out','manuel ugarte':'out','hugo ekitike':'out','jeremy doku':'out','nico oreilly':'back','carlos baleba':'out'};
  const knownPositions={'william saliba':'CB','jurrien timber':'CB','cristhian mosquera':'CB','alisson becker':'GK','senne lammens':'GK','gabriel magalhaes':'CB','virgil van dijk':'CB','ibrahima konate':'CB','trent alexander arnold':'RB','andy robertson':'LB','declan rice':'CM','martin odegaard':'CM','bukayo saka':'RW','gabriel martinelli':'LW','kai havertz':'ST','gabriel jesus':'ST','mohamed salah':'RW','florian wirtz':'AM','bruno fernandes':'AM','rasmus hojlund':'ST','mason mount':'CM','cody gakpo':'LW','anthony gordon':'LW','alexander isak':'ST','bruno guimaraes':'CM','sandro tonali':'CM','cole palmer':'AM','nicolas jackson':'ST','enzo fernandez':'CM','moises caicedo':'CM','joao pedro':'ST','liam delap':'ST','ollie watkins':'ST','matheus cunha':'ST','jarrod bowen':'RW','eze':'AM','morgan gibbs white':'AM','antoine semenyo':'RW','yoane wissa':'ST','bryan mbeumo':'RW','dominick szoboszlai':'CM','ethan nwaneri':'AM','fabio vieira':'AM','reiss nelson':'LW','jurrien timber':'CB','gabriel jesus':'ST','amadou onana':'CM','johan manzambi':'CM','leon goretzka':'CM','brian madjo':'ST','eli kroupi':'ST','amine adli':'LW','julian araujo':'RB','joe gomez':'CB','cheick doucoure':'CM','kaoru mitoma':'LW','evan ferguson':'ST','xavi simons':'AM','dejan kulusevski':'RW','matthijs de ligt':'CB','amad diallo':'RW','manuel ugarte':'CM','hugo ekitike':'ST','jeremy doku':'LW','nico oreilly':'CM','carlos baleba':'CM'};

  // Players who are draftable but have no 2026/27 Premier League rating yet.
  // baseRating is their previous-season FotMob rating used only to create a provisional draft value.
  const unrated=[
    ['William Saliba','Arsenal','CB',7.16,'out'],['Jurrien Timber','Arsenal','CB',7.08,'doubt'],['Gabriel Jesus','Arsenal','ST',6.86,'out'],['Gabriel Martinelli','Arsenal','LW',7.04,'out'],['Ethan Nwaneri','Arsenal','AM',6.91,'out'],['Fabio Vieira','Arsenal','AM',6.74,'out'],['Reiss Nelson','Arsenal','LW',6.72,'out'],
    ['Joe Gomez','Liverpool','CB',6.95,'doubt'],['Hugo Ekitike','Liverpool','ST',7.06,'out'],
    ['Jeremy Doku','Manchester City','LW',7.10,'out'],['Carlos Baleba','Manchester United','CM',7.00,'out'],['Amad Diallo','Manchester United','RW',7.01,'out'],['Matthijs de Ligt','Manchester United','CB',6.96,'out'],['Manuel Ugarte','Manchester United','CM',6.86,'out'],
    ['Xavi Simons','Tottenham','AM',7.18,'out'],['Dejan Kulusevski','Tottenham','RW',7.04,'out'],
    ['Kaoru Mitoma','Brighton','LW',7.02,'out'],['Evan Ferguson','Brighton','ST',6.82,'out'],
    ['Amadou Onana','Aston Villa','CM',6.93,'out'],['Leon Goretzka','Aston Villa','CM',6.92,'out'],['Brian Madjo','Aston Villa','ST',6.70,'out'],['Johan Manzambi','Aston Villa','CM',6.70,'doubt'],
    ['Eli Kroupi','Bournemouth','ST',6.78,'out'],['Amine Adli','Bournemouth','LW',6.88,'out'],['Julian Araujo','Bournemouth','RB',6.70,'out'],
    ['Cheick Doucoure','Crystal Palace','CM',6.94,'back'],['Tom Heaton','Manchester United','GK',6.70,'out'],['Jack Butland','Crystal Palace','GK',6.80,'out'],
    ['Marli Salmon','Arsenal','CB',6.50,'out'],['Connor Bradley','Liverpool','RB',6.82,'out'],['Ben Chilwell','Everton','LB',6.80,'out'],['Callum Hudson-Odoi','Nottingham Forest','LW',6.85,'out'],['Joe Willock','Newcastle United','CM',6.83,'out'],['Sven Botman','Newcastle United','CB',6.96,'doubt']
  ];

  const metaCache=new Map();let filter='all';
  function hasState(){try{return Array.isArray(state.players)}catch{return false}}
  function penalty(status,hasCurrentRating){
    if(!hasCurrentRating) return status==='out'?0.65:status==='doubt'?0.82:0.78;
    if(status==='out') return 0.85;
    if(status==='doubt') return 0.95;
    return 1;
  }
  function addUnrated(){
    if(!hasState())return;
    const existing=new Set(state.players.map(p=>norm(p.name)));
    for(const [name,teamName,position,baseRating,status] of unrated){
      const n=norm(name); if(existing.has(n))continue;
      state.players.push({id:'unrated-'+n.replace(/ /g,'-'),name,teamName,position,baseRating,rating:baseRating,injuryStatus:status,noCurrentRating:true});
    }
  }
  function decorate(){
    if(!hasState()||!state.players.length)return;
    addUnrated();
    state.players.forEach(p=>{
      const n=norm(p.name);
      if(keepers.has(n))p.position='GK';
      if(knownPositions[n])p.position=knownPositions[n];
      if(injuryStatus[n])p.injuryStatus=injuryStatus[n];
      if(!Number.isFinite(Number(p.baseRating)))p.baseRating=Number(p.rating);
      const hasCurrent=Number.isFinite(Number(p.baseRating))&&!p.noCurrentRating;
      if(hasCurrent)p.rating=Number(p.baseRating)*penalty(p.injuryStatus,true);
      else if(Number.isFinite(Number(p.baseRating)))p.rating=Number(p.baseRating)*penalty(p.injuryStatus,false);
    });
  }
  function ensureControls(){
    const box=document.querySelector('.searchbox');if(!box||document.getElementById('player-filter'))return;
    const wrap=document.createElement('div');wrap.id='player-filter';wrap.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 12px';
    [['all','All'],['GK','Keepers'],['def','Defenders'],['mid','Midfielders'],['att','Attackers'],['injured','🚑 Injured'],['unrated','🆕 No Rating']].forEach(([v,t])=>{const b=document.createElement('button');b.type='button';b.textContent=t;b.dataset.filter=v;b.className='btn';b.style.cssText='padding:6px 9px;font-size:11px';b.onclick=()=>{filter=v;document.querySelectorAll('#player-filter button').forEach(x=>x.classList.toggle('primary',x===b));renderPlayersEnhanced()};wrap.appendChild(b)});
    box.parentNode.insertBefore(wrap,box);wrap.firstChild.classList.add('primary');
  }
  function matchesFilter(p){
    if(filter==='all')return true;
    const pos=String(p.position||'').toLowerCase();
    if(filter==='GK')return pos==='gk'||pos.includes('keeper');
    if(filter==='injured')return p.injuryStatus==='out'||p.injuryStatus==='doubt';
    if(filter==='unrated')return !!p.noCurrentRating;
    if(filter==='def')return /def|back|center|centre|full/.test(pos);
    if(filter==='mid')return /mid|wing|attacking|am/.test(pos)&&!/(striker|forward)/.test(pos);
    if(filter==='att')return /striker|forward|wing|attacking|am/.test(pos)&&pos!=='gk';
    return true;
  }
  function photoMarkup(p){
    const fallback=(p.name||'?').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
    return p.photo?`<img class="avatar" src="${p.photo}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"/><span class="avatar-fallback">${fallback}</span>`:`<span class="avatar-fallback">${fallback}</span>`;
  }
  function ratingMarkup(p){
    const draft=Number(p.rating),raw=Number(p.baseRating);
    if(p.noCurrentRating)return `<div><div class="rating good">${draft.toFixed(2)}</div><div class="rating-note">No 26/27 rating</div></div>`;
    if(Number.isFinite(raw)&&draft<raw-0.001)return `<div><div class="rating good">${draft.toFixed(2)}</div><div class="rating-note">FotMob ${raw.toFixed(2)}</div></div>`;
    return `<div class="rating good">${draft.toFixed(2)}</div>`;
  }
  function renderPlayersEnhanced(){
    if(!hasState()||typeof $!=='function')return;
    const q=$('search').value.trim().toLowerCase(),taken=allTaken(),arr=state.players.filter(p=>matchesFilter(p)&&`${p.name} ${p.teamName||''}`.toLowerCase().includes(q));
    $('count').textContent=`${arr.length} shown`;
    $('player-list').innerHTML=arr.slice(0,400).map(p=>{const injury=p.injuryStatus==='out'?'🩹':p.injuryStatus==='doubt'?'⚠️':'';return `<div class="player ${taken.has(key(p))?'used':''}" data-id="${key(p)}">${photoMarkup(p)}<div><div class="pname">${p.name} ${injury}</div><div class="meta">${p.teamName||'Premier League'} · ${p.position||'Player'}${p.noCurrentRating?' · No current rating':''}</div></div>${ratingMarkup(p)}</div>`}).join('')||'<div class="empty">No players match that search.</div>';
    $('player-list').querySelectorAll('.player').forEach(el=>el.onclick=()=>{const p=state.players.find(x=>key(x)===el.dataset.id);if(!p||taken.has(key(p)))return;state.selectedPlayer=p;document.querySelectorAll('.player').forEach(x=>x.style.outline='');el.style.outline='2px solid var(--accent)'});
    lazyPhotos(arr.slice(0,60));
  }
  async function getMeta(p){const n=norm(p.name);if(metaCache.has(n))return metaCache.get(n);const promise=fetch('/api/player-meta?name='+encodeURIComponent(p.name)).then(r=>r.ok?r.json():null).catch(()=>null);metaCache.set(n,promise);return promise}
  function lazyPhotos(players){players.forEach(p=>{if(p.photo||p._photoRequested)return;p._photoRequested=true;getMeta(p).then(m=>{if(m&&m.photo)p.photo=m.photo;if(m&&m.position&&!p.position)p.position=m.position;if(m&&(m.photo||m.position)){renderPlayersEnhanced();try{renderPitch()}catch{}}})})}
  function decorateAndPatch(){
    decorate();
    // The original app uses p.rating everywhere. Keep that value as the adjusted draft score.
    // Preserve the raw FotMob value separately as p.baseRating for display.
    if(typeof $('avg')!=='undefined'){}
  }
  const originalRenderAll=window.renderAll;
  window.renderPlayers=()=>{decorateAndPatch();ensureControls();renderPlayersEnhanced()};
  window.renderAll=()=>{decorateAndPatch();ensureControls();originalRenderAll();renderPlayersEnhanced()};
  const style=document.createElement('style');style.textContent='.avatar-fallback{width:36px;height:36px;border-radius:50%;background:var(--panel2);border:1px solid var(--line);display:grid;place-items:center;font-size:10px;font-weight:900;color:var(--muted)}.pname{display:flex;align-items:center;gap:4px}.rating-note{font-size:9px;color:var(--muted);font-weight:600;margin-top:1px}.slot-btn img{object-fit:cover}';document.head.appendChild(style);
  const boot=setInterval(()=>{if(hasState()&&state.players.length){clearInterval(boot);decorateAndPatch();ensureControls();renderPlayersEnhanced()}},100);setTimeout(()=>clearInterval(boot),15000);
})();
