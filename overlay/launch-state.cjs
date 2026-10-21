const path=require('node:path');
const {readHostState}=require('./host-state.cjs');
const win=require('./windows.cjs');
const {runtimePaths}=require('./runtime-paths.cjs');
const port=Number(process.argv[2]||4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local server port');
const paths=runtimePaths({root:path.resolve(__dirname,'..'),port});
const {running,alive}=readHostState(path.join(paths.profile,'host.json'));
const observed=win.elevated(running?.pid);
// Windows can deny a lower-privilege launcher access to the elevated token.
// The host marker is written by our running instance after checking its token.
const runningElevated=alive&&(observed===true||(observed===null&&running.elevated===true));
console.log(JSON.stringify({elevationRequired:win.elevated(process.pid)!==true&&[...win.gamePids()].some(pid=>win.elevated(pid)===true),runningElevated,running:alive,features:alive&&Array.isArray(running?.features)?running.features:[]}));
