/* ?rafshim uses timers when requestAnimationFrame is throttled in hidden tabs or automation; testing only. */
(() => {
  const query = new URLSearchParams(location.search);
  if (!query.has('rafshim') && document.visibilityState !== 'hidden') return;
  window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 33);
  window.cancelAnimationFrame = clearTimeout;
})();
