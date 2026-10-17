/* The in-browser preview player (only when index.html is opened directly; ?render / ?t captures do not use it).
 * Click the picture or press Space: play / pause; ← →: 5 s back / forward; F: full screen; the bar at the bottom can be dragged.
 * With narration (SCRIPT.VOICE), each line's audio plays in sync: lines are loaded ahead, the picture waits for a line
 * that is not ready yet, and while a line plays the picture keeps to it. */
(function () {
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  window.PLAYER = function ({ from = 0, render }) {
    const dur = ENGINE.layout.duration;
    // the player speaks the Studio panel's language when embedded there (?lang=), else the film's (META.lang; a film
    // made before it was set: Chinese if its title is)
    const meta = (window.SCRIPT && SCRIPT.META) || {};
    const ui = new URLSearchParams(location.search).get('lang');
    const en = ui === 'en' || ui === 'zh' ? ui === 'en' : meta.lang ? meta.lang === 'en' : !/[\u3400-\u9fff]/.test(meta.title || '');
    const say = (zh, english) => (en ? english : zh);
    let t = Math.min(from, dur), playing = false, t0 = 0, wall = 0;

    // ── narration: one <audio> per line ──
    // A line used to be fetched only once it began, so it started late by the fetch (a hosted service's round trip:
    // the whole line out of step) and was then cut off where it should have ended. Now the lines of the next AHEAD
    // seconds are loaded in advance; the clock holds at a line that cannot play yet (at most WAIT_MS); a line plays out
    // to its own end; and while one plays, the clock keeps to it (more than DRIFT off, e.g. after frames stalled in a
    // background tab, the picture moves, never the sound: seeking a playing line is itself an audible jolt).
    // A line can also be stuck after it was told to play: its file came without a length or byte ranges (a running film's
    // box, behind its proxy, sometimes answers so), and a seek in it never ends. Such a line used to lead the clock all
    // the same: the picture was pulled back to its stuck time every few frames and shook at the start of the page. Now a
    // line leads only while it flows; a stuck one holds the clock, is fetched again after RETRY_MS, and is given up at WAIT_MS.
    const AHEAD = 15, WAIT_MS = 4000, RETRY_MS = 1500, DRIFT = 0.12;
    const clips = ENGINE.layout.pages.flatMap((p) => p.cues).filter((c) => c.audio)
      .map((c) => ({ at: c.audioAt ?? c.start, d: c.dur ?? c.end - c.start, src: c.audio, el: null, done: false, since: 0, fresh: false }));
    const audioOf = (c) => {
      if (!c.el) {
        const el = (c.el = new Audio(c.src)); el.preload = 'auto';
        el.addEventListener('ended', () => { if (c.el === el) c.done = true; });
        el.addEventListener('error', () => { if (c.el === el) c.done = true; });   // a line that will not load does not hold the film
      }
      return c.el;
    };
    /** drop a line's element: the next one asks for the file again */
    const forget = (c) => { const el = c.el; c.el = null; if (el) { el.pause(); el.removeAttribute('src'); el.load(); } };
    /** the line can play on from where it is: not mid-seek, and loaded ahead of its own time */
    const flowing = (el) => !el.seeking && el.readyState >= 3;
    const loadAhead = () => { for (const c of clips) if (c.at + c.d > t && c.at < t + AHEAD) audioOf(c); };
    /** a line due by `to` that cannot play yet (not loaded, or stuck since it was started): the clock waits for it */
    const holding = (to, now) => clips.find((c) => {
      if (c.done || to < c.at || t >= c.at + c.d) return false;
      const el = audioOf(c);
      if (flowing(el)) { c.since = 0; return false; }
      if (!c.since) c.since = now;
      if (now - c.since > WAIT_MS) { forget(c); c.done = true; return false; }
      if (now - c.since > RETRY_MS && !c.fresh && !el.paused) { c.fresh = true; forget(c); audioOf(c); }
      return true;
    });
    const sfx = TIMING.sfxTimes ? TIMING.sfxTimes(ENGINE.layout).map((s) => ({ ...s, el: null })) : [];
    const syncAudio = () => {
      if (playing) loadAhead();
      for (const c of clips) {
        const off = t - c.at, el = c.el;
        if (playing && !c.done && off >= 0 && off < c.d) {
          const a = audioOf(c);
          if (a.paused) {
            if (a.readyState < 2) continue;
            a.currentTime = off;
            // Refused for want of a click (play was asked from outside, by the Studio panel): the film stops and asks
            // for one, rather than going on silent. Any other refusal: leave it, rather than asking every frame
            a.play().catch((e) => { if (e?.name === 'NotAllowedError' && playing) needsClick(); else c.done = true; });
          }
        } else if (el && !el.paused && (!playing || off < 0 || off > c.d + 0.5)) el.pause();
      }
      // sound effects / music beds (page.sfx): volume and fades approximated, no ducking (the render mixes them exactly)
      for (const s of sfx) {
        const end = s.t1 ?? Infinity, inside = playing && t >= s.t0 && t < end;
        if (!inside) { if (s.el && !s.el.paused) s.el.pause(); continue; }
        if (!s.el) { s.el = new Audio(s.f); s.el.loop = s.loop; s.el.preload = 'auto'; s.el.playbackRate = s.rate; }
        let g = Math.pow(10, s.vol / 20);
        if (s.fin > 0) g *= Math.min(1, (t - s.t0) / s.fin);
        if (s.fout > 0 && end < Infinity) g *= Math.min(1, (end - t) / s.fout);
        s.el.volume = Math.max(0, Math.min(1, g));
        if (s.el.paused) {
          const pos = t - s.t0 + s.from, d = s.el.duration;
          if (!s.loop && d && pos >= d) continue;
          s.el.currentTime = s.loop && d ? pos % d : pos;
          s.el.play().catch(() => {});
        }
      }
    };

    // ── control bar ──
    const css = document.createElement('style');
    css.textContent = `
#pv-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 99; display: flex; align-items: center; gap: 14px; padding: 14px 22px 18px;
  background: linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0)); color: #fff; font: 600 15px -apple-system, "PingFang SC", sans-serif; transition: opacity .3s; }
#pv-bar.idle { opacity: 0; }
#pv-bar button { background: none; border: 0; color: #fff; font-size: 22px; cursor: pointer; width: 36px; height: 36px; border-radius: 8px; }
#pv-bar button:hover { background: rgba(255,255,255,0.15); }
#pv-bar input { flex: 1; accent-color: #FF9A3C; height: 6px; cursor: pointer; }
#pv-time { font-variant-numeric: tabular-nums; min-width: 96px; text-align: center; }
#pv-hint { position: fixed; inset: 0; display: grid; place-items: center; z-index: 98; pointer-events: none; }
#pv-hint span { background: rgba(0,0,0,0.55); color: #fff; font: 600 22px -apple-system, "PingFang SC", sans-serif; padding: 16px 28px; border-radius: 40px; transition: opacity .3s; }
#viewport { cursor: pointer; }`;
    document.head.appendChild(css);
    const bar = document.createElement('div');
    bar.id = 'pv-bar';
    bar.innerHTML = `<button id="pv-play" title="${say('播放 / 暂停（空格）', 'Play / pause (Space)')}">▶</button><span id="pv-time"></span><input id="pv-seek" type="range" min="0" step="0.05"><button id="pv-fs" title="${say('全屏（F）', 'Full screen (F)')}">⛶</button>`;
    document.body.appendChild(bar);
    const hint = document.createElement('div');
    hint.id = 'pv-hint';
    hint.innerHTML = `<span>${say('点击画面或按空格播放', 'Click the picture or press Space to play')}</span>`;
    document.body.appendChild(hint);
    const $ = (id) => document.getElementById(id);
    const seek = $('pv-seek');
    const embedded = window.parent !== window;
    seek.max = dur.toFixed(2);

    const show = () => {
      render(t);
      seek.value = t.toFixed(2);
      $('pv-time').textContent = `${fmt(t)} / ${fmt(dur)}`;
      $('pv-play').textContent = playing ? '❚❚' : '▶';
      if (embedded) parent.postMessage({ type: 'studio:time', t, playing }, '*');   // the Studio panel follows along
    };
    const loop = (now) => {
      if (!playing) return;
      let next = Math.min(dur, wall + (now - t0) / 1000);
      const wait = holding(next, now);
      const lead = !wait && clips.findLast((c) => c.el && !c.el.paused && flowing(c.el));
      if (wait) { next = Math.max(t, wait.at); wall = next; t0 = now; }
      else if (lead && Math.abs(lead.at + lead.el.currentTime - next) > DRIFT) { next = Math.min(dur, lead.at + lead.el.currentTime); wall = next; t0 = now; }
      t = next;
      if (t >= dur) playing = false;
      syncAudio();
      show();
      if (playing) requestAnimationFrame(loop);
    };
    const play = () => {
      if (t >= dur - 0.05) t = 0;
      playing = true; wall = t; t0 = performance.now();
      loadAhead();
      hint.firstChild.style.opacity = '0';
      requestAnimationFrame(loop);
    };
    const pause = () => { playing = false; syncAudio(); show(); };
    const needsClick = () => {
      pause();
      hint.firstChild.textContent = say('点击画面播放（有声音）', 'Click the picture to play with sound');
      hint.firstChild.style.opacity = '1';
    };
    const toggle = () => (playing ? pause() : play());
    const jump = (to) => {
      t = Math.max(0, Math.min(dur, to)); wall = t; t0 = performance.now();
      for (const c of clips) { c.done = false; c.since = 0; c.fresh = false; if (c.el) c.el.pause(); }
      syncAudio(); show();
    };
    const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

    document.getElementById('viewport').addEventListener('click', toggle);
    $('pv-play').addEventListener('click', toggle);
    $('pv-fs').addEventListener('click', fullscreen);
    seek.addEventListener('input', () => jump(parseFloat(seek.value)));
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.code === 'ArrowRight') jump(t + 5);
      else if (e.code === 'ArrowLeft') jump(t - 5);
      else if (e.code === 'KeyF') fullscreen();
    });
    // embedded in the Studio panel: the panel can jump to a line, play or pause ({ type: 'studio:seek', t, play })
    addEventListener('message', (e) => {
      const m = e.data;
      if (m?.type === 'studio:seek') { jump(+m.t || 0); if (m.play && !playing) play(); }
      else if (m?.type === 'studio:pause') pause();
    });
    // while playing, the control bar hides after 2 s without mouse movement
    let idle;
    addEventListener('mousemove', () => { bar.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => playing && bar.classList.add('idle'), 2000); });
    loadAhead();
    show();
    if (embedded) parent.postMessage({ type: 'studio:ready', duration: dur }, '*');
  };
})();
