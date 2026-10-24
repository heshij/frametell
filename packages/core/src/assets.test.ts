import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addAsset, listAssets, removeAsset, sniff, updateAsset } from './assets.js';

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];

/** a PNG's signature and IHDR (colour type 6: with alpha; 2: without), and `extra` bytes to make it another file */
const png = (w: number, h: number, alpha = true, extra = 0) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(w), be32(h), [8, alpha ? 6 : 2, 0, 0, 0], be32(0), be32(0), 'IEND', be32(extra));
const jpg = (w: number, h: number) => bytes([0xff, 0xd8, 0xff, 0xe0], [0, 4, 0, 0], [0xff, 0xc0, 0, 17, 8], [h >> 8, h & 255, w >> 8, w & 255], [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = (w: number, h: number) => bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0], [0x10, 0, 0, 0], [(w - 1) & 255, ((w - 1) >> 8) & 255, 0], [(h - 1) & 255, ((h - 1) >> 8) & 255, 0], [0, 0]);
/** a GIF with a 2-colour global table, and a graphic control extension marking a transparent colour when `alpha` */
const gif = (w: number, h: number, alpha: boolean) => bytes('GIF89a', le16(w), le16(h), [0x80, 0, 0], [0, 0, 0, 255, 255, 255],
  [0x21, 0xff, 11], 'NETSCAPE2.0', [3, 1, 0, 0, 0], [0x21, 0xf9, 4, alpha ? 1 : 0, 0, 0, 0, 0], [0x2c, 0, 0, 0, 0, ...le16(w), ...le16(h), 0], [2, 2, 0x4c, 0x01, 0], [0x3b]);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10"/></svg>';

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fs-user-assets-'));

test('what a picture is comes from its bytes, with its size and transparency', () => {
  assert.deepEqual(pick(sniff(png(640, 480))), { type: 'png', w: 640, h: 480, alpha: true });
  assert.deepEqual(pick(sniff(png(640, 480, false))), { type: 'png', w: 640, h: 480, alpha: false });
  assert.deepEqual(pick(sniff(jpg(1600, 900))), { type: 'jpg', w: 1600, h: 900, alpha: false });
  assert.deepEqual(pick(sniff(webp(800, 600))), { type: 'webp', w: 800, h: 600, alpha: true });
  assert.deepEqual(pick(sniff(gif(320, 200, true))), { type: 'gif', w: 320, h: 200, alpha: true });
  assert.deepEqual(pick(sniff(gif(320, 200, false))), { type: 'gif', w: 320, h: 200, alpha: false });
  assert.deepEqual(pick(sniff(bytes('GIF87a', le16(5), le16(7), [0, 0, 0], [0x2c]))), { type: 'gif', w: 5, h: 7, alpha: false });
  const s = sniff(Buffer.from(svg));
  assert.ok(s && s !== 'svg' && s.type === 'svg' && s.w === 300 && s.h === 100 && s.alpha);
  assert.doesNotMatch(Buffer.from(s.data).toString(), /script|onload|alert/);
  assert.equal(sniff(Buffer.from('<svg><g></svg>')), 'svg', 'an SVG that does not parse is told apart');
  assert.equal(sniff(Buffer.from('%PDF-1.7')), undefined);
  assert.equal(sniff(bytes('GIF89a', le16(0), le16(7))), undefined, 'no size, no picture');
});
const pick = (s: ReturnType<typeof sniff>) => (s && s !== 'svg' ? { type: s.type, w: s.w, h: s.h, alpha: s.alpha } : s);

