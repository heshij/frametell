// A project's files as this process opens them on the agent's behalf: the read, write and edit tools, the
// orchestrator's own reads and writes of the film, the pictures sent to a model, ffmpeg's frames, and (through core)
// every file a host serves from a project. The agent's shell writes the project and can plant links in it, so a name
// is never trusted: a file is opened first and what was opened is checked (its real path, that it is a plain file, that
// it has no second hard link, which carries no path to check); a file is written only into a real folder of the
// project, never through a link. One place for the rule, so no caller gets it half right.
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR, engineModulesDir } from '@frametell/engine/tools/project.mjs';

/** an opened file: `fd` (the caller closes it), the name it was asked for, its real path, and its size and time as opened */
export interface OpenFile { fd: number; name: string; path: string; size: number; mtimeMs: number; mtime: Date }

/**
 * What may be reached. `engine`: files of the installed engine and its modules may be read (the project's engine/ and
 * engine_modules/ link to them; decided by the installed engine's own folders, never by where those links point).
 * `record`: the studio's record of the run (.studio/) may be read or written; without it only .studio/revision.json
 * (the planner's plan for a change) is reachable. A write never reaches .git, engine/ or engine_modules/.
 */
export interface Reach { engine?: boolean; record?: boolean }

/** why a file was refused; `message` is for the agent */
export class Refused extends Error {
  constructor(readonly why: 'outside' | 'record' | 'read-only' | 'frozen' | 'link' | 'hard link' | 'not a file', shown: string) {
    super(why === 'frozen' ? `cannot change ${shown}: every page of this film uses it, so it is fixed now. Draw what this page needs in the page itself`
      : why === 'outside' ? `path is outside the project directory: ${shown}`
      : why === 'record' ? `${shown} is the studio's record, not part of the film`
      : why === 'read-only' ? `cannot change ${shown}: the engine directory is read-only`
      : why === 'link' ? `cannot write ${shown}: it is a link`
      : why === 'hard link' ? `cannot use ${shown}: it has another hard link`
      : `${shown} is not a file`);
  }
}

export const within = (dir: string, p: string) => { const r = path.relative(dir, p); return !r.startsWith('..') && !path.isAbsolute(r); };
// macOS and Windows file systems ignore case: .STUDIO is .studio there
const fold = (s: string) => (process.platform === 'darwin' || process.platform === 'win32' ? s.toLowerCase() : s);
const REVISION = path.join('.studio', 'revision.json');

/** files of a project the agents' own writes may not change any more (the studio's own writes, `record`, still may):
 *  a file every page uses (a film's own components), by the project's real folder */
const frozen = new Map<string, Set<string>>();
/** freeze `rel` in the project at `root`: the agents' write and edit tools refuse it from now on */
export function freeze(root: string, rel: string) {
  let real: string;
  try { real = fold(fs.realpathSync(root)); } catch { return; }
  if (!frozen.has(real)) frozen.set(real, new Set());
  frozen.get(real)!.add(fold(path.normalize(rel)));
}

/** null when the real path `real` may be reached under `realRoot`, else why not */
function place(realRoot: string, real: string, o: Reach & { write?: boolean }): Refused['why'] | null {
  if (within(realRoot, real)) {
    const rel = path.relative(realRoot, real);
    if (!rel) return 'not a file';
    const top = fold(rel.split(path.sep)[0]);
    if (top === '.studio' && fold(rel) !== fold(REVISION) && !o.record) return 'record';
    if (o.write && (top === '.git' || top === 'engine' || top === 'engine_modules')) return 'read-only';
    if (o.write && !o.record && frozen.get(fold(realRoot))?.has(fold(rel))) return 'frozen';
    return null;
  }
  if (!o.write && o.engine && engineRoots().some((d) => within(d, real))) return null;
  return 'outside';
}

/** the installed engine and its modules (pnpm links each module in from a store elsewhere, so each one's real folder counts) */
function engineRoots(): string[] {
  const out = new Set<string>();
  const add = (p: string) => { try { out.add(fs.realpathSync(p)); } catch { /* gone */ } };
  add(ENGINE_DIR);
  const mods = engineModulesDir();
  add(mods);
  try {
    for (const n of fs.readdirSync(mods)) {
      add(path.join(mods, n));
      if (n.startsWith('@')) for (const m of fs.readdirSync(path.join(mods, n))) add(path.join(mods, n, m));
    }
  } catch { /* none */ }
  return [...out];
}

