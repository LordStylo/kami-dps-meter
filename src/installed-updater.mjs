import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const problem=(message,status=409)=>Object.assign(new Error(message),{status});
export function installedPackage(root){
  try{return JSON.parse(fs.readFileSync(path.join(root,'installed.json'),'utf8')).format==='kami-installed/1';}catch{return false;}
}
export function assertUpdateIdle(state){
  if(state?.combat?.active||state?.combat?.encounterActive)throw problem('Güncellemeyi savaş bittikten sonra başlat.');
  if(state?.research?.active||state?.research?.armed)throw problem('Güncellemeden önce test kaydını bitir.');
  if(state?.archive?.activeRun?.timingSource==='manual')throw problem('Güncellemeden önce açık zindan turunu bitir.');
}
export function createInstallerHandoff({root,dataDir,port,getState,onHandoffFailure,platform=process.platform,spawnProcess=spawn,env=process.env}){
  if(platform!=='win32'||!installedPackage(root))return undefined;
  const script=path.join(root,'scripts','apply-update.ps1');
  return async({installerPath,version,sha256})=>{
    if(!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{64}$/i.test(sha256))throw problem('Güncelleme bilgisi geçersiz.',400);
    const directory=fs.realpathSync(path.join(dataDir,'updates'));
    const file=fs.realpathSync(installerPath);
    if(!file.startsWith(directory+path.sep)||path.basename(file)!==`Kami-DPS-Meter-Setup-${version}.exe`||!fs.statSync(file).isFile())throw problem('Güncelleme dosyası geçersiz.',400);
    const hash=crypto.createHash('sha256');
    for await(const chunk of fs.createReadStream(file))hash.update(chunk);
    if(hash.digest('hex')!==sha256.toLowerCase())throw problem('Güncelleme dosyası doğrulanamadı.',400);
    if(!fs.existsSync(script))throw problem('Güncelleme yardımcısı bulunamadı.',503);
    assertUpdateIdle(getState());
    const executable=path.join(env.SystemRoot||env.WINDIR||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const acknowledgement=path.join(directory,`handoff-${crypto.randomUUID()}.json`);
    const child=spawnProcess(executable,['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Root',root,'-DataDir',dataDir,'-Installer',file,'-SHA256',sha256.toLowerCase(),'-Port',String(port),'-BackendPid',String(process.pid),'-AckFile',acknowledgement],{cwd:root,env:{...env,AION_DATA_DIR:dataDir},windowsHide:true,detached:true,stdio:'ignore'});
    let accepted=false;
    child.once('exit',()=>{if(accepted)onHandoffFailure?.('Güncelleme başlatılamadı. Savaşın ve açık işlemlerin bitmesini bekleyip yeniden dene.');});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    try{
      await new Promise((resolve,reject)=>{
        const started=Date.now();
        const timer=setInterval(()=>{
          try{
            if(fs.existsSync(acknowledgement)){
              const reply=JSON.parse(fs.readFileSync(acknowledgement,'utf8').replace(/^\uFEFF/,''));
              clearInterval(timer);
              if(reply.ok===true)resolve();else reject(problem(reply.error||'Güncelleme başlatılamadı.'));
            }else if(Date.now()-started>20000){clearInterval(timer);child.kill();reject(problem('Güncelleme yardımcısı zaman aşımına uğradı.',504));}
          }catch(error){
            if(!(error instanceof SyntaxError)&&!['ENOENT','EACCES','EPERM','EBUSY'].includes(error.code)){clearInterval(timer);reject(error);}
            else if(Date.now()-started>20000){clearInterval(timer);child.kill();reject(problem('Güncelleme yardımcısı yanıtı okunamadı.',504));}
          }
        },100);
        child.once('exit',()=>{clearInterval(timer);reject(problem('Güncelleme yardımcısı başlatılamadı.',503));});
      });
    }finally{try{fs.unlinkSync(acknowledgement);}catch{}}
    accepted=true;
    child.unref();
    return {ok:true,version,restartExpected:true};
  };
}
