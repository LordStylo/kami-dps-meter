const fs=require('node:fs'),path=require('node:path');
const win=require('./windows.cjs');
const port=Number(process.argv[2]||4317);
let running=null;try{running=JSON.parse(fs.readFileSync(path.join(__dirname,'../settings',`overlay-${port}`,'host.json'),'utf8'));}catch{}
let alive=false;if(Number.isInteger(running?.pid)&&running.pid>0){try{process.kill(running.pid,0);alive=true;}catch(error){alive=error.code==='EPERM';}}
const observed=win.elevated(running?.pid);
// Windows can deny a lower-privilege launcher access to the elevated token.
// The host marker is written by our running instance after checking its token.
const runningElevated=alive&&(observed===true||(observed===null&&running.elevated===true));
console.log(JSON.stringify({elevationRequired:win.elevated(process.pid)!==true&&[...win.gamePids()].some(pid=>win.elevated(pid)===true),runningElevated}));