/** the real path of what `fd` is. Linux names it (/proc/self/fd); elsewhere the real path of the name it was opened by,
 *  which must still be the very file opened (same device and inode), or a link moved in between and null is returned */
function openedPath(fd: number, name: string, st: fs.BigIntStats): string | null {
  if (process.platform === 'linux') {
    try {
      const p = fs.readlinkSync(`/proc/self/fd/${fd}`);
      return p.startsWith('/') && !p.endsWith(' (deleted)') ? p : null;
    } catch { /* no /proc: as elsewhere */ }
  }
  try {
    const real = fs.realpathSync(name);
    const now = fs.statSync(real, { bigint: true });
    return now.dev === st.dev && now.ino === st.ino ? real : null;
  } catch { return null; }
}

const C = fs.constants;
// non-blocking: a FIFO planted under the name would otherwise hold the open forever
const QUIET = (C.O_NONBLOCK ?? 0) | (C.O_NOCTTY ?? 0);
const NOFOLLOW = C.O_NOFOLLOW ?? 0;   // none on Windows: there the real-path check after the open is what there is

/** checks an opened `fd` against the rules; closes it and throws Refused when it fails */
function check(fd: number, name: string, realRoot: string, shown: string, o: Reach & { write?: boolean }): OpenFile {
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile()) throw new Refused('not a file', shown);
    const real = openedPath(fd, name, st);
    if (!real) throw new Refused('outside', shown);
    const why = place(realRoot, real, o);
    if (why) throw new Refused(why, shown);
    if (within(realRoot, real) && st.nlink > 1n) throw new Refused('hard link', shown);
    return { fd, name, path: real, size: Number(st.size), mtimeMs: Number(st.mtimeMs), mtime: st.mtime };
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
}

/** `p` (relative to `root`, or absolute) when it names something inside the project; else Refused */
function lexical(root: string, p: string, shown = p): string {
  const abs = path.resolve(root, p);
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Refused('outside', shown);
  return abs;
}

/**
 * Opens a file of the project for reading (`edit`: for reading and writing, nothing changed yet), then checks what was
 * opened. Throws Refused, or the open's own error (a missing file's ENOENT). The caller owns and closes `fd`.
 */
export function openIn(root: string, p: string, o: Reach & { edit?: boolean; shown?: string } = {}): OpenFile {
  const shown = o.shown ?? p;
  const abs = lexical(root, p, shown);
  const realRoot = fs.realpathSync(root);
  const fd = fs.openSync(abs, (o.edit ? C.O_RDWR : C.O_RDONLY) | QUIET);
  return check(fd, abs, realRoot, shown, { ...o, write: o.edit });
}

/** openIn, or null (nothing left open) for anything refused or missing: what a server serving files wants */
export function openProjectFile(root: string, p: string, o: Reach = {}): OpenFile | null {
  try { return openIn(root, p, o); } catch { return null; }
}

/** the whole of an opened file, read from its descriptor */
export function readFd(fd: number): Buffer {
  const parts: Buffer[] = [];
  for (let pos = 0; ;) {
    const b = Buffer.allocUnsafe(1 << 16);
    const n = fs.readSync(fd, b, 0, b.length, pos);
    if (!n) break;
    parts.push(b.subarray(0, n)); pos += n;
  }
  return Buffer.concat(parts);
}

/** replaces the whole content of an opened file through its descriptor */
function rewrite(fd: number, data: Buffer) {
  fs.ftruncateSync(fd, 0);
  for (let off = 0; off < data.length;) off += fs.writeSync(fd, data, off, data.length - off, off);
}

/** a file of the project, read through a checked descriptor. Throws as openIn does */
export function readIn(root: string, p: string, o: Reach & { shown?: string } = {}): Buffer {
  const f = openIn(root, p, o);
  try { return readFd(f.fd); } finally { fs.closeSync(f.fd); }
}

/**
 * An edit of a file of the project: `change` gets its content (read through the checked descriptor) and returns the
 * new one, written through the same descriptor; it can throw to leave the file as it was.
 */
export function editIn(root: string, p: string, change: (src: string) => string, o: Reach & { shown?: string } = {}): void {
  const f = openIn(root, p, { ...o, edit: true });
  try { rewrite(f.fd, Buffer.from(change(readFd(f.fd).toString('utf8')))); } finally { fs.closeSync(f.fd); }
}

