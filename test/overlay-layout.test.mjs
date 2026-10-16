import test from 'node:test';
import assert from 'node:assert/strict';
import layout from '../overlay/layout.cjs';
import {interactionFor} from '../overlay/interaction.cjs';
const area={x:0,y:0,width:1920,height:1040};
test('collapsed DPS is only the title bar and saved positions recover onto an available display',()=>{
 const small=layout.boundsFor('dps',{x:45,y:200,collapsed:true},area);
 assert.deepEqual(small,{x:45,y:200,width:400,height:36});
 const recovered=layout.boundsFor('dps',{x:4000,y:2000},area);
 assert.equal(recovered.x+recovered.width,1920);assert.equal(recovered.y+recovered.height,1040);
 const left=layout.boundsFor('cube',{x:-1700,y:300},{x:-1920,y:0,width:1920,height:1080});
 assert.equal(left.x,-1700);assert.equal(left.y,300);
 const invalid=layout.boundsFor('dps',{x:NaN,y:Infinity},area);assert.ok(Number.isFinite(invalid.x+invalid.y));
});
test('overlay follows game focus, requires Alt and allows an explicit desktop edit mode',()=>{
 assert.deepEqual(interactionFor({gameFocused:true,alt:false}),{visible:true,interactive:false});
 assert.deepEqual(interactionFor({gameFocused:true,alt:true}),{visible:true,interactive:true});
 assert.deepEqual(interactionFor({gameFocused:false,alt:true}),{visible:false,interactive:false});
 assert.deepEqual(interactionFor({gameFocused:false,desktopEdit:true}),{visible:true,interactive:true});
 assert.deepEqual(interactionFor({gameFocused:true,alt:true,desktopEdit:true,hiddenByUser:true}),{visible:false,interactive:false});
});
