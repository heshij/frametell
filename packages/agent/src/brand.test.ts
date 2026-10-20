import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_MOMENT_RULES, brandFilesOn, brandSection, cleanBrand, cornerMark, signsOff, type BrandBrief } from './brand.js';
import { pagePrompt, pageSystem, plannerSystem, reviewerPrompt, reviewerSystem } from './prompts.js';
import type { PageTiming, Storyboard } from './project.js';

const brand: BrandBrief = {
  name: 'Tidewise', about: 'A tide-table app for sailors', tone: 'Calm, exact, a little dry.\nNever hype.', tagline: 'Know the water',
  assets: [
    { file: 'a1.svg', kind: 'logo', name: 'Logo', note: 'the main logo', w: 600, h: 200, alpha: true },
    { file: 'a2.svg', kind: 'logo-dark', name: 'Logo (dark)', note: '', w: 600, h: 200, alpha: true },
    { file: 'a3.png', kind: 'image', name: 'Home screen', note: 'the app\'s home screen', w: 1170, h: 2532, alpha: false },
  ],
};
const sb: Storyboard = { title: 'Tides', summary: 'How the moon pulls the sea', style: 'warm-story', cast: '', lang: 'en', pages: [
  { id: 'p01', section: 'Open', say: 'The sea rises twice a day', beats: [{ at: 'c1', object: 'shore', action: 'water rises' }] },
  { id: 'p02', section: 'How', say: 'The app shows it', beats: [{ at: 'c1', object: 'phone with assets/brand/a3.png', action: 'slides in' }] },
  { id: 'p03', section: 'Middle', say: 'The moon pulls', beats: [{ at: 'c1', object: 'moon', action: 'pulls' }] },
  { id: 'p04', section: 'Close', say: 'Next time, think of the moon', beats: [{ at: 'c1', object: 'moon and sea', action: 'settle and clear' }, { at: 'c2', object: 'brand moment: assets/brand/a1.svg, closing sign-off, centred once the scene has cleared, tagline under it', action: 'fades in and holds' }] },
] };
const t: PageTiming = { id: 'p01', start: 0, end: 8, speechEnd: 7, cues: [{ i: 1, at: 0.4, abs: 0.4, text: 'The sea rises' }] };

test('a brief is trimmed to size, keeps only plain picture names, and needs a name', () => {
  assert.equal(cleanBrand({ assets: [] }), undefined);
  assert.equal(cleanBrand('Tidewise'), undefined);
  const b = cleanBrand({
    name: '  Tidewise  ', tagline: 'x'.repeat(200), showLogo: false, bookends: true, id: 'b-1', nope: 1,
    assets: [
      { file: 'a1.svg', kind: 'logo', name: 'Logo', note: 'n', w: 600.4, h: 200, alpha: true },
      { file: '../a.svg', kind: 'logo' }, { file: 'x/a.png' }, { file: '.hidden.png' }, { file: 'a.gif' }, { file: 'A1.SVG' },
      { file: 'b.webp', kind: 'hologram', w: -3, h: 'x' },
    ],
  })!;
  assert.equal(b.name, 'Tidewise');
  assert.equal(b.id, 'b-1');
  assert.equal(b.tagline!.length, 80);
  assert.equal(b.showLogo, false);
  assert.ok(!('bookends' in b));
  assert.equal(cleanBrand({ name: 'x', assets: [], showLogo: true })!.showLogo, undefined, 'the default is not stored');
  assert.ok(!('nope' in b));
  assert.deepEqual(b.assets.map((a) => a.file), ['a1.svg', 'b.webp']);
  assert.deepEqual(b.assets[0], { file: 'a1.svg', kind: 'logo', name: 'Logo', note: 'n', w: 600, h: 200, alpha: true });
  assert.deepEqual(b.assets[1], { file: 'b.webp', kind: 'image', name: 'b.webp', note: '', w: 0, h: 0, alpha: false });
  assert.equal(cleanBrand({ name: 'x', assets: Array.from({ length: 40 }, (_, i) => ({ file: `f${i}.png` })) })!.assets.length, 30);
});

