// A quiet, irregular field of drifting points; no lattice or connecting lines.
// Static for reduced motion, paused in background tabs, bounded to 30 fps.
(() => {
  const canvas = document.getElementById('waves');
  const ctx = canvas && canvas.getContext('2d');
  if (!ctx) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let w = 0, h = 0, raf = 0, last = 0, elapsed = 0, points = [];

  // Fixed seed keeps the composition stable across reloads and motion preferences.
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let seed = 72419;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    points = Array.from({ length: Math.min(240, Math.max(40, Math.round(w * h / 6500))) }, () => ({
      x: random(), y: random(), radius: 0.55 + random() * 1.05,
      phase: random() * Math.PI * 2, speed: 0.25 + random() * 0.65,
      alpha: 0.18 + random() * 0.28,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const p of points) {
      const x = p.x * w + Math.sin(t * 0.11 * p.speed + p.phase) * 14;
      const y = (p.y * (h + 40) - t * p.speed * 1.6 + 20) % (h + 40);
      const py = ((y + h + 40) % (h + 40)) - 20;
      const breathe = 0.8 + 0.2 * Math.sin(t * 0.35 + p.phase);
      ctx.fillStyle = 'rgba(105, 211, 234, ' + (p.alpha * breathe) + ')';
      ctx.beginPath();
      ctx.arc(x, py, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return;
    elapsed += Math.min((now - last) / 1000, 0.1);
    last = now;
    draw(elapsed);
  }

  function start() {
    cancelAnimationFrame(raf);
    raf = 0;
    draw(still.matches ? 0 : elapsed);
    if (!still.matches && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  resize(); start();
  window.addEventListener('resize', () => { resize(); start(); });
  document.addEventListener('visibilitychange', start);
  still.addEventListener('change', start);
})();
