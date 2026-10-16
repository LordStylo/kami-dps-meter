// Synthetic WM_HOTKEY messages are sent only to this worker's own Windows queue.
// No physical keyboard input or game traffic is generated.
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import assert from 'node:assert/strict';
import koffi from 'koffi';
import {createCubeHotkeys} from '../src/capture/hotkeys.mjs';
if(isMainThread){
  const worker=new Worker(new URL(import.meta.url));
  const timer=setTimeout(()=>{worker.terminate();console.error('Hotkey test timed out');process.exitCode=1;},10000);
  worker.on('message',m=>console.log(JSON.stringify(m,null,2)));
  worker.on('error',e=>{console.error(e.message);process.exitCode=1;});
  worker.on('exit',code=>{clearTimeout(timer);if(code)process.exitCode=1;});
}else{
  const actions=[],keys=createCubeHotkeys(action=>actions.push(action));
  try{
    keys.setEnabled(true);assert.equal(keys.status().found,true,keys.status().error);assert.equal(keys.status().opened,true,keys.status().error);
    const kernel=koffi.load('kernel32.dll'),user=koffi.load('user32.dll');
    const thread=kernel.func('uint32 __stdcall GetCurrentThreadId()')();
    const post=user.func('bool __stdcall PostThreadMessageW(uint32 thread, uint32 message, uintptr wParam, intptr lParam)');
    assert.equal(post(thread,0x0312,0x4b31,0),true);assert.equal(post(thread,0x0312,0x4b32,0),true);
    keys.poll();assert.deepEqual(actions,['found','opened']);keys.close();keys.setEnabled(true);
    assert.equal(keys.status().found,true);assert.equal(keys.status().opened,true);
    parentPort.postMessage({register:'passed',workerQueue:'passed',found:'passed',opened:'passed',reRegister:'passed',physicalInGameKeysTested:false});
  }finally{keys.close();}
}
