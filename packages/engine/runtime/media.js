/* media.js · real material (screenshots, video clips as frame sequences, character cameos, browser windows) placed into the
 * hand-drawn picture, all driven by the time lt.
 * Clip frames live in the project at assets/clips/<name>/f000.jpg…; frame counts are registered in window.CLIP_FRAMES
 * (generated into the project's extras, see engine/README.md).
 *   P.img(src, x, y, w, h, o)           still image (o.fit/pos/r/shadow/mask/pop)
 *   P.clip(name, x, y, w, h, o)         frame-sequence clip assets/clips/<name>/f000.jpg… (o.fps/speed/from/to/loop/start)
 *   P.cameo(kind, cx, cy, size, o)      character cameo clip (clips/c-<kind>), soft paper edge + multiply into the background
 *   P.browser(x, y, w, h, o)            browser window: address bar + screenshot (o.src/url/crop/dpr/pan), returns { mark(rect, o), ring(rect, o), toStage(rect) }
 * Still images are preloaded while the page is built; main.js waits for them to decode along with document.fonts.ready.
 * Clip frames load **on demand**: a frame loads when it is drawn (the next few are prefetched), recently used ones stay in a
 * bounded cache, the rest are released — otherwise every render process would decode thousands of frames, and 12 of them
 * fill 48 GB of memory. Frames still loading are awaited through window.__frameReady(t): the engine's render-chunk / snap
 * await it before each capture (redrawing once every image of the frame has decoded), so the output stays deterministic. */