test('the brand follows the style card and its notes in the director\'s prompt, and adds nothing else', () => {
  const sys = plannerSystem('warm-story', '- chatty', '- more white space', brand);
  const card = sys.indexOf("# This film's style"), own = sys.indexOf("# This film's own look"), it = sys.indexOf("# This film's brand");
  assert.ok(card >= 0 && own > card && it > own);
  assert.ok(sys.indexOf('<preferences>') > it, 'the preferences still close the prompt');
  assert.equal(sys.replace('\n\n' + brandSection(brand), ''), plannerSystem('warm-story', '- chatty', '- more white space'));
  for (const s of ['Name: Tidewise', 'About: A tide-table app for sailors', 'Tagline: “Know the water”', '<brand-tone>\nCalm, exact, a little dry.\nNever hype.\n</brand-tone>',
    '`assets/brand/a1.svg`: logo, 600×200, transparent background, “Logo”: the main logo', '`assets/brand/a3.png`: image, 1170×2532, opaque background, “Home screen”: the app\'s home screen',
    '## Brand moments', BRAND_MOMENT_RULES, 'only where the content calls for them', 'The rules on facts still hold']) assert.ok(sys.includes(s), s);
  assert.ok(!sys.includes('first page'), 'no rule puts the logo on fixed pages');
  assert.ok(sys.includes('The film ends on the sign-off.'));
  assert.ok(sys.includes('never a substitute for it, and it stays for a whole section (at least about 8 seconds)'));
  const off = brandSection({ ...brand, showLogo: false });
  assert.ok(off.includes('No logo on screen anywhere in this film: the brand shows in its colours and its tone only.'));
  assert.ok(!off.includes('Brand moments') && !off.includes('a1.svg') && !off.includes('a2.svg'), 'no logo is even listed');
  assert.ok(off.includes('assets/brand/a3.png'));
  assert.ok(!brandSection({ ...brand, assets: brand.assets.filter((a) => a.kind === 'image') }).includes('Brand moments'), 'no moments without a logo');
});

test('without a brand the system prompts are as they were', () => {
  assert.equal(plannerSystem('warm-story', 'p', 'n', undefined), plannerSystem('warm-story', 'p', 'n'));
  assert.equal(brandSection(undefined), '');
  for (const sys of [plannerSystem('warm-story'), pageSystem('warm-story'), reviewerSystem('warm-story')]) assert.ok(!sys.includes("# This film's brand") && !sys.includes('assets/brand'));
});

test('a page is told of the brand files only where its storyboard names them, the logo in a planned brand moment', () => {
  assert.deepEqual(brandFilesOn(brand, sb.pages, 'p01'), [], 'no logo by rule on the first page');
  assert.deepEqual(brandFilesOn(brand, sb.pages, 'p02').map((a) => a.file), ['a3.png']);
  assert.deepEqual(brandFilesOn(brand, sb.pages, 'p03'), []);
  assert.deepEqual(brandFilesOn(brand, sb.pages, 'p04').map((a) => a.file), ['a1.svg', 'a2.svg']);
  assert.deepEqual(brandFilesOn({ ...brand, showLogo: false }, sb.pages, 'p04'), [], 'no logo at all when the film shows none');
  assert.deepEqual(brandFilesOn({ ...brand, showLogo: false }, sb.pages, 'p02').map((a) => a.file), ['a3.png']);
  assert.equal(pagePrompt(sb, 'p01', t, 'en', 'en', false, brand), pagePrompt(sb, 'p01', t, 'en', 'en', false));

  const first = pagePrompt(sb, 'p04', t, 'en', 'en', false, brand);
  assert.ok(first.includes("## The brand's files on this page"));
  assert.ok(first.includes("P.img('assets/brand/a1.svg', x, y, w, w * 200 / 600, { fit: 'contain', border: false, shadow: false, r: 0, pop: 0, at, dur: 0.8 })"));
  assert.ok(first.includes('draw exactly the beat that names the logo'));
  assert.ok(first.includes('nothing else within about one logo-height of it'));
  assert.ok(first.includes("enters with the style's own motion"));
  assert.ok(first.includes('A sign-off makes the logo the largest thing in the moment, about 18–30% of the frame\'s width'));
  assert.ok(first.includes('its tagline is narrower than the logo and clearly smaller'));
  assert.ok(first.includes('never stretch, crop, recolour'));
  assert.ok(first.includes('never framed, bordered or shadowed'));
  assert.ok(first.includes('On a dark ground use `assets/brand/a2.svg`'));
  assert.ok(first.indexOf("## The brand's files") < first.indexOf('Stop once pages/p04.js'));
  const shot = pagePrompt(sb, 'p02', t, 'en', 'en', false, brand);
  assert.ok(shot.includes("P.img('assets/brand/a3.png', x, y, w, w * 2532 / 1170, { fit: 'cover' })"));
  assert.ok(!shot.includes('logo-height'), 'no logo rules for a page without a logo');
  assert.ok(!shot.includes('border: false'), 'a picture that is not a logo is framed as any picture');
  assert.equal(pagePrompt(sb, 'p03', t, 'en', 'en', false, brand), pagePrompt(sb, 'p03', t, 'en', 'en', false));
});

