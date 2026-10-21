import {combatView} from './combat-view.mjs';
import {cubeProximityPresentation} from '../public/cube-alerts.js';
import {createCubeMap} from '../public/cube-map.js';
import {createPetsMap} from '../public/pets-map.js';
import {petHeaderProgress} from './pet-progress.mjs';
const api=window.kamiOverlay,$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=n=>{n=Number(n||0);return n>=1e6?(n/1e6).toLocaleString('tr-TR',{maximumFractionDigits:1})+' M':n>=1000?(n/1000).toLocaleString('tr-TR',{maximumFractionDigits:1})+' K':n.toLocaleString('tr-TR',{maximumFractionDigits:0});};
const pct=n=>Number(n||0).toLocaleString('tr-TR',{maximumFractionDigits:1})+'%';
const duration=n=>`${String(Math.floor((n||0)/60)).padStart(2,'0')}:${String(Math.floor((n||0)%60)).padStart(2,'0')}`;
let view=null,selected=null,lastUpdate=0,audio=null,lastSound=0,lastAlert=0,lastRows='';
let cubeMap=null,mapCatalogKey='',petMap=null,petMapCatalogKey='',petMapRevision=null;
const activeTones=new Set();
function silence(){for(const oscillator of activeTones){try{oscillator.stop();}catch{}}activeTones.clear();}
const status=s=>({capturing:'Canlı',starting:'Bağlanıyor',stopped:'Durduruldu',paused:'Duraklatıldı','waiting-for-game':'Oyun bekleniyor','waiting-for-connection':'Bağlantı bekleniyor',stalled:'Veri akışı durdu',delayed:'Veri gecikiyor',error:'Veri okuma sorunu',demo:'Örnek savaş',replay:'Kayıt'})[s]||'Bekliyor';
function audioLabel(){const alarm=view?.cubeAlarm||{},ready=audio?.state==='running';$('audio-state').textContent=alarm.muted?'Sessiz':ready?'Ses hazır':'Ses hazır değil';$('mute').setAttribute('aria-pressed',String(!!alarm.muted));$('mute').title=alarm.muted?'Alarm sesini yeniden aç':'Alarm sesini kapat';$('cube-start').disabled=!!alarm.running;$('cube-stop').disabled=!alarm.running;}
function updateCubeProximity(){
 if(view?.panel!=='cube')return;
 const s=view.state,healthy=view.connected&&s?.mode==='live'&&s.capture?.state==='capturing';
 const cube=healthy&&view.cubeAlarm?.running?(s.cubes?.active||[]).filter(c=>c.status==='present').slice().sort((a,b)=>(a.sequence??Infinity)-(b.sequence??Infinity))[0]:null;
 const p=cubeProximityPresentation(cube,{healthy,lastUpdate});
 $('cube-proximity').dataset.direction=p.direction;$('cube-proximity').classList.toggle('unknown',!p.known);
 $('cube-distance').textContent=p.distance;$('cube-quality').textContent=p.quality;$('cube-trend').textContent=p.trend;
}
async function prepareAudio(){try{audio??=new AudioContext();await audio.resume();return audio.state==='running';}catch{return false;}}
function tone(test=false){if((!test&&(!view?.cubeAlarm?.running||view.cubeAlarm.muted))||audio?.state!=='running')return false;[659.25,880,1108.73].forEach((f,i)=>{const at=audio.currentTime+i*.19,o=audio.createOscillator(),g=audio.createGain();o.frequency.value=f;g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(.135,at+.015);g.gain.exponentialRampToValueAtTime(.0001,at+.25);o.connect(g);g.connect(audio.destination);activeTones.add(o);o.start(at);o.stop(at+.27);o.onended=()=>{activeTones.delete(o);o.disconnect();g.disconnect();};});lastSound=Date.now();return true;}
$('sound').onclick=async()=>{if(await prepareAudio())tone(true);audioLabel();};
$('cube-start').onclick=async()=>{await prepareAudio();api.cubeAction('start');audioLabel();};
$('cube-stop').onclick=()=>api.cubeAction('stop');
$('cube-hide').onclick=()=>api.cubeAction('hide');
$('mute').onclick=async()=>{if(view?.cubeAlarm?.muted)await prepareAudio();api.cubeAction('mute');};
$('collapse').onclick=()=>api.collapse();$('dashboard').onclick=()=>api.dashboard();
$('details').onclick=$('app-details').onclick=()=>api.dashboard();
$('settings').onclick=$('settings-close').onclick=()=>api.settings();
$('launcher').onclick=$('controls-close').onclick=()=>api.controls();
$('launcher').addEventListener('pointerdown',event=>{if(event.button===0&&view?.interactive){event.preventDefault();api.drag();}});
$('toggle-dps').onclick=()=>api.togglePanel('dps');$('toggle-cube').onclick=()=>api.togglePanel('cube');$('toggle-cube-map').onclick=()=>api.togglePanel('cube-map');
$('cube-map-hide').onclick=()=>api.togglePanel('cube-map');
$('toggle-pet-map').onclick=$('pet-map-hide').onclick=()=>api.togglePanel('pet-map');
$('show-dps').onclick=()=>api.showDps();$('auto-hide').onchange=event=>api.autoHide(event.target.checked);
$('mode-party').onclick=()=>api.mode('party');$('mode-individual').onclick=()=>api.mode('individual');
$('metric-damage').onclick=()=>api.metric('damage');$('metric-healing').onclick=()=>api.metric('healing');
function showTransparency(value){document.documentElement.style.setProperty('--panel-opacity',(100-value)/100);$('transparency').value=value;$('transparency-value').textContent='%'+value;$('transparency').setAttribute('aria-valuetext','%'+value+' şeffaf');}
$('transparency').oninput=event=>{const value=Number(event.target.value);showTransparency(value);api.transparency(value);};
$('appearance-reset').onclick=()=>{showTransparency(8);api.transparency(8);};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(view?.settingsOpen){event.preventDefault();api.settings();}else if(view?.controlsOpen){event.preventDefault();api.controls();}}});
$('bar').addEventListener('pointerdown',event=>{if(event.button===0&&!event.target.closest('button')&&view?.interactive){event.preventDefault();api.drag();}});
$('resize-grip').addEventListener('pointerdown',event=>{if(event.button===0&&view?.interactive){event.preventDefault();api.resize();}});
$('back').onclick=()=>{selected=null;render(view);};
$('rows').onclick=event=>{const row=event.target.closest('[data-player]');if(row){selected=Number(row.dataset.player);render(view);}};
$('rows').addEventListener('error',event=>{if(event.target.tagName==='IMG')event.target.style.visibility='hidden';},true);
function render(data){
 if(!data)return;if(view?.dpsMode!==data.dpsMode||view?.metric!==data.metric)selected=null;
 if(view?.cubeAlarm?.running&&!data.cubeAlarm?.running||!view?.cubeAlarm?.muted&&data.cubeAlarm?.muted)silence();
 view=data;lastUpdate=Date.now();const s=data.state,connected=data.connected;
 document.body.classList.toggle('interactive',data.interactive);document.body.classList.toggle('dps-panel',data.panel==='dps');document.body.classList.toggle('collapsed',data.panel==='dps'&&data.collapsed&&!data.settingsOpen);$('interaction').textContent=data.desktopEdit?'DÜZENLE':data.interactive?'TAŞI':'ALT';
 document.body.classList.toggle('controls-panel',data.panel==='controls');document.body.classList.toggle('individual',data.dpsMode==='individual');
 document.body.classList.toggle('cube-panel',data.panel==='cube');
 document.body.classList.toggle('cube-map-panel',data.panel==='cube-map');
 document.body.classList.toggle('pet-map-panel',data.panel==='pet-map');
 $('title').textContent=data.panel==='pet-map'?'PET · '+(data.petOverlay?.pet?.name||'HARİTA'):{cube:'KAMI · KÜP',dps:'KAMI · DPS',controls:'ARAYÜZ','cube-map':'KAMI · KÜP HARİTASI'}[data.panel];
 $('title').title=$('title').textContent;
 $('launcher').hidden=data.panel!=='controls'||data.controlsOpen;$('bar').hidden=data.panel==='controls'&&!data.controlsOpen;$('controls-body').hidden=data.panel!=='controls'||!data.controlsOpen;
 const collapsed=data.collapsed&&!data.settingsOpen;
 $('collapse').hidden=data.panel!=='dps';$('collapse').textContent=collapsed?'+':'−';$('collapse').title=collapsed?'Genişlet':'Küçült';$('collapse').setAttribute('aria-label',$('collapse').title);
  $('settings').hidden=data.panel!=='dps';$('settings').setAttribute('aria-expanded',String(!!data.settingsOpen));$('settings-body').hidden=data.panel!=='dps'||!data.settingsOpen;showTransparency(data.transparency??8);
  $('details').hidden=data.panel!=='dps';
 $('auto-hide').checked=data.autoHide!==false;
 $('dps-body').hidden=data.panel!=='dps'||data.collapsed||data.settingsOpen;$('cube-body').hidden=data.panel!=='cube';
 $('cube-map-body').hidden=data.panel!=='cube-map';$('cube-map-hide').hidden=data.panel!=='cube-map';
 $('pet-map-body').hidden=data.panel!=='pet-map';$('pet-map-hide').hidden=data.panel!=='pet-map';
 $('pet-map-progress').hidden=data.panel!=='pet-map'||!data.petOverlay?.pet;
 $('resize-grip').hidden=data.panel!=='dps'||data.collapsed||data.settingsOpen;
 if(data.panel==='controls'){
  for(const panel of ['dps','cube','cube-map','pet-map']){const enabled=['cube-map','pet-map'].includes(panel)?data.panels?.[panel]===true:data.panels?.[panel]!==false,button=$('toggle-'+panel);button.setAttribute('aria-checked',String(enabled));button.querySelector('.switch-state').textContent=panel==='pet-map'&&!data.petMapSelection?'Pet seç':!enabled?'Gizli':panel==='dps'&&data.manualDpsReveal?'Elle açık':panel==='dps'&&data.autoHide!==false&&!data.desktopEdit&&s?.mode==='live'&&s.combat?.active===false?'Savaş bekliyor':'Açık';if(panel==='pet-map'){button.disabled=!data.petMapSelection;button.title=data.petMapSelection?data.petMapSelection.name:'Önce Petler menüsünden oyun üstü haritayı aç.';}}
  $('show-dps').textContent=data.manualDpsReveal?'Otomatik gizlemeye dön':'DPS’yi göster';$('show-dps').setAttribute('aria-pressed',String(!!data.manualDpsReveal));
  return;
 }
 if(data.panel==='cube-map'){
  if(!cubeMap)cubeMap=createCubeMap($('cube-map-body'),{catalog:data.mapCatalog||{version:1,maps:[]},imageURL:image=>'../public'+image,lockedFollow:true});
  const key=JSON.stringify(data.mapCatalog||null);if(key!==mapCatalogKey){mapCatalogKey=key;if(data.mapCatalog)cubeMap.setCatalog(data.mapCatalog);}
  if(s)cubeMap.update(s);if(!connected)cubeMap.disconnected();return;
 }
 if(data.panel==='pet-map'){
  const selection=data.petOverlay||{revision:0,pet:null,spawns:[],maps:[]},catalog={version:1,maps:selection.maps||[]};
  const progress=petHeaderProgress(selection.pet,s?.pets?.collection),chip=$('pet-map-progress');chip.textContent=progress.text;chip.dataset.state=progress.state;chip.title=progress.title;chip.setAttribute('aria-label',progress.title);
  if(!petMap)petMap=createPetsMap($('pet-map-body'),{catalog,imageURL:image=>'../public'+image,lockedFollow:true});
  const key=JSON.stringify(catalog);if(key!==petMapCatalogKey){petMapCatalogKey=key;petMap.setCatalog(catalog);}
  if(s)petMap.update(s);
  if(petMapRevision!==selection.revision){petMapRevision=selection.revision;petMap.select(selection.pet,{spawns:selection.spawns||[]},{mapId:selection.preferredMapId});}
  if(!connected)petMap.disconnected();return;
 }
 if(data.panel==='cube'){
  const alarm=data.cubeAlarm||{},healthy=connected&&s?.mode==='live'&&s.capture?.state==='capturing';const active=healthy&&alarm.running?(s.cubes?.active||[]).filter(c=>c.status==='present').slice().sort((a,b)=>(a.sequence??Infinity)-(b.sequence??Infinity)):[];
  $('cube-status').textContent='Küp alarmı: '+(!alarm.running?'Kapalı':!connected?'Bağlantı yok':active.length?'Küp bulundu':healthy?'Aranıyor':'Bekliyor');$('cube-count').textContent=active.length;
  $('cube-led').className=active.length?'found':healthy&&alarm.running?'active':'';document.body.classList.toggle('found',!!active.length);
  $('cube-detail').textContent=!alarm.running?'Başlat ile alarmı etkinleştir.':active.length?`Hidden cube #${active[0].sequence} algılandı.`:healthy?'Yeni küp bildirimi bekleniyor.':connected?status(s?.capture?.state):'DPS Lab bağlantısı bekleniyor.';
  if((alarm.alertVersion||0)>lastAlert&&active.length&&Date.now()-lastSound>=1800)tone();
  lastAlert=alarm.alertVersion||0;audioLabel();updateCubeProximity();return;
 }
 const combat=combatView(s,data.dpsMode,selected,data.metric),{players,player:p,individual,healing}=combat;
 const rateLabel=healing?'HPS':'DPS',amountLabel=healing?'iyileştirme':'hasar';
 $('metric-damage').setAttribute('aria-pressed',String(!healing));$('metric-healing').setAttribute('aria-pressed',String(healing));
 $('mode-party').setAttribute('aria-pressed',String(!individual));$('mode-individual').setAttribute('aria-pressed',String(individual));
 $('total-dps').textContent=combat.amount?compact(combat.rate):'—';$('duration').textContent=duration(combat.seconds);$('damage').textContent=compact(combat.amount)+' '+amountLabel;
 const prefix=s?.mode==='demo'?'ÖRNEK · ':s?.mode==='replay'?'KAYIT · ':combat.previous?'SON SAVAŞ · ':'';
 $('fight-label').textContent=prefix+(individual?'BENİM ':'PARTİ ')+rateLabel;
 $('dps-status').textContent=connected?healing?'Tüm karşılaşma · Alt ile sürükle':status(s?.capture?.state)+' · Alt ile sürükle':'Bağlantı kesildi';
 if(!p&&!individual)selected=null;
 $('back').hidden=individual||!p;$('list-title').textContent=p?p.name+' · Yetenekler':individual?'YETENEKLERİM':'OYUNCULAR';$('columns').textContent=rateLabel+(individual?(healing?' · TOPLAM · PAY':' · HASAR · PAY'):' · PAY');
 let rows=p?(p.skills||[]).map(sk=>{const icon=/^\/icons\/skills\/[A-Za-z0-9_]+\.webp$/.test(sk.icon||'')?'../public'+sk.icon:null;return `<div class="row" style="--share:${Math.min(100,Math.max(0,sk.share||0))}%">${icon?`<img class="icon" src="${esc(icon)}" alt="">`:'<span class="rank">◇</span>'}<span class="name" title="${esc(sk.name)}">${esc(sk.name)}</span><b>${compact(healing?sk.hps:sk.dps)}</b>${individual?`<span class="skill-damage" title="Toplam ${amountLabel}">${compact(healing?sk.healing:sk.damage)}</span>`:''}<span class="share">${pct(sk.share)}</span></div>`;}).join(''):individual?'':players.map((p,i)=>`<button class="row" data-player="${p.entity}" style="--share:${Math.min(100,Math.max(0,p.share||0))}%"><span class="rank">${i+1}</span><span class="name">${esc(p.name)}${p.self?'<small>SEN</small>':''}</span><b>${compact(healing?p.hps:p.dps)}</b><span class="share">${pct(p.share)}</span></button>`).join('');
 if(individual&&!p)rows=`<div class="empty">Kendi karakterinin ${healing?'iyileştirmesi':'hasarı'} bekleniyor.<br>${healing?'Savaş sırasında iyileştirme yap.':'Oyuna girip bir hedefe vur.'}</div>`;
 else if(!players.length)rows=`<div class="empty">${healing?'İyileştirme verisi bekleniyor.<br>Savaş sırasında iyileştirme yap.':'Savaş verisi bekleniyor.<br>Oyuna girip bir hedefe vur.'}</div>`;
 // Preserve nodes and scroll position while a repeated snapshot is unchanged.
 if(rows!==lastRows){$('rows').innerHTML=rows;lastRows=rows;}
}
api.onUpdate(render);api.init().then(render);
setInterval(()=>{updateCubeProximity();if(view?.panel!=='cube'||!view.connected||Date.now()-lastUpdate>2500||Date.now()-lastSound<3000)return;const s=view.state;if(s?.mode==='live'&&s.capture?.state==='capturing'&&s.cubes?.active?.some(c=>c.status==='present'))tone();},150);
