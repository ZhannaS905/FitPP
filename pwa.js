/* Installation only. No data access, offline writes or application cache. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', {
      scope: './',
      updateViaCache: 'none',
    }).catch(error => console.warn('FitPP: не удалось зарегистрировать PWA.', error));
  });
}
