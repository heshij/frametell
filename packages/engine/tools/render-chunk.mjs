// Renders frames [f0, f1) at FPS to an mp4 chunk. Usage (from a project dir): node engine/tools/render-chunk.mjs <f0> <f1> <fps> <out.mp4>
//   or: render-chunk.mjs --jobs <list.json> <fps> — several chunks [{ a, b, out, cover? }] in one browser, one after
//   another; `cover`: the time drawn as the chunk's first frame instead of its own (the film's cover, render.mjs)
// HW=1 (render.mjs --hw): encode on the machine's media engine (the Mac's, or an NVIDIA card's) so every CPU core is left
// for the browsers. JPEG_QUALITY (render.mjs --jpeg-quality): how frames come out of Chrome; 92 by default.
// A browser that stops answering exits with STALLED (3) instead of waiting for ever; render.mjs draws that share again.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { openStage, within, finish } from './lib.mjs';
import { FFMPEG, HW_ENCODE } from './bins.mjs';
const jobsMode = process.argv[2] === '--jobs';
const fps = +process.argv[4];
const jobs = jobsMode ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [{ a: +process.argv[2], b: +process.argv[3], out: process.argv[5] }];

const STALLED = 3;   // render.mjs knows this exit code
// a frame takes well under a second; one that takes this long is a browser that stopped answering
const FRAME_MS = +(process.env.RENDER_FRAME_TIMEOUT_MS || 60_000);
const stalled = (e) => {
  if (!e?.stalled) throw e;
  console.error(`✗ ${e.message}`);
  process.exit(STALLED);   // Playwright closes the browser it launched as this process exits
};

const { page } = await openStage('render', ['--disable-gpu-vsync', '--force-color-profile=srgb']).catch(stalled);
// WATERMARK=1 (render.mjs --watermark): the Frametell mark, small and quiet in the bottom right, on every frame. It sits
// outside the stage the pages draw on, so no page can cover or move it.
if (process.env.WATERMARK === '1') {
  await page.evaluate(() => {
    const m = document.createElement('div');
    m.setAttribute('aria-hidden', 'true');
    m.style.cssText = 'position:fixed;right:2.1%;bottom:3.2%;z-index:2147483647;display:flex;align-items:center;gap:.45em;font:600 clamp(14px,1.25vw,26px)/1 Inter,"PingFang SC",system-ui,sans-serif;letter-spacing:-.01em;color:rgba(255,255,255,.82);text-shadow:0 1px 2px rgba(0,0,0,.45);filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));pointer-events:none;opacity:.9';
    m.innerHTML = '<svg viewBox="0 0 64 64" style="width:1.25em;height:1.25em"><path fill="currentColor" d="M8 8H31V14.5H14.5V31H8Z"/><path fill="currentColor" d="M56 56H33V49.5H49.5V33H56Z"/><circle fill="#E0B88A" cx="32" cy="32" r="7.5"/></svg><span>Frametell</span>';
    document.body.appendChild(m);
  });
}
// frames straight from Chrome (CDP): Playwright's screenshot() waits on fonts and settles the page on every call
const cdp = await page.context().newCDPSession(page);
// the stage's own size: without a clip CDP returns the browser window's visible area (1920×993 on a desktop Chrome)
const { width, height } = page.viewportSize();
const clip = { x: 0, y: 0, width, height, scale: 1 };
const grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: +(process.env.JPEG_QUALITY || 92), optimizeForSpeed: true, clip })).data, 'base64');
// veryfast: x264 at 'medium' took the CPU the browsers need to draw frames; at CRF 16 the difference does not show
const enc = process.env.HW === '1' ? [...HW_ENCODE, ...(process.platform === 'darwin' ? ['-realtime', '0'] : [])] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16'];
let code = 0;
for (const { a: f0, b: f1, out, cover } of jobs) {
  const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    ...enc, '-pix_fmt', 'yuv420p', '-r', String(fps), '-f', 'mp4', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  // an encoder that quits takes no more frames: stop drawing for it, and never wait on a pipe it will not drain
  const closed = new Promise((r) => ff.on('close', r));
  ff.stdin.on('error', () => {});
  const t0 = Date.now();
  for (let f = f0; f < f1 && ff.exitCode === null; f++) {
    // window.__frameReady (optional, set by an episode's extras): wait until everything this frame needs (e.g. images) is ready
    const buf = await within((async () => {
      await page.evaluate(async (t) => { ENGINE.renderAt(t); if (window.__frameReady) await window.__frameReady(t); }, f === f0 && cover !== undefined ? cover : f / fps);
      return grab();
    })(), FRAME_MS, `frame ${f} (${(f / fps).toFixed(2)}s) was not drawn in ${FRAME_MS / 1000}s: the browser stopped answering`).catch(stalled);
    if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), closed]);
    if ((f - f0) % 600 === 0) console.log(`[${path.basename(out)}] ${f - f0}/${f1 - f0}  ${((Date.now() - t0) / 1000) | 0}s`);
  }
  ff.stdin.end();
  await closed;
  if (ff.exitCode) { code = ff.exitCode; break; }
}
// a page whose code threw draws a placeholder: never let that into a film
const thrown = await page.evaluate(() => ENGINE.errors);
if (thrown.length) { for (const x of thrown) console.error(`✗ ${x.page} runtime error (${x.phase}): ${x.message}${x.at.length ? ` — at ${x.at.join(', ')}` : ''}`); code = code || 2; }
// the chunk is written: the browser is left to close as the process exits, never waited on (a graceful close took ~3 s
// a chunk, and could hang after system Chrome had already gone)
process.exitCode = code;
finish();
