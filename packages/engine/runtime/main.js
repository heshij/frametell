/* Boot. ?render → fixed-size frame capture (1920×1080, or 1080×1920 with ?portrait). ?subs → burn subtitles (preview). ?t=12.3 → still. ?only=p01,p02 → build a subset.
 * ?deck (or window.DECK_MODE) → the film as a slide deck, a line a click (deck.js). */
(function () {
  const q = new URLSearchParams(location.search);
  const frame = document.getElementById('frame');
  // paper: warm fibres + faint dot grid, generated once
  const noise = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.33  0 0 0 0 0.22  0 0 0 0.16 0"/></filter><rect width="480" height="480" filter="url(#n)"/></svg>');
  const blotch = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${STAGE.w}" height="${STAGE.h}"><filter id="b"><feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 0.62  0 0 0 0 0.48  0 0 0 0 0.3  0 0 0 0.11 0"/></filter><rect width="${STAGE.w}" height="${STAGE.h}" filter="url(#b)"/></svg>`);
  const bg = document.getElementById('bg');
  bg.style.background = window.STYLE?.background ? STYLE.background(STAGE) : [
    'radial-gradient(circle, rgba(120, 100, 80, 0.13) 1.3px, transparent 1.6px) 0 0 / 40px 40px',
    `url("data:image/svg+xml;utf8,${noise}")`,
    `url("data:image/svg+xml;utf8,${blotch}")`,
    'radial-gradient(1300px 800px at 35% 30%, #FBF7EE, #F3EBDC 70%, #EDE3D1)',
  ].join(',');

  const only = q.get('only') ? q.get('only').split(',') : null;
  // preview: scale the frame into the window and centre it (a grid would pin an oversized frame to the top left, so place it directly)
  // (deck.js's presenter window draws it in a box of its own: window.DECK_BOX)
  const frameScale = () => {
    const b = window.DECK_BOX ? DECK_BOX() : { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const k = Math.min(b.w / STAGE.w, b.h / STAGE.h);
    Object.assign(frame.style, { position: 'absolute', left: `${b.x + (b.w - STAGE.w) / 2}px`, top: `${b.y + (b.h - STAGE.h) / 2}px`, transform: `scale(${k})` });
  };
  const deck = q.has('deck') || window.DECK_MODE === true;

  if (!q.has('render')) { addEventListener('resize', frameScale); frameScale(); }

  window.__ready = (async () => {
    // pass 1: build once to discover every glyph, load those font subsets, then build for real (so text can be measured)
    ENGINE.init({ only });
    await document.fonts.ready;
    // request every glyph subset used anywhere (fonts are split by unicode-range)
    const all = document.getElementById('stage').textContent + SCRIPT.PAGES.map((p) => p.cues.map((c) => (typeof c === 'string' ? c : c.t)).join('') + p.section).join('') + '0123456789/·';
    await Promise.all(['400', '700'].flatMap((w) => [document.fonts.load(`${w} 40px "LXGW WenKai"`, all)]).concat([
      document.fonts.load('400 30px "JetBrains Mono"', all), document.fonts.load('600 30px "JetBrains Mono"', all),
      document.fonts.load('700 30px Caveat', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/'),
    ]).concat((window.EXTRA_FONTS || []).map((f) => document.fonts.load(f, all + '0123456789%.,+-×÷=¥?!？！'))));   // extras can register more font faces
    await document.fonts.ready;
    ENGINE.init({ subs: q.has('subs') || (!deck && !q.has('render') && !q.has('t') && !q.has('nosubs')), only });
    ENGINE.renderAt(0);
    return ENGINE.layout.duration;
  })();

  const t0 = q.has('t') ? parseFloat(q.get('t')) : null;
  if (t0 != null) { window.__ready.then(() => ENGINE.renderAt(t0)); return; }
  if (q.has('render')) return;
  // live preview (index.html opened directly): the player is player.js (deck.js for ?deck); ?from=seconds starts there; subtitles on by default (?nosubs turns them off)
  frame.style.visibility = 'hidden';   // the first build pass shows every element: stay hidden until ready, so nothing flashes
  window.__ready.then(() => {
    frameScale();
    frame.style.visibility = '';
    if (deck) DECK({ render: (t) => ENGINE.renderAt(t) });
    else PLAYER({ from: parseFloat(q.get('from') || '0'), render: (t) => ENGINE.renderAt(t) });
  }).catch((e) => {
    // a film that did not build stays dark: embedded in the Studio panel, say so, and the panel loads it again
    console.error(e);
    if (window.parent !== window) parent.postMessage({ type: 'studio:error', message: String((e && e.message) || e) }, '*');
  });
})();
