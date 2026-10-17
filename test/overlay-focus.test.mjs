import test from 'node:test';
import assert from 'node:assert/strict';
import {FocusSession} from '../overlay/focus.cjs';

const game={foreground:'game',alt:true};
const blocked={visible:false,interactive:false};

test('Alt only changes mouse interaction; visibility remains when Alt is released',()=>{
 const focus=new FocusSession();
 for(let i=0;i<10;i++){
  assert.deepEqual(focus.update(game),{visible:true,interactive:true});
  assert.deepEqual(focus.update({...game,alt:false}),{visible:true,interactive:false});
 }
});

test('Alt+Tab cancels interaction before the foreground window changes',()=>{
 const focus=new FocusSession();focus.update(game);
 for(const input of [{...game,tab:true},game,{...game,alt:false}])assert.deepEqual(focus.update(input),blocked);
 assert.deepEqual(focus.update({...game,alt:false}),{visible:true,interactive:false});
 assert.deepEqual(focus.update(game),{visible:true,interactive:true});
});

test('a desktop transition hides overlays even if the Tab press was missed',()=>{
 const focus=new FocusSession();focus.update(game);
 for(let i=0;i<100;i++)assert.deepEqual(focus.update({foreground:'other',alt:false}),blocked);
 assert.deepEqual(focus.update({...game,alt:false}),{visible:true,interactive:false});
});

test('returning to the game while the switching Alt gesture is still held stays inactive',()=>{
 const focus=new FocusSession();focus.update(game);
 focus.update({foreground:'other',alt:true});
 assert.deepEqual(focus.update(game),blocked);
 assert.deepEqual(focus.update({...game,alt:false}),blocked);
 assert.deepEqual(focus.update(game),{visible:true,interactive:true});
});

test('Alt+Escape and Windows shortcuts suppress the whole gesture',()=>{
 for(const shortcut of [{escape:true},{windows:true}]){
  const focus=new FocusSession();focus.update(game);
  assert.deepEqual(focus.update({...game,...shortcut}),blocked);
  assert.deepEqual(focus.update(game),blocked);
  assert.deepEqual(focus.update({...game,alt:false}),blocked);
  assert.deepEqual(focus.update(game),{visible:true,interactive:true});
 }
});

test('desktop editing allows mouse input with or without Alt, but respects app switches',()=>{
 const focus=new FocusSession(),desktop={foreground:'other',desktopEdit:true};
 assert.deepEqual(focus.update(desktop),{visible:true,interactive:true});
 assert.deepEqual(focus.update({...desktop,alt:true}),{visible:true,interactive:true});
 assert.deepEqual(focus.update({...desktop,alt:true,tab:true}),blocked);
 assert.deepEqual(focus.update(desktop),blocked);
 assert.deepEqual(focus.update(desktop),{visible:true,interactive:true});
});

test('explicit hiding disables input in both game and desktop modes',()=>{
 for(const input of [game,{foreground:'other',desktopEdit:true}]){
  const focus=new FocusSession();
  assert.deepEqual(focus.update({...input,hiddenByUser:true}),blocked);
  assert.deepEqual(focus.update(input),{visible:true,interactive:true});
 }
});

test('overlay foreground is never treated as game foreground',()=>{
 const focus=new FocusSession();focus.update(game);
 assert.deepEqual(focus.update({foreground:'overlay',alt:false}),blocked);
 assert.deepEqual(focus.update({foreground:'overlay',alt:true}),blocked);
});
