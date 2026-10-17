// Send synthetic protocol frames over our own loopback connection and capture them.
// This tests the real driver/FFI/TCP/parser/meter path, without launching the game.
import net from 'node:net';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { listDevices, openDevice, tcpConnections } from '../src/capture/npcap.mjs';
import { parseTcpFrame, TcpStream } from '../src/capture/tcp.mjs';
import { FrameStream } from '../src/protocol/framing.mjs';
import { Meter } from '../src/meter.mjs';
import * as f from '../test/wire-fixtures.mjs';

const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,loopback=listDevices().find(d=>d.loopback);
const capture=openDevice(loopback.name,`tcp and src port ${port}`);
const meter=new Meter(),issues=[],frames=new FrameStream(p=>p.events.forEach(e=>meter.ingest(e)),s=>issues.push(s));
const tcp=new TcpStream((b,at)=>frames.push(b,at),()=>frames.gap());
let peer;server.on('connection',socket=>{peer=socket;socket.setNoDelay(true);});
const client=net.connect(port,'127.0.0.1');client.on('data',()=>{});
await new Promise(resolve=>client.once('connect',resolve));
let captured=0;
try{
  assert.ok(tcpConnections(new Set([process.pid])).some(c=>c.localPort===client.localPort));
  peer.write(f.cat(f.player(),f.heartbeat(),f.heartbeat(),f.direct()));
  await delay(80);peer.write(f.cat(f.dot(),f.partyHp()));
  const deadline=Date.now()+2500;
  while(Date.now()<deadline){
    for(let i=0;i<100;i++){
      const packet=capture.next();if(!packet)break;const p=parseTcpFrame(packet.bytes,capture.linkType);if(!p)continue;
      captured++;tcp.push(p.sequence,p.payload,p.syn,packet.at);
    }
    if(meter.snapshot({scope:'party'}).damage===13000)break;
    await delay(20);
  }
  const snapshot=meter.snapshot({scope:'all'});assert.equal(snapshot.damage,13000);assert.equal(snapshot.players.length,1);assert.deepEqual(issues,[]);
  const party=meter.snapshot({scope:'party'});assert.equal(party.damage,13000);assert.equal(party.players.length,1);
  console.log(JSON.stringify({realNpcap:'passed',processTcpTable:'passed',capturedFrames:captured,syntheticDamage:snapshot.damage,partyDamage:party.damage,expectedDamage:13000,issues,liveGameValidated:false},null,2));
}finally{capture.close();client.destroy();peer?.destroy();await new Promise(resolve=>server.close(resolve));}