(function () {
  const { h, s, clamp, ease, smooth, col, Builder } = PV;
  const B = Builder.prototype;

  // ── preload: every image is decoded before the first frame is captured ──
  const cache = new Map(), pending = [];
  function need(src) {
    if (cache.has(src)) return cache.get(src);
    const im = new Image();
    im.src = src;
    // wait for load (reliable), then try decode (can reject under memory pressure; harmless)
    pending.push(new Promise((res) => { im.onload = res; im.onerror = () => { console.error('image failed to load ' + src); res(); }; }).then(() => im.decode().catch(() => {})));
    cache.set(src, im);
    return im;
  }
  PV.preload = need;   // the engine's own pictures (the brand's corner mark) wait for the first frame the same way
  const fonts = document.fonts, readyGet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.fonts), 'ready').get;
  Object.defineProperty(fonts, 'ready', { configurable: true, get() { return Promise.all([readyGet.call(fonts), ...pending]).then(() => fonts); } });

  // ── clip frames: loaded on demand, bounded LRU cache ──
  const FRAMES = new Map(), MAX_FRAMES = 160, waiting = new Set();
  function frame(src) {
    let im = FRAMES.get(src);
    if (im) { FRAMES.delete(src); FRAMES.set(src, im); return im; }    // refresh LRU position
    im = new Image();
    im.src = src;
    const p = im.decode().catch(() => new Promise((res) => { if (im.complete) res(); else { im.onload = res; im.onerror = () => { console.error('image failed to load ' + src); res(); }; } }))
      .then(() => { im._ok = im.naturalWidth > 0; waiting.delete(p); });
    waiting.add(p);
    FRAMES.set(src, im);
    while (FRAMES.size > MAX_FRAMES) FRAMES.delete(FRAMES.keys().next().value);
    return im;
  }
  /** Called by the engine tools after ENGINE.renderAt(t): wait for every frame this t needs, then redraw once more. */
  window.__frameReady = async (t) => {
    for (let k = 0; k < 4 && waiting.size; k++) { await Promise.all([...waiting]); ENGINE.renderAt(t); }
  };

  const frameSrc = (name, i) => `assets/clips/${name}/f${String(i).padStart(3, '0')}.jpg`;

  // fade + small rise/pop in at `at`; returns an act handle with hide()
  function reveal(P, el, o) {
    const at = o.at ?? 0, dur = o.dur ?? 0.6, pop = o.pop ?? 0.04;
    el.style.opacity = '0';
    const a = P.act({ at, dur, kind: 'media', apply(k, lt, op) {
      const e = ease.out(k);
      el.style.opacity = (e * op).toFixed(3);
      el.style.transform = `translateY(${((1 - e) * 18).toFixed(1)}px) scale(${(1 - pop + pop * e).toFixed(4)})`;
    } });
    return { el, hide(t, d = 0.5) { a.out = t; a.outDur = d; return this; } };
  }
  function frameBox(P, x, y, w, hh, o) {
    const el = h('div', 'media', null, P.html);
    Object.assign(el.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px', overflow: 'hidden',
      borderRadius: (o.r ?? 14) + 'px', transformOrigin: '50% 50%' });
    if (o.shadow !== false) el.style.boxShadow = '0 10px 28px rgba(60,45,30,.18), 0 2px 6px rgba(60,45,30,.12)';
    if (o.border !== false) el.style.outline = `2.5px solid ${col(o.border || 'soft')}`;
    if (o.mask) {
      const m = 'radial-gradient(closest-side, #000 62%, transparent 100%)';
      Object.assign(el.style, { maskImage: m, webkitMaskImage: m, boxShadow: 'none', outline: 'none', borderRadius: '0' });
    }
    if (o.blend) el.style.mixBlendMode = o.blend;
    return el;
  }

  B.img = function (src, x, y, w, hh, o = {}) {
    const el = frameBox(this, x, y, w, hh, o);
    const im = need(src).cloneNode();
    Object.assign(im.style, { width: '100%', height: '100%', objectFit: o.fit || 'cover', objectPosition: o.pos || '50% 50%', display: 'block' });
    el.appendChild(im);
    return reveal(this, el, o);
  };

  /** Frame-sequence clip on a canvas. Frame index = from + (lt − start)·fps·speed, clamped (or looped). */
  B.clip = function (name, x, y, w, hh, o = {}) {
    const n = (window.CLIP_FRAMES || {})[name];
    if (!n) { console.error('clip not registered: ' + name); return null; }
    const el = frameBox(this, x, y, w, hh, o);
    const cv = h('canvas', null, null, el);
    cv.width = Math.round(w * (o.res ?? 1.25)); cv.height = Math.round(hh * (o.res ?? 1.25));
    Object.assign(cv.style, { width: '100%', height: '100%', display: 'block' });
    const ctx = cv.getContext('2d');
    const start = o.start ?? o.at ?? 0, fps = o.fps ?? 24, sp = o.speed ?? 1, from = o.from ?? 0, to = o.to ?? n - 1;
    let last = -1;
    const idxAt = (lt) => {
      if (o.timeMap) { // [[lt, clipSeconds], …] piecewise-linear
        const m = o.timeMap; let sec = m[0][1];
        for (let j = 1; j < m.length; j++) { if (lt >= m[j - 1][0]) sec = m[j - 1][1] + (m[j][1] - m[j - 1][1]) * clamp((lt - m[j - 1][0]) / (m[j][0] - m[j - 1][0])); }
        return Math.min(to, Math.max(from, Math.floor(sec * fps + 1e-6)));
      }
      const f = Math.floor(Math.max(0, lt - start) * fps * sp + 1e-6);
      if (o.loop) return from + (f % (to - from + 1));
      if (o.pingpong && from + f > to) { const [a, b] = o.pingpong, span = b - a, q = (from + f - to) % (2 * span); return q < span ? b - q : a + (q - span); }
      return Math.min(to, from + f);
    };
    this.tick((lt) => {
      const i = idxAt(lt);
      for (let j = 1; j <= 6; j++) frame(frameSrc(name, Math.min(to, i + j)));   // prefetch the next few frames
      if (i === last) return;
      const im = frame(frameSrc(name, i));
      if (!im._ok) return;             // not decoded yet: __frameReady waits for it and redraws
      last = i;
      // cover-fit
      const k = Math.max(cv.width / im.naturalWidth, cv.height / im.naturalHeight), dw = im.naturalWidth * k, dh = im.naturalHeight * k;
      ctx.drawImage(im, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
    });
    const r = reveal(this, el, o);
    r.frameAt = idxAt;
    return r;
  };

  /** Clawd acting, blended into the paper with a soft round edge. */
  B.cameo = function (kind, cx, cy, size, o = {}) {
    return this.clip('c-' + kind, cx - size / 2, cy - size / 2, size, size, { mask: true, blend: 'multiply', loop: o.loop ?? false, pop: 0.12, dur: 0.5, ...o });
  };

  /**
   * Browser window with a real screenshot. o.src (2× screenshot), o.url (address bar), o.crop = [x, y, w, h] in page CSS px of the
   * screenshot (default whole), o.pan = [{ at, y, dur }] scrolls the content (CSS px). mark/ring take rects in the same CSS px.
   */
  B.browser = function (x, y, w, hh, o = {}) {
    const at = o.at ?? 0, bar = 54, dpr = o.dpr ?? 2;
    const shell = this.box(x, y, w, hh, { r: 16, fill: 'paper', color: 'ink', sw: 2.6, at, dur: 0.7, texture: false, rough: 0.6 });
    this.line(x + 4, y + bar, x + w - 4, y + bar, { color: 'soft', sw: 2, at: at + 0.3, dur: 0.4 });
    ['red', 'orange', 'green'].forEach((c, i) => this.circle(x + 30 + i * 26, y + bar / 2, 14, { fill: c, color: c, at: at + 0.35 + i * 0.05, dur: 0.3, texture: false }));
    if (o.url) {
      const bw = w - 150, fs = Math.min(21, (bw - 40) / (o.url.length * 0.62));   // full link, shrink the font to fit the bar
      this.box(x + 118, y + 11, bw, bar - 22, { r: 10, fill: 'faintF', color: 'faint', sw: 1.6, at: at + 0.4, dur: 0.4, texture: false });
      this.text(o.url, { x: x + 138, y: y + (bar - fs * 1.3) / 2, size: fs, font: 'mono', color: 'soft', at: at + 0.55, mode: 'fade', raw: true });
    }
    const [cx0, cy0, cw, ch] = o.crop || [0, 0, 1440, 900];
    const vw = w - 8, vh = hh - bar - 6, k = vw / cw;
    const view = h('div', 'media', null, this.html);
    Object.assign(view.style, { position: 'absolute', left: x + 4 + 'px', top: y + bar + 2 + 'px', width: vw + 'px', height: vh + 'px', overflow: 'hidden', borderRadius: '0 0 12px 12px' });
    const content = h('div', null, null, view);
    Object.assign(content.style, { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0' });
    const im = need(o.src).cloneNode();
    im.style.display = 'block';
    content.appendChild(im);
    const ov = s('svg', { width: 10, height: 10, style: 'position:absolute;left:0;top:0;overflow:visible' }, content);
    const setImg = () => { im.style.width = (im.naturalWidth / dpr * k) + 'px'; };
    if (im.complete) setImg(); else im.onload = setImg;
    const pan = o.pan || [];
    const panY = (lt) => { let cur = cy0; for (const p of pan) { const e = ease.inOut(clamp((lt - p.at) / (p.dur ?? 1.4))); cur = cur + (p.y - cur) * e; } return cur; };
    content.style.opacity = '0';
    this.tick((lt) => {
      if (!im.style.width) setImg();
      content.style.opacity = smooth(at + 0.5, at + 0.9, lt).toFixed(3);
      content.style.transform = `translate(${(-cx0 * k).toFixed(1)}px, ${(-panY(lt) * k).toFixed(1)}px)`;
    });
    const R = rough.svg(ov);
    const P = this;
    const api = {
      k,
      /** stage position of a rect given in screenshot CSS px (at pan time lt) */
      toStage([rx, ry, rw, rh], lt = Infinity) { return [x + 4 + (rx - cx0) * k, y + bar + 2 + (ry - panY(lt)) * k, rw * k, rh * k]; },
      /** hand-drawn box around a rect (drawn stroke by stroke at o.at); o.fill for a highlighter wash */
      mark([rx, ry, rw, rh], mo = {}) {
        const pad = mo.pad ?? 6, c = col(mo.color || 'red');
        const g = s('g', null, ov);
        const X = rx * k - pad, Y = ry * k - pad, W = rw * k + pad * 2, H = rh * k + pad * 2;
        let wash = null;
        if (mo.fill) { wash = s('rect', { x: X, y: Y, width: W, height: H, rx: 6, fill: col(mo.fill), opacity: 0 }, g); }
        const node = mo.shape === 'ring'
          ? R.ellipse(X + W / 2, Y + H / 2, W * 1.12, H * 1.5, { stroke: c, strokeWidth: mo.sw ?? 4, roughness: 1.3, seed: P.seed() })
          : R.rectangle(X, Y, W, H, { stroke: c, strokeWidth: mo.sw ?? 4, roughness: 1.2, bowing: 1, seed: P.seed() });
        g.appendChild(node);
        const paths = [...node.querySelectorAll('path')];
        let lens = null;
        const a = P.act({ at: mo.at ?? 0, dur: mo.dur ?? 0.7, kind: 'media', apply(kk, lt, op) {
          if (!lens) { lens = paths.map((p) => p.getTotalLength() + 1); paths.forEach((p, i) => { p.style.strokeDasharray = `${lens[i]} ${lens[i]}`; }); }
          const e = ease.draw(kk), tot = lens.reduce((q, v) => q + v, 0);
          let acc = e * tot;
          paths.forEach((p, i) => { const d = clamp(acc / lens[i]); acc -= lens[i]; p.style.strokeDashoffset = (lens[i] * (1 - d)).toFixed(1); });
          g.style.opacity = op.toFixed(3);
          if (wash) wash.setAttribute('opacity', (0.35 * ease.out(kk)).toFixed(3));
        } });
        return { hide(t, d = 0.4) { a.out = t; a.outDur = d; return this; } };
      },
      ring(rect, mo = {}) { return api.mark(rect, { ...mo, shape: 'ring' }); },
      hide(t, d = 0.5) { shell.hide(t, d); P.tick((lt) => { view.style.opacity = (1 - smooth(t, t + d, lt)).toFixed(3); }); return this; },
    };
    return api;
  };

  window.MEDIA = { need, frameSrc };
})();
