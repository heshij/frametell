// The research session's tools: search the web, read a page, look through the folders it was given (a cloned
// repository, a folder on the user's machine, the uploaded material), and hand in the brief. Everything is read-only.
// Limits are kept here, not left to the model: once one is spent the tool says so, and after the time is up every
// tool but finish answers "call finish now", so a long session always ends with a brief.
import fs from 'node:fs';
import path from 'node:path';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Web } from './web.js';

export interface Limits {
  /** web searches */
  searches: number;
  /** web pages read (a page read again in parts counts once) */
  pages: number;
  /** wall-clock minutes before the session is told to finish */
  minutes: number;
}

/** a folder (or one file) the session may read, under a short name it uses in paths: "<name>/src/index.ts" */
export interface Mount { name: string; root: string; /** what it is, for the model: "the repository github.com/a/b" */ about: string }

export interface Finding { title: string; ref: string; note?: string }
export interface Handed { brief: string; sources: Finding[] }

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'target', 'vendor', '__pycache__', '.venv', 'venv', 'coverage', '.turbo', '.cache', '.idea', '.vscode', '.studio', 'engine_modules']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|exe|dll|so|dylib|bin|woff2?|ttf|otf|eot|mp3|mp4|mov|wav|ogg|webm|avi|psd|sketch|fig|sqlite|db|lock)$/i;
const PAGE_CHUNK = 20_000;
const FILE_CHUNK = 30_000;
/** a longer line is read in rows of this many characters */
const WRAP = 500;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: undefined });

