import {petProgress} from '../public/pets.js';
const costs=[5,25,75];
const fmt=n=>Number(n).toLocaleString('tr-TR',{maximumFractionDigits:0});
export function petHeaderProgress(petOrId,collection){
 const pet=petOrId&&typeof petOrId==='object'?petOrId:{id:petOrId},p=pet.id!==null&&pet.id!==undefined?petProgress(pet,collection,3):{level:null,souls:null},saved=collection?.status==='saved';
 const level=p.level,souls=p.souls,complete=level===3,nextLevel=level!==null&&!complete?level+1:null,cost=nextLevel!==null?costs[level]:null;
 const remaining=cost!==null&&souls!==null?Math.max(0,cost-souls):null;
 const state=complete?'complete':level===null||souls===null?'unknown':'progress';
 const text=complete?'Sv. 3 · Tamamlandı':level===null?'Seviye bilinmiyor':souls===null?`Sv. ${level} · Ruh bilinmiyor`:`Sv. ${level} · ${fmt(souls)}/${cost} ruh · ${fmt(remaining)} kaldı`;
 const source=saved?'Son kaydedilen koleksiyon':collection?.status==='live'?'Canlı koleksiyon':'Koleksiyon bilgisi bilinmiyor';
 const details=complete?'Petin bilinen seviyesi 3; yükseltme tamamlandı.':level===null?`Pet seviyesi bilinmiyor.${souls!==null?' Bilinen ruh: '+fmt(souls)+'.':''}`:souls===null?`Pet seviyesi ${level}; ruh sayısı bilinmiyor.`:`Pet seviyesi ${level}. ${nextLevel}. seviye için ${fmt(souls)}/${cost} ruh; ${fmt(remaining)} ruh kaldı. Seviye oyundan alınan son kayda göre gösterilir.`;
 return {state,text,title:`${pet.name?pet.name+' · ':''}${source}. ${details}`,level,souls,cost,nextLevel,remaining,complete,saved};
}
