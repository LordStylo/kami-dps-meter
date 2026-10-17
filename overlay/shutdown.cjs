const {setTimeout:wait}=require('node:timers/promises');

// Only the main process supplies the fixed loopback service origin.
async function shutdownBackend(origin,{timeoutMs=8000}={}){
 const deadline=Date.now()+timeoutMs;
 async function request(endpoint,options={}){
  const remaining=deadline-Date.now();
  if(remaining<=0)throw Error('Veri toplama uygulaması zamanında kapanmadı. Tekrar deneyebilirsin.');
  return fetch(origin+endpoint,{...options,redirect:'error',headers:{Connection:'close',...options.headers},signal:AbortSignal.timeout(remaining)});
 }
 async function state(){
  let response;
  try{response=await request('/api/state');}
  catch(error){if(error.cause?.code==='ECONNREFUSED')return null;throw error;}
  if(!response.ok){await response.body?.cancel();throw Error('Veri toplama uygulamasının durumu okunamadı.');}
  const value=await response.json();
  if(value.app!=='aion-dps-lab')throw Error('Bu portta farklı bir uygulama çalışıyor; kapatma isteği gönderilmedi.');
  return value;
 }
 if(await state()===null)return;
 // A recording command may briefly occupy the service. Wait for it to finish.
 for(;;){
  let response;
  try{response=await request('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'shutdown'})});}
  catch(error){if(error.cause?.code==='ECONNREFUSED')return;throw error;}
  if(response.status===409){await response.body?.cancel();await wait(100);continue;}
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Veri toplama uygulaması kapatılamadı.');
  break;
 }
 // The API acknowledges before the capture worker has stopped. Wait for exit.
 for(;;){
  try{if(await state()===null)break;}
  catch(error){
   // The service can close a connection between our exit check and response.
   // After its acknowledgement, retry a reset within the original deadline;
   // only connection refusal confirms exit, never the reset by itself.
   if(!['ECONNRESET','UND_ERR_SOCKET'].includes(error.cause?.code))throw error;
  }
  await wait(100);
 }
}

module.exports={shutdownBackend};
