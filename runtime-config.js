/* Constructor capability only. Sale mode is confirmed through salesPolicy/current, never a local flag. */
(()=>{
 if(location.protocol!=='https:' || location.hostname!=='zhannas905.github.io' || !location.pathname.startsWith('/FitPP/') || new URL(location.href).searchParams.has('fitppMode'))throw Error('Кандидат доступен только по рабочему адресу FitPP. Подключение заблокировано.');
 globalThis.FitPPRuntime=Object.freeze({mode:'production',salesMode:null,catalogEnabled:true,catalogActivationEnabled:true,namespace:'fitpp-165a2-stage2',build:'fitpp-stage2-catalog-rc-20261021-1'});
})();
