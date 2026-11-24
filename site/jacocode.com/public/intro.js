// The short film is a mood, not content: it never autoplays for a visitor who asked for less motion, and it
// stops while it is out of view so it costs nothing in the background.
(() => {
  const video = document.getElementById('intro-video');
  if (!video) return;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { video.removeAttribute('autoplay'); video.pause(); video.setAttribute('controls', ''); return; }
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) video.play().catch(() => {});
      else video.pause();
    }
  }, { threshold: 0.25 }).observe(video);
})();
