function interactionFor({gameFocused,alt,desktopEdit,hiddenByUser}){
 const visible=!hiddenByUser&&(!!gameFocused||!!desktopEdit);
 return {visible,interactive:visible&&(!!desktopEdit||!!alt)};
}
module.exports={interactionFor};
