// Only Windows process metadata, foreground ownership and two input states.
// No process memory, hooks, injected input or game modifications.
const koffi=require('koffi');
const user=koffi.load('user32.dll'),kernel=koffi.load('kernel32.dll'),security=koffi.load('advapi32.dll');
const foreground=user.func('uintptr __stdcall GetForegroundWindow()');
const windowPid=user.func('uint32 __stdcall GetWindowThreadProcessId(uintptr window, _Out_ uint32 *pid)');
const key=user.func('int16 __stdcall GetAsyncKeyState(int key)');
const validWindow=user.func('int __stdcall IsWindow(uintptr window)');
const setForeground=user.func('int __stdcall SetForegroundWindow(uintptr window)');
const snapshot=kernel.func('uintptr __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)');
const first=kernel.func('int __stdcall Process32FirstW(uintptr snapshot, void *entry)');
const next=kernel.func('int __stdcall Process32NextW(uintptr snapshot, void *entry)');
const open=kernel.func('uintptr __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)');
const close=kernel.func('int __stdcall CloseHandle(uintptr handle)');
const token=security.func('int __stdcall OpenProcessToken(uintptr process, uint32 access, _Out_ uintptr *token)');
const info=security.func('int __stdcall GetTokenInformation(uintptr token, int kind, void *buffer, uint32 length, _Out_ uint32 *returned)');
function gamePids(){
 const found=new Set(),handle=snapshot(2,0);
 if(!handle||BigInt(handle)===0xffffffffffffffffn)return found;
 try{const entry=Buffer.alloc(568);entry.writeUInt32LE(568);let ok=first(handle,entry);
  while(ok){const name=entry.subarray(44,564).toString('utf16le').split('\0')[0];if(/^aion2\.exe$/i.test(name))found.add(entry.readUInt32LE(8));ok=next(handle,entry);}
 }finally{close(handle);}return found;
}
function elevated(pid){
 if(!Number.isInteger(pid)||pid<=0)return null;
 const handle=open(0x1000,0,pid),out=[0];if(!handle)return null;
 try{if(!token(handle,8,out))return null;try{const b=Buffer.alloc(4);return info(out[0],20,b,4,[0])?b.readUInt32LE(0)!==0:null;}finally{close(out[0]);}}finally{close(handle);}
}
function input(){const pid=[0],window=foreground();windowPid(window,pid);return {foregroundWindow:window,foregroundPid:pid[0],alt:!!(key(0x12)&0x8000),left:!!(key(1)&0x8000)};}
function restoreGame(window,pids){if(!window||!validWindow(window))return false;const pid=[0];windowPid(window,pid);return pids.has(pid[0])&&!!setForeground(window);}
module.exports={gamePids,elevated,input,restoreGame};
