import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { componentNames, keepComponents, kitIssues, kitPlan, kitStage, kitTimes, kitWanted, reservedNames } from './kit.js';

const ids = Array.from({ length: 10 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);

test('the engine\'s own drawing calls are reserved: a film component may not replace them', () => {
  const r = reservedNames();
  for (const n of ['text', 'title', 'arrow', 'c', 'seed']) assert.ok(r.has(n), n);
  assert.ok(!r.has('chinaMap'));
});

test('the kit plan keeps well-formed components, once each, at most eight', () => {
  const look = { kit: [
    { name: 'globe', what: 'a turning globe', pages: ['p01', 'p02', 'p09'] },
    { name: 'globe', what: 'again', pages: ['p01', 'p02', 'p03'] },
    { name: 'Bad-Name', what: 'x', pages: ['p01'] },
    { name: 'text', what: 'the engine already has this', pages: ['p01', 'p02', 'p03'] },
    { name: 'flag', what: '', pages: ['p01'] },
    ...Array.from({ length: 10 }, (_, i) => ({ name: `thing${i}`, what: 'w', pages: ['p01', 'p02', 'p03'] })),
  ] };
  const plan = kitPlan(look);
  assert.equal(plan[0].name, 'globe');
  assert.equal(plan.length, 8);
  assert.ok(!plan.some((x) => x.name === 'text' || x.name === 'Bad-Name' || x.name === 'flag'));
  assert.deepEqual(kitPlan(undefined), []);
  assert.deepEqual(kitPlan({ kit: 'no' }), []);
});

test('the storyboard check says what is wrong with look.kit, and nothing when there is none', () => {
  assert.deepEqual(kitIssues({}, ids), []);
  assert.deepEqual(kitIssues({ kit: [{ name: 'globe', what: 'a globe', pages: ['p01', 'p02', 'p03'] }] }, ids), []);
  const issues = kitIssues({ kit: [
    { name: 'globe', what: 'a globe', pages: ['p01', 'p02'] },
    { name: 'text', what: 'x', pages: ['p01', 'p02', 'p03'] },
    { name: 'map', what: 'x', pages: ['p01', 'p02', 'p99'] },
    { name: 'x y', what: 'x', pages: [] },
  ] }, ids).join('\n');
  assert.match(issues, /globe is on 2 pages/);
  assert.match(issues, /already one of the engine's P\.text/);
  assert.match(issues, /does not have: p99/);
  assert.match(issues, /"x y" is not a component name/);
});

test('a kit is written for a designed style\'s film of eight pages or more, with two things or more that recur', () => {
  const two = kitPlan({ kit: [{ name: 'globe', what: 'g', pages: ids.slice(0, 3) }, { name: 'flag', what: 'f', pages: ids.slice(0, 3) }] });
  assert.equal(kitWanted(true, 8, two), true);
  assert.equal(kitWanted(true, 7, two), false);
  assert.equal(kitWanted(false, 40, two), false);
  assert.equal(kitWanted(true, 40, two.slice(0, 1)), false);
});

const KIT = `/* a film's kit */
(function () {
  const { col, Builder } = PV;
  const B = Builder.prototype;
  /** globe(x, y, r, o): a turning globe. o: { at } */
  B.globe = function (x, y, r, o = {}) {
    return this.circle(x, y, r, o);
  };
  /**
   * flag(x, y, label, o): a pin with a label.
   * o: { at, color }
   */
  B.flag = function (x, y, label, o = {}) {
    if (o.at) { return null; }
    return label;
  };
  /** slab(x, y, o): a terrain step */
  B.slab = function (x, y, o = {}) { return [x, y]; };
})();
`;

test('a kit keeps only the components that passed, each with its doc comment', () => {
  assert.deepEqual(componentNames(KIT), ['globe', 'flag', 'slab']);
  const kept = keepComponents(KIT, ['globe', 'slab']);
  assert.deepEqual(componentNames(kept), ['globe', 'slab']);
  assert.doesNotMatch(kept, /flag|pin with a label/);
  assert.match(kept, /\/\*\* slab\(x, y, o\)/);
  assert.match(kept, /^\}\)\(\);$/m);
  // what is left still runs
  const proto: Record<string, unknown> = {};
  new Function('PV', kept)({ col: {}, Builder: { prototype: proto } });
  assert.deepEqual(Object.keys(proto), ['globe', 'slab']);
  assert.equal(keepComponents(KIT, ['globe', 'flag', 'slab']), KIT);
});

test('the kit\'s check is a project of its own: the film\'s look, the kit, and one page with a cue per component', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  const items = kitPlan({ kit: [{ name: 'globe', what: 'g', pages: ids.slice(0, 3) }, { name: 'flag', what: 'f', pages: ids.slice(0, 3) }] });
  const stage = kitStage(dir, { style: 'free', lang: 'zh', look: { palette: { ink: '#111111' } }, items, kit: KIT, check: "ENGINE.visual('check', (P) => { P.globe(400, 400, 100, { at: P.c(0) }); });" });
  assert.equal(stage, path.join(dir, '.studio/kit'));
  assert.equal(fs.readFileSync(path.join(stage, 'extras/film-kit.js'), 'utf8'), KIT);
  assert.match(fs.readFileSync(path.join(stage, 'pages/kit.js'), 'utf8'), /^ENGINE\.visual\('kit'/);
  const ctx: { SCRIPT?: { META: Record<string, unknown>; PAGES: { id: string; cues: { t: string }[] }[] } } = {};
  new Function('globalThis', 'window', fs.readFileSync(path.join(stage, 'script.js'), 'utf8'))(ctx, ctx);
  assert.deepEqual(ctx.SCRIPT!.META.extras, ['extras/film-kit.js']);
  assert.deepEqual(ctx.SCRIPT!.META.look, { palette: { ink: '#111111' } });
  assert.deepEqual(ctx.SCRIPT!.PAGES[0].cues.map((c) => c.t), ['globe', 'flag']);
  assert.ok(fs.existsSync(path.join(stage, 'index.html')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the check sheet looks at each component once it is drawn, at most six moments', () => {
  assert.deepEqual(kitTimes([{ abs: 0 }, { abs: 3 }], 6), [2.7, 4.8]);
  assert.equal(kitTimes(Array.from({ length: 8 }, (_, i) => ({ abs: i * 3 })), 24).length, 6);
});
