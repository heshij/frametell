import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Director } from './director.js';
import { editIn, writeIn } from './projectfs.js';
import type { AgentRuntime } from './runtime/types.js';
import type { StudioEvent } from './events.js';

const KIT = `(function () {
  const { Builder } = PV;
  const B = Builder.prototype;
  /** globe(x, y, r, o): a turning globe. o: { at } */
  B.globe = function (x, y, r, o = {}) { return this.circle(x, y, r, o); };
  /** flag(x, y, label, o): a pin with a label. o: { at } */
  B.flag = function (x, y, label, o = {}) { return this.text(label, { x, y, ...o }); };
})();
`;
const CHECK = "ENGINE.visual('kit', (P) => { P.globe(400, 400, 200, { at: P.c(0) }); P.flag(1200, 400, 'A', { at: P.c(1) }); });\n";
const PAGE = "ENGINE.visual('p01', (P) => {\n  P.globe(960, 500, 300);\n});\n";
const ids = Array.from({ length: 8 }, (_, i) => `p0${i + 1}`);
const KIT_PLAN = [{ name: 'globe', what: 'a turning globe', pages: ids.slice(0, 4) }, { name: 'flag', what: 'a pin with a label', pages: ids.slice(2, 6) }];

/** the page model: writes the kit and its check page when asked for the kit, the page otherwise; `systems` keeps what
 *  each session was told */
function artist(systems: Record<string, string>, o: { writesKit?: boolean } = {}): AgentRuntime {
  return {
    id: 'pi', model: { provider: 'x', id: 'opus' },
    async open(s) {
      systems[s.name] = s.system;
      return { ref: s.name, close: async () => {}, send: async ({ text }: { text: string }) => {
        if (s.name === 'kit') {
          if (/^Check round/.test(text)) fs.appendFileSync(path.join(s.cwd, 'extras/film-kit.js'), '// changed\n');
          else if (o.writesKit !== false && /Write extras\/film-kit\.js|film's own components/.test(text)) {
            fs.mkdirSync(path.join(s.cwd, 'extras'), { recursive: true });
            fs.writeFileSync(path.join(s.cwd, 'extras/film-kit.js'), KIT);
            fs.writeFileSync(path.join(s.cwd, 'extras/kit-check.js'), CHECK);
          }
        } else if (s.name.startsWith('page-')) {
          const id = s.name.slice(5);
          fs.writeFileSync(path.join(s.cwd, `pages/${id}.js`), PAGE.replace('p01', id));
          // one page reaches into the film's components
          if (id === 'p02' && fs.existsSync(path.join(s.cwd, 'extras'))) fs.writeFileSync(path.join(s.cwd, 'extras/film-kit.js'), '/* gone */');
        }
        return { text: 'done', stopReason: 'done', usage: {}, answers: [] } as never;
      } };
    },
  };
}

/** a reviewer: fails the flag on the kit's sheet, passes every page */
function reviewer(prompts: string[], o: { failFlag?: boolean } = {}): AgentRuntime {
  return {
    id: 'pi', model: { provider: 'y', id: 'haiku' },
    async open(s) {
      return { ref: 'v', close: async () => {}, send: async ({ text }: { text: string }) => {
        prompts.push(`${s.name}: ${text}`);
        const problems = s.name === 'check-kit' && o.failFlag ? [{ at: 4, what: 'flag: the pin is cut off', fix: 'move it in' }] : [];
        return { text: '', stopReason: 'done', usage: {}, answers: [{ name: 'verdict', args: { pass: !problems.length, problems } }] } as never;
      } };
    },
  };
}

function film(o: { pages?: number; kit?: unknown; designed?: boolean; writesKit?: boolean; failFlag?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-filmkit-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'script.js'), "(function (root) {\n  const META = {\n    style: 'free',\n    extras: [],\n  };\n  root.SCRIPT = { META, PAGES: [] };\n})(globalThis);\n");
  const systems: Record<string, string> = {}, prompts: string[] = [], events: StudioEvent[] = [];
  const art = artist(systems, { writesKit: o.writesKit });
  const d = new Director({ dir, style: 'free', brief: { durationSec: 180, lang: 'zh', replyLang: 'zh' }, runtime: art, pages: { runtime: art }, reviewer: { runtime: reviewer(prompts, { failFlag: o.failFlag }) }, emit: (e) => events.push(e) });
  const n = o.pages ?? 8;
  const sb = { title: 'T', summary: 'S', look: { card: 'card', kit: o.kit ?? KIT_PLAN }, pages: Array.from({ length: n }, (_, i) => ({ id: `p0${i + 1}`, section: 's', say: '…', beats: [] })) };
  const timing = { duration: n * 5, pages: sb.pages.map((p, i) => ({ id: p.id, start: i * 5, end: i * 5 + 5, speechEnd: i * 5 + 4, cues: [] })) };
  const checked: string[] = [];
  Object.assign(d.project, {
    check: async () => ({ issues: [], sheet: 'sheet.jpg' }), lint: async () => [], snap: async () => 'sheet.jpg', commit: async () => undefined,
    storyboard: () => sb, timeline: async () => timing,
  });
  Object.assign(d, {
    designed: () => (o.designed === false ? undefined : { card: 'card', look: { palette: { ink: '#111111' } } }),
    checkKit: async (items: { name: string }[]) => {
      checked.push(fs.readFileSync(path.join(dir, 'extras/film-kit.js'), 'utf8'));
      return { page: { start: 0, end: 5.2, cues: items.map((_, i) => ({ abs: i * 2.6 })) }, times: [2.3, 4.9], check: { issues: [], sheet: path.join(dir, 'kit.jpg') } };
    },
  });
  fs.writeFileSync(path.join(dir, 'kit.jpg'), 'jpg');
  return { d: d as unknown as { kit(): Promise<void>; pages(): Promise<void>; state: { kit?: { status: string; components: string[] }; pages: Record<string, { status: string; issues: { msg: string }[] }> } }, dir, systems, prompts, events, checked };
}

