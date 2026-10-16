// The page agent's reference pack: everything it would otherwise dig out of engine/ with ls / grep / sed. Measured on
// a real run, a quarter of all tokens went to that digging; handing it over up front cuts it out.
//   - the style's components, as signatures with their doc comments (generated from the lib source)
//   - one complete page from the style's benchmark project, as a worked example of the grammar
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';

/** "P.name(args)" + its doc comment, for every `B.name = function (args)` in a component file */
export function componentDocs(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*B\.(\w+)\s*=\s*function\s*\(([^)]*)\)/g;   // a doc comment never spans past its own */
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const doc = m[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ');
    out.push(`- \`P.${m[2]}(${m[3].trim()})\` — ${doc.replace(/^\w+\([^)]*\):?\s*/, '')}`);
  }
  // the methods of what a component returns (a 3D scene's `D.city(…)`, documented inside it as /** D.city(args): … */)
  const handle = /\/\*\*\s*([A-Z]\w*\.\w+)\(((?:(?!\*\/)[^)])*)\)\s*(?:→[^:]*)?:?((?:(?!\*\/)[\s\S])*)\*\//g;
  for (let m = handle.exec(src); m; m = handle.exec(src)) {
    const doc = m[3].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ');
    out.push(`  - \`${m[1]}(${m[2].trim()})\` — ${doc}`);
  }
  return out;
}

/** a short benchmark page for the style (the most beats in the fewest lines), or undefined */
function examplePage(style: string): { id: string; code: string } | undefined {
  const dir = path.join(ENGINE_DIR, 'styles', style, 'example', 'pages');
  if (!fs.existsSync(dir)) return undefined;
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => ({ id: f.replace(/\.js$/, ''), code: fs.readFileSync(path.join(dir, f), 'utf8') }));
  return pages.filter((p) => p.code.split('\n').length <= 30).sort((a, b) => (b.code.match(/P\.c\w?\(/g)?.length ?? 0) - (a.code.match(/P\.c\w?\(/g)?.length ?? 0))[0];
}

/** `filmKit`: this film's own components (a file of the project, kit.ts), shown first: the things it draws on many pages */
export function pagePack(style: string, extras: string[], filmKit?: string): string {
  const parts: string[] = ['# This film\'s components and worked example (ready for you)', 'These components are already registered in `META.extras`: call them directly as `P.xxx(...)` in the page. **Don\'t** run use-extra for them again, and don\'t look for their source in engine/.'];
  const own = filmKit && fs.existsSync(filmKit) ? componentDocs(filmKit) : [];
  if (own.length) parts.push('## This film\'s own components (film-kit.js)', 'Written for this film, in its look, for the things it draws on many pages. **Whenever the page shows one of these things, draw it with its component**, never by hand: every page must show it the same way. Add to it (labels, highlights, arrows) where the page needs more. Don\'t edit extras/film-kit.js: the other pages use it too.', ...own);
  for (const e of extras) {
    const f = path.join(ENGINE_DIR, e.replace(/^engine\//, ''));
    if (!fs.existsSync(f)) continue;
    const docs = componentDocs(f);
    if (docs.length) parts.push(`## ${path.basename(e)}`, ...docs);
  }
  const ex = examplePage(style);
  if (ex) parts.push(`## Worked example: ${ex.id} of the benchmark film`, 'One complete page. Organise your page the way it does (objects, actions, timing to cues, camera, numbers landing on objects); don\'t copy its content.', '```js', ex.code.trim(), '```');
  return parts.join('\n');
}