/**
 * Writes a file of the project: a new one created, an existing one replaced in place. Never through a link. On Linux
 * (production) any link on the way is refused, even one inside the project to a folder of the project: each folder is
 * opened (never following a link) under the one opened before, and the next made and opened through it, never by its
 * path again; a new file is created exclusively in the last opened folder and taken back if the check of the opened
 * file then fails (the folder moved out of the project meanwhile). Elsewhere (local development only) a weaker
 * fallback checks names first: the nearest folder that exists must really be in the project, missing folders are made
 * one at a time and checked, then the file is opened without following a link and checked again as opened. On both,
 * an existing file that is a link or has another hard link is refused.
 * `before` sees the existing content (undefined for a new file) and can throw to leave everything as it was.
 */
export function writeIn(root: string, p: string, data: string | Uint8Array, o: Reach & { shown?: string; before?: (existing: string | undefined) => void } = {}): void {
  const shown = o.shown ?? p;
  if (process.platform === 'linux' && fs.existsSync('/proc/self/fd')) return writeAtFds(root, p, data, o, shown);
  const rules = { ...o, write: true };
  const abs = lexical(root, p, shown);
  const realRoot = fs.realpathSync(root);
  const name = path.basename(abs);
  // the nearest folder that exists, and the ones to make below it
  let base = path.dirname(abs);
  const make: string[] = [];
  for (;;) {
    try { fs.lstatSync(base); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || base === path.dirname(base)) throw e;
      make.unshift(path.basename(base)); base = path.dirname(base);
    }
  }
  let dir = fs.realpathSync(base);
  if (!fs.statSync(dir).isDirectory()) throw new Refused('not a file', shown);
  if (!within(realRoot, dir)) throw new Refused('outside', shown);
  { const why = place(realRoot, path.join(dir, ...make, name), rules); if (why) throw new Refused(why, shown); }
  for (const m of make) {
    const next = path.join(dir, m);
    try { fs.mkdirSync(next); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const st = fs.lstatSync(next);
    if (st.isSymbolicLink()) throw new Refused('link', shown);
    if (!st.isDirectory()) throw new Refused('not a file', shown);
    dir = fs.realpathSync(next);
    if (!within(realRoot, dir)) throw new Refused('outside', shown);
  }
  const target = path.join(dir, name);
  { const why = place(realRoot, target, rules); if (why) throw new Refused(why, shown); }
  let st: fs.Stats | undefined;
  try { st = fs.lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const bytes = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
  if (st) {
    if (st.isSymbolicLink()) throw new Refused('link', shown);
    if (st.isFile() && st.nlink > 1) throw new Refused('hard link', shown);
    const f = check(fs.openSync(target, C.O_RDWR | QUIET | NOFOLLOW), target, realRoot, shown, rules);
    try {
      o.before?.(readFd(f.fd).toString('utf8'));
      rewrite(f.fd, bytes);
    } finally { fs.closeSync(f.fd); }
    return;
  }
  o.before?.(undefined);
  const fd = fs.openSync(target, C.O_WRONLY | C.O_CREAT | C.O_EXCL | QUIET | NOFOLLOW, 0o666);
  const made = fs.fstatSync(fd);
  let f: OpenFile;
  try { f = check(fd, target, realRoot, shown, rules); } catch (e) {
    // created where it may not be (a folder swapped for a link in between): take back only that very file
    try { const now = fs.lstatSync(target); if (now.ino === made.ino && now.dev === made.dev) fs.unlinkSync(target); } catch { /* gone */ }
    throw e;
  }
  try { rewrite(f.fd, bytes); } finally { fs.closeSync(f.fd); }
}

/**
 * The pictures the orchestrator sends with a message (contact sheets, a page's check): files of the project the
 * agent's shell could have replaced with a link, so read through a checked descriptor. One that is not a file of the
 * project is left out (and logged), never read from wherever a link points.
 */
export function imagesIn(root: string, files: string[] = []): { file: string; data: Buffer }[] {
  return files.flatMap((file) => {
    try { return [{ file, data: readIn(root, file, { record: true }) }]; }
    catch (e) { console.warn(`[project] picture left out: ${file}: ${(e as Error).message}`); return []; }
  });
}

const DIR = C.O_RDONLY | (C.O_DIRECTORY ?? 0) | NOFOLLOW;

/** Linux: the folders `parts` under the real root, each opened (never a link) under the one before through
 *  /proc/self/fd/<fd>/<name>, made first when `make`; returns the last one's fd (the caller closes it) */
function openDirs(realRoot: string, parts: string[], shown: string, make: boolean): number {
  let fd = fs.openSync(realRoot, DIR);
  try {
    for (const part of parts) {
      const at = `/proc/self/fd/${fd}/${part}`;
      if (make) { try { fs.mkdirSync(at); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
      let next: number;
      try { next = fs.openSync(at, DIR); } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ELOOP') throw new Refused('link', shown);
        if (code === 'ENOTDIR') throw new Refused('not a file', shown);
        throw e;
      }
      fs.closeSync(fd);
      fd = next;
    }
    if (!within(realRoot, fs.readlinkSync(`/proc/self/fd/${fd}`))) throw new Refused('outside', shown);
    return fd;
  } catch (e) { fs.closeSync(fd); throw e; }
}

/** writeIn on Linux: judged by name first (nothing is made for a write the rules refuse), then every folder on the way
 *  is opened and the next made and opened under it, never by its path again: a folder swapped for a link meanwhile is
 *  never walked through, and nothing lands outside, not even an empty folder */
function writeAtFds(root: string, p: string, data: string | Uint8Array, o: Reach & { before?: (existing: string | undefined) => void }, shown: string): void {
  const rules = { ...o, write: true };
  const abs = lexical(root, p, shown);
  const realRoot = fs.realpathSync(root);
  const parts = path.relative(root, abs).split(path.sep);
  const name = parts.pop()!;
  { const why = place(realRoot, path.join(realRoot, ...parts, name), rules); if (why) throw new Refused(why, shown); }
  const fd = openDirs(realRoot, parts, shown, true);
  try {
    const dir = fs.readlinkSync(`/proc/self/fd/${fd}`);
    { const why = place(realRoot, path.join(dir, name), rules); if (why) throw new Refused(why, shown); }
    const target = `/proc/self/fd/${fd}/${name}`;
    const bytes = Buffer.from(typeof data === 'string' ? Buffer.from(data) : data);
    let st: fs.Stats | undefined;
    try { st = fs.lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (st) {
      if (st.isSymbolicLink()) throw new Refused('link', shown);
      if (st.isFile() && st.nlink > 1) throw new Refused('hard link', shown);
      const f = check(fs.openSync(target, C.O_RDWR | QUIET | NOFOLLOW), path.join(dir, name), realRoot, shown, rules);
      try { o.before?.(readFd(f.fd).toString('utf8')); rewrite(f.fd, bytes); } finally { fs.closeSync(f.fd); }
      return;
    }
    o.before?.(undefined);
    const created = fs.openSync(target, C.O_WRONLY | C.O_CREAT | C.O_EXCL | QUIET | NOFOLLOW, 0o666);
    const made = fs.fstatSync(created);
    let f: OpenFile;
    try { f = check(created, path.join(dir, name), realRoot, shown, rules); } catch (e) {
      // the folder moved out of the project in between: take back only that very file, through the folder as opened
      try { const now = fs.lstatSync(target); if (now.ino === made.ino && now.dev === made.dev) fs.unlinkSync(target); } catch { /* gone */ }
      throw e;
    }
    try { rewrite(f.fd, bytes); } finally { fs.closeSync(f.fd); }
  } finally { fs.closeSync(fd); }
}

/**
 * The names in a folder of the project (sorted), read through the folder as opened: [] for one that is missing, a
 * link, outside the project, or the studio's record. On Linux each level is opened as writeIn walks; elsewhere (local
 * development) each level must be a real folder and the last one really inside the project.
 */
export function listIn(root: string, p: string): string[] {
  try {
    const abs = lexical(root, p);
    const realRoot = fs.realpathSync(root);
    const parts = path.relative(root, abs).split(path.sep).filter(Boolean);
    if (parts.length && place(realRoot, path.join(realRoot, ...parts), {})) return [];
    if (process.platform === 'linux' && fs.existsSync('/proc/self/fd')) {
      const fd = openDirs(realRoot, parts, p, false);
      try { return fs.readdirSync(`/proc/self/fd/${fd}`).sort(); } finally { fs.closeSync(fd); }
    }
    let dir = realRoot;
    for (const part of parts) { dir = path.join(dir, part); if (!fs.lstatSync(dir).isDirectory()) return []; }
    return within(realRoot, fs.realpathSync(dir)) ? fs.readdirSync(dir).sort() : [];
  } catch { return []; }
}