test('a designed style\'s film of eight pages writes its components first, and every page is shown them', async () => {
  const f = film();
  await f.d.kit();
  assert.deepEqual(f.d.state.kit, { status: 'done', components: ['globe', 'flag'] });
  assert.match(f.systems.kit, /This film's style card/);
  assert.ok(f.events.some((e) => e.type === 'kit' && e.status === 'done'));
  await f.d.pages();
  // the pages load it (META.extras) and are told about it, first
  assert.match(fs.readFileSync(path.join(f.dir, 'script.js'), 'utf8'), /extras: \["extras\/film-kit\.js"\]/);
  assert.match(f.systems['page-p01'], /This film's own components \(film-kit\.js\)[\s\S]*P\.globe\(x, y, r, o = \{\}\)[\s\S]*P\.flag\(x, y, label, o = \{\}\)/);
  assert.ok(f.prompts.some((p) => p.startsWith('check-p01')));
});

test('once checked, the components are fixed: the agents\' file tools refuse them, and a shell\'s change is put back', async () => {
  const f = film();
  await f.d.kit();
  // the write and edit tools go through writeIn without the studio's record: refused, with why
  assert.throws(() => writeIn(f.dir, 'extras/film-kit.js', 'x'), /every page of this film uses it/);
  assert.throws(() => editIn(f.dir, 'extras/film-kit.js', (src) => src + 'x'), /every page of this film uses it/);
  writeIn(f.dir, 'extras/other.js', 'fine');   // the rest of the film is not
  // p02's agent changes it through its shell (the fake writes it directly): put back before the pages are checked
  await f.d.pages();
  assert.equal(fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8'), fs.readFileSync(path.join(f.dir, '.studio/film-kit.js'), 'utf8'));
  assert.match(fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8'), /B\.globe/);
  assert.equal(f.d.state.pages.p02.status, 'ok');
});

test('a component the check fails is kept out; the others are given to the pages', async () => {
  const f = film({ failFlag: true });
  await f.d.kit();
  assert.deepEqual(f.d.state.kit, { status: 'done', components: ['globe'] });
  const kit = fs.readFileSync(path.join(f.dir, 'extras/film-kit.js'), 'utf8');
  assert.match(kit, /B\.globe/);
  assert.doesNotMatch(kit, /B\.flag/);
  assert.equal(f.checked.length, 3);   // checked, fixed and checked again, up to three times
  // the flag kept failing, so the last kit is what the third check saw, less the flag
  assert.match(f.checked[2], /\/\/ changed\n\/\/ changed/);
});

test('no kit for a short film, a style with its own look, or a storyboard that lists none', async () => {
  for (const o of [{ pages: 7 }, { designed: false }, { kit: [] }]) {
    const f = film(o);
    await f.d.kit();
    assert.deepEqual(f.d.state.kit, { status: 'none', components: [] }, JSON.stringify(o));
    assert.equal(f.systems.kit, undefined);
  }
});

test('a kit that is never written leaves the pages to draw everything, as before', async () => {
  const f = film({ writesKit: false });
  await f.d.kit();
  assert.deepEqual(f.d.state.kit, { status: 'failed', components: [] });
  await f.d.pages();
  assert.doesNotMatch(f.systems['page-p01'], /This film's own components/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.dir, 'script.js'), 'utf8'), /film-kit/);
});

test('a kit that throws goes back to its session with the error, and is kept once it draws', async () => {
  const f = film();
  const asked: string[] = [];
  const runtime = (f.d as unknown as { o: { pages: { runtime: AgentRuntime } } }).o.pages.runtime;
  const open = runtime.open.bind(runtime);
  runtime.open = async (s, resume) => { const x = await open(s, resume); const send = x.send; return { ...x, send: async (m: { text: string }) => { if (s.name === 'kit') asked.push(m.text); return send(m as never); } }; };
  let round = 0;
  Object.assign(f.d, {
    checkKit: async (items: { name: string }[]) => {
      round++;
      const issues = round === 1 ? [{ page: 'kit', t: 0, t1: 0, local: 0, kind: 'runtime', level: 'error', msg: 'runtime error (build): this.nope is not a function' }] : [];
      return { page: { start: 0, end: 5.2, cues: items.map((_, i) => ({ abs: i * 2.6 })) }, times: [2.3, 4.9], check: { issues, sheet: path.join(f.dir, 'kit.jpg') } };
    },
  });
  await f.d.kit();
  assert.equal(round, 2);
  assert.match(asked[1], /throws when it runs[\s\S]*this\.nope is not a function/);
  assert.deepEqual(f.d.state.kit, { status: 'done', components: ['globe', 'flag'] });
});
