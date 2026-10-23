// Evidence replay: a real recording of JACO IDE next to the receipts that run produced. Each receipt
// lights up at the moment it happened in the recording; clicking one jumps there. Data: /replay/replay.json,
// exported from the mission's own log (see site/tools/build-replay.mjs).
(async () => {
  const video = document.getElementById('replay-video');
  const list = document.getElementById('proof-list');
  const verdict = document.getElementById('proof-verdict');
  const count = document.getElementById('proof-count');
  const caption = document.getElementById('replay-caption');
  const meta = document.getElementById('replay-meta');
  const scrub = document.getElementById('scrub');
  const fill = document.getElementById('scrub-fill');
  const marks = document.getElementById('scrub-marks');
  if (!video || !list) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let data;
  try {
    const res = await fetch('/replay/replay.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    caption.textContent = 'The recording could not be loaded.';
    return;
  }

  const recorded = new Date(data.recordedAt);
  meta.textContent = `Recorded ${recorded.toISOString().slice(0, 10)}, mission ${data.missionId}: ${data.realSeconds} s of real work in ${Math.round(data.videoSeconds)} s. Only waiting time is shortened; nothing is cut or reordered.`;
  caption.textContent = data.goal;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const items = data.events.map((ev, i) => {
    const li = el('li');
    const label = { check: 'CHECK', start: 'START', decision: 'BACK' }[ev.kind] || `#${ev.n ?? i + 1}`;
    li.appendChild(el('span', 'n', label));
    li.appendChild(el('span', 'what', ev.title));
    const how = el('span', 'how');
    const state = el('span', ev.ok === false ? 'fail' : ev.ok ? 'ok' : '', ev.ok === false ? 'failed' : ev.verified ? 'verified' : ev.ok ? 'ok' : '');
    how.appendChild(state);
    if (ev.detail) how.appendChild(document.createTextNode(`${state.textContent ? ' · ' : ''}${ev.detail}`));
    li.appendChild(how);
    li.addEventListener('click', () => { video.currentTime = Math.max(0, ev.t - 0.4); video.play().catch(() => {}); });
    list.appendChild(li);
    return { ev, li };
  });

  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : data.videoSeconds);
  const placeMarks = () => {
    marks.textContent = '';
    for (const { ev } of items) {
      const m = el('i', ev.kind === 'check' ? (ev.ok ? 'check' : 'fail') : ev.ok === false ? 'fail' : ev.ok ? 'ok' : '');
      m.style.left = `${Math.min(100, (ev.t / duration()) * 100)}%`;
      m.title = ev.title;
      marks.appendChild(m);
    }
  };
  placeMarks();
  video.addEventListener('loadedmetadata', placeMarks);

  const showVerdict = on => {
    if (!data.answerCheck) return;
    verdict.hidden = !on;
    if (!on) return;
    const c = data.answerCheck;
    verdict.className = `verdict${c.ok ? '' : ' bad'}`;
    verdict.textContent = '';
    verdict.appendChild(el('b', null, c.ok ? 'Answer checked against the receipts' : 'Answer did not hold against the receipts'));
    verdict.appendChild(document.createTextNode(c.summary));
  };

  let last = -1;
  const sync = () => {
    const t = video.currentTime;
    let current = -1;
    items.forEach(({ ev, li }, i) => {
      const on = reduced || ev.t <= t;
      li.classList.toggle('on', on);
      if (ev.t <= t) current = i;
    });
    items.forEach(({ li }, i) => li.classList.toggle('now', i === current));
    if (current !== last && current >= 0 && !reduced) {
      const li = items[current].li;
      list.scrollTo({ top: li.offsetTop - list.clientHeight / 2 + li.clientHeight / 2, behavior: 'smooth' });
    }
    last = current;
    const shown = items.filter(({ ev }) => reduced || ev.t <= t).length;
    count.textContent = `${shown}/${items.length}`;
    showVerdict(reduced || (data.answerCheck && t >= data.answerCheck.t));
    const pct = Math.min(100, (t / duration()) * 100);
    fill.style.width = `${pct}%`;
    scrub.setAttribute('aria-valuenow', String(Math.round(pct)));
  };
  video.addEventListener('timeupdate', sync);
  video.addEventListener('seeked', sync);
  sync();

  const seekTo = clientX => {
    const r = scrub.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration();
  };
  scrub.addEventListener('click', e => seekTo(e.clientX));
  scrub.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') video.currentTime = Math.min(duration(), video.currentTime + 2);
    if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 2);
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  });
  video.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  const full = document.getElementById('replay-full');
  const figure = video.closest('figure');
  if (full && figure?.requestFullscreen) full.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : figure.requestFullscreen()).catch(() => {}));
  else if (full) full.hidden = true;

  // Play while visible; never autoplay for people who asked for less motion.
  if (!reduced && 'IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      for (const e of entries) e.isIntersecting ? video.play().catch(() => {}) : video.pause();
    }, { threshold: 0.35 }).observe(video);
  }
})();
