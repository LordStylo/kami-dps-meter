// Presence comes from current capture state; repeating does not need a position
// or a new appearance packet. Multiple cubes share one three-second reminder.
export function cubeRepeatDue(state, now, lastSoundAt) {
  return state?.mode==='live'&&state.capture?.state==='capturing'&&
    (state.cubes?.active||[]).some(c=>c.status==='present')&&now-lastSoundAt>=3000;
}
// Presentation only. Proximity never changes the presence alarm or its cadence.
export function cubeProximityPresentation(cube,{healthy=true,lastUpdate=Date.now(),now=Date.now()}={}) {
  const p=cube?.proximity,elapsed=Math.max(0,now-lastUpdate);
  const age=Number.isFinite(p?.at)?now-p.at:Number.isFinite(p?.ageMs)?p.ageMs+elapsed:null;
  if(!healthy||elapsed>=2500||cube?.status!=='present'||!p?.fresh||!Number.isFinite(p.distance)||p.distance<0||age===null||age< -1000||age>3000)
    return {known:false,distance:'',quality:'',trend:'Yakınlık bilinmiyor',direction:'unknown'};
  const labels={approaching:'Yaklaşıyorsun',receding:'Uzaklaşıyorsun',steady:'Belirgin değişim yok'};
  return {known:true,distance:`≈ ${Math.round(p.distance).toLocaleString('tr-TR')} m yatay`,quality:p.quality==='estimated'?'Tahmini':p.quality==='observed'?'Gözlenen':'Deneysel',
    trend:labels[p.trend]||'Ölçüm bekleniyor',direction:labels[p.trend]?p.trend:'unknown'};
}
const el=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// No audio is attempted before the user's click unlocks the AudioContext.
export function createCubeAlerts(){
  let context,enabled=false,epoch=null,lastSequence=null,lastDetection=0,lastState=null,connected=false,lastUpdate=0,lastSoundAt=0;
  const updateSound=()=>{
    const ready=enabled&&context?.state==='running';
    el('cube-sound-status').textContent=ready?'Ses açık · bu sekmeyi açık tut.':enabled?'Ses durakladı · Sesi dene düğmesine bas.':'Ses kapalı · etkinleştirmek için düğmeye bas.';
    el('cube-sound-test').textContent=ready?'Sesi dene':'Sesi aç ve dene';
    el('cube-sound-mute').disabled=!enabled;
  };
  function tone(){
    if(!enabled||context?.state!=='running'){updateSound();return false;}
    const volume=Number(el('cube-volume').value)/100;
    [659.25,880,1108.73].forEach((frequency,i)=>{
      const start=context.currentTime+i*.19,osc=context.createOscillator(),gain=context.createGain();
      osc.type='sine';osc.frequency.value=frequency;
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.3*volume,start+.015);
      gain.gain.exponentialRampToValueAtTime(.0001,start+.25);
      osc.connect(gain);gain.connect(context.destination);osc.start(start);osc.stop(start+.27);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
    });
    lastSoundAt=Date.now();
    return true;
  }
  el('cube-sound-test').onclick=async()=>{
    el('cube-sound-test').disabled=true;
    try{
      if(!context||context.state==='closed'){
        context=new AudioContext();context.onstatechange=updateSound;
      }
      let timeout;
      try{await Promise.race([context.resume(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Tarayıcı ses iznini açamadı; tekrar dene.')),2000);})]);}
      finally{clearTimeout(timeout);}
      if(context.state!=='running')throw Error('Tarayıcı sesi henüz açmadı; tekrar dene.');
      enabled=true;updateSound();tone();
    }catch(error){enabled=false;updateSound();el('cube-sound-status').textContent=error.message;}
    finally{el('cube-sound-test').disabled=false;}
  };
  el('cube-sound-mute').onclick=()=>{enabled=false;updateSound();};
  function render(state,isConnected=true){
    lastState=state;connected=isConnected;lastUpdate=Date.now();
    const cubes=state.cubes||{epoch:null,total:0,active:[],recent:[]};
    const live=connected&&state.mode==='live'&&state.capture.state==='capturing';
    const active=live?cubes.active:[],activeIds=new Set(active.map(c=>c.id));
    const history=(cubes.recent||[]).filter(c=>!activeIds.has(c.id)).slice(0,8);
    el('cube-alert-panel').classList.toggle('has-cubes',active.length>0);
    el('cube-alert-count').textContent=live?String(active.length):'—';
    el('cube-alert-state').textContent=!connected?'Uygulama bağlantısı kesildi':['stalled','delayed','error'].includes(state.capture.state)?state.capture.error||'Paket okuma sorunu':!live?'Canlı yakalama bekleniyor':active.length?'Cube görünme bildirimi alındı':'Yeni cube bildirimi bekleniyor';
    el('cube-detections').innerHTML=[...active,...history].map(c=>{
      const present=live&&c.status==='present';
      const label=present?'Algılandı':c.status==='disappeared'?'Kayboldu':'Durumu belirsiz';
      const detected=new Date(c.detectedAt).toLocaleTimeString('tr-TR');
      return `<li class="${present?'cube-present':''}"><span class="cube-symbol" aria-hidden="true">◇</span><span class="cube-detection-identity"><b>Hidden cube adayı #${escape(c.sequence)}</b><small>İlk bildirim ${escape(detected)}${c.endedAt?' · Son durum '+escape(new Date(c.endedAt).toLocaleTimeString('tr-TR')):''}</small><span class="cube-proximity-hint" data-cube-proximity="${escape(c.id??c.sequence)}" aria-label="Cube yakınlığı"></span></span><strong>${label}</strong></li>`;
    }).join('')||'<li class="cube-list-empty">Henüz cube bildirimi alınmadı. Ölçer açıkken gezinmeye devam et.</li>';
    const total=cubes.total||0;
    // Initial page load establishes a baseline. After the user enables sound,
    // still-present cubes get reminders; historical detections never do.
    const first=lastSequence===null;
    if(epoch!==cubes.epoch){epoch=cubes.epoch;lastSequence=first?total:0;}
    if(lastSequence===null)lastSequence=total;
    const now=Date.now();
    const fresh=active.some(c=>c.sequence>lastSequence&&now-c.detectedAt>=-5000&&now-c.detectedAt<15000);
    if(!first&&fresh&&now-lastDetection>=1800&&tone())lastDetection=now;
    lastSequence=Math.max(lastSequence,total);updateSound();
    updateReminder();
  }
  function updateProximity(now=Date.now()) {
    const healthy=connected&&lastState?.mode==='live'&&lastState.capture?.state==='capturing';
    const cubes=[...(lastState?.cubes?.active||[]),...(lastState?.cubes?.recent||[])];
    for(const node of el('cube-detections').querySelectorAll('[data-cube-proximity]')){
      const cube=cubes.find(c=>String(c.id??c.sequence)===node.dataset.cubeProximity);
      const p=cubeProximityPresentation(cube,{healthy,lastUpdate,now});
      node.dataset.direction=p.direction;
      const text=p.known?`${p.distance} · ${p.quality} · ${p.trend}`:p.trend;
      if(node.textContent!==text)node.textContent=text;
    }
  }
  function updateReminder(){
    const now=Date.now();
    updateProximity(now);
    if(!connected||now-lastUpdate>=2500||!enabled||context?.state!=='running')return;
    if(cubeRepeatDue(lastState,now,lastSoundAt))tone();
  }
  const reminderTimer=setInterval(updateReminder,150);
  window.addEventListener('pagehide',()=>clearInterval(reminderTimer),{once:true});
  updateSound();
  return {render,disconnected:()=>{if(lastState)render(lastState,false);}};
}
