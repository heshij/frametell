// A film's own components (the film kit). A designed style (styles/<id>/fonts.json: the director designs each film's
// look) has no kit.js of its own, so every page drew the film's recurring things from nothing: in a 45-page film the
// same map flag was written 28 times, and no two pages drew the globe alike. When the storyboard lists the things that
// recur (`look.kit`), one session writes them as components (extras/film-kit.js) before the pages are drawn, they are
// checked once on a sheet of their own, and every page calls them.
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';

/** one thing the film draws on several pages, as the storyboard lists it */
export interface KitItem { name: string; what: string; pages: string[] }

/** a film shorter than this is drawn without a kit: writing one costs about a page and a half */
export const KIT_MIN_PAGES = 8;
export const KIT_MAX = 8;
/** the components, where the pages load them from (META.extras) */
export const KIT_FILE = 'extras/film-kit.js';
/** the page that calls every component once, written with them: the kit's check draws it */
export const KIT_CHECK_FILE = 'extras/kit-check.js';
/** the kit's check runs in a project of its own here, so the film's own pages and timing are never touched */
export const KIT_STAGE = '.studio/kit';
/** the kit as it was checked, put back if a page changes it */
export const KIT_KEPT = '.studio/film-kit.js';

const NAME = /^[a-z][A-Za-z0-9]{1,23}$/;

/** the engine's own `P.xxx`: a film component of the same name would replace it for every page */
let reserved: Set<string> | undefined;
export function reservedNames(): Set<string> {
  if (reserved) return reserved;
  const names = new Set<string>();
  const files = ['runtime', 'lib'].flatMap((d) => { try { return fs.readdirSync(path.join(ENGINE_DIR, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(ENGINE_DIR, d, f)); } catch { return []; } });
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bB\.(\w+)\s*=\s*function|Builder\.prototype\.(\w+)\s*=/g)) names.add(m[1] ?? m[2]);
    // the methods of the Builder class itself (core.js): `    name(args) {` at the class's indent
    if (/class Builder\b/.test(src)) for (const m of src.matchAll(/^ {4}(\w+)\s*\([^)]*\)\s*\{/gm)) names.add(m[1]);
  }
  for (const n of ['constructor', 'hud', 'page', 'host', 'svg', 'html', 'sh']) names.add(n);
  return (reserved = names);
}

/** the kit the storyboard asks for, as far as it is well formed */
export function kitPlan(look: unknown): KitItem[] {
  const list = look && typeof look === 'object' ? (look as Record<string, unknown>).kit : undefined;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: KitItem[] = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const what = typeof o.what === 'string' ? o.what.trim().slice(0, 300) : '';
    const pages = Array.isArray(o.pages) ? o.pages.filter((p): p is string => typeof p === 'string') : [];
    if (!NAME.test(name) || seen.has(name) || reservedNames().has(name) || !what) continue;
    seen.add(name);
    out.push({ name, what, pages });
    if (out.length === KIT_MAX) break;
  }
  return out;
}

/** what is wrong with `look.kit`, for the storyboard check (nothing when there is none: a kit is optional) */
export function kitIssues(look: unknown, pageIds: string[]): string[] {
  const list = look && typeof look === 'object' ? (look as Record<string, unknown>).kit : undefined;
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ['`look.kit` must be a list of { name, what, pages }'];
  const out: string[] = [];
  const ids = new Set(pageIds), seen = new Set<string>();
  if (list.length > KIT_MAX) out.push(`\`look.kit\` lists ${list.length} components: keep the ${KIT_MAX} that recur most`);
  for (const x of list) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name : '';
    if (!NAME.test(name)) { out.push(`\`look.kit\`: "${String(o.name)}" is not a component name (camelCase letters and digits, starting lower-case, 2–24 long)`); continue; }
    if (seen.has(name)) out.push(`\`look.kit\`: ${name} is listed twice`);
    seen.add(name);
    if (reservedNames().has(name)) out.push(`\`look.kit\`: ${name} is already one of the engine's P.${name}: name the component after what it draws in this film`);
    if (typeof o.what !== 'string' || !o.what.trim()) out.push(`\`look.kit\`: ${name} needs \`what\`: what it draws, in the look's words`);
    const pages = Array.isArray(o.pages) ? o.pages : [];
    const unknown = pages.filter((p) => typeof p !== 'string' || !ids.has(p));
    if (unknown.length) out.push(`\`look.kit\`: ${name} names pages the storyboard does not have: ${unknown.join(', ')}`);
    else if (pages.length < 3) out.push(`\`look.kit\`: ${name} is on ${pages.length} page${pages.length === 1 ? '' : 's'}: a component is for something drawn on 3 or more; leave it out`);
  }
  return out;
}

