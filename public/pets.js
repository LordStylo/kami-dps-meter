import {createPetsMap} from './pets-map.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('tr-TR',{maximumFractionDigits:0});
const same=(a,b)=>a!==null&&a!==undefined&&b!==null&&b!==undefined&&String(a)===String(b);
const thresholds=[5,25,75];
const genusNames={intellect:'Cogni',feral:'Fera',nature:'Natura',trans:'Varian (Trans)',special:'Özel'};
const genusName=value=>genusNames[value]??value??'Tür bilgisi yok';
const searchText=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').replace(/ı/g,'i').toLowerCase();
const factionWorlds={elyos:new Set(['1000','1010','1011']),asmodian:new Set(['1100','1110','1111']),reshanta:new Set(['20','22','23'])};
export function petFactions(pet){const ids=(pet.mapIds||[]).map(String);return [['elyos','Elyos',factionWorlds.elyos],['asmodian','Asmodian',factionWorlds.asmodian],['abyss','Abyss',factionWorlds.reshanta]].filter(([, ,worlds])=>ids.some(id=>worlds.has(id))).map(([id,name])=>({id,name}));}
export function petWorldMatches(pet,{world=null,worldOnly=false,faction='',factionOnly=false}={}){
  const ids=[...new Set((pet.mapIds||[]).map(String))];
  if(world!==null&&world!==undefined&&(!ids.includes(String(world))||worldOnly&&ids.some(id=>id!==String(world))))return false;
  const group=factionWorlds[faction];if(group&&(!ids.some(id=>group.has(id))||factionOnly&&ids.some(id=>!group.has(id))))return false;
  return true;
}
export function petProgress(pet,collection,target=3){
  const id=String(pet.id),complete=collection?.complete===true&&['saved','live'].includes(collection.status),raw=collection?.levels?.[id],points=collection?.souls?.[id];
  const level=Number.isInteger(raw)&&raw>=0&&raw<=3?raw:complete?0:null,souls=Number.isInteger(points)&&points>=-2147483648&&points<=2147483647?Math.max(0,points):complete?0:null;
  let effective=level,remaining=level!==null&&level>=target?0:null;
  if(level!==null&&souls!==null){let available=souls;while(effective<3&&available>=thresholds[effective]){available-=thresholds[effective];effective++;}remaining=Math.max(0,thresholds.slice(level,Math.max(level,target)).reduce((sum,n)=>sum+n,0)-souls);}
  return {level,souls,effective,remaining,owned:level===null?null:level>0,target,complete};
}
export function petAutoTarget(eligible,collection){return 1+Math.min(2,eligible.length?Math.min(...eligible.map(p=>petProgress(p,collection).effective??0)):0);}
export function createPetsView(root=document.getElementById('view-pets')){
  if(!root)return {update(){},disconnected(){}};
  const find=name=>root.querySelector('[data-pets-'+name+']'),map=createPetsMap(find('map'));
  let pets=[],worlds=[],catalogState='empty',state=null,signature='',page=0,selected=null,manualSelection=false,spawnToken=0,lastCards='',lastGenus='',loadingPet=null,loadedPet=null,overlayBusy=false;const spawnCache=new Map();
  const excluded=new Set();try{const saved=JSON.parse(localStorage.getItem('kami-pet-plan-v1')||'[]');if(Array.isArray(saved))for(const id of saved.slice(0,1000))if(/^\d+$/.test(String(id)))excluded.add(String(id));}catch{}
  const collection=()=>state?.pets?.collection||{status:'unknown',complete:false,levels:{},souls:{}};
  const scoped=pet=>{const selection=find('world').value,world=selection==='current'?currentWorld():selection||null;return !(selection==='current'&&world===null)&&(!find('genus').value||String(pet.genus??'')===find('genus').value)&&petWorldMatches(pet,{world,worldOnly:find('world-only').checked,faction:find('faction').value,factionOnly:find('faction-only').checked});};
  const target=()=>find('target').value==='auto'?petAutoTarget(pets.filter(p=>(p.monsters||[]).length&&!excluded.has(String(p.id))&&scoped(p)),collection()):Number(find('target').value)||1;
  const visible=()=>!root.hidden;
  const currentWorld=()=>[...(state?.pets?.map?.contexts||[])].filter(c=>c.mapId!=null).sort((a,b)=>(Number(b.observedAt)||0)-(Number(a.observedAt)||0))[0]?.mapId??null;
  function renderWorldOptions(){const selectedWorld=find('world').value,ids=new Set([...worlds.map(m=>String(m.id)),...pets.flatMap(p=>(p.mapIds||[]).map(String))]);find('world').replaceChildren(new Option('Tüm bölgeler',''),new Option('Bulunduğum bölge','current'),...[...ids].sort((a,b)=>(worlds.find(m=>same(m.id,a))?.name||a).localeCompare(worlds.find(m=>same(m.id,b))?.name||b,'en')).map(id=>new Option(worlds.find(m=>same(m.id,id))?.name||'Haritası olmayan bölge #'+id,id)));find('world').value=selectedWorld;}
  function renderStatus(){
    const c=collection(),progress=pets.map(p=>petProgress(p,c,1)),known=progress.filter(p=>p.owned!==null).length,owned=progress.filter(p=>p.owned===true).length,missing=progress.filter(p=>p.owned===false).length,unknown=pets.length-known;
    find('owned').textContent=known?fmt(owned):'—';find('total').textContent=pets.length?'/ '+fmt(pets.length):'';find('missing').textContent=known?fmt(missing):'—';find('unknown').textContent=pets.length?fmt(unknown):'—';
    find('maxed').textContent=known?fmt(progress.filter(p=>p.level===3).length):'—';find('maxed-total').textContent=pets.length?'/ '+fmt(pets.length):'';
    find('completion').style.width=pets.length?(owned/pets.length*100)+'%':'0%';find('completion').setAttribute('aria-valuenow',String(owned));find('completion').setAttribute('aria-valuemax',String(pets.length||1));
    const character=typeof c.character==='string'?c.character:c.character?.name;const at=c.at&&Number.isFinite(new Date(c.at).getTime())?new Date(c.at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):null;
    let status=c.status==='live'?'Canlı koleksiyon':c.status==='saved'?'Son kaydedilen koleksiyon':'Koleksiyon bilgisi henüz alınmadı';if(character)status+=' · '+character;if(at)status+=' · '+at;if(c.status!=='unknown'&&!c.complete)status+=' · kısmi kayıt';find('status').textContent=status;find('status').dataset.source=c.status||'unknown';
    find('status-note').textContent=c.status==='saved'?'Sahiplik ve ruhlar son kayıttan gösteriliyor. Oyundaki güncel durumdan farklı olabilir.':c.status==='live'&&!c.complete?'Yalnız alınan pet bilgileri biliniyor. Eksik kayıtlar “Bilinmiyor” olarak kalır.':c.status==='live'?'Bilinen seviye, oyundan alınan seviyedir. Ruhlarla ulaşılabilir seviye ayrıca hesaplanır.':'Bilinmeyen sahiplik eksik sayılmaz. Canlı koleksiyon veya kayıt alındığında durum güncellenir.';
    const errors=(c.errors||[]).map(e=>typeof e==='string'?e:e.message).filter(Boolean);find('warning').hidden=!errors.length;find('warning').textContent=errors.join(' · ');
    for(const genus of Object.keys(genusNames)){const level=c.genera?.[genus]?.level,group=pets.filter(p=>p.genus===genus).map(p=>petProgress(p,c,3)),groupKnown=group.some(p=>p.level!==null);root.querySelector(`[data-pet-genus-level="${genus}"]`).textContent=Number.isInteger(level)&&level>=0?fmt(level):'—';root.querySelector(`[data-pet-genus-owned="${genus}"]`).textContent=`${groupKnown?fmt(group.filter(p=>p.owned).length):'—'} / ${fmt(group.length)}`;root.querySelector(`[data-pet-genus-maxed="${genus}"]`).textContent=`${groupKnown?fmt(group.filter(p=>p.level===3).length):'—'} / ${fmt(group.length)}`;}
  }
  function card(pet){
    const p=petProgress(pet,collection(),3),outside=excluded.has(String(pet.id));
    const icon=/^\/icons\/pets\/[A-Za-z0-9_-]+\.webp$/.test(pet.icon||'')?pet.icon:null;
    const factions=petFactions(pet),tags=factions.length?`<span class="pet-faction-tags">${factions.map(f=>`<span data-pet-faction="${f.id}">${f.name}</span>`).join('')}</span>`:'';
    return `<article class="pet-row ${same(pet.id,selected)?'selected':''} ${outside?'pet-excluded':''} ${p.level===3?'completed':''}" data-pet-card="${esc(pet.id)}" data-pet-level="${p.level??'unknown'}" data-remaining-level3="${p.remaining??'unknown'}"><button class="pet-row-main" data-pet-open="${esc(pet.id)}" aria-pressed="${same(pet.id,selected)}" aria-label="${esc(pet.name)} için haritada aç"><span class="pet-portrait" aria-hidden="true">◇${icon?`<img src="${esc(icon)}" alt="" loading="lazy" width="36" height="36">`:''}</span><span class="pet-row-identity"><b title="${esc(pet.name)}">${esc(pet.name)}</b><small>${esc(genusName(pet.genus))} · ${p.level===null?'Seviye bilinmiyor':'Sv. '+p.level} · Ruh ${p.souls===null?'—':fmt(p.souls)}</small>${tags}</span><span class="pet-row-remaining"><b>${p.remaining===null?'—':fmt(p.remaining)}</b><small>${p.level===3?'tamamlandı':p.remaining===null?'bilinmiyor':'ruh kaldı'}</small></span></button><button class="pet-row-plan" data-pet-exclude="${esc(pet.id)}" aria-pressed="${outside}" title="${outside?'Plana dahil et':'Plandan çıkar'}" aria-label="${esc(pet.name)} ${outside?'plana dahil et':'plandan çıkar'}">${outside?'+':'−'}</button></article>`;
  }
  function renderCards(){
    if(!visible())return;const q=searchText(find('search').value.trim()),status=find('filter').value,phase=target(),levelFilter=find('level').value;
    const worldSelection=find('world').value,world=worldSelection==='current'?currentWorld():worldSelection||null,faction=find('faction').value;find('world-only').disabled=!worldSelection;find('faction-only').disabled=!faction;
    const filtered=pets.filter(p=>{const progress=petProgress(p,collection(),3),kind=progress.owned===true?'owned':progress.owned===false?'missing':'unknown';return (!find('hide-maxed').checked||progress.level!==3)&&(!q||[p.name,p.id,p.genus,genusName(p.genus),...(p.monsters||[]).map(m=>m.name)].some(v=>searchText(v).includes(q)))&&(status==='all'||status===kind)&&(levelFilter==='all'||levelFilter==='unknown'&&progress.level===null||String(progress.level)===levelFilter)&&scoped(p);});
    const minLevel=p=>{const levels=(p.monsters||[]).map(m=>m.level).filter(finite);return levels.length?Math.min(...levels):Infinity;},sort=find('sort').value;
    filtered.sort((a,b)=>{const pa=petProgress(a,collection(),3),pb=petProgress(b,collection(),3),group=p=>p.remaining===null?2:p.level===3?1:0;if(group(pa)!==group(pb))return group(pa)-group(pb);const delta=sort==='closest'?(pa.remaining??Infinity)-(pb.remaining??Infinity):sort==='level'?minLevel(a)-minLevel(b):sort==='spawns'?(b.spawnCount||0)-(a.spawnCount||0):0;return (Number.isNaN(delta)?0:delta)||(sort==='closest'?(pb.level??-1)-(pa.level??-1):0)||a.name.localeCompare(b.name,'en')||Number(a.id)-Number(b.id);});
    find('auto-note').textContent=find('target').value==='auto'?`Auto hedef: Seviye ${phase}. Seçili bölge/taraf/tür ve plana dahil petlerin ruhlarla ulaşılabilir en düşük seviyesine göre.`:`Hedef: Seviye ${phase}. “En az ruh gereken” sırası kalan ruh sayısını kullanır.`;
    root.querySelectorAll('[data-pet-genus-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.petGenusFilter===find('genus').value)));
    const manual=manualSelection&&filtered.find(p=>same(p.id,selected));if(manualSelection&&!manual)manualSelection=false;const chosen=manual||filtered[0];if(!same(chosen?.id,selected)){selected=chosen?.id??null;find('overlay-status').hidden=true;if(!chosen){spawnToken++;loadingPet=loadedPet=null;}}find('selected').hidden=!chosen;find('selection-empty').hidden=!!chosen;find('show-overlay').disabled=!chosen||overlayBusy;
    let html=filtered.map(card).join('');
    if(!html)html=`<div class="pets-empty">${catalogState==='loading'?'Pet kataloğu yükleniyor…':catalogState==='error'?'Pet kataloğu okunamadı. Yenile düğmesini kullanabilirsin.':worldSelection==='current'&&world===null?'Bulunduğun bölge henüz bilinmiyor.':'Bu filtrelere uyan pet bulunamadı.'}</div>`;
    if(html!==lastCards){lastCards=html;const scroll=find('list').scrollTop;find('list').innerHTML=html;find('list').scrollTop=scroll;}find('result').textContent=fmt(filtered.length)+' pet';find('page').textContent=fmt(filtered.length)+' pet';find('prev').disabled=find('next').disabled=true;
    if(chosen)void loadSelected(chosen);
  }
  async function loadCatalog(){
    if(catalogState==='loading')return;catalogState='loading';find('list').setAttribute('aria-busy','true');renderCards();try{const response=await fetch('/api/pets/catalog');if(!response.ok)throw Error('Pet kataloğu okunamadı.');const data=await response.json();if(data.version!==1||!Array.isArray(data.pets))throw Error('Pet kataloğu geçersiz.');pets=data.pets.filter(p=>p&&p.id!=null&&typeof p.name==='string').sort((a,b)=>a.name.localeCompare(b.name,'en'));catalogState='ready';const genera=[...new Set(pets.map(p=>p.genus).filter(v=>v!==null&&v!==undefined&&v!==''))].sort((a,b)=>String(genusName(a)).localeCompare(String(genusName(b)),'tr'));const key=JSON.stringify(genera);if(key!==lastGenus){lastGenus=key;find('genus').replaceChildren(new Option('Tüm türler',''),...genera.map(g=>new Option(String(genusName(g)),String(g))));}find('catalog-note').textContent=`Pet adları kaynak katalogda İngilizcedir. ${fmt(pets.length)} pet · Veriler yerel olarak okunur.`;renderStatus();renderCards();}
    catch(error){catalogState='error';find('catalog-note').textContent=error.message;renderCards();}finally{find('list').removeAttribute('aria-busy');renderWorldOptions();void fetch('/api/pets/maps').then(r=>r.ok?r.json():null).then(data=>{if(data?.version===1&&Array.isArray(data.maps)){worlds=data.maps;renderWorldOptions();renderCards();}}).catch(()=>{});}
  }
  async function loadSelected(pet,force=false){
    const p=petProgress(pet,collection(),target());find('target-progress').textContent=`${pet.name} · Hedef Sv. ${p.target}: ${p.remaining===null?'ruh bilgisi yetersiz':fmt(p.remaining)+' ruh daha'}${p.effective!==null&&p.effective>p.level?' · Ruhlarla Sv. '+p.effective+' ulaşılabilir':''}`;find('selected-exclude').textContent=excluded.has(String(pet.id))?'Seçili peti plana dahil et':'Seçili peti plandan çıkar';find('selected-exclude').setAttribute('aria-pressed',String(excluded.has(String(pet.id))));
    if(!force&&(same(loadingPet,pet.id)||same(loadedPet,pet.id)))return;loadingPet=pet.id;loadedPet=null;find('selected-title').textContent=pet.name;find('selected-info').textContent=[...new Set((pet.monsters||[]).map(m=>m.name+(finite(m.level)?' · Sv. '+m.level:'')))].join(' / ')||'Bu pet için yaratık bilgisi yok.';find('selected').hidden=false;find('spawn-retry').hidden=true;find('map').hidden=false;map.select(pet,null);
    const token=++spawnToken;try{let data=spawnCache.get(String(pet.id));if(!data||force){const response=await fetch('/api/pets/'+encodeURIComponent(pet.id)+'/spawns');if(!response.ok)throw Error('Pet konumları okunamadı.');data=await response.json();if(!Array.isArray(data.spawns)||!same(data.petId,pet.id))throw Error('Pet konum verisi geçersiz.');spawnCache.set(String(pet.id),data);}if(token!==spawnToken)return;loadedPet=pet.id;loadingPet=null;map.select(pet,data);find('selected-note').textContent='Halka bilinen spawn konumudur; şu anda pet bulunduğunu göstermez. Yeşil noktalar canlı gözlemdir.';}
    catch(error){if(token!==spawnToken)return;loadedPet=pet.id;loadingPet=null;map.select(pet,{spawns:[],error:error.message});find('selected-note').textContent=error.message;find('spawn-retry').hidden=false;}
  }
  function openPet(id){const pet=pets.find(p=>same(p.id,id));if(pet){const hadFocus=same(document.activeElement?.dataset.petOpen,id);if(!same(pet.id,selected))find('overlay-status').hidden=true;selected=pet.id;manualSelection=true;renderCards();if(hadFocus)find('list').querySelector(`[data-pet-open="${CSS.escape(String(id))}"]`)?.focus({preventScroll:true});}}
  async function showPetOverlay(){
    const pet=pets.find(p=>same(p.id,selected));if(!pet||overlayBusy)return;
    const id=pet.id,payload={petId:Number(id)},world=map.selectedMapId();if(world!=null)payload.mapId=Number(world);
    overlayBusy=true;find('show-overlay').disabled=true;const note=find('overlay-status');note.hidden=false;note.dataset.error='false';note.textContent=pet.name+' oyun haritası açılıyor…';
    try{
      let result;if(typeof window.kamiApplication?.showPetMap==='function')result=await window.kamiApplication.showPetMap(payload);
      else{const response=await fetch('/api/pet-overlay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});result=await response.json();if(!response.ok)throw Error(result.error||'Oyun haritası açılamadı.');}
      if(result?.ok!==true)throw Error(result?.error||'Oyun haritasının açıldığı doğrulanamadı.');
      if(same(id,selected)){note.hidden=false;note.textContent=pet.name+' seçildi. Oyun öndeyken pet haritası görünür.';}
    }catch(error){if(same(id,selected)){note.hidden=false;note.dataset.error='true';note.textContent=error.message||'Oyun haritası açılamadı.';}}
    finally{overlayBusy=false;find('show-overlay').disabled=selected===null;if(!same(id,selected))note.hidden=true;}
  }
  find('show-overlay').onclick=()=>void showPetOverlay();
  find('list').addEventListener('click',event=>{const plan=event.target.closest('[data-pet-exclude]');if(plan){const id=plan.dataset.petExclude;if(excluded.has(id))excluded.delete(id);else excluded.add(id);try{localStorage.setItem('kami-pet-plan-v1',JSON.stringify([...excluded]));}catch{}renderCards();return;}const button=event.target.closest('[data-pet-open]');if(button)void openPet(button.dataset.petOpen);});find('list').addEventListener('error',event=>{if(event.target.tagName==='IMG')event.target.remove();},true);
  root.addEventListener('click',event=>{const button=event.target.closest('[data-pet-genus-filter]');if(button){find('genus').value=find('genus').value===button.dataset.petGenusFilter?'':button.dataset.petGenusFilter;page=0;renderCards();}});
  for(const name of ['search','filter','genus','target','world','world-only','faction','faction-only','level','sort','hide-maxed'])find(name).addEventListener(name==='search'?'input':'change',()=>{page=0;renderCards();});find('prev').onclick=find('next').onclick=()=>{};find('refresh').onclick=()=>void loadCatalog();find('spawn-retry').onclick=()=>{const pet=pets.find(p=>same(p.id,selected));if(pet)void loadSelected(pet,true);};find('selected-exclude').onclick=()=>{if(selected===null)return;const id=String(selected);if(excluded.has(id))excluded.delete(id);else excluded.add(id);try{localStorage.setItem('kami-pet-plan-v1',JSON.stringify([...excluded]));}catch{}renderCards();};
  const activate=()=>{document.body.classList.toggle('pets-workspace-active',visible());if(visible()){if(catalogState==='empty')void loadCatalog();else{renderStatus();renderCards();}}};window.addEventListener('hashchange',activate);new ResizeObserver(activate).observe(root);activate();
  return {update(next){state=next;map.update(next);const key=JSON.stringify([next.pets?.collection||null,currentWorld()]);if(key!==signature){signature=key;renderStatus();renderCards();}},disconnected(){map.disconnected();}};
}
