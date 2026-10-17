import {createCubeAlerts} from './cube-alerts.js';
const cubeAlerts=createCubeAlerts();
const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString('tr-TR',{maximumFractionDigits:0});
const compact=n=>Number(n||0)>=1e6?(n/1e6).toLocaleString('tr-TR',{maximumFractionDigits:2})+' M':Number(n||0)>=1000?(n/1000).toLocaleString('tr-TR',{maximumFractionDigits:1})+' K':fmt(n);
const percent=n=>Number(n||0).toLocaleString('tr-TR',{maximumFractionDigits:1})+'%';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=s=>`${String(Math.floor((s||0)/60)).padStart(2,'0')}:${String(Math.floor((s||0)%60)).padStart(2,'0')}`;
let state,selected=null,targetsKey='',toastTimer,metric='damage';
const failedSkillIcons=new Set();
$('skills').addEventListener('error',event=>{if(event.target.tagName==='IMG'){failedSkillIcons.add(event.target.getAttribute('src'));event.target.remove();}},true);
const colors=['#a9eccb','#9dbfee','#d9ac81','#c5a5e4','#e6aeae','#99d4d6'];
async function action(data){try{const r=await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error);render(result);}catch(e){$('toast').textContent=e.message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000);}}
$('start').onclick=()=>action({action:'live'});$('stop').onclick=()=>action({action:'stop'});$('demo').onclick=()=>action({action:'demo'});$('reset').onclick=()=>action({action:'reset'});
for(const name of ['arm','found','opened','stop'])$('cube-'+name).onclick=()=>action({action:'cube-'+name});
document.querySelectorAll('[data-cube-phase]').forEach(b=>b.onclick=()=>action({action:'cube-mark',phase:b.dataset.cubePhase}));
function renderCube(s){
  const r=s.research||{},running=r.armed||r.active;
  $('cube-badge').textContent=r.active?'KAYDEDİLİYOR':r.armed?'ARAMA AÇIK':r.id?'KAYIT BİTTİ':'HAZIRLIK';
  $('cube-arm').disabled=!!running;
  $('cube-found').disabled=!running;$('cube-opened').disabled=!running;$('cube-stop').disabled=!running;
  for(const id of ['demo','reset','replay'])$(id).disabled=!!running||(id==='replay'&&!$('recordings').value);
  document.querySelectorAll('[data-cube-phase]').forEach(b=>b.disabled=!r.active);
  const remaining=r.autoStopAt?Math.max(0,Math.ceil((r.autoStopAt-Date.now())/1000)):null;
  $('cube-status').textContent=r.active?`${fmt(r.messages)} mesaj kaydedildi · ${remaining!==null?remaining+' sn sonra otomatik tamamlanacak':'Cube’u aldığında Açtım işaretini kullan.'}`:
    r.armed?`Bellekte ${Math.floor((r.bufferMs||0)/1000)} sn · ${fmt(r.bufferMessages)} mesaj · ${r.hotkeys?.found&&r.hotkeys?.opened?'Oyun içi kısayollar hazır.':'Kısayol durumu kontrol ediliyor.'}`:
    r.id?`Kayıt bitti · ${fmt(r.messages)} mesaj · captures/cube-research/${r.id}.ndjson`:'Arama kapalı.';
  const warnings=[r.error,r.commandError,r.hotkeys?.error,r.bufferClipped?'Yoğun trafik nedeniyle önceki 60 saniyenin tamamı bellekte tutulamadı.':null,
    r.armed&&s.capture.state!=='capturing'?'Oyun bağlantısı bekleniyor; henüz test verisi gelmeyebilir.':null,
    r.armed&&!r.bufferMessages?'Bellekte henüz çözümlenmiş oyun mesajı yok; hareket ederek veri sayacını kontrol et.':null,
    r.id&&!running&&!r.messages?'Bu kayıtta oyun mesajı yok.':null,
    ['size-limit','time-limit'].includes(r.reason)?'Kayıt boyut veya süre sınırında durdu.':null].filter(Boolean);
  $('cube-warning').hidden=!warnings.length;$('cube-warning').textContent=warnings.join(' ');
  $('cube-markers').textContent=(r.markers||[]).map(m=>new Date(m.at).toLocaleTimeString('tr-TR')+' '+m.label).join(' · ');
}
document.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>action({action:'filter',scope:b.dataset.scope,target:state?.target??null}));
document.querySelectorAll('[data-metric]').forEach(b=>b.onclick=()=>{metric=b.dataset.metric;if(state)render(state);});
$('target').onchange=()=>action({action:'filter',scope:state.scope,target:$('target').value===''?null:Number($('target').value)});
$('replay').onclick=async()=>{const id=$('recordings').value;if(!id)return;$('replay').disabled=true;try{await action({action:'replay',id});}finally{$('replay').disabled=false;}};
const statusLabels={'starting':'Yakalama hazırlanıyor','waiting-for-game':'Oyun bekleniyor','waiting-for-connection':'Bağlantı bekleniyor','capturing':'Canlı yakalama açık','stalled':'Paket okuma yanıt vermiyor','delayed':'Paket okuma gecikiyor','stopped':'Yakalama durdu','demo':'Örnek veri','replay':'Yerel savaş kaydı','error':'Yakalama sorunu'};
function render(s){
  state=s;const currentHasData=!!(s.current.damage||s.current.healing),c=currentHasData?s.current:s.last||s.current;
  const healing=metric==='healing',amount=healing?'healing':'damage',rate=healing?'hps':'dps',rateLabel=healing?'HPS':'DPS';
  const rows=healing?c.healers||[]:c.players,total=c[amount]||0;
  renderCube(s);
  cubeAlerts.render(s);
  $('connection').textContent=statusLabels[s.capture.state]||s.capture.state;$('led').classList.toggle('live',s.capture.state==='capturing');
  $('stop').hidden=!['live','demo'].includes(s.mode);$('start').hidden=s.mode==='live';
  const notice=$('notice');notice.className='notice';
  if(s.mode==='demo'){notice.classList.add('warning');notice.textContent='ÖRNEK SAVAŞ · Bu ekrandaki veriler sentetiktir. Gerçek oyun verisi için Canlı başlat seçeneğini kullan.';}
  else if(s.mode==='replay'){notice.classList.add('replay');notice.textContent='YEREL KAYIT · Bu savaş, bilgisayarındaki olay günlüğünden yeniden hesaplandı. Canlı yakalama kapalı.';}
  else if(s.capture.error){notice.classList.add('warning');notice.textContent=s.capture.error;}
  else if(s.capture.state==='capturing'){notice.textContent='CANLI · Aion 2 bağlantısı dinleniyor. Oyuncu bilgileri veya parti listesi eksikse ölçer açıkken bölge değiştir.';}
  else if(s.mode==='paused'){notice.textContent='Yakalama durduruldu. Mevcut savaş sonucu ekranda tutuluyor.';}
  else{notice.textContent='HAZIR · Aion 2’yi açıp bir savaşa gir. Bağlantı otomatik algılanacak. Beklerken yerel bir savaş kaydını inceleyebilirsin.';}
  $('rate-label').textContent=`TOPLAM ${rateLabel}`;$('amount-label').textContent=healing?'TOPLAM İYİLEŞTİRME':'TOPLAM HASAR';
  $('dps').textContent=total?fmt(c[rate]):'—';$('damage').textContent=total?compact(total):'—';$('duration').textContent=time(healing?c.healingSeconds??c.seconds:c.seconds);$('players-count').textContent=rows.length;
  $('target-count').textContent=healing?'Karşılaşmanın tüm iyileştirmeleri':c.targets.length?`${c.targets.length} hedefte ölçüldü`:'Henüz hedef yok';
  $('mode-label').textContent=s.mode==='replay'?'Kayıttan yeniden hesaplandı':s.mode==='demo'?'Örnek oyuncular':s.last&&!currentHasData?'Son tamamlanan savaş':'Algılanan oyuncular';
  $('fight-label').textContent=s.mode==='demo'?'ÖRNEK':s.mode==='replay'?'KAYIT':s.last&&!currentHasData?'TAMAMLANDI':c.damage||c.healing?'SAVAŞ':'BEKLENİYOR';
  document.querySelectorAll('[data-metric]').forEach(b=>{const active=b.dataset.metric===metric;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
  $('ranking-title').textContent=healing?'İyileştirme sıralaması':'Hasar sıralaması';$('ranking-amount-label').textContent=healing?'İYİLEŞTİRME':'HASAR';$('ranking-rate-label').textContent=rateLabel;
  $('detail-rate-label').textContent=`YETENEK BAŞINA ${rateLabel}`;$('skill-rate-label').textContent=rateLabel;$('skill-amount-label').textContent=healing?'İYİLEŞTİRME':'HASAR';
  document.querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('selected',b.dataset.scope===s.scope));
  const availableTargets=s.availableTargets||c.targets,key=JSON.stringify(availableTargets.map(t=>[t.entity,t.name]));
  if(key!==targetsKey&&document.activeElement!==$('target')){targetsKey=key;$('target').innerHTML='<option value="">Tüm hedefler</option>'+availableTargets.map(t=>`<option value="${t.entity}">${esc(t.name)}</option>`).join('');}
  $('target').value=s.target??'';
  if(!rows.some(p=>p.entity===selected))selected=rows[0]?.entity??null;
  $('ranking').innerHTML=rows.length?rows.map((p,i)=>`<button class="player-row ${selected===p.entity?'chosen':''}" data-player="${p.entity}" style="--fill:${Math.max(3,p[amount]/(rows[0]?.[amount]||1)*100)}%;--row-color:${colors[i%colors.length]}" aria-pressed="${selected===p.entity}"><span class="name"><span class="avatar">${String(i+1).padStart(2,'0')}</span><span class="identity"><b>${esc(p.name)}${p.self?'<em>SEN</em>':''}</b><small>${esc(p.class)} · ${percent(p.share)}</small></span></span><span>${compact(p[amount])}</span><span class="muted">${p.critRate===null||p.critRate===undefined?'—':percent(p.critRate)}</span><span class="player-dps">${fmt(p[rate])}</span></button>`).join(''):`<div class="empty"><span class="empty-symbol">◇</span><span>${healing?'Bu karşılaşmada iyileştirme kaydı yok.':'Henüz savaş verisi yok.<br>Oyuna gir veya aşağıdan bir kayıt aç.'}</span></div>`;
  document.querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.player);render(state);});
  const p=rows.find(p=>p.entity===selected);$('detail-name').textContent=p?`${p.name} · Yetenekler`:'Yetenek dökümü';
  $('player-detail').innerHTML=p?(healing?`<span>İyileştirme <b>${compact(p.healing)}</b></span><span>Olay <b>${fmt(p.events)}</b></span>`:`<span>DoT <b>${compact(p.dotDamage)}</b></span><span>Pet <b>${compact(p.petDamage)}</b></span><span>Vuruş <b>${fmt(p.hits)}</b></span>`):'';
  $('skill-head').hidden=!p;
  $('skill-note').hidden=!p;
  $('skill-note').textContent=healing?"Yetenek HPS'leri karşılaşmanın ortak savaş süresini kullanır. İyileştirmeler hedef filtresinden bağımsızdır; kritik bilgisi pakette bulunmaz.":"Yetenek DPS'leri aynı savaş süresini kullanır; toplamları oyuncunun DPS'sini verir. Kritik oranı doğrudan hasar olayları üzerinden hesaplanır.";
  $('skills').innerHTML=p?p.skills.map(sk=>`<div class="skill" role="row" style="--skill-fill:${Math.min(100,sk[amount]/Math.max(p.skills[0]?.[amount]||1,1)*100)}%">
    <span class="skill-identity" role="cell" title="${esc(sk.name)} · #${sk.id}${healing?` · ${fmt(sk.events)} iyileştirme olayı`:` · ${fmt(sk.hits)} vuruş${sk.dotDamage?' · DoT '+fmt(sk.dotDamage):''}`}"><span class="skill-icon" aria-hidden="true">◇${sk.icon&&!failedSkillIcons.has(sk.icon)?`<img src="${esc(sk.icon)}" alt="" width="32" height="32" loading="lazy">`:''}</span><span class="skill-name">${esc(sk.name)}</span></span>
    <span class="skill-dps" role="cell" title="${fmt(sk[rate])} ${rateLabel}">${compact(sk[rate])}</span>
    <span class="skill-share" role="cell">${percent(sk.share)}</span>
    <span class="skill-damage" role="cell" title="${fmt(sk[amount])} ${healing?'iyileştirme':'hasar'}">${compact(sk[amount])}</span>
    <span class="skill-crit" role="cell" title="${healing?'İyileştirme paketinde kritik bilgisi yok':`${fmt(sk.criticalHits)} kritik / ${fmt(sk.directHits)} doğrudan hasar olayı`}">${sk.critRate===null||sk.critRate===undefined?'—':percent(sk.critRate)}</span>
  </div>`).join(''):'<div class="empty">Bir oyuncu seçtiğinde yetenekleri burada görünür.</div>';
  $('chart-panel').hidden=healing;$('bottom-grid').classList.toggle('healing-view',healing);
  if(!healing)drawChart(c);$('chart-end').textContent=c.seconds?`${fmt(c.seconds)} sn`:'—';
  $('comparison').textContent=s.comparison?(s.comparison.damageDelta===0&&Math.abs(s.comparison.secondsDelta)<.001?'✓ Toplam hasar ve süre kaynak raporla eşleşti.':`Kaynak rapora göre hasar farkı: ${fmt(s.comparison.damageDelta)} · süre farkı: ${s.comparison.secondsDelta.toFixed(3)} sn`):'';
  $('diagnostic-summary').textContent=`${fmt(s.capture.packetCount)} paket · ${fmt(s.capture.decoded)} çözülen mesaj`;
  const errors=Object.entries(s.capture.issues||{}).map(([k,v])=>`${k}: ${v}`).join('\n');
  $('diagnostics').innerHTML=`<div class="diagnostic-grid"><span><b>${s.capture.adapters||0}</b>Adaptör</span><span><b>${s.capture.connections||0}</b>Oyun bağlantısı</span><span><b>${s.coverage.full} + ${s.coverage.prefix}</b>Tam / kısmi mesaj okuyucu</span><span><b>${c.issues.gaps}</b>Akış boşluğu</span><span><b>${c.issues.unknownHits}</b>Kimliği çözülemeyen olay</span></div><pre>${esc(errors||'Bildirilen paket hatası yok.')}${c.issues.truncated?'\nOlay sınırına ulaşıldı; bu karşılaşma eksik.':''}</pre>`;
}
function drawChart(c){
  let svg='';for(const y of [15,50,85,120])svg+=`<line x1="0" y1="${y}" x2="800" y2="${y}" stroke="#25313b" stroke-dasharray="3 5"/>`;
  if(c.chart.length){const max=Math.max(...c.chart.map(p=>p.dps),1);const points=c.chart.map(p=>[p.second/Math.max(c.seconds,1)*800,120-p.dps/max*105]);if(points.length===1)points.push([800,points[0][1]]);const line=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');svg+=`<defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8ed3b2" stop-opacity=".2"/><stop offset="100%" stop-color="#8ed3b2" stop-opacity="0"/></linearGradient></defs><path d="${line} L ${points.at(-1)[0]},130 L ${points[0][0]},130 Z" fill="url(#area)"/><path d="${line}" fill="none" stroke="#a9eccb" stroke-width="2" stroke-linejoin="round"/>`;}
  else svg+='<text x="400" y="72" fill="#657987" text-anchor="middle" font-size="12">Savaş başladığında grafik burada oluşacak.</text>';
  $('chart').innerHTML=svg;
}
async function recordings(){try{const r=await fetch('/api/encounters');const data=await r.json();$('recordings').innerHTML=data.length?data.map(x=>`<option value="${esc(x.id)}">${new Date(x.savedAt).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${time(x.seconds)} · ${x.players} oyuncu · ${compact(x.damage)}</option>`).join(''):'<option value="">Yerel kayıt bulunamadı</option>';$('replay').disabled=!data.length;}catch{$('recordings').innerHTML='<option value="">Kayıtlar okunamadı</option>';}finally{if(state)renderCube(state);}}
const stream=new EventSource('/api/events');stream.onmessage=e=>render(JSON.parse(e.data));stream.onerror=()=>{$('connection').textContent='Uygulama bağlantısı kesildi';$('led').classList.remove('live');cubeAlerts.disconnected();};recordings();
