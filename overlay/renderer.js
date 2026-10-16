const api=window.kamiOverlay,$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=n=>{n=Number(n||0);return n>=1e6?(n/1e6).toLocaleString('tr-TR',{maximumFractionDigits:1})+' M':n>=1000?(n/1000).toLocaleString('tr-TR',{maximumFractionDigits:1})+' K':n.toLocaleString('tr-TR',{maximumFractionDigits:0});};
const pct=n=>Number(n||0).toLocaleString('tr-TR',{maximumFractionDigits:1})+'%';
const duration=n=>`${String(Math.floor((n||0)/60)).padStart(2,'0')}:${String(Math.floor((n||0)%60)).padStart(2,'0')}`;
let view=null,selected=null,lastUpdate=0,audio=null,sound=false,lastSound=0,sequence=null,epoch=null,lastRows='';
const status=s=>({capturing:'Canlı',starting:'Bağlanıyor',stopped:'Durduruldu',paused:'Duraklatıldı','waiting-for-game':'Oyun bekleniyor','waiting-for-connection':'Bağlantı bekleniyor',stalled:'Veri akışı durdu',delayed:'Veri gecikiyor',error:'Veri okuma sorunu',demo:'Örnek savaş',replay:'Kayıt'})[s]||'Bekliyor';
function audioLabel(){const ready=sound&&audio?.state==='running';$('audio-state').textContent=ready?'Ses açık':'Ses kapalı';$('sound').textContent=ready?'Sesi dene':'Sesi aç ve dene';$('mute').disabled=!sound;}
function tone(){if(!sound||audio?.state!=='running')return false;[659.25,880,1108.73].forEach((f,i)=>{const at=audio.currentTime+i*.19,o=audio.createOscillator(),g=audio.createGain();o.frequency.value=f;g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(.135,at+.015);g.gain.exponentialRampToValueAtTime(.0001,at+.25);o.connect(g);g.connect(audio.destination);o.start(at);o.stop(at+.27);o.onended=()=>{o.disconnect();g.disconnect();};});lastSound=Date.now();return true;}
$('sound').onclick=async()=>{try{audio??=new AudioContext();await audio.resume();sound=true;tone();}catch{sound=false;}audioLabel();};
$('mute').onclick=()=>{sound=false;audioLabel();};
$('collapse').onclick=()=>api.collapse();$('dashboard').onclick=()=>api.dashboard();
$('bar').addEventListener('pointerdown',event=>{if(event.button===0&&!event.target.closest('button')&&view?.interactive){event.preventDefault();api.drag();}});
$('back').onclick=()=>{selected=null;render(view);};
$('rows').onclick=event=>{const row=event.target.closest('[data-player]');if(row){selected=Number(row.dataset.player);render(view);}};
$('rows').addEventListener('error',event=>{if(event.target.tagName==='IMG')event.target.style.visibility='hidden';},true);
function render(data){
 if(!data)return;view=data;lastUpdate=Date.now();const s=data.state,connected=data.connected;
 document.body.classList.toggle('interactive',data.interactive);document.body.classList.toggle('collapsed',data.panel==='dps'&&data.collapsed);$('interaction').textContent=data.desktopEdit?'DÜZENLE':data.interactive?'TAŞI':'ALT';
 $('title').textContent=data.panel==='cube'?'KAMI · KÜP':'KAMI · DPS';
 $('collapse').hidden=data.panel!=='dps';$('collapse').textContent=data.collapsed?'+':'−';$('collapse').title=data.collapsed?'Genişlet':'Küçült';$('collapse').setAttribute('aria-label',$('collapse').title);
 $('dps-body').hidden=data.panel!=='dps'||data.collapsed;$('cube-body').hidden=data.panel!=='cube';
 if(data.panel==='cube'){
  const healthy=connected&&s?.mode==='live'&&s.capture?.state==='capturing';const active=healthy?(s.cubes?.active||[]).filter(c=>c.status==='present'):[];
  $('cube-status').textContent='Küp bildirimi: '+(!connected?'Bağlantı yok':healthy?'Aktif':'Bekliyor');$('cube-count').textContent=active.length;
  $('cube-led').className=active.length?'found':healthy?'active':'';document.body.classList.toggle('found',!!active.length);
  $('cube-detail').textContent=active.length?`Hidden cube #${active[0].sequence} · ${active.length} aday algılandı`:healthy?'Yeni küp bildirimi bekleniyor.':connected?status(s?.capture?.state):'DPS Lab bağlantısı bekleniyor.';
  const first=sequence===null;if(epoch!==s?.cubes?.epoch){epoch=s?.cubes?.epoch;sequence=first?s?.cubes?.total||0:0;}
  if(!first&&active.some(c=>c.sequence>sequence&&Date.now()-c.detectedAt>=-5000&&Date.now()-c.detectedAt<15000)&&Date.now()-lastSound>=1800)tone();
  sequence=Math.max(sequence||0,s?.cubes?.total||0);audioLabel();return;
 }
 const c=s?.current?.damage?s.current:s?.last||s?.current;
 $('total-dps').textContent=c?.damage?compact(c.dps):'—';$('duration').textContent=duration(c?.seconds);$('damage').textContent=compact(c?.damage)+' hasar';
 $('fight-label').textContent=s?.mode==='demo'?'ÖRNEK · PARTİ DPS':s?.mode==='replay'?'KAYIT · PARTİ DPS':s?.last&&!s?.current?.damage?'SON SAVAŞ · DPS':'PARTİ DPS';
 $('dps-status').textContent=connected?status(s?.capture?.state)+' · Alt ile sürükle':'Bağlantı kesildi';
 const players=c?.players||[],p=players.find(x=>x.entity===selected);if(!p)selected=null;
 $('back').hidden=!p;$('list-title').textContent=p?p.name+' · Yetenekler':'OYUNCULAR';
 let rows=p?p.skills.map(sk=>{const icon=/^\/icons\/skills\/[A-Za-z0-9_]+\.webp$/.test(sk.icon||'')?'../public'+sk.icon:null;return `<div class="row" style="--share:${Math.min(100,Math.max(0,sk.share||0))}%">${icon?`<img class="icon" src="${esc(icon)}" alt="">`:'<span class="rank">◇</span>'}<span class="name">${esc(sk.name)}</span><b>${compact(sk.dps)}</b><span class="share">${pct(sk.share)}</span></div>`;}).join(''):players.map((p,i)=>`<button class="row" data-player="${p.entity}" style="--share:${Math.min(100,Math.max(0,p.share||0))}%"><span class="rank">${i+1}</span><span class="name">${esc(p.name)}${p.self?'<small>SEN</small>':''}</span><b>${compact(p.dps)}</b><span class="share">${pct(p.share)}</span></button>`).join('');
 if(!players.length)rows='<div class="empty">Savaş verisi bekleniyor.<br>Oyuna girip bir hedefe vur.</div>';
 // Preserve nodes and scroll position while a repeated snapshot is unchanged.
 if(rows!==lastRows){$('rows').innerHTML=rows;lastRows=rows;}
}
api.onUpdate(render);api.init().then(render);
setInterval(()=>{if(view?.panel!=='cube'||!view.connected||Date.now()-lastUpdate>2500||Date.now()-lastSound<3000)return;const s=view.state;if(s?.mode==='live'&&s.capture?.state==='capturing'&&s.cubes?.active?.some(c=>c.status==='present'))tone();},150);
