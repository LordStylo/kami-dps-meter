import {projectWorld} from './cube-map.js';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const same=(a,b)=>a!==null&&a!==undefined&&b!==null&&b!==undefined&&String(a)===String(b);
const stamp=n=>finite(n)?n:typeof n==='string'?Date.parse(n):NaN;
function validMap(m){
  if(!m||m.id==null||![m.width,m.height,m.originX,m.originY,m.rows,m.columns,m.cellUnits,m.tileSize].every(finite)||m.width<=0||m.height<=0||m.width>16384||m.height>16384||m.rows<=0||m.columns<=0||m.cellUnits<=0||m.tileSize<=0||m.width!==m.columns*m.tileSize||m.height!==m.rows*m.tileSize)return false;
  if(/^\/maps\/[A-Za-z0-9_-]+\.webp$/.test(m.image||''))return true;
  return Array.isArray(m.tiles)&&m.tiles.length>0&&m.tiles.length<=16&&m.tiles.every(t=>/^\/pet-maps\/[A-Za-z0-9_-]+\.webp$/.test(t.image||'')&&[t.x,t.y,t.width,t.height].every(finite)&&t.x>=0&&t.y>=0&&t.width>0&&t.height>0&&t.x+t.width<=m.width&&t.y+t.height<=m.height);
}
export function createPetsMap(root,{catalog=null,imageURL=image=>image,lockedFollow=false}={}){
  const find=name=>root.querySelector('[data-pet-map-'+name+']'),canvas=find('canvas'),stage=find('stage'),ctx=canvas.getContext('2d',{alpha:false});
  let state=null,connected=false,receivedAt=0,pet=null,spawns=[],pending=false,spawnError='',maps=[],catalogState='empty',catalogError='',map=null,selectedMap=null,contextId=null,regionsKey='';
  let layers=[],imageState='empty',generation=0,width=0,height=0,dpr=1,visible=false,frame=0,lastDraw='',view={scale:1,x:0,y:0},fitPending=true,follow=lockedFollow,lastOwn='',drag=null,hitPoints=[];
  const injectedCatalog=catalog!==null;let catalogValue=catalog;
  const npcIds=()=>new Set((pet?.monsters||[]).map(n=>String(n.id)));
  const contexts=()=>Array.isArray(state?.pets?.map?.contexts)?state.pets.map.contexts:[];
  const selectedContext=()=>contexts().find(c=>same(c.id,contextId)&&same(c.mapId,selectedMap))||null;
  const healthy=now=>connected&&state?.mode==='live'&&state.capture?.state==='capturing'&&now-receivedAt<2500;
  const inside=p=>p&&map&&p.x>=0&&p.y>=0&&p.x<=map.width&&p.y<=map.height;
  const staticPoints=()=>!map?[]:spawns.filter(s=>same(s.mapId,map.id)).map(s=>({...s,point:projectWorld(map,s),kind:'static'})).filter(s=>inside(s.point));
  function livePoints(now){const c=selectedContext(),ids=npcIds();return !map||!c||!healthy(now)?[]:(state?.pets?.map?.markers||[]).filter(m=>m.status==='present'&&ids.has(String(m.npcId))&&same(m.contextId,c.id)&&same(m.mapId,map.id)&&(!m.stream||!c.stream||m.stream===c.stream)).map(m=>({...m,point:projectWorld(map,m),kind:'live'})).filter(m=>inside(m.point));}
  function own(now){const c=selectedContext(),p=c?.player,point=p&&map?projectWorld(map,p):null,at=stamp(p?.at),age=p?Math.max(0,finite(p.ageMs)?p.ageMs+Math.max(0,now-receivedAt):0,finite(at)?now-at:Infinity):Infinity;return {p,point:inside(point)?point:null,age,fresh:!!(inside(point)&&p?.fresh&&finite(at)&&age<60000&&healthy(now))};}
  function schedule(){if(!frame)frame=requestAnimationFrame(draw);}
  function setFollow(value){follow=lockedFollow||value;lastOwn='';find('follow').setAttribute('aria-pressed',String(follow));find('follow').textContent=follow?'Konum takibi açık':'Konumumu izle';schedule();}
  function release(){generation++;for(const layer of layers){layer.img.onload=null;layer.img.onerror=null;layer.img.src='';}layers=[];imageState='empty';lastDraw='';}
  function selectContext(){const current=selectedContext();if(current)return;const ordered=contexts().filter(c=>same(c.mapId,selectedMap)).sort((a,b)=>(stamp(b.observedAt)||0)-(stamp(a.observedAt)||0));contextId=ordered[0]?.id??null;lastOwn='';}
  function regionLabel(id){const name=maps.find(m=>same(m.id,id))?.name;return typeof name==='string'?name.replace(/^Chaotic\s+/i,''):'Bölge #'+id;}
  function syncRegions(){find('regions').querySelectorAll('[data-pet-map-region]').forEach(button=>button.setAttribute('aria-pressed',String(same(button.dataset.petMapRegion,selectedMap))));}
  function chooseMap(id){const next=maps.find(m=>same(m.id,id))||null,changed=!same(id,selectedMap)||map!==next;selectedMap=id??null;map=next;if(changed){release();contextId=null;fitPending=true;setFollow(false);}selectContext();syncRegions();schedule();}
  function updateRegions(){
    if(!pet)return;const counts=new Map();for(const s of spawns)if(s.mapId!=null)counts.set(String(s.mapId),(counts.get(String(s.mapId))||0)+1);for(const id of pet.mapIds||[])if(!counts.has(String(id)))counts.set(String(id),0);
    const ids=npcIds();for(const m of state?.pets?.map?.markers||[])if(m.status==='present'&&ids.has(String(m.npcId))&&m.mapId!=null&&!counts.has(String(m.mapId)))counts.set(String(m.mapId),0);
    const entries=[...counts].sort((a,b)=>b[1]-a[1]),key=JSON.stringify([pending,entries.map(([id,count])=>[id,count,regionLabel(id),maps.some(m=>same(m.id,id))])]);if(key!==regionsKey){regionsKey=key;const focused=document.activeElement?.dataset.petMapRegion,buttons=entries.map(([id,count])=>{const available=maps.some(m=>same(m.id,id)),button=document.createElement('button'),name=document.createElement('span'),number=document.createElement('b');button.type='button';button.dataset.petMapRegion=id;button.setAttribute('aria-pressed',String(same(id,selectedMap)));button.title=`${regionLabel(id)} · ${count} bilinen konum${available?'':' · Bu bölgenin yerel haritası yok'}`;button.setAttribute('aria-label',button.title);name.textContent=regionLabel(id);number.dataset.petMapRegionCount='';number.textContent=String(count);button.append(name,number);if(!available){button.classList.add('unavailable');const note=document.createElement('small');note.textContent='Harita yok';button.append(note);}return button;});find('regions').replaceChildren(...buttons);if(!buttons.length){const empty=document.createElement('span');empty.className='pets-map-regions-empty';empty.textContent=pending?'Bölgeler yükleniyor…':'Bilinen bölge yok';find('regions').append(empty);}if(focused)find('regions').querySelectorAll('[data-pet-map-region]').forEach(button=>{if(same(button.dataset.petMapRegion,focused))button.focus({preventScroll:true});});}
    const currentOwn=lockedFollow?[...contexts()].filter(c=>c.player&&c.mapId!=null).sort((a,b)=>(stamp(b.observedAt)||0)-(stamp(a.observedAt)||0))[0]:null;
    if(currentOwn&&counts.has(String(currentOwn.mapId))&&maps.some(m=>same(m.id,currentOwn.mapId))&&!same(selectedMap,currentOwn.mapId))chooseMap(currentOwn.mapId);
    if(selectedMap==null||!counts.has(String(selectedMap))){const supported=[...counts].filter(([id])=>maps.some(m=>same(m.id,id)));const current=[...contexts()].sort((a,b)=>(stamp(b.observedAt)||0)-(stamp(a.observedAt)||0)).find(c=>supported.some(([id])=>same(id,c.mapId)));chooseMap(current?.mapId??supported.sort((a,b)=>b[1]-a[1])[0]?.[0]??counts.keys().next().value??null);}
    else if(!map&&maps.some(m=>same(m.id,selectedMap)))chooseMap(selectedMap);
    syncRegions();
  }
  function setCatalog(body){
    if(body?.version!==1||!Array.isArray(body.maps))throw Error('Harita listesi geçersiz.');
    const next=body.maps.filter(validMap);if(!next.length)throw Error('Desteklenen yerel harita bulunamadı.');
    catalogValue=body;maps=next;catalogState='ready';catalogError='';regionsKey='';
    if(selectedMap!=null)chooseMap(selectedMap);updateRegions();schedule();
  }
  async function loadMaps(){
    if(injectedCatalog){try{setCatalog(catalogValue);}catch(error){catalogState='error';catalogError=error.message;schedule();}return;}
    if(catalogState==='loading')return;catalogState='loading';catalogError='';schedule();try{let response=await fetch('/api/pets/maps');if(response.status===404)response=await fetch('/api/maps');if(!response.ok)throw Error('Harita listesi okunamadı.');const body=await response.json();if(body.version!==1||!Array.isArray(body.maps))throw Error('Harita listesi geçersiz.');maps=body.maps.filter(validMap);if(!maps.length)throw Error('Desteklenen yerel harita bulunamadı.');catalogState='ready';regionsKey='';updateRegions();}catch(error){catalogState='error';catalogError=error.message;}schedule();
  }
  function ensureImages(){
    if(!map||imageState!=='empty'||!visible)return;const token=++generation;imageState='loading';const assets=map.image?[{image:map.image,x:0,y:0,width:map.width,height:map.height}]:map.tiles;let loaded=0;
    layers=assets.map(asset=>{const img=new Image(),layer={...asset,img};img.decoding='async';img.onload=()=>{if(token!==generation)return;if(img.naturalWidth!==asset.width||img.naturalHeight!==asset.height){imageState='error';schedule();return;}loaded++;if(loaded===assets.length&&imageState!=='error'){imageState='ready';schedule();}};img.onerror=()=>{if(token===generation){imageState='error';schedule();}};img.src=imageURL(asset.image);return layer;});
  }
  function fit(){if(!map||!width||!height)return;const points=[...staticPoints(),...livePoints(Date.now())].map(p=>p.point);if(!points.length){view.scale=Math.min(width/map.width,height/map.height)*.94;view.x=(width-map.width*view.scale)/2;view.y=(height-map.height*view.scale)/2;}else{const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));view.scale=Math.max(.01,Math.min(1.4,(width-70)/Math.max(120,maxX-minX),(height-70)/Math.max(120,maxY-minY)));view.x=width/2-(minX+maxX)/2*view.scale;view.y=height/2-(minY+maxY)/2*view.scale;}fitPending=false;lastOwn='';}
  function zoom(factor,x=width/2,y=height/2){if(!map||imageState!=='ready')return;const next=Math.max(Math.min(width/map.width,height/map.height)*.4,Math.min(4,view.scale*factor)),ratio=next/view.scale;view.x=x-(x-view.x)*ratio;view.y=y-(y-view.y)*ratio;view.scale=next;lastOwn='';schedule();}
  function labels(now,statics,live,me){
    let message='';if(!pet)message='Bir petin “Haritada aç” düğmesini seç.';else if(pending)message='Pet konumları yükleniyor…';else if(spawnError)message=spawnError;else if(catalogState==='loading')message='Yerel haritalar hazırlanıyor…';else if(catalogError)message=catalogError;else if(selectedMap==null)message='Bu pet için bilinen harita konumu yok. Yeni görülen konumlar canlı bağlantıda eklenebilir.';else if(!map)message='Bu bölge için yerel harita bulunmuyor. Konumlar başka bölgeye taşınmaz.';else if(imageState==='error')message='Harita görseli açılamadı veya boyutları uyuşmuyor.';else if(imageState!=='ready')message='Bölge haritası yükleniyor…';
    find('message').textContent=message;find('message').hidden=!message;find('retry').hidden=!catalogError&&imageState!=='error';find('title').textContent=pet?pet.name+' · '+(map?.name||'Konumlar'):'Pet haritası';
    find('count').textContent=`${statics.length} bilinen konum · ${live.length} canlı görülen`;let position='Karakter konumu henüz alınmadı';
    if(me.point){const age=Number.isFinite(me.age)?Math.floor(me.age/1000)+' sn önce':'zamanı bilinmiyor';position=me.fresh?`${me.p.quality==='estimated'?'Tahmini':'Gözlenen'} konum · güncel`:`Son bilinen konum · ${age}${!connected?' · bağlantı kesildi':''}`;}
    else if(map&&contexts().some(c=>c.player&&c.mapId!=null&&!same(c.mapId,map.id)))position='Karakterin başka bir bölgede; bu haritada gösterilmiyor.';
    find('position').textContent=position;find('position').dataset.fresh=String(me.fresh);find('retained').hidden=selectedContext()?.mapState!=='retained';
    for(const name of ['zoom-in','zoom-out','fit'])find(name).disabled=imageState!=='ready';find('follow').disabled=imageState!=='ready'||!me.point;
    root.dataset.pet=pet?.id??'';root.dataset.map=map?.id??'';root.dataset.state=imageState;root.dataset.static=String(statics.length);root.dataset.live=String(live.length);root.dataset.own=me.point?'visible':'missing';
    canvas.setAttribute('aria-label',`${pet?.name||'Pet'} haritası; ${map?.name||'bölge seçilmedi'}; ${find('count').textContent}; ${position}. Bilinen konumlar şu anda pet bulunduğunu göstermez.`);
  }
  function draw(){frame=0;if(!visible||!width||!height)return;ensureImages();const now=Date.now(),statics=staticPoints(),live=livePoints(now),me=own(now);if(fitPending&&imageState==='ready')fit();const ownKey=me.point?`${contextId}/${me.p.at}/${me.p.revision}/${me.point.x}/${me.point.y}`:'';if(follow&&me.point&&ownKey!==lastOwn){view.x=width/2-me.point.x*view.scale;view.y=height/2-me.point.y*view.scale;lastOwn=ownKey;}
    labels(now,statics,live,me);const key=JSON.stringify([imageState,map?.id,width,height,dpr,view,find('static').checked,find('live').checked,find('own').checked,statics.map(p=>[p.id,p.point]),live.map(p=>[p.id,p.point]),me.point,me.fresh]);if(key===lastDraw)return;lastDraw=key;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#0c141c';ctx.fillRect(0,0,width,height);hitPoints=[];if(imageState!=='ready'||!map)return;
    ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);for(const layer of layers)ctx.drawImage(layer.img,layer.x,layer.y,layer.width,layer.height);ctx.restore();
    for(const p of [...(find('static').checked?statics:[]),...(find('live').checked?live:[])]){const x=view.x+p.point.x*view.scale,y=view.y+p.point.y*view.scale;if(x< -15||x>width+15||y< -15||y>height+15)continue;ctx.beginPath();ctx.arc(x,y,p.kind==='live'?5:4,0,Math.PI*2);ctx.lineWidth=2;ctx.strokeStyle=p.kind==='live'?'#c1f0cf':'#f3c17d';ctx.fillStyle=p.kind==='live'?'#62bf82':'#312d2490';ctx.fill();ctx.stroke();hitPoints.push({x,y,p});}
    if(find('own').checked&&me.point){const x=view.x+me.point.x*view.scale,y=view.y+me.point.y*view.scale;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fillStyle=me.fresh?'#9bf1e430':'#99a8b030';ctx.fill();ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fillStyle=me.fresh?'#9bf1e4':'#8a99a5';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#14202b';ctx.stroke();}
  }
  find('regions').onclick=event=>{const button=event.target.closest('[data-pet-map-region]');if(button)chooseMap(button.dataset.petMapRegion);};find('zoom-in').onclick=()=>zoom(1.35);find('zoom-out').onclick=()=>zoom(1/1.35);find('fit').onclick=()=>{setFollow(false);fit();schedule();};find('follow').onclick=()=>setFollow(!follow);for(const name of ['static','live','own'])find(name).onchange=schedule;
  find('retry').onclick=()=>{if(catalogError)loadMaps();else{release();schedule();}};
  canvas.addEventListener('wheel',event=>{if(imageState!=='ready')return;event.preventDefault();const b=canvas.getBoundingClientRect();zoom(Math.exp(-Math.max(-300,Math.min(300,event.deltaY))*.002),event.clientX-b.left,event.clientY-b.top);},{passive:false});
  canvas.addEventListener('pointerdown',event=>{if(lockedFollow||event.button!==0||imageState!=='ready')return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,vx:view.x,vy:view.y};canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(drag&&event.pointerId===drag.id){const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3){setFollow(false);view.x=drag.vx+dx;view.y=drag.vy+dy;schedule();}}else{const b=canvas.getBoundingClientRect(),x=event.clientX-b.left,y=event.clientY-b.top,near=hitPoints.find(p=>Math.hypot(p.x-x,p.y-y)<12);const monster=near&&(pet.monsters||[]).find(m=>same(m.id,near.p.npcId));canvas.title=near?`${near.p.kind==='live'?'Canlı görülen':'Bilinen konum'} · ${monster?.name||pet.name}`:'';}});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>drag=null);
  canvas.addEventListener('keydown',event=>{const moves={ArrowLeft:[35,0],ArrowRight:[-35,0],ArrowUp:[0,35],ArrowDown:[0,-35]};if(moves[event.key]){event.preventDefault();if(lockedFollow)return;setFollow(false);view.x+=moves[event.key][0];view.y+=moves[event.key][1];schedule();}else if(['+','=','-'].includes(event.key)){event.preventDefault();zoom(event.key==='-'?1/1.35:1.35);}else if(event.key==='Home'){event.preventDefault();setFollow(false);fit();schedule();}});
  new ResizeObserver(()=>{const b=stage.getBoundingClientRect(),w=Math.round(b.width),h=Math.round(b.height);if(!w||!h){visible=false;release();return;}visible=true;const oldWidth=width,oldHeight=height;width=w;height=h;dpr=Math.min(2,window.devicePixelRatio||1,4096/w,4096/h);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);view.x+=(w-oldWidth)/2;view.y+=(h-oldHeight)/2;lastOwn='';lastDraw='';schedule();}).observe(stage);
  setInterval(()=>{if(visible)schedule();},250);if(injectedCatalog)void loadMaps();setFollow(lockedFollow);schedule();
  return {
    select(next,result,{mapId=null}={}){const changed=!same(next?.id,pet?.id);pet=next;pending=result==null;spawnError=result?.error||'';spawns=Array.isArray(result?.spawns)?result.spawns:[];if(changed){selectedMap=null;contextId=null;regionsKey='';release();setFollow(false);}if(mapId!=null)chooseMap(mapId);fitPending=true;if(catalogState==='empty'||catalogState==='error')void loadMaps();updateRegions();schedule();},
    setCatalog,
    selectedMapId:()=>selectedMap,
    update(next){state=next;connected=true;receivedAt=Date.now();if(pet){selectContext();updateRegions();}schedule();},
    disconnected(){connected=false;schedule();}
  };
}
