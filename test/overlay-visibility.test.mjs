import test from 'node:test';
import assert from 'node:assert/strict';
import {panelVisible} from '../overlay/interaction.cjs';
const live=active=>({connected:true,state:{mode:'live',combat:{active},current:{damage:1000},last:{damage:2000}}});
test('DPS auto-hides on combat exit and reappears in combat without affecting cube or controls',()=>{
 for(const active of [false,true,false,true]){
  assert.equal(panelVisible('dps',{},true,live(active)),active);
  assert.equal(panelVisible('cube',{},true,live(active)),true);
  assert.equal(panelVisible('controls',{},true,live(active)),true);
 }
});
test('combat never overrides user hiding or Alt+Tab visibility policy, even while collapsed',()=>{
 assert.equal(panelVisible('dps',{dps:{enabled:false}},true,live(true)),false);
 assert.equal(panelVisible('dps',{},false,live(true)),false);
 assert.equal(panelVisible('dps',{dps:{collapsed:true}},true,live(false)),false);
});
test('desktop editing and recording/demo views allow inspection outside combat',()=>{
 assert.equal(panelVisible('dps',{},true,{...live(false),desktopEdit:true}),true);
 for(const mode of ['demo','replay'])assert.equal(panelVisible('dps',{},true,{state:{mode}}),true);
 assert.equal(panelVisible('dps',{},true,{...live(true),connected:false}),false);
});
test('automatic hiding defaults on and its setting allows inspecting finished damage',()=>{
 const outOfCombat=live(false);
 for(const layout of [{},{dps:{}},{dps:{autoHide:true}}]){
  assert.equal(panelVisible('dps',layout,true,outOfCombat),false);
 }
 assert.equal(panelVisible('dps',{dps:{autoHide:false}},true,outOfCombat),true);
 assert.equal(panelVisible('dps',{dps:{autoHide:false,collapsed:true}},true,outOfCombat),true);
 assert.equal(panelVisible('dps',{dps:{autoHide:false}},true,{...outOfCombat,connected:false}),true);
});
test('manual DPS reveal makes completed damage inspectable outside combat and across disconnects',()=>{
 const layout={dps:{enabled:true,autoHide:true}};
 for(const connected of [true,false]){
  const options={...live(false),connected};
  assert.equal(panelVisible('dps',layout,true,{...options,manualDpsReveal:true}),true);
  assert.equal(panelVisible('dps',layout,true,{...options,manualDpsReveal:false}),false);
 }
 // The explicit reveal still works before the backend has supplied live state.
 assert.equal(panelVisible('dps',layout,true,{connected:false,manualDpsReveal:true}),true);
});
test('manual reveal and disabled auto-hide respect panel and global visibility preferences',()=>{
 for(const autoHide of [true,false]){
  for(const options of [
   {...live(false),manualDpsReveal:true},
   {...live(false),connected:false,manualDpsReveal:true},
   {...live(true),desktopEdit:true,manualDpsReveal:true},
  ]){
   assert.equal(panelVisible('dps',{dps:{enabled:false,autoHide}},true,options),false);
   assert.equal(panelVisible('dps',{dps:{enabled:true,autoHide}},false,options),false);
  }
 }
});
test('DPS settings stay usable outside combat until the settings panel closes',()=>{
 const layout={dps:{enabled:true,autoHide:true}};
 for(const connected of [true,false]){
  const options={...live(false),connected};
  assert.equal(panelVisible('dps',layout,true,{...options,settingsOpen:true}),true);
  assert.equal(panelVisible('dps',layout,true,{...options,settingsOpen:false}),false);
 }
 const options={...live(false),settingsOpen:true};
 assert.equal(panelVisible('dps',{dps:{enabled:false}},true,options),false);
 assert.equal(panelVisible('dps',layout,false,options),false);
});
test('manual DPS reveal leaves cube and control visibility unchanged',()=>{
 for(const manualDpsReveal of [true,false]){
  const options={...live(false),connected:false,manualDpsReveal};
  assert.equal(panelVisible('cube',{cube:{enabled:false}},true,options),false);
  assert.equal(panelVisible('cube',{cube:{enabled:true}},true,options),true);
  assert.equal(panelVisible('controls',{},true,options),true);
  assert.equal(panelVisible('controls',{},false,options),false);
 }
});
