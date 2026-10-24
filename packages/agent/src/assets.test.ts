import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assetPageNote, assetsOn, assetsSection, cleanUserAssets, userAssets, USER_ASSETS_MANIFEST, type UserAsset } from './assets.js';
import { pagePrompt, plannerSystem, reviewerPrompt } from './prompts.js';
import type { PageTiming, Storyboard } from './project.js';

const logo: UserAsset = { file: 'our-logo-0123456789.svg', name: 'Our logo', note: 'the company mark', type: 'svg', w: 600, h: 200, alpha: true, bytes: 900, addedAt: '2026-10-21T00:00:00Z' };
const photo: UserAsset = { file: 'product-abcdef0123.jpg', name: 'Product', note: '', type: 'jpg', w: 1600, h: 900, alpha: false, bytes: 90000, addedAt: '2026-10-21T00:00:00Z' };
const spin: UserAsset = { file: 'spin-1111111111.gif', name: 'Spinner', note: '', type: 'gif', w: 200, h: 200, alpha: false, bytes: 4000, addedAt: '2026-10-21T00:00:00Z' };
const sb: Storyboard = { title: 'Tides', summary: 'How the moon pulls the sea', style: 'warm-story', cast: '', lang: 'en', pages: [
  { id: 'p01', section: 'Open', say: 'The sea rises', beats: [{ at: 'c1', object: 'shore', action: 'water rises' }] },
  { id: 'p02', section: 'Product', say: 'Our app shows it', beats: [{ at: 'c1', object: 'the product photo assets/user/product-abcdef0123.jpg', action: 'slides in' }] },
] };
const t: PageTiming = { id: 'p01', start: 0, end: 8, speechEnd: 7, cues: [{ i: 1, at: 0.4, abs: 0.4, text: 'The sea rises' }] };

test('the list keeps only entries with the file names core gives, each once', () => {
  const list = cleanUserAssets({ assets: [
    logo, { ...logo }, { ...photo, file: '../x.jpg' }, { ...photo, file: 'Product-abcdef0123.jpg' }, { ...photo, type: 'bmp' },
    { ...photo, name: 'x'.repeat(100), thumb: 'thumbs/product-abcdef0123.webp' }, { ...spin, thumb: '../../etc/passwd' },
  ] });
  assert.deepEqual(list.map((a) => a.file), [logo.file, photo.file, spin.file]);
  assert.equal(list[1].name.length, 60);
  assert.equal(list[1].thumb, 'thumbs/product-abcdef0123.webp');
  assert.equal(list[2].thumb, undefined);
  assert.deepEqual(cleanUserAssets('nope'), []);
});

test('the film\'s list is read from the project as it is now', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-assets-'));
  try {
    assert.deepEqual(userAssets(dir), []);
    fs.mkdirSync(path.join(dir, 'assets', 'user'), { recursive: true });
    fs.writeFileSync(path.join(dir, USER_ASSETS_MANIFEST), JSON.stringify({ assets: [logo] }));
    assert.deepEqual(userAssets(dir).map((a) => a.file), [logo.file]);
    fs.writeFileSync(path.join(dir, USER_ASSETS_MANIFEST), '{ not json');
    assert.deepEqual(userAssets(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the director sees the user\'s pictures when there are some, and the prompt is as it was without', () => {
  const sys = plannerSystem('warm-story', undefined, undefined, undefined, [logo, photo]);
  assert.ok(sys.includes("# The user's assets"));
  assert.ok(sys.includes('`assets/user/our-logo-0123456789.svg`: SVG, 600×200, transparent background, “Our logo”: the company mark'));
  assert.ok(sys.includes('a picture left out of the film needs a reason'));
  assert.ok(!sys.includes('GIF may show as a still'));
  assert.ok(assetsSection([spin]).includes('A GIF may show as a still'));
  assert.equal(plannerSystem('warm-story', 'p', 'n', undefined, []), plannerSystem('warm-story', 'p', 'n'));
  assert.ok(!plannerSystem('warm-story').includes("The user's assets"));
});

test('a page places the pictures its storyboard or its change names, each with the call at its proportions', () => {
  assert.deepEqual(assetsOn([logo, photo], sb.pages, 'p02').map((a) => a.file), [photo.file]);
  assert.deepEqual(assetsOn([logo, photo], sb.pages, 'p01'), []);
  assert.deepEqual(assetsOn([logo, photo], sb.pages, 'p01', 'put assets/user/our-logo-0123456789.svg in the corner').map((a) => a.file), [logo.file]);
  const note = assetPageNote([logo, photo]);
  assert.ok(note.includes("P.img('assets/user/our-logo-0123456789.svg', x, y, w, w * 200 / 600, { fit: 'contain', border: false, shadow: false, r: 0, at })"));
  assert.ok(note.includes("P.img('assets/user/product-abcdef0123.jpg', x, y, w, w * 900 / 1600, { fit: 'cover', at })"));
  const p = pagePrompt(sb, 'p02', t, 'en', 'en', false, undefined, [photo]);
  assert.ok(p.includes("## The user's pictures on this page"));
  assert.equal(pagePrompt(sb, 'p01', t, 'en', 'en', false, undefined, []), pagePrompt(sb, 'p01', t, 'en', 'en', false));
  const r = reviewerPrompt(sb, 'p02', t, 1, [], [{ local: 1 }], undefined, undefined, [photo]);
  assert.ok(r.includes('The storyboard puts the user\'s own picture on this page (“Product”)'));
  assert.equal(reviewerPrompt(sb, 'p01', t, 1, [], [{ local: 1 }], undefined, undefined, []), reviewerPrompt(sb, 'p01', t, 1, [], [{ local: 1 }]));
});

test('a picture over 100 KB keeps its size in the list', () => {
  const [a] = cleanUserAssets({ assets: [{ ...photo, bytes: 1694188 }] });
  assert.equal(a.bytes, 1694188);
});
