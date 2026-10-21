const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const configured=value=>typeof value==='string'&&value.trim()?path.resolve(value):null;
const within=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
function runtimePaths({root=path.resolve(__dirname,'..'),port=4317,env=process.env,profile}={}){
  root=path.resolve(root);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new TypeError('Invalid runtime port');
  let installed=!!configured(env.AION_DATA_DIR),dataDir=configured(env.AION_DATA_DIR);
  const marker=path.join(root,'installed.json');
  if(!installed&&fs.existsSync(marker)){
    if(JSON.parse(fs.readFileSync(marker,'utf8')).format!=='kami-installed/1')throw Error('Invalid installed application marker');
    if(!configured(env.LOCALAPPDATA))throw Error('LOCALAPPDATA is required for the installed application');
    installed=true;dataDir=path.join(configured(env.LOCALAPPDATA),'Kami DPS Meter','data');
  }
  dataDir=dataDir||root;
  const archive=configured(env.AION_HISTORY_DIR)||path.join(dataDir,...installed?['archive']:['settings','archive']);
  const pets=configured(env.AION_PETS_DIR)||(configured(env.AION_HISTORY_DIR)?path.join(archive,'pets'):path.join(dataDir,...installed?['pets']:['settings','pets']));
  const overlay=configured(profile)||configured(env.AION_OVERLAY_PROFILE_DIR)||path.join(dataDir,...installed?[`overlay-${port}`]:['settings',`overlay-${port}`]);
  const captures=path.join(dataDir,'captures'),tmp=path.join(dataDir,'tmp');
  const paths={root,installed,dataDir,archive,pets,profile:overlay,captures,research:path.join(captures,'cube-research'),tmp};
  const canonical=value=>process.platform==='win32'?value.toLowerCase():value;
  paths.instanceId=crypto.createHash('sha256').update(JSON.stringify([root,archive,pets,overlay,captures,tmp].map(canonical))).digest('hex');
  return paths;
}

// Migration is explicit, copy-only and limited to portable user data. Runtime
// command/PID files and Chromium caches are not user preferences.
function seedPortableData({sourceRoot,dataDir,probe=pid=>process.kill(pid,0)}={}){
  if(!configured(sourceRoot)||!configured(dataDir))throw new TypeError('Explicit migration source and destination are required');
  const source=path.resolve(sourceRoot),target=path.resolve(dataDir);
  if(source===target||within(source,target)||within(target,source))throw Error('Migration source and destination must be separate folders');
  if(fs.lstatSync(source).isSymbolicLink()||!fs.statSync(source).isDirectory())throw Error('Migration source must be an ordinary folder');
  if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('Linked migration destinations are not allowed');
  let ancestor=target;const suffix=[];
  while(!fs.existsSync(ancestor)){suffix.unshift(path.basename(ancestor));const parent=path.dirname(ancestor);if(parent===ancestor)throw Error('Invalid migration destination');ancestor=parent;}
  const realSource=fs.realpathSync(source),realTarget=path.join(fs.realpathSync(ancestor),...suffix);
  const canonical=value=>process.platform==='win32'?value.toLowerCase():value;
  if(canonical(realTarget)!==canonical(target))throw Error('Linked migration destinations are not allowed');
  if(realSource===realTarget||within(realSource,realTarget)||within(realTarget,realSource))throw Error('Migration folders overlap');
  const plan=[],roots=[],settings=path.join(source,'settings');
  if(fs.existsSync(settings)&&fs.lstatSync(settings).isSymbolicLink())throw Error('Linked migration data is not allowed');
  function requireClosed(filename,json=false){
    if(!fs.existsSync(filename))return;
    if(fs.lstatSync(filename).isSymbolicLink()||fs.statSync(filename).size>65536)throw Error('Invalid portable process marker; close the old Kami before importing');
    let pid;try{const text=fs.readFileSync(filename,'utf8');pid=json?JSON.parse(text).pid:Number(text.trim());}catch{throw Error('Close the old Kami before importing its browser data');}
    if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid portable process marker; close the old Kami before importing');
    try{probe(pid);}catch(error){if(error.code==='ESRCH')return;throw Error('The old Kami may still be running; close it completely before importing');}
    throw Error('The old Kami is running; close it completely before importing');
  }
  if(fs.existsSync(path.join(source,'tmp'))&&fs.lstatSync(path.join(source,'tmp')).isSymbolicLink())throw Error('Linked migration data is not allowed');
  requireClosed(path.join(source,'tmp','server.pid'));
  for(const name of ['archive','pets'])if(fs.existsSync(path.join(settings,name)))roots.push({from:path.join(settings,name),to:path.join(target,name)});
  if(fs.existsSync(settings))for(const name of fs.readdirSync(settings))if(/^overlay-\d+$/.test(name)){
    const folder=path.join(settings,name);
    if(fs.lstatSync(folder).isSymbolicLink())throw Error('Linked migration data is not allowed');
    requireClosed(path.join(folder,'host.json'),true);
    for(const item of ['layout.json','browser'])if(fs.existsSync(path.join(folder,item)))roots.push({from:path.join(folder,item),to:path.join(target,name,item)});
  }
  if(fs.existsSync(path.join(source,'captures')))roots.push({from:path.join(source,'captures'),to:path.join(target,'captures')});
  const ignored=new Set(['Cache','Code Cache','GPUCache','DawnCache','ShaderCache','SingletonLock','SingletonCookie','SingletonSocket','LOCK','lockfile','DevToolsActivePort']);
  let bytes=0;
  function inspect(from,to){
    const stat=fs.lstatSync(from);if(stat.isSymbolicLink())throw Error('Linked migration data is not allowed');
    if(stat.isDirectory()){for(const name of fs.readdirSync(from))if(!ignored.has(name))inspect(path.join(from,name),path.join(to,name));return;}
    if(!stat.isFile())throw Error('Unsupported migration data');
    if(!within(target,to)||stat.size>512*1024*1024||plan.length>=100000||(bytes+=stat.size)>10*1024*1024*1024)throw Error('Migration data limit exceeded');
    plan.push({from,to,bytes:stat.size});
  }
  for(const entry of roots)inspect(entry.from,entry.to);
  if(!roots.length)throw Error('The selected folder contains no portable user data');
  let copied=0,skipped=0,copiedBytes=0;
  for(const entry of plan){
    let parent=path.dirname(entry.to);
    while(parent!==path.dirname(target)){
      if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('Linked migration destinations are not allowed');
      if(parent===target)break;parent=path.dirname(parent);
    }
    fs.mkdirSync(path.dirname(entry.to),{recursive:true});
    try{fs.copyFileSync(entry.from,entry.to,fs.constants.COPYFILE_EXCL);copied++;copiedBytes+=entry.bytes;}
    catch(error){if(error.code==='EEXIST')skipped++;else throw error;}
  }
  return {copied,skipped,bytes:copiedBytes};
}

module.exports={runtimePaths,seedPortableData};
if(require.main===module){
  const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
  try{
    const paths=runtimePaths({root:option('root')||path.resolve(__dirname,'..'),port:Number(option('port')||4317),profile:option('profile')});
    const source=option('seed-portable');
    if(source){if(!paths.installed)throw Error('Portable data can be imported only into the installed data directory');console.log(JSON.stringify(seedPortableData({sourceRoot:source,dataDir:paths.dataDir})));}
    else console.log(JSON.stringify(paths));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