test('the film ends on its last page: told so, with the hold after its last line, the sign-off in that hold', () => {
  assert.equal(signsOff(brand, sb.pages), true);
  assert.equal(signsOff({ ...brand, showLogo: false }, sb.pages), false, 'no sign-off when the film shows no logo');
  assert.equal(signsOff(undefined, sb.pages), false);
  const end = { ...t, id: 'p04', end: 10.6 };
  const last = pagePrompt(sb, 'p04', end, 'en', 'en', false, brand);
  assert.ok(last.includes('## The film ends on this page'));
  assert.ok(last.includes('the film holds 3.6s on this page, then fades out by itself'));
  assert.ok(last.includes("except the brand's sign-off, which happens in this hold"));
  assert.ok(last.includes('the logo enters about 0.3s later and stays until the film\'s own fade-out'));
  assert.ok(last.indexOf('## The film ends') < last.indexOf("## The brand's files"));
  const plain = pagePrompt(sb, 'p04', end, 'en', 'en', false);
  assert.ok(plain.includes('## The film ends on this page') && !plain.includes("brand's sign-off"));
  assert.ok(!pagePrompt(sb, 'p03', t, 'en', 'en', false, brand).includes('The film ends'), 'only the last page');
  assert.ok(reviewerPrompt(sb, 'p04', end, 1, [], [{ local: 1 }], undefined, brand).includes('This page ends the film: after its last line it holds 3.6s'));
  assert.ok(BRAND_MOMENT_RULES.includes("The sign-off comes after the narration's last line"));
});

test('the reviewer checks the logo where the storyboard puts it, and fails one it doesn\'t ask for', () => {
  const r = reviewerPrompt(sb, 'p04', t, 1, [], [{ local: 1 }], undefined, brand);
  assert.ok(r.includes("The storyboard puts the brand's logo on this page (a1.svg, a2.svg). Fail the page if the logo is stretched"));
  assert.ok(r.includes('overlapping or crowding any other element, in the middle of the content'));
  assert.ok(r.includes('if the logo is smaller or narrower than its tagline, touches or sits on a line, horizon or edge, reads as a watermark'));
  assert.ok(r.indexOf("brand's logo") < r.indexOf('## The checker'));
  assert.ok(reviewerPrompt(sb, 'p02', t, 1, [], [{ local: 1 }], undefined, brand).includes('The storyboard puts no brand logo on this page: fail it if one appears.'));
  const images = { ...brand, assets: brand.assets.filter((a) => a.kind === 'image') };
  assert.equal(reviewerPrompt(sb, 'p02', t, 1, [], [{ local: 1 }], undefined, images), reviewerPrompt(sb, 'p02', t, 1, [], [{ local: 1 }]));
});