test('a picture is kept under its name and content hash, listed, and the same content is kept once', () => {
  const dir = project();
  try {
    const a = addAsset(dir, { name: 'Our Logo.png', data: png(600, 200), note: '  the   mark ', thumb: webp(480, 160) });
    assert.match(a.file, /^our-logo-[0-9a-f]{10}\.png$/);
    assert.deepEqual({ name: a.name, note: a.note, type: a.type, w: a.w, h: a.h, alpha: a.alpha }, { name: 'Our Logo', note: 'the mark', type: 'png', w: 600, h: 200, alpha: true });
    assert.equal(a.thumb, `thumbs/${a.file.replace('.png', '')}.webp`);
    assert.ok(fs.existsSync(path.join(dir, 'assets/user', a.file)) && fs.existsSync(path.join(dir, 'assets/user', a.thumb!)));
    assert.deepEqual(listAssets(dir), [a]);
    // the same bytes again, under another name: the one there, renamed
    const again = addAsset(dir, { name: 'logo-final.png', data: png(600, 200) });
    assert.equal(again.file, a.file);
    assert.equal(again.name, 'logo-final');
    assert.equal(again.note, 'the mark', 'a note not given is kept');
    assert.equal(listAssets(dir).length, 1);
    // a Chinese name has no letters for the file: 'asset'; an SVG is kept cleaned
    const b = addAsset(dir, { name: '图表.svg', data: Buffer.from(svg), from: 'lib-1' });
    assert.match(b.file, /^asset-[0-9a-f]{10}\.svg$/);
    assert.equal(b.from, 'lib-1');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'assets/user', b.file), 'utf8'), /script/);
    assert.equal(b.bytes, fs.statSync(path.join(dir, 'assets/user', b.file)).size);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'assets/user/assets.json'), 'utf8')).assets.map((x: { file: string }) => x.file), [a.file, b.file]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('what is too big, not a picture, a dirty SVG, or one too many is refused; a bad small copy is left out', () => {
  const dir = project();
  try {
    assert.throws(() => addAsset(dir, { name: 'big.png', data: new Uint8Array(10 * 1024 * 1024 + 1) }), /10 ?MB/);
    assert.throws(() => addAsset(dir, { name: 'doc.pdf', data: Buffer.from('%PDF-1.7') }), /PNG、JPEG|PNG, JPEG/);
    assert.throws(() => addAsset(dir, { name: 'x.svg', data: Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>') }), /SVG/);
    const big = addAsset(dir, { name: 'a.png', data: png(10, 10), thumb: new Uint8Array(600 * 1024) });
    assert.equal(big.thumb, undefined, 'a small copy over 512 KB');
    const svgThumb = addAsset(dir, { name: 'b.png', data: png(10, 10, true, 1), thumb: Buffer.from(svg) });
    assert.equal(svgThumb.thumb, undefined, 'a small copy that is not PNG, JPEG or WebP');
    for (let i = 2; i < 60; i++) addAsset(dir, { name: `p${i}.png`, data: png(10, 10, true, i) });
    assert.equal(listAssets(dir).length, 60);
    assert.throws(() => addAsset(dir, { name: 'one-more.png', data: png(10, 10, true, 999) }), /60/);
    assert.equal(addAsset(dir, { name: 'again.png', data: png(10, 10, true, 5) }).name, 'again', 'the same content is still found when full');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a picture is renamed and noted, and removed with its small copy', () => {
  const dir = project();
  try {
    const a = addAsset(dir, { name: 'shot.jpg', data: jpg(1600, 900), thumb: jpg(480, 270) });
    assert.equal(a.thumb, `thumbs/${a.file.replace('.jpg', '')}.jpg`);
    const b = addAsset(dir, { name: 'spin.gif', data: gif(20, 20, false) });
    const u = updateAsset(dir, a.file, { name: '  Home   screen ', note: 'n'.repeat(300) });
    assert.equal(u.name, 'Home screen');
    assert.equal(u.note.length, 200);
    assert.equal(updateAsset(dir, a.file, { name: '' }).name, 'Home screen', 'a name never goes blank');
    assert.equal(listAssets(dir)[0].name, 'Home screen');
    assert.throws(() => updateAsset(dir, 'nope-0000000000.png', { note: 'x' }), /not found|不存在/);
    removeAsset(dir, a.file);
    assert.ok(!fs.existsSync(path.join(dir, 'assets/user', a.file)) && !fs.existsSync(path.join(dir, 'assets/user', a.thumb!)));
    assert.deepEqual(listAssets(dir).map((x) => x.file), [b.file]);
    assert.throws(() => removeAsset(dir, a.file), /not found|不存在/);
    assert.throws(() => removeAsset(dir, '../../etc/passwd'), /not found|不存在/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
