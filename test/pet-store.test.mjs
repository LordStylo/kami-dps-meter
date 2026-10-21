import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PetStore} from '../src/pet-store.mjs';
const character={name:'Pet Tester',server:1316};
const snapshot=(extra={})=>({character,complete:true,at:Date.now(),status:'live',revision:1,levels:{1002:1},souls:{1002:7},...extra});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'kami-pets-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});return root;}
test('Quest import is read-only saved evidence and a different character cannot inherit its collection',t=>{
 const root=fixture(t),quest=path.join(root,'quest.json'),bytes=JSON.stringify({character:{...character,confirmedAt:1000,levels:{1002:2},souls:{1002:4}}});fs.writeFileSync(quest,bytes);
 const store=new PetStore({directory:path.join(root,'kami'),questSnapshotFile:quest});
 assert.equal(fs.readFileSync(quest,'utf8'),bytes);const saved=store.snapshot(character,{live:true});assert.equal(saved.status,'saved');assert.equal(saved.source,'questlog-import');assert.equal(saved.levels[1002],2);
 const other=store.snapshot({...character,server:1317},{live:true});assert.equal(other.status,'unknown');assert.equal(other.complete,false);assert.deepEqual(other.levels,{});
 assert.equal(store.seeds()[0].status,'saved');
});
test('partial observations merge known fields while only a full snapshot replaces proven absence',t=>{
 const store=new PetStore({directory:fixture(t)});store.observe(snapshot());
 store.observe(snapshot({complete:false,at:Date.now()+10,revision:2,levels:{1003:1},souls:{1003:2}}));
 const partial=store.snapshot(character,{live:true});assert.equal(partial.levels[1002],1);assert.equal(partial.levels[1003],1);assert.equal(partial.complete,true);
 store.observe(snapshot({at:Date.now()+20,revision:3,levels:{1003:2},souls:{}}));
 const full=store.snapshot(character,{live:true});assert.equal(full.levels[1002],undefined);assert.equal(full.levels[1003],2);assert.equal(full.status,'live');
});
test('saved collection survives a process restart and is never presented live without matching current evidence',t=>{
 const root=fixture(t),first=new PetStore({directory:root});first.observe(snapshot());
 assert.equal(first.snapshot(character,{live:false}).status,'saved');
 const second=new PetStore({directory:root});assert.equal(second.snapshot(character,{live:true}).status,'saved');assert.equal(second.snapshot(character).souls[1002],7);
 second.observe(snapshot({character:{name:'Other',server:1316},at:Date.now()+10}));assert.equal(second.snapshot(character,{live:true}).status,'saved');
});
test('stale or malformed collection updates cannot overwrite accepted data',t=>{
 const store=new PetStore({directory:fixture(t)});store.observe(snapshot({at:2000}));store.observe(snapshot({at:1000,revision:2,levels:{1002:3}}));assert.equal(store.snapshot(character).levels[1002],1);
 store.observe(snapshot({at:3000,revision:3,levels:{1002:99}}));assert.equal(store.snapshot(character).levels[1002],1);assert.equal(store.errors.length,1);
});
test('unknown identity does not invent owned state and bad saved files stay visibly recoverable',t=>{
 const root=fixture(t);fs.writeFileSync(path.join(root,'collections.json'),'{bad');const store=new PetStore({directory:root});assert.equal(store.snapshot().status,'unknown');assert.equal(store.snapshot().complete,false);assert.equal(store.errors.length,1);assert.equal(fs.readFileSync(path.join(root,'collections.json'),'utf8'),'{bad');
});
test('touching an old Quest file cannot overwrite an existing own collection',t=>{
 const root=fixture(t),directory=path.join(root,'kami'),quest=path.join(root,'quest.json');const first=new PetStore({directory});first.observe(snapshot({at:2000,levels:{1002:3}}));
 fs.writeFileSync(quest,JSON.stringify({character:{...character,confirmedAt:1000,levels:{1002:1},souls:{}}}));fs.utimesSync(quest,new Date(10000),new Date(10000));
 const second=new PetStore({directory,questSnapshotFile:quest});assert.equal(second.snapshot(character).levels[1002],3);assert.equal(second.snapshot(character).at,2000);
});
test('a rejected live update cannot promote saved data to live and partial records are not full seeds',t=>{
 const root=fixture(t),store=new PetStore({directory:root});store.observe(snapshot({status:'saved',at:1000}));
 store.observe(snapshot({status:'live',at:2000,revision:2,levels:{1002:99}}));assert.equal(store.snapshot(character,{live:true}).status,'saved');
 const partial=new PetStore({directory:path.join(root,'partial')});partial.observe(snapshot({complete:false}));assert.equal(partial.seeds().length,0);assert.equal(partial.snapshot(character).complete,false);
});