/** whether this film gets a kit: a designed style, enough pages, and at least two things that recur */
export const kitWanted = (designed: boolean, pages: number, plan: KitItem[]) => designed && pages >= KIT_MIN_PAGES && plan.length >= 2;

/** the components a kit file defines (`B.name = function`), in order */
export const componentNames = (src: string): string[] => [...src.matchAll(/^\s*B\.(\w+)\s*=\s*function\b/gm)].map((m) => m[1]);

/**
 * The kit with only the components in `keep`: each other `B.name = function (…) { … };` is cut out with the doc comment
 * above it (a component ends where the next one's doc comment or definition starts, or at the IIFE's close).
 */
export function keepComponents(src: string, keep: string[]): string {
  const lines = src.split('\n');
  const starts: { name: string; from: number }[] = [];
  lines.forEach((l, i) => {
    const m = /^\s*B\.(\w+)\s*=\s*function\b/.exec(l);
    if (!m) return;
    let from = i;   // back over the doc comment directly above it
    if (i > 0 && /\*\/\s*$/.test(lines[i - 1])) { from = i - 1; while (from > 0 && !/^\s*\/\*\*/.test(lines[from])) from--; }
    starts.push({ name: m[1], from });
  });
  if (!starts.length) return src;
  // the IIFE's close: the last line that is only `})();` or `}());`
  let close = lines.length;
  for (let i = lines.length - 1; i > starts[starts.length - 1].from; i--) if (/^\s*\}\s*\)\s*\(\s*\)\s*;?\s*$|^\s*\}\s*\(\s*\)\s*\)\s*;?\s*$/.test(lines[i])) { close = i; break; }
  const drop = new Set<number>();
  starts.forEach((s, k) => {
    if (keep.includes(s.name)) return;
    const to = k + 1 < starts.length ? starts[k + 1].from : close;
    for (let i = s.from; i < to; i++) drop.add(i);
  });
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

/** the cue of the kit's check page that shows component i (one cue each, held so its drawing finishes) */
const CHECK_HOLD = 2.6;

/**
 * The kit's check as a project of its own (`.studio/kit/`): the film's look, the kit, and one page `kit` with a cue
 * per component, written from the check page the kit session wrote. The engine's own check (lint, determinism, a
 * contact sheet) then runs there as on any page. Returns the stage's folder.
 */
export function kitStage(dir: string, o: { style: string; lang: string; look?: unknown; items: KitItem[]; kit: string; check: string }): string {
  const stage = path.join(dir, KIT_STAGE);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(stage, 'extras'), { recursive: true });
  fs.copyFileSync(path.join(ENGINE_DIR, 'template', 'index.html'), path.join(stage, 'index.html'));
  fs.writeFileSync(path.join(stage, 'extras', 'film-kit.js'), o.kit);
  // the check page as written, its id made `kit` whatever the session called it
  fs.writeFileSync(path.join(stage, 'pages', 'kit.js'), o.check.replace(/ENGINE\.visual\(\s*['"][^'"]*['"]/, "ENGINE.visual('kit'"));
  const META = { title: 'kit', name: 'kit', style: o.style, lang: o.lang, gap: 0.5, extras: ['extras/film-kit.js'], ...(o.look ? { look: o.look } : {}) };
  const cues = o.items.map((x) => ({ t: x.name, hold: CHECK_HOLD }));
  const PAGES = [{ id: 'kit', section: 'kit', title: '', cues }];
  fs.writeFileSync(path.join(stage, 'script.js'), `(function (root) {\n  const META = ${JSON.stringify(META)};\n  const PAGES = ${JSON.stringify(PAGES)};\n  root.SCRIPT = { META, PAGES };\n})(typeof window !== 'undefined' ? window : globalThis);\n`);
  return stage;
}

/** the moments of the check page worth looking at: each component drawn (just before the next one starts; the last
 *  before the closing fade, as the check page is a film's last page), at most six */
export function kitTimes(cues: { abs: number }[], end: number): number[] {
  const at = cues.map((c, i) => (i + 1 < cues.length ? cues[i + 1].abs - 0.3 : end - 1.2));
  while (at.length > 6) at.splice(Math.floor(at.length / 2) - 1, 1);
  return at;
}
