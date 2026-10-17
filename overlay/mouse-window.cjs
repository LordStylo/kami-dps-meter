// Window callbacks stay inside a tiny native DLL. Entering V8 from a Windows
// window procedure is unsafe during Chromium's modal mouse/resize handling.
// Koffi is used only for ordinary JS -> C install/remove calls, never callbacks.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const koffi=require('koffi');
const filename=path.join(__dirname,'mouse-policy.win32-x64.dll');
let metadata;
try{metadata=JSON.parse(fs.readFileSync(path.join(__dirname,'mouse-policy.build.json'),'utf8'));}
catch{throw Error('Native mouse helper is missing. Run scripts/build-overlay-native.ps1 or extract the complete portable package.');}
if(metadata.abi!==1||metadata.platform!=='win32-x64'||crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')!==metadata.dllSHA256)throw Error('Native mouse helper checksum/ABI mismatch. Rebuild the helper or extract the complete package.');
// Keep this library loaded until process exit; subclass procedures may remain
// installed on an HWND until WM_NCDESTROY, independently of JavaScript GC.
const library=koffi.load(filename);
const version=library.func('uint32 __stdcall KamiMousePolicyVersion()');
const install=library.func('int __stdcall KamiInstallMousePolicy(uintptr window)');
const remove=library.func('int __stdcall KamiRemoveMousePolicy(uintptr window)');
if(version()!==1)throw Error('Unsupported native mouse helper ABI');
function allowMouseWithoutActivation(window){
 if(!install(window))throw Error('Mouse policy requires an overlay window on this thread');
 let released=false;
 return ()=>{if(released)return;released=true;remove(window);};
}
module.exports={allowMouseWithoutActivation};
