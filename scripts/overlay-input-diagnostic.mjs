// Read-only diagnostics of overlay input; never records typed keys or sends input.
import koffi from 'koffi';
const u=koffi.load('user32.dll'),k=koffi.load('kernel32.dll'),a=koffi.load('advapi32.dll');
const foreground=u.func('uintptr __stdcall GetForegroundWindow()');
const windowPid=u.func('uint32 __stdcall GetWindowThreadProcessId(uintptr window, _Out_ uint32 *pid)');
const key=u.func('int16 __stdcall GetAsyncKeyState(int key)');
const open=k.func('uintptr __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)');
const close=k.func('int __stdcall CloseHandle(uintptr handle)');
const token=a.func('int __stdcall OpenProcessToken(uintptr process, uint32 access, _Out_ uintptr *token)');
const info=a.func('int __stdcall GetTokenInformation(uintptr token, int kind, void *buffer, uint32 length, _Out_ uint32 *returned)');
function elevated(pid){const h=open(0x1000,0,pid),t=[0];if(!h)return null;try{if(!token(h,8,t))return null;try{const b=Buffer.alloc(4);return info(t[0],20,b,4,[0])?b.readUInt32LE(0)!==0:null;}finally{close(t[0]);}}finally{close(h);}}
console.log(JSON.stringify({processElevation:process.argv.slice(2).map(Number).filter(Number.isInteger).map(pid=>({pid,elevated:elevated(pid)})),probeElevation:elevated(process.pid)}));
let previous='';const end=Date.now()+15000;
while(Date.now()<end){const pid=[0];windowPid(foreground(),pid);const value=JSON.stringify({foregroundPid:pid[0],alt:!!(key(0x12)&0x8000),left:!!(key(1)&0x8000)});if(value!==previous){console.log(value);previous=value;}await new Promise(r=>setTimeout(r,50));}
