const fs=require('node:fs');
function readHostState(filename,{fsModule=fs,probe=pid=>process.kill(pid,0)}={}){
 let raw,running;try{raw=fsModule.readFileSync(filename,'utf8');running=JSON.parse(raw);}catch{return {running:null,alive:false};}
 if(!Number.isInteger(running?.pid)||running.pid<=0)return {running:null,alive:false};
 try{probe(running.pid);return {running,alive:true};}
 catch(error){
  // Lack of access does not mean an elevated overlay is dead. Only ESRCH
  // proves absence; do not signal or kill any process using this cached PID.
  if(error.code!=='ESRCH')return {running,alive:true};
  try{if(fsModule.readFileSync(filename,'utf8')===raw)fsModule.unlinkSync(filename);}catch{}
  return {running:null,alive:false};
 }
}
module.exports={readHostState};
