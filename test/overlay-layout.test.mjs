import test from 'node:test';
import assert from 'node:assert/strict';
import layout from '../overlay/layout.cjs';
import {interactionFor,panelVisible} from '../overlay/interaction.cjs';
const area={x:0,y:0,width:1920,height:1040};
test('collapsed DPS is only the title bar and saved positions recover onto an available display',()=>{
 const small=layout.boundsFor('dps',{x:45,y:200,collapsed:true},area);
 assert.deepEqual(small,{x:45,y:200,width:232,height:36});
 const recovered=layout.boundsFor('dps',{x:4000,y:2000},area);
 assert.equal(recovered.x+recovered.width,1920);assert.equal(recovered.y+recovered.height,1040);
 const left=layout.boundsFor('cube',{x:-1700,y:300},{x:-1920,y:0,width:1920,height:1080});
 assert.equal(left.x,-1700);assert.equal(left.y,300);
 const invalid=layout.boundsFor('dps',{x:NaN,y:Infinity},area);assert.ok(Number.isFinite(invalid.x+invalid.y));
});
test('custom DPS dimensions survive collapse and settings without becoming the temporary panel size',()=>{
 const saved={x:40,y:90,width:460,height:340};
 assert.equal(layout.boundsFor('dps',{},area).height,210);
 assert.deepEqual(layout.dpsSize(saved),{width:460,height:340});
 const collapsed=layout.boundsFor('dps',{...saved,collapsed:true},area);
 assert.equal(collapsed.width,460);assert.equal(collapsed.height,36);
 const settings=layout.boundsFor('dps',{...saved,settingsOpen:true},area);
 assert.equal(settings.height,232);assert.equal(settings.width,460);
 assert.equal(layout.boundsFor('dps',saved,area).height,340);
 assert.deepEqual(layout.dpsSize({width:NaN,height:'300'}),{width:232,height:210});
 assert.deepEqual(layout.dpsSize({width:-10,height:99999}),{width:220,height:800});
});

test('compact migration changes old dimensions once and preserves all other preferences and later resizing',()=>{
 const saved={x:0,y:109,width:333,height:305,collapsed:true,transparency:17,mode:'individual',metric:'healing',autoHide:false,enabled:false};
 const migrated=layout.migrateDpsLayout(saved);
 assert.deepEqual(migrated,{...saved,width:232,height:210,compactVersion:1});
 assert.equal(saved.width,333);
 const resized={...migrated,width:380,height:290};
 assert.equal(layout.migrateDpsLayout(resized),resized);
 assert.deepEqual(layout.dpsSize(resized),{width:380,height:290});
 assert.deepEqual(layout.migrateDpsLayout(),{width:232,height:210,compactVersion:1});
});
test('corner resizing clamps to readable dimensions and the monitor while keeping the top-left fixed',()=>{
 const start={x:100,y:100,width:320,height:250};
 assert.deepEqual(layout.resizeBounds(start,{x:100,y:60},area),{x:100,y:100,width:420,height:310});
 assert.deepEqual(layout.resizeBounds(start,{x:-9999,y:-9999},area),{x:100,y:100,width:220,height:150});
 const edge=layout.resizeBounds({...start,x:1400,y:800},{x:9999,y:9999},area);
 assert.equal(edge.width,520);assert.equal(edge.height,240);
 const smallMonitor=layout.boundsFor('dps',{width:800,height:800},{x:-640,y:0,width:640,height:480});
 assert.equal(smallMonitor.width,640);assert.equal(smallMonitor.height,480);
});
test('overlay follows game focus, requires Alt and allows an explicit desktop edit mode',()=>{
 assert.deepEqual(interactionFor({gameFocused:true,alt:false}),{visible:true,interactive:false});
 assert.deepEqual(interactionFor({gameFocused:true,alt:true}),{visible:true,interactive:true});
 assert.deepEqual(interactionFor({gameFocused:false,alt:true}),{visible:false,interactive:false});
 assert.deepEqual(interactionFor({gameFocused:false,desktopEdit:true}),{visible:true,interactive:true});
 assert.deepEqual(interactionFor({gameFocused:true,alt:true,desktopEdit:true,hiddenByUser:true}),{visible:false,interactive:false});
});
test('appearance settings retain a usable window and normalize saved transparency',()=>{
 const settings=layout.boundsFor('dps',{x:1700,y:1000,collapsed:true,settingsOpen:true},area);
 assert.equal(settings.height,232);assert.equal(settings.y+settings.height,area.height);
 const cube=layout.boundsFor('cube',{settingsOpen:true},area);assert.equal(cube.width,206);assert.equal(cube.height,206);
 for(const value of [undefined,null,'65',NaN,Infinity,{},[]])assert.equal(layout.transparencyFor(value),8);
 assert.equal(layout.transparencyFor(-10),0);assert.equal(layout.transparencyFor(150),100);
 assert.equal(layout.transparencyFor(64.7),65);assert.equal(layout.transparencyFor(0),0);
});
test('the control launcher remains available when both meters are hidden, and still follows game focus',()=>{
 const hidden={dps:{enabled:false},cube:{enabled:false}};
 assert.equal(panelVisible('controls',hidden,true),true);
 assert.equal(panelVisible('dps',hidden,true),false);assert.equal(panelVisible('cube',hidden,true),false);
 for(const panel of ['dps','cube','cube-map','pet-map','controls'])assert.equal(panelVisible(panel,hidden,false),false);
 assert.equal(panelVisible('dps',{},true),true);
 const square=layout.boundsFor('controls',{},area);assert.equal(square.width,44);assert.equal(square.height,44);
 const open=layout.boundsFor('controls',{controlsOpen:true,x:1900,y:1030},area);
 assert.equal(open.width,224);assert.equal(open.height,292);assert.equal(open.x+open.width,area.width);assert.equal(open.y+open.height,area.height);
});

test('the cube map starts hidden, retains saved coordinates and obeys the same game focus boundary',()=>{
 assert.equal(panelVisible('cube-map',{},true),false);
 const saved={'cube-map':{enabled:true,x:900,y:300}};
 assert.equal(panelVisible('cube-map',saved,true),true);assert.equal(panelVisible('cube-map',saved,false),false);
 assert.equal(panelVisible('cube-map',{'cube-map':{enabled:false}},true,{desktopEdit:true}),false);
 assert.deepEqual(layout.boundsFor('cube-map',saved['cube-map'],area),{x:900,y:300,width:360,height:360});
 const small=layout.boundsFor('cube-map',{x:900,y:300},{x:0,y:0,width:300,height:240});
 assert.deepEqual(small,{x:0,y:0,width:300,height:240});
});

test('the pet map is an independent optional panel with recoverable square bounds and the common focus boundary',()=>{
 assert.equal(panelVisible('pet-map',{},true),false);
 const saved={'pet-map':{enabled:true,x:980,y:410,petId:1016,mapId:1110}};
 assert.equal(panelVisible('pet-map',saved,true),true);assert.equal(panelVisible('pet-map',saved,false),false);
 assert.equal(panelVisible('pet-map',{'pet-map':{enabled:false}},true,{desktopEdit:true}),false);
 assert.deepEqual(layout.boundsFor('pet-map',saved['pet-map'],area),{x:980,y:410,width:420,height:420});
 assert.deepEqual(layout.boundsFor('pet-map',{x:4000,y:2000},{x:0,y:0,width:320,height:240}),{x:0,y:0,width:320,height:240});
 assert.equal(panelVisible('cube-map',saved,true),false,'Opening a pet map must not implicitly enable the cube map');
});
