import test from 'node:test';
import assert from 'node:assert/strict';
import {captureHealth} from '../src/capture/health.mjs';

test('a responsive HTTP server cannot hide a stalled capture worker',()=>{
  const last={state:'capturing',packetCount:42,processingLagMs:10};
  assert.equal(captureHealth(last,1000,5000).state,'capturing');
  const stale=captureHealth(last,1000,6001);
  assert.equal(stale.state,'stalled');assert.match(stale.error,/yanıt vermiyor/);
  assert.equal(last.state,'capturing');
  assert.equal(captureHealth(last,7000,7001).state,'capturing');
  assert.equal(captureHealth({state:'starting'},0,6000).state,'stalled');
  assert.equal(captureHealth({state:'stopped'},0,6000).state,'stopped');
});

test('backlogged game messages are reported as delayed until fresh traffic arrives',()=>{
  const stale=captureHealth({state:'capturing',processingLagMs:94674},10000,10010);
  assert.equal(stale.state,'delayed');assert.match(stale.error,/95 sn/);
  assert.equal(captureHealth({state:'capturing',processingLagMs:20},10000,10010).state,'capturing');
});
