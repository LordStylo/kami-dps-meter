import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeCubeFile} from '../src/research/cube-analysis.mjs';
const directory=fileURLToPath(new URL('../captures/cube-research/',import.meta.url));
try {
  let id=process.argv[2];
  if(!id||id==='latest'){
    const files=fs.existsSync(directory)?fs.readdirSync(directory).filter(n=>n.endsWith('.ndjson')):[];
    files.sort((a,b)=>fs.statSync(path.join(directory,b)).mtimeMs-fs.statSync(path.join(directory,a)).mtimeMs);
    id=files[0]?.replace(/\.ndjson$/,'');
  }
  if(!id)throw Error('Henüz cube test kaydı yok.');
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Geçerli bir kayıt UUID’si veya latest kullan.');
  const report=await analyzeCubeFile(path.join(directory,id+'.ndjson'));
  const output=path.join(directory,id+'.analysis.json');
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(`${report.messages} mesaj, ${report.phases.length} aşama, ${report.opcodes.length} opcode.\n${report.conclusion}\nRapor: ${output}`);
  for(const warning of report.warnings)console.log('Not: '+warning);
}catch(error){console.error(error.message);process.exitCode=1;}
