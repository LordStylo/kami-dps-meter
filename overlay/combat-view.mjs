// Keep the same encounter duration as the party rows. Switching presentation
// never changes the capture session or the browser's filters.
export function combatView(state,mode,selected,metric='damage'){
 const currentHasData=!!(state?.current?.damage||state?.current?.healing);
 const fight=currentHasData?state.current:state?.last||state?.current;
 const healing=metric==='healing',players=(healing?fight?.healers:fight?.players)||[],individual=mode==='individual';
 const player=individual?players.find(p=>p.self===true):players.find(p=>p.entity===selected);
 return {fight,players,player,individual,healing,previous:!!state?.last&&!currentHasData,
  amount:individual?player?.[healing?'healing':'damage']||0:fight?.[healing?'healing':'damage']||0,
  rate:individual?player?.[healing?'hps':'dps']||0:fight?.[healing?'hps':'dps']||0,
  damage:individual?player?.damage||0:fight?.damage||0,
  dps:individual?player?.dps||0:fight?.dps||0,seconds:(healing?fight?.healingSeconds:fight?.seconds)||0};
}
