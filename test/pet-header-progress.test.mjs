import test from 'node:test';
import assert from 'node:assert/strict';
import {petHeaderProgress} from '../overlay/pet-progress.mjs';

const collection=(level,souls,extra={})=>({status:'live',complete:false,levels:{1016:level},souls:{1016:souls},...extra});
const values=value=>Object.fromEntries(['state','level','souls','nextLevel','remaining','complete'].map(key=>[key,value[key]]));

test('the header shows the immediate next level cost at all three actual level boundaries',()=>{
 for(const [level,souls,nextLevel,remaining]of [[0,4,1,1],[1,14,2,11],[2,74,3,1]]){
  const result=petHeaderProgress(1016,collection(level,souls));
  assert.deepEqual(values(result),{state:'progress',level,souls,nextLevel,remaining,complete:false});
  assert.equal(result.cost,[5,25,75][level]);assert.match(result.text,/ruh/);assert.match(result.text,new RegExp(remaining+' kaldı'));
 }
});

test('enough souls show zero remaining without inventing a reported level-up or an upgrade action',()=>{
 for(const [level,souls]of [[0,5],[1,25],[1,100],[2,75]]){
  const result=petHeaderProgress(1016,collection(level,souls));
  assert.equal(result.state,'progress');assert.equal(result.level,level);assert.equal(result.nextLevel,level+1);assert.equal(result.remaining,0);assert.equal('ready' in result,false);assert.equal(result.complete,false);
  assert.match(result.text,/0 kaldı/);assert.doesNotMatch(result.text,/hazır|ready|Tamamlandı/i);
 }
});

test('only an actual level three is complete, including when no soul balance was observed',()=>{
 for(const souls of [0,105,undefined]){
  const result=petHeaderProgress(1016,collection(3,souls));
  assert.equal(result.state,'complete');assert.equal(result.level,3);assert.equal(result.nextLevel,null);assert.equal(result.remaining,null);assert.equal(result.complete,true);assert.equal('ready' in result,false);assert.match(result.text,/Tamamlandı/);
 }
});

test('a soul balance cannot identify an unknown actual level or imply completion',()=>{
 const result=petHeaderProgress(1016,{status:'live',complete:false,levels:{},souls:{1016:105}});
 assert.equal(result.state,'unknown');assert.equal(result.level,null);assert.equal(result.nextLevel,null);assert.equal(result.remaining,null);assert.equal('ready' in result,false);assert.equal(result.complete,false);
 assert.doesNotMatch(result.text,/Tamamlandı|Yükseltmeye hazır/);
});

test('absence means zero only in a complete saved or live collection',()=>{
 for(const status of ['saved','live']){
  const result=petHeaderProgress(1016,{status,complete:true,levels:{},souls:{}});
  assert.deepEqual(values(result),{state:'progress',level:0,souls:0,nextLevel:1,remaining:5,complete:false});
 }
 for(const extra of [{status:'unknown',complete:true},{status:'saved',complete:false},{status:'live',complete:false}]){
  const result=petHeaderProgress(1016,{...extra,levels:{},souls:{}});assert.equal(result.state,'unknown');assert.equal(result.level,null);assert.equal(result.souls,null);
 }
});

test('a known level with an unobserved balance retains an explicitly unknown remaining cost',()=>{
 const result=petHeaderProgress(1016,{status:'live',complete:false,levels:{1016:1},souls:{}});
 assert.equal(result.state,'unknown');assert.equal(result.level,1);assert.equal(result.souls,null);assert.equal(result.remaining,null);assert.equal('ready' in result,false);assert.equal(result.complete,false);
});

test('signed negative balances display zero while the input collection remains unchanged',()=>{
 for(const souls of [-7,-2147483648]){
  const source=collection(1,souls),result=petHeaderProgress(1016,source);
  assert.equal(result.souls,0);assert.equal(result.remaining,25);assert.equal(result.state,'progress');assert.equal(source.souls[1016],souls);assert.doesNotMatch(result.text,/-7|-2147483648/);
 }
});

test('progress reads only the selected pet identifier and carries saved confidence into its description',()=>{
 const source={status:'saved',complete:true,levels:{1016:2,1004:1},souls:{1016:74,1004:14}};
 const a=petHeaderProgress({id:1016,name:'Slink'},source),b=petHeaderProgress(1004,source);
 assert.equal(a.remaining,1);assert.equal(b.remaining,11);assert.equal(a.level,2);assert.equal(b.level,1);assert.equal(a.saved,true);assert.match(a.title,/Son kaydedilen/);
 assert.equal(petHeaderProgress('1004',source).remaining,11);
});

test('a maximum valid soul balance stays a non-completed reported level with zero remaining',()=>{
 const result=petHeaderProgress(1016,collection(1,2147483647));
 assert.equal(result.souls,2147483647);assert.equal(result.state,'progress');assert.equal(result.complete,false);assert.equal(result.level,1);assert.equal(result.remaining,0);assert.match(result.title,/2[.,]147[.,]483[.,]647|2147483647/);
});