test('the brand\'s main colour, when the host names its palette name, is the one for emphasis: in the director\'s prompt and on every page', () => {
  const rule = "The brand's main colour is the palette's `teal`: use it for emphasis (highlights, underlines, the key number) rather than other accents.";
  const b = cleanBrand({ ...brand, emphasis: 'teal' })!;
  assert.equal(b.emphasis, 'teal');
  for (const bad of ['', 'te al', '--x', 'red;}', '1red', 'x'.repeat(40), 7]) assert.equal(cleanBrand({ ...brand, emphasis: bad })!.emphasis, undefined);
  assert.ok(brandSection(b).includes(`- ${rule}`));
  assert.ok(!brandSection(brand).includes('main colour'));
  const plain = pagePrompt(sb, 'p03', t, 'en', 'en', false, b);
  assert.ok(plain.includes(`## The brand\n- ${rule}`));
  assert.ok(plain.indexOf(rule) < plain.indexOf('Stop once pages/p03.js'));
  const first = pagePrompt(sb, 'p04', t, 'en', 'en', false, b);
  assert.ok(first.includes(rule) && first.includes("## The brand's files on this page"));
  assert.equal(pagePrompt(sb, 'p03', t, 'en', 'en', false, brand), pagePrompt(sb, 'p03', t, 'en', 'en', false));
});

test('the film\'s palette as the host set it from the brand is spelled out, so colours are described as they are now', () => {
  const b = cleanBrand({ ...brand, palette: { red: '#0b6e99', green: '#2a9d8f', 'bad name': '#000000', blue: 'teal', ink: '#1A1714' } })!;
  assert.deepEqual(b.palette, { red: '#0B6E99', green: '#2A9D8F', ink: '#1A1714' });
  assert.equal(cleanBrand({ ...brand, palette: { red: 'x' } })!.palette, undefined);
  assert.equal(cleanBrand({ ...brand, palette: ['#000000'] })!.palette, undefined);
  assert.ok(brandSection(b).includes("- In this film the palette's colours are: red #0B6E99, green #2A9D8F, ink #1A1714. Describe colours by what they are now, not by the style card's names.\n"));
  assert.ok(!brandSection(brand).includes("palette's colours are"));
});

test('a corner the brand chose puts its logo on every page through the engine, and the agents keep that corner clear', () => {
  assert.equal(cleanBrand({ ...brand, corner: 'tr' })!.corner, 'tr');
  for (const bad of ['tl', 'none', '', 3]) assert.equal(cleanBrand({ ...brand, corner: bad })!.corner, undefined);
  const b = { ...brand, corner: 'br' as const };
  assert.deepEqual(cornerMark(b), { src: 'assets/brand/a1.svg', dark: 'assets/brand/a2.svg', corner: 'br', w: 600, h: 200 });
  assert.equal(cornerMark(b, true)!.signOff, true);
  // a wordless mark is preferred in a corner
  assert.equal(cornerMark({ ...b, assets: [...brand.assets, { file: 'm.png', kind: 'mark', name: 'Mark', note: '', w: 64, h: 64, alpha: true }] })!.src, 'assets/brand/m.png');
  assert.equal(cornerMark(brand), undefined, 'no corner chosen');
  assert.equal(cornerMark({ ...b, showLogo: false }), undefined, 'no logo at all');
  assert.equal(cornerMark({ ...b, assets: brand.assets.filter((a) => a.kind === 'image') }), undefined, 'a picture is not a logo');
  assert.ok(brandSection(b).includes('bottom-right corner of every page') && brandSection(b).includes('plan no other corner mark'));
  assert.ok(!brandSection(brand).includes('corner of every page'));
  // every page is told, with or without the brand's files on it; the reviewer accepts the mark but not a crowded corner
  assert.ok(pagePrompt(sb, 'p03', t, 'en', 'en', false, b).includes('bottom-right corner of every page'));
  assert.ok(pagePrompt(sb, 'p04', t, 'en', 'en', false, b).includes('bottom-right corner of every page'));
  const review = reviewerPrompt(sb, 'p03', t, 1, [], [], undefined, b);
  assert.ok(review.includes("film's own corner mark") && review.includes('anywhere but that corner'));
  assert.equal(pagePrompt(sb, 'p03', t, 'en', 'en', false, brand), pagePrompt(sb, 'p03', t, 'en', 'en', false), 'no corner, no change');
});