export function researchTools(o: { mounts: Mount[]; web: Web; limits: Limits; signal?: AbortSignal; onFinish: (h: Handed) => void }) {
  const started = Date.now();
  const used = { searches: 0, pages: new Set<string>() };
  /** set once the session must stop gathering: time is up, or the orchestrator asked for the brief */
  let closing = false;
  const pages = new Map<string, { title?: string; text: string }>();

  const gate = () => {
    if (closing || Date.now() - started > o.limits.minutes * 60_000) {
      closing = true;
      throw new Error('Time is up for research. Call finish now with the brief, from what you have found.');
    }
  };

  const resolve = (p: string): { abs: string; mount: Mount } => {
    const clean = p.replace(/\\/g, '/').replace(/^\.?\/+/, '');
    const [head, ...rest] = clean.split('/');
    const mount = o.mounts.find((m) => m.name === head);
    if (!mount) throw new Error(`unknown folder "${head}": paths start with one of ${o.mounts.map((m) => m.name).join(', ')}`);
    const abs = path.resolve(mount.root, rest.join('/'));
    const rel = path.relative(mount.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${p} is outside ${mount.name}`);
    // a link inside the folder (a cloned repository's, one planted in the material) is never followed out of it
    if (!inside(mount, abs)) throw new Error(`${p} is outside ${mount.name}`);
    return { abs, mount };
  };
  /** where abs really is, links resolved, lies inside the mount's real root (a path that does not exist is not inside) */
  const inside = (mount: Mount, abs: string) => {
    let root: string, real: string;
    try { root = fs.realpathSync(mount.root); real = fs.realpathSync(abs); } catch { return false; }
    const r = path.relative(root, real);
    return !r.startsWith('..') && !path.isAbsolute(r);
  };
  const shown = (mount: Mount, abs: string) => [mount.name, path.relative(mount.root, abs)].filter(Boolean).join('/').replace(/\\/g, '/');
  const binary = (abs: string) => {
    if (BINARY.test(abs)) return true;
    const fd = fs.openSync(abs, 'r');
    try { const b = Buffer.alloc(4096); const n = fs.readSync(fd, b, 0, 4096, 0); return b.subarray(0, n).includes(0); } finally { fs.closeSync(fd); }
  };
  function* walk(dir: string, depth = Infinity): Generator<{ abs: string; dir: boolean; level: number }> {
    const go = function* (d: string, level: number): Generator<{ abs: string; dir: boolean; level: number }> {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
      for (const e of entries) {
        if (SKIP.has(e.name) || (e.name.startsWith('.') && e.name !== '.github') || e.isSymbolicLink()) continue;
        const abs = path.join(d, e.name);
        yield { abs, dir: e.isDirectory(), level };
        if (e.isDirectory() && level + 1 < depth) yield* go(abs, level + 1);
      }
    };
    yield* go(dir, 0);
  }

  const ListP = Type.Object({ path: Type.Optional(Type.String({ description: 'a folder, e.g. "repo" or "repo/src"; empty lists the folders you were given' })), depth: Type.Optional(Type.Number({ description: 'how many levels down, default 2' })) });
  const list: AgentTool<typeof ListP> = {
    name: 'list_files', label: 'List files',
    description: 'List a folder you were given (dependencies, build output and hidden folders are left out). Start here to see how a project is laid out.',
    parameters: ListP,
    execute: async (_id, p) => {
      gate();
      if (!p.path?.trim()) return text(o.mounts.map((m) => `${m.name}/  — ${m.about}`).join('\n'));
      const { abs, mount } = resolve(p.path);
      if (!fs.statSync(abs).isDirectory()) return text(`${shown(mount, abs)} is a file (${fs.statSync(abs).size} bytes)`);
      const lines: string[] = [];
      for (const e of walk(abs, Math.min(Math.max(p.depth ?? 2, 1), 6))) {
        if (lines.length >= 400) { lines.push('… (more; list a subfolder)'); break; }
        lines.push(`${'  '.repeat(e.level)}${path.basename(e.abs)}${e.dir ? '/' : ` (${fs.statSync(e.abs).size} B)`}`);
      }
      return text(lines.join('\n') || '(empty)');
    },
  };

  const ReadP = Type.Object({
    path: Type.String(), offset: Type.Optional(Type.Number({ description: 'first line, from 1' })), limit: Type.Optional(Type.Number({ description: 'how many lines, default 400' })),
    part: Type.Optional(Type.Number({ description: `for a line longer than ${WRAP} characters: which ${WRAP}-character part of the offset line to start from, as the reply says` })),
  });
  const read: AgentTool<typeof ReadP> = {
    name: 'read_file', label: 'Read file',
    description: `Read a text file in a folder you were given, with line numbers. A line longer than ${WRAP} characters goes on in rows marked with its number and +. Long files come in parts: read on with the offset (and part) the reply gives.`,
    parameters: ReadP,
    execute: async (_id, p) => {
      gate();
      const { abs, mount } = resolve(p.path);
      if (fs.statSync(abs).isDirectory()) throw new Error(`${p.path} is a folder: use list_files`);
      if (binary(abs)) return text(`${shown(mount, abs)} is not a text file (${fs.statSync(abs).size} bytes)`);
      const lines = fs.readFileSync(abs, 'utf8').split('\n');
      const from = Math.max(0, Math.floor(p.offset ?? 1) - 1), to = Math.min(lines.length, from + Math.min(Math.max(p.limit ?? 400, 1), 2000));
      // nothing is ever dropped: a long line (a paragraph of a parsed PDF is one line) goes on in rows of WRAP
      // characters, and a reply full before its lines are done says exactly where to read on, mid-line if need be
      const rows: string[] = [];
      let size = 0, next: { line: number; part: number } | undefined;
      rows: for (let n = from; n < to; n++) {
        const l = lines[n], parts = Math.max(1, Math.ceil(l.length / WRAP));
        for (let k = n === from ? Math.min(Math.max(1, Math.floor(p.part ?? 1)), parts) : 1; k <= parts; k++) {
          const row = `${String(n + 1).padStart(5)}${k > 1 ? '+' : ' '} ${l.slice((k - 1) * WRAP, k * WRAP)}`;
          if (rows.length && size + row.length + 1 > FILE_CHUNK) { next = { line: n + 1, part: k }; break rows; }
          rows.push(row); size += row.length + 1;
        }
      }
      const more = next ? `\n… (${lines.length} lines in all; read on with offset ${next.line}${next.part > 1 ? ` and part ${next.part}` : ''})`
        : to < lines.length ? `\n… (${lines.length} lines in all; read on with offset ${to + 1})` : '';
      return text(rows.join('\n') + more);
    },
  };

  const GrepP = Type.Object({ pattern: Type.String({ description: 'a regular expression, matched case-insensitively' }), path: Type.Optional(Type.String({ description: 'a folder or file to search; default all' })), glob: Type.Optional(Type.String({ description: 'only files whose name ends like this, e.g. ".ts" or "README.md"' })) });
  const grep: AgentTool<typeof GrepP> = {
    name: 'search_files', label: 'Search files',
    description: 'Find the lines matching a pattern across a folder you were given: where something is defined, used or explained.',
    parameters: GrepP,
    execute: async (_id, p) => {
      gate();
      let re: RegExp;
      try { re = new RegExp(p.pattern, 'i'); } catch (e) { throw new Error(`not a valid pattern: ${(e as Error).message}`); }
      const roots = p.path?.trim() ? [resolve(p.path)] : o.mounts.map((m) => ({ abs: m.root, mount: m }));
      const hits: string[] = [];
      let files = 0;
      for (const { abs: root, mount } of roots) {
        const all = fs.statSync(root).isDirectory() ? [...walk(root)].filter((e) => !e.dir).map((e) => e.abs) : [root];
        for (const f of all) {
          if (hits.length >= 200 || files >= 20_000) break;
          if (p.glob && !f.endsWith(p.glob.replace(/^\*/, ''))) continue;
          files++;
          try { if (fs.statSync(f).size > 2_000_000 || binary(f)) continue; } catch { continue; }
          const lines = fs.readFileSync(f, 'utf8').split('\n');
          for (let i = 0; i < lines.length && hits.length < 200; i++) if (re.test(lines[i])) hits.push(`${shown(mount, f)}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
        }
      }
      return text(hits.length ? hits.join('\n') + (hits.length >= 200 ? '\n… (more; narrow the pattern or the folder)' : '') : `nothing matches /${p.pattern}/i`);
    },
  };

  const SearchP = Type.Object({ query: Type.String(), max_results: Type.Optional(Type.Number({ description: 'default 8, at most 20' })) });
  const search: AgentTool<typeof SearchP> = {
    name: 'web_search', label: 'Search the web',
    description: 'Search the web. Returns titles, addresses and short excerpts; read a promising page with read_url to get its full text.',
    parameters: SearchP,
    execute: async (_id, p, signal) => {
      gate();
      if (used.searches >= o.limits.searches) throw new Error(`The ${o.limits.searches} searches are used up: read the pages you found, or finish.`);
      used.searches++;
      const hits = await o.web.search(p.query, p.max_results ?? 8, signal);
      return text(hits.length ? hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n') : 'no results');
    },
  };

  const UrlP = Type.Object({ url: Type.String(), offset: Type.Optional(Type.Number({ description: 'character offset to read on from, for a long page' })) });
  const readUrl: AgentTool<typeof UrlP> = {
    name: 'read_url', label: 'Read a page',
    description: 'Read a web page as text (Markdown). A long page comes in parts: call again with the offset it gives to read on.',
    parameters: UrlP,
    execute: async (_id, p, signal) => {
      gate();
      let page = pages.get(p.url);
      if (!page) {
        if (used.pages.size >= o.limits.pages) throw new Error(`The ${o.limits.pages} pages are used up: work from what you have, or finish.`);
        used.pages.add(p.url);
        page = await o.web.read(p.url, signal);
        pages.set(p.url, page);
      }
      const from = Math.max(0, p.offset ?? 0), part = page.text.slice(from, from + PAGE_CHUNK);
      const more = from + PAGE_CHUNK < page.text.length ? `\n\n… (${page.text.length} characters in all; read on with offset ${from + PAGE_CHUNK})` : '';
      return text(`${page.title ? `# ${page.title}\n` : ''}${p.url}\n\n${part}${more}`);
    },
  };

  const FinishP = Type.Object({
    brief: Type.String({ description: 'the research brief, in Markdown, laid out as the instructions say' }),
    sources: Type.Array(Type.Object({ title: Type.String(), ref: Type.String({ description: 'the address, or the file path as you read it' }), note: Type.Optional(Type.String({ description: 'what it was used for' })) }), { description: 'the sources the brief relies on' }),
  });
  const finish: AgentTool<typeof FinishP> = {
    name: 'finish', label: 'Hand in the brief',
    description: 'Hand in the research brief and the sources it relies on. This ends the research.',
    parameters: FinishP,
    execute: async (_id, p) => {
      if (p.brief.trim().length < 200) throw new Error('The brief is too short: write it out as the instructions describe.');
      o.onFinish({ brief: p.brief.trim(), sources: p.sources ?? [] });
      return { ...text('Brief received.'), terminate: true };
    },
  };

  const tools: AgentTool<any>[] = [];
  if (o.mounts.length) tools.push(list, read, grep);
  if (o.web.provider) tools.push(search);
  if (o.web.reads !== false) tools.push(readUrl);
  tools.push(finish);
  return { tools, close: () => { closing = true; }, used };
}
