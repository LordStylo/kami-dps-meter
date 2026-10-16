import test from 'node:test';
import assert from 'node:assert/strict';
import {readSelfPosition,decodePacket} from '../src/protocol/packets.mjs';
import {frameHeader} from '../src/protocol/framing.mjs';
import * as f from './wire-fixtures.mjs';
function payload(frame){return frame.subarray(frameHeader(frame).payloadOffset);}

test('self appearance exposes its XYZ to research without changing DPS identity events',()=>{
 const position={x:15095.25,y:-8380.25,z:25031},body=payload(f.self(position));
 assert.deepEqual(readSelfPosition(body),{entity:7,position});
 const original=decodePacket(0x3633,body).events;
 assert.equal(original.length,1);assert.equal(original[0].self,true);
 assert.equal('position' in original[0],false);
});

test('position prefix rejects missing spatial state, invalid entity and non-finite coordinates',()=>{
 const good=payload(f.self());
 assert.throws(()=>readSelfPosition(good.subarray(0,30)));
 const invalid=Buffer.from(good);invalid[0]=0;assert.throws(()=>readSelfPosition(invalid));
 assert.throws(()=>readSelfPosition(payload(f.self({x:NaN,y:0,z:0}))));
 assert.throws(()=>readSelfPosition(payload(f.self({x:0,y:Infinity,z:0}))));
});
