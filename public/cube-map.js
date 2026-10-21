// Packet positions only. The map never predicts movement.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const stamp = value => finite(value) ? value : typeof value === 'string' ? Date.parse(value) : NaN;
const same = (a,b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const MAP_POSITION_FRESH_MS = 60000;

export function projectWorld(map, point) {
  if (!map || !point || ![map.originX,map.originY,map.rows,map.cellUnits,map.tileSize,point.x,point.y].every(finite) || map.rows <= 0 || map.cellUnits <= 0 || map.tileSize <= 0) return null;
  return {x:(point.x-map.originX)*map.tileSize/map.cellUnits,y:(point.y-map.originY)*map.tileSize/map.cellUnits};
}

function validMap(map) {
  return map && map.id !== null && map.id !== undefined && typeof map.name === 'string' && /^\/maps\/[A-Za-z0-9_-]+\.webp$/.test(map.image) &&
    [map.width,map.height,map.rows,map.columns,map.originX,map.originY,map.cellUnits,map.tileSize].every(finite) &&
    map.width > 0 && map.height > 0 && map.width <= 16384 && map.height <= 16384 && map.rows > 0 && map.columns > 0 && map.cellUnits > 0 && map.tileSize > 0 &&
    map.columns*map.tileSize === map.width && map.rows*map.tileSize === map.height;
}

export function createCubeMap(root = document.getElementById('cube-map'), options = {}) {
  if (!root) return {update(){},disconnected(){},setCatalog(){}};
  const lockedFollow=options.lockedFollow===true,suppliedCatalog=Object.hasOwn(options,'catalog');
  root.dataset.lockedFollow=String(lockedFollow);
  const find = name => root.querySelector('[data-map-'+name+']');
  const canvas=find('canvas'),stage=find('stage'),contextSelect=find('context'),followButton=find('follow'),message=find('message'),playerLabel=find('position'),countLabel=find('count'),regionLabel=find('region');
  const ctx=canvas.getContext('2d',{alpha:false});
  let catalog=[],catalogError='',catalogLoading=true,contexts=[],markers=[],selectedId=null,manualContext=false,state=null,receivedAt=0,connected=false;
  let map=null,image=null,loadingImage=null,imageState='empty',imageGeneration=0,view={scale:1,x:0,y:0},follow=true,followZoomPending=true,viewContext=null,lastFollow='',drag=null,frame=0,lastDraw='',contextOptions='';
  let width=0,height=0,pixelRatio=1,visibleStage=false;
  const activeContext = () => contexts.find(c=>String(c.id)===selectedId)||null;
  const mapFor = c => c && c.mapId !== null && c.mapId !== undefined ? catalog.find(m=>same(m.id,c.mapId))||null : null;
  const inside = p => p && map && p.x>=0 && p.y>=0 && p.x<=map.width && p.y<=map.height;
  const healthy = now => connected && state?.mode==='live' && state?.capture?.state==='capturing' && now-receivedAt<2500;
  function playerState(now) {
    const c=activeContext(),p=c?.player,point=p&&map&&same(c.mapId,map.id)?projectWorld(map,p):null;
    const at=stamp(p?.at),elapsed=Math.max(0,now-receivedAt),age=p?Math.max(0,finite(p.ageMs)?p.ageMs+elapsed:0,finite(at)?now-at:Infinity):Infinity;
    return {player:p,point:inside(point)?point:null,age,fresh:!!(inside(point)&&p?.fresh&&finite(at)&&age<MAP_POSITION_FRESH_MS&&healthy(now))};
  }
  function currentMarkers() {
    const c=activeContext();
    return !c||!map ? [] : markers.filter(m=>m.status==='present'&&same(m.contextId,c.id)&&same(m.mapId,map.id)).map(m=>({...m,point:projectWorld(map,m)})).filter(m=>inside(m.point)).sort((a,b)=>(a.sequence||0)-(b.sequence||0));
  }
  function setFollow(value) {follow=lockedFollow||value;followZoomPending=follow;followButton.setAttribute('aria-pressed',String(follow));followButton.textContent=follow?'Takip açık':'Takip kapalı';lastFollow='';schedule();}
  function fit() {
    if (!map || !width || !height) return;
    view.scale=Math.min(width/map.width,height/map.height)*.94;view.x=(width-map.width*view.scale)/2;view.y=(height-map.height*view.scale)/2;lastFollow='';schedule();
  }
  function zoom(factor,px=width/2,py=height/2) {
    if(!map||imageState!=='ready')return;
    const minimum=Math.min(width/map.width,height/map.height)*.5,next=Math.max(minimum,Math.min(4,view.scale*factor)),ratio=next/view.scale;
    view.x=px-(px-view.x)*ratio;view.y=py-(py-view.y)*ratio;view.scale=next;lastFollow='';schedule();
  }
  function releaseImage() {imageGeneration++;for(const previous of [image,loadingImage])if(previous){previous.onload=null;previous.onerror=null;previous.src='';}image=loadingImage=null;imageState='empty';lastDraw='';}
  function chooseMap() {
    const c=activeContext(),next=mapFor(c),contextChanged=viewContext!==c?.id;viewContext=c?.id;
    if(same(next?.id,map?.id)){
      if(contextChanged){followZoomPending=follow;fit();schedule();}return;
    }
    releaseImage();map=next;followZoomPending=follow;lastFollow='';fit();schedule();
  }
  function ensureImage() {
    if(!map||imageState!=='empty'||!width||!height)return;
    imageState='loading';const token=++imageGeneration,candidate=new Image(),expected=map;loadingImage=candidate;
    candidate.decoding='async';
    candidate.onload=()=>{
      if(token!==imageGeneration)return;
      loadingImage=null;
      if(candidate.naturalWidth!==expected.width||candidate.naturalHeight!==expected.height){imageState='error';image=null;}
      else{image=candidate;imageState='ready';followZoomPending=follow;fit();}
      schedule();
    };
    candidate.onerror=()=>{if(token===imageGeneration){imageState='error';image=loadingImage=null;schedule();}};
    candidate.src=typeof options.imageURL==='function'?options.imageURL(expected.image):expected.image;
  }
  function schedule() {if(!frame)frame=requestAnimationFrame(draw);}
  function draw() {
    frame=0;
    if(!visibleStage||!width||!height)return;
    ensureImage();const now=Date.now(),c=activeContext(),own=playerState(now),visible=currentMarkers(),live=healthy(now);
    const ownKey=own.point?`${c?.id}/${own.player.generation}/${own.player.revision}/${own.player.at}/${own.point.x}/${own.point.y}`:'';
    if(imageState==='ready'&&follow&&own.point&&(ownKey!==lastFollow||followZoomPending)){
      // Start at a local view once; subsequent zoom choices survive position updates.
      if(followZoomPending){view.scale=Math.max(view.scale,1);followZoomPending=false;}
      view.x=width/2-own.point.x*view.scale;view.y=height/2-own.point.y*view.scale;lastFollow=ownKey;
    }
    updateLabels(now,own,visible,live);
    const key=JSON.stringify([width,height,pixelRatio,map?.id,imageState,view,find('cubes').checked,find('own').checked,own.point,own.fresh,visible.map(m=>[m.id,m.sequence,m.point]),live]);
    if(key===lastDraw)return;lastDraw=key;
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);ctx.fillStyle='#0c141c';ctx.fillRect(0,0,width,height);
    if(imageState!=='ready'||!image||!map)return;
    ctx.save();ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);ctx.drawImage(image,0,0,map.width,map.height);ctx.restore();
    // Constant screen-size markers stay legible at every map zoom.
    if(find('cubes').checked)for(const m of visible){
      const x=view.x+m.point.x*view.scale,y=view.y+m.point.y*view.scale;
      if(x< -20||x>width+20||y< -20||y>height+20)continue;
      ctx.save();ctx.globalAlpha=live?1:.48;ctx.beginPath();ctx.moveTo(x,y-8);ctx.lineTo(x+7,y);ctx.lineTo(x,y+8);ctx.lineTo(x-7,y);ctx.closePath();ctx.fillStyle='#f1ba72';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#37281c';ctx.stroke();
      ctx.font='600 10px Segoe UI, sans-serif';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#14202b';ctx.strokeText('#'+m.sequence,x,y-13);ctx.fillStyle='#fff0d7';ctx.fillText('#'+m.sequence,x,y-13);ctx.restore();
    }
    if(find('own').checked&&own.point){
      const x=view.x+own.point.x*view.scale,y=view.y+own.point.y*view.scale;
      ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle=own.fresh?'#68dcd02c':'#a4afba23';ctx.fill();ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=own.fresh?'#9bf1e4':'#8a99a5';ctx.fill();ctx.strokeStyle='#11202b';ctx.lineWidth=2;ctx.stroke();
    }
  }
  function updateLabels(now,own=playerState(now),visible=currentMarkers(),live=healthy(now)) {
    const c=activeContext();regionLabel.textContent=map?.name||'Bölge bekleniyor';
    countLabel.textContent=visible.length?`${visible.length} ${live?'cube işareti':'son alınan cube işareti'}`:'Bu bölgede cube işareti yok';
    let text='';
    if(catalogLoading)text='Yerel haritalar hazırlanıyor…';
    else if(catalogError)text='Harita listesi okunamadı. Yeniden deneyebilirsin.';
    else if(!c)text='Bölge bilgisi bekleniyor. Canlı oyun bağlantısı alındığında harita açılır.';
    else if(c.mapId===null||c.mapId===undefined)text='Bölge henüz bilinmiyor. Konum işaretleri gösterilmiyor.';
    else if(!map)text='Bu bölge için yerel harita bulunmuyor. Konum işaretleri gösterilmiyor.';
    else if(imageState==='loading'||imageState==='empty')text='Bölge haritası yükleniyor…';
    else if(imageState==='error')text='Harita görseli açılamadı veya boyutları uyuşmuyor. Konum işaretleri gösterilmiyor.';
    message.textContent=text;message.hidden=!text;find('retry').hidden=!catalogError&&imageState!=='error';
    if(!map||!c)playerLabel.textContent='Konum gösterilemiyor';
    else if(!own.player)playerLabel.textContent='Karakter konumu henüz alınmadı';
    else if(!own.point)playerLabel.textContent='Karakter konumu bu haritanın sınırları dışında';
    else{
      const quality=own.player.quality==='estimated'?'Tahmini':'Gözlenen';
      const age=Number.isFinite(own.age)?Math.max(0,Math.floor(own.age/1000))+' sn önce':'zamanı bilinmiyor';
      playerLabel.textContent=own.fresh?`${quality} konum · güncel`:`Son bilinen konum · ${age}${!connected?' · bağlantı kesildi':!live?' · canlı veri bekleniyor':''}`;
    }
    playerLabel.dataset.fresh=String(own.fresh);root.dataset.state=imageState;root.dataset.context=c?.id??'';root.dataset.map=map?.id??'';root.dataset.player=own.point?'visible':'missing';root.dataset.markerCount=String(visible.length);
    find('region-note').hidden=c?.mapState!=='retained';
    canvas.setAttribute('aria-label',`${map?.name||'Cube haritası'}; ${countLabel.textContent}; ${playerLabel.textContent}. ${lockedFollow?'Konum merkezde sabit.':'Ok tuşlarıyla kaydır,'} artı ve eksi ile yakınlaştır.`);
    for(const name of ['zoom-in','zoom-out','reset','follow'])find(name).disabled=imageState!=='ready';
  }
  function resize() {
    const box=stage.getBoundingClientRect(),w=Math.round(box.width),h=Math.round(box.height);if(w<=0||h<=0){visibleStage=false;return;}visibleStage=true;
    const changed=w!==width||h!==height,oldWidth=width,oldHeight=height;width=w;height=h;pixelRatio=Math.min(2,window.devicePixelRatio||1,4096/width,4096/height);
    canvas.width=Math.round(width*pixelRatio);canvas.height=Math.round(height*pixelRatio);lastDraw='';
    if(changed){if(!oldWidth||!oldHeight)fit();else{view.x+=(width-oldWidth)/2;view.y+=(height-oldHeight)/2;}lastFollow='';lastDraw='';}schedule();
  }
  function updateContexts(next) {
    const previous=activeContext(),oldIds=new Set(contexts.map(c=>String(c.id)));contexts=next.filter(c=>c&&c.id!==null&&c.id!==undefined);
    const ordered=[...contexts].sort((a,b)=>(stamp(b.observedAt)||0)-(stamp(a.observedAt)||0)),latest=ordered.find(c=>c.mapId!==null&&c.mapId!==undefined)||ordered[0];
    const selected=activeContext(),newArea=latest&&!oldIds.has(String(latest.id))&&(!previous||stamp(latest.enteredAt)>stamp(previous.enteredAt));
    if(!selected||(!manualContext&&newArea)){selectedId=latest?String(latest.id):null;manualContext=false;lastFollow='';}
    const options=JSON.stringify(contexts.map(c=>[c.id,c.mapId]));
    if(options!==contextOptions){contextOptions=options;contextSelect.replaceChildren();for(const [index,c]of contexts.entries()){
      const option=document.createElement('option');option.value=String(c.id);option.textContent=`${mapFor(c)?.name||(c.mapId===null||c.mapId===undefined?'Bölge bilinmiyor':'Haritası olmayan bölge')}${contexts.length>1?' · bağlantı '+(index+1):''}`;contextSelect.append(option);
    }}
    contextSelect.value=selectedId??'';contextSelect.disabled=!contexts.length;chooseMap();
  }
  function acceptCatalog(body) {
    if(body?.version!==1||!Array.isArray(body.maps))throw Error('map catalog');const next=body.maps.filter(validMap);if(!next.length)throw Error('empty map catalog');catalog=next;catalogError='';contextOptions='';updateContexts(contexts);
  }
  async function loadCatalog() {
    catalogLoading=true;catalogError='';schedule();
    try{if(suppliedCatalog)acceptCatalog(options.catalog);else{const response=await fetch('/api/maps');if(!response.ok)throw Error('map catalog');acceptCatalog(await response.json());}}
    catch(error){catalogError=error.message;}
    finally{catalogLoading=false;schedule();}
  }
  contextSelect.addEventListener('change',()=>{selectedId=contextSelect.value;manualContext=true;lastFollow='';chooseMap();schedule();});
  find('zoom-in').onclick=()=>zoom(1.35);find('zoom-out').onclick=()=>zoom(1/1.35);find('reset').onclick=()=>{setFollow(false);fit();};followButton.onclick=()=>setFollow(!follow);
  for(const name of ['cubes','own'])find(name).addEventListener('change',schedule);
  find('retry').onclick=()=>{if(catalogError)loadCatalog();else{releaseImage();schedule();}};
  canvas.addEventListener('wheel',event=>{if(!map||imageState!=='ready')return;event.preventDefault();const b=canvas.getBoundingClientRect();zoom(Math.exp(-Math.max(-300,Math.min(300,event.deltaY))*.002),event.clientX-b.left,event.clientY-b.top);},{passive:false});
  canvas.addEventListener('pointerdown',event=>{if(lockedFollow||event.button!==0||imageState!=='ready')return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,viewX:view.x,viewY:view.y};canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');});
  canvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)<3)return;setFollow(false);view.x=drag.viewX+dx;view.y=drag.viewY+dy;schedule();});
  const endDrag=()=>{drag=null;canvas.classList.remove('dragging');};canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
  canvas.addEventListener('keydown',event=>{if(imageState!=='ready')return;const moves={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};if(moves[event.key]&&!lockedFollow){event.preventDefault();setFollow(false);view.x+=moves[event.key][0];view.y+=moves[event.key][1];schedule();}else if(['+','=','-'].includes(event.key)){event.preventDefault();zoom(event.key==='-'?1/1.35:1.35);}else if(event.key==='Home'&&!lockedFollow){event.preventDefault();setFollow(false);fit();}});
  new ResizeObserver(resize).observe(stage);setInterval(()=>{if(visibleStage)schedule();},250);loadCatalog();setFollow(true);
  return {
    update(next){state=next;receivedAt=Date.now();connected=true;const data=next.cubes?.map;markers=Array.isArray(data?.markers)?data.markers:[];updateContexts(Array.isArray(data?.contexts)?data.contexts:[]);schedule();},
    disconnected(){connected=false;schedule();},
    setCatalog(body){try{acceptCatalog(body);options.catalog=body;}catch(error){catalogError=error.message;}catalogLoading=false;schedule();}
  };
}
