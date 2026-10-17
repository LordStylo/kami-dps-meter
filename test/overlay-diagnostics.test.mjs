import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createDiagnostics} from '../overlay/diagnostics.cjs';

function setup(t,options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kami-diagnostics-'));
 const processObject=Object.assign(new EventEmitter(),{pid:12345});
 const logger=createDiagnostics({directory,processObject,...options});
 t.after(()=>{logger.dispose();fs.rmSync(directory,{recursive:true,force:true});});
 const entries=()=>fs.readFileSync(logger.path,'utf8').trim().split('\n').map(JSON.parse);
 return {directory,processObject,logger,entries};
}

test('diagnostics distinguish renderer loss, window close and a normal process shutdown',t=>{
 const {directory,processObject,logger,entries}=setup(t);
 const window=Object.assign(new EventEmitter(),{webContents:new EventEmitter()});
 logger.attachProcess();logger.attachProcess();logger.watchWindow(window,'dps');
 window.webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:-1073740791});
 window.emit('closed');logger.beforeQuit('tray-quit');processObject.emit('exit',0);
 const rows=entries();
 assert.equal(rows.filter(row=>row.event==='process-exit').length,1);
 assert.deepEqual(rows.find(row=>row.event==='renderer-gone').exitCode,-1073740791);
 assert.equal(rows.find(row=>row.event==='window-closed').panel,'dps');
 assert.equal(rows.at(-1).normal,true);
 assert.equal(fs.existsSync(path.join(directory,'diagnostics-session.json')),false);
 logger.dispose();assert.equal(processObject.listenerCount('exit'),0);
 assert.equal(window.webContents.listenerCount('render-process-gone'),0);
});

test('fatal errors are observed without adding handlers that swallow the exception or rejection',t=>{
 const {directory,processObject,logger,entries}=setup(t);logger.attachProcess();
 assert.equal(processObject.listenerCount('uncaughtException'),0);
 assert.equal(processObject.listenerCount('unhandledRejection'),0);
 const error=new Error('failure');
 error.stack='Error: failure\n at C:\\Users\\demir\\Desktop\\aion\\overlay\\main.cjs:1:2\n at https://user:secret@example.org/script.js?token=secret#private:3:4';
 processObject.emit('uncaughtExceptionMonitor',error,'unhandledRejection');
 logger.beforeQuit();processObject.emit('exit',0);
 const rows=entries(),failure=rows.find(row=>row.event==='unhandled-rejection');
 assert.equal(failure.message,'failure');
 assert.match(failure.stack,/<user>/);assert.doesNotMatch(failure.stack,/demir|secret|token=|private/);
 assert.equal(rows.at(-1).normal,false);
 assert.equal(fs.existsSync(path.join(directory,'diagnostics-session.json')),true);
});

test('next startup identifies an interrupted session but not a clean shutdown',t=>{
 const {directory,processObject,logger}=setup(t);logger.attachProcess();
 const nextProcess=Object.assign(new EventEmitter(),{pid:6789});
 const next=createDiagnostics({directory,processObject:nextProcess});t.after(()=>next.dispose());
 const rows=fs.readFileSync(next.path,'utf8').trim().split('\n').map(JSON.parse);
 const interrupted=rows.find(row=>row.event==='previous-session-incomplete');
 assert.equal(interrupted.previousPid,12345);
 logger.beforeQuit();processObject.emit('exit',0);
 assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'diagnostics-session.json'),'utf8')).pid,6789);
 next.attachProcess();next.beforeQuit();nextProcess.emit('exit',0);next.dispose();
 const third=createDiagnostics({directory,processObject:nextProcess});t.after(()=>third.dispose());
 const finalRows=fs.readFileSync(third.path,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(finalRows.filter(row=>row.event==='previous-session-incomplete').length,1);
});

test('rotation bounds both files and each record stays valid JSON',t=>{
 const {directory,logger}=setup(t,{maxBytes:1200});
 for(let i=0;i<40;i++)assert.equal(logger.record('window-test',{panel:'dps',code:i}),true);
 logger.error('oversized-error',new Error('ş'.repeat(12000)));
 for(const name of ['diagnostics.ndjson','diagnostics.previous.ndjson']){
  const filename=path.join(directory,name);assert.ok(fs.statSync(filename).size<=1200);
  for(const row of fs.readFileSync(filename,'utf8').trim().split('\n'))assert.doesNotThrow(()=>JSON.parse(row));
 }
});

test('unexpected fields and arbitrary rejection objects never enter the log',t=>{
 const {logger,entries}=setup(t);
 logger.record('test',{panel:'cube',state:{character:'private'},packets:'private',token:'private'});
 logger.error('rejection',{token:'private',toString(){throw Error('must not stringify arbitrary object');}});
 const rows=entries();assert.equal(rows.at(-1).message,'Rejected object value');
 assert.equal(JSON.stringify(rows).includes('private'),false);
});

test('failed local writes never replace the original error with a logging exception',t=>{
 const failure=()=>{throw Object.assign(new Error('disk unavailable'),{code:'EACCES'});};
 const fakeFs={mkdirSync:failure,readFileSync:failure,writeFileSync:failure};
 const {processObject,logger}=setup(t,{fsModule:fakeFs});logger.attachProcess();
 assert.equal(logger.record('window-closed',{panel:'cube'}),false);
 assert.doesNotThrow(()=>processObject.emit('uncaughtExceptionMonitor',new Error('original failure'),'uncaughtException'));
 assert.doesNotThrow(()=>{logger.beforeQuit();processObject.emit('exit',1);});
});
