/* Production-only candidate; activation remains an explicit future release step. */
(()=>{
 if(location.protocol!=='https:' || location.hostname!=='zhannas905.github.io' || !location.pathname.startsWith('/FitPP/') || new URL(location.href).searchParams.has('fitppMode'))throw Error('Кандидат доступен только по рабочему адресу FitPP. Подключение заблокировано.');
 globalThis.FitPPRuntime=Object.freeze({mode:'production',salesMode:'legacy',catalogEnabled:false,catalogActivationEnabled:false,namespace:'fitpp-165a2-stage2',build:'fitpp-stage2-rc-20261021-3'});
})();
