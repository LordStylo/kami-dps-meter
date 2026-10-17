function interactionFor({gameFocused,alt,desktopEdit,hiddenByUser}){
 const visible=!hiddenByUser&&(!!gameFocused||!!desktopEdit);
 return {visible,interactive:visible&&(!!desktopEdit||!!alt)};
}
function panelVisible(panel,layout,visible,{state,connected=true,desktopEdit=false,manualDpsReveal=false,settingsOpen=false}={}){
 if(!visible||(panel!=='controls'&&layout[panel]?.enabled===false))return false;
 if(panel!=='dps'||desktopEdit||manualDpsReveal||settingsOpen||layout.dps?.autoHide===false)return true;
 // Completed damage stays accessible in the browser; only the native DPS
 // window auto-hides. Editing mode always allows positioning/settings.
 if(!connected)return false;
 if(state?.mode==='live')return state.combat?.active ?? (state.current?.damage>0);
 return state?.mode==='demo'||state?.mode==='replay'||!state;
}
module.exports={interactionFor,panelVisible};
