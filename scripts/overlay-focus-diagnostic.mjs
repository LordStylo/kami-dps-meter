// Read-only foreground/cursor diagnostics. No input, hooks or process memory.
// Records only Alt/Tab/switch keys, window ownership and cursor geometry.
import fs from 'node:fs';
import path from 'node:path';
import koffi from 'koffi';
import native from '../overlay/windows.cjs';
const user=koffi.load('user32.dll');
const threadId=user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr window, _Out_ uint32 *pid)');
const gui=user.func('int __stdcall GetGUIThreadInfo(uint32 thread, void *info)');
const clip=user.func('int __stdcall GetClipCursor(void *rect)');
const cursor=user.func('int __stdcall GetCursorPos(void *point)');
const className=user.func('int __stdcall GetClassNameW(uintptr window, void *name, int count)');
const seconds=Math.min(120,Math.max(1,Number(process.argv[2])||60));
const file=path.resolve('tmp',`overlay-focus-${Date.now()}.ndjson`);
fs.mkdirSync(path.dirname(file),{recursive:true});
const output=fs.createWriteStream(file,{flags:'wx'}),started=Date.now();
const gameThreads=new Map();let pids=native.gamePids(),lastCheck=started,last='',rows=0;
function windowInfo(window){const pid=[0];threadId(window,pid);return {window:Number(window),pid:pid[0]};}
function guiInfo(thread){const b=Buffer.alloc(72);b.writeUInt32LE(72);if(!gui(thread,b))return null;return {flags:b.readUInt32LE(4),active:windowInfo(b.readBigUInt64LE(8)),focus:windowInfo(b.readBigUInt64LE(16)),capture:windowInfo(b.readBigUInt64LE(24))};}
console.log(JSON.stringify({file,seconds,readOnly:true}));
while(Date.now()-started<seconds*1000){
 if(Date.now()-lastCheck>2000){pids=native.gamePids();lastCheck=Date.now();}
 const input=native.input(),rect=Buffer.alloc(16),point=Buffer.alloc(8),name=Buffer.alloc(256);
 className(input.foregroundWindow,name,128);
 if(pids.has(input.foregroundPid)){const id=threadId(input.foregroundWindow,[0]);gameThreads.set(input.foregroundPid,id);}
 const value={...input,foregroundWindow:Number(input.foregroundWindow),class:name.toString('utf16le').split('\0')[0],gui:guiInfo(0),gameGui:[...gameThreads].map(([pid,id])=>({pid,...guiInfo(id)})),clip:clip(rect)?[0,4,8,12].map(n=>rect.readInt32LE(n)):null,cursor:cursor(point)?[point.readInt32LE(0),point.readInt32LE(4)]:null};
 const key=JSON.stringify(value);
 if(key!==last){output.write(JSON.stringify({ms:Date.now()-started,...value})+'\n');rows++;last=key;}
 await new Promise(resolve=>setTimeout(resolve,25));
}
await new Promise(resolve=>output.end(resolve));console.log(JSON.stringify({file,rows}));
