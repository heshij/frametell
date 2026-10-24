// The user's own pictures for a film (素材): kept in the project's assets/user/, listed in its assets.json, with a small
// copy in thumbs/ when the client made one. What a file is comes from its first bytes, never its name; its size from
// its header (nothing is decoded); an SVG is cleaned before it is kept. The director reads the list (agent/assets.ts).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { USER_ASSETS_DIR, USER_ASSETS_MANIFEST, USER_ASSETS_MAX, USER_ASSET_FILE, cleanUserAssets, userAssets, writeIn, type UserAsset, type UserAssetType } from '@frametell/agent';
import { sanitizeSvg } from './svg.js';
import { tr } from './i18n.js';

export interface NewUserAsset { name: string; data: Uint8Array; note?: string; thumb?: Uint8Array; from?: string }

export const ASSET_BYTES = 10 << 20;
export const ASSET_THUMB_BYTES = 512 << 10;

// ── what a file is ──

export interface Sniffed { type: UserAssetType; w: number; h: number; alpha: boolean; /** what to keep: the file, or for an SVG the cleaned one */ data: Uint8Array }

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
const starts = (b: Uint8Array, bytes: number[]) => bytes.every((x, i) => b[i] === x);

/** a PNG's size, and transparency: a colour type with alpha, or a tRNS chunk before the image data */
function png(b: Uint8Array) {
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR') return undefined;
  const w = u32(b, 16), h = u32(b, 20), colour = b[25];
  let alpha = colour === 4 || colour === 6;
  for (let i = 33; !alpha && i + 8 <= b.length;) {
    const len = u32(b, i), kind = ascii(b, i + 4, 4);
    if (kind === 'IDAT' || kind === 'IEND') break;
    if (kind === 'tRNS') alpha = true;
    i += 12 + len;
  }
  return { w, h, alpha };
}

/** a JPEG's size, from its start-of-frame segment */
function jpg(b: Uint8Array) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    // SOF0–SOF15 but DHT (C4), JPG (C8) and DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(b, i + 7), h: u16(b, i + 5), alpha: false };
    if (m === 0xda || m === 0xd9) return undefined;
    i += 2 + u16(b, i + 2);
  }
  return undefined;
}

/** a WebP's size and alpha, from its first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X) */
function webp(b: Uint8Array) {
  if (b.length < 30) return undefined;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff, alpha: false };
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, alpha: !!((bits >>> 28) & 1) };
  }
  if (chunk === 'VP8X') return { w: le24(b, 24) + 1, h: le24(b, 27) + 1, alpha: !!(b[20] & 0x10) };
  return undefined;
}

/** a GIF's size (its logical screen), and transparency: a graphic control extension before the first frame that marks
 *  a colour transparent */
function gif(b: Uint8Array) {
  if (b.length < 13) return undefined;
  const w = le16(b, 6), h = le16(b, 8);
  let i = 13 + (b[10] & 0x80 ? 3 << ((b[10] & 7) + 1) : 0), alpha = false;
  while (i + 1 < b.length && b[i] === 0x21) {
    if (b[i + 1] === 0xf9 && i + 3 < b.length && b[i + 3] & 1) { alpha = true; break; }
    // the extension's data sub-blocks, each led by its length, to the zero that ends them
    i += 2;
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i++;
  }
  return { w, h, alpha };
}

const isWebp = (b: Uint8Array) => b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP';

/** what the file is, by its first bytes, with its size; 'svg' when it is an SVG that doesn't parse cleanly; undefined
 *  when it is none of the five */
export function sniff(data: Uint8Array): Sniffed | 'svg' | undefined {
  const b = data;
  const pick = (type: UserAssetType, x: { w: number; h: number; alpha: boolean } | undefined) => (x && x.w > 0 && x.h > 0 ? { type, ...x, data } : undefined);
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return pick('png', png(b));
  if (starts(b, [0xff, 0xd8, 0xff])) return pick('jpg', jpg(b));
  if (isWebp(b)) return pick('webp', webp(b));
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return pick('gif', gif(b));
  // text that opens with a tag (after a byte-order mark and white space) is read as an SVG
  let i = starts(b, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i++;
  if (b[i] !== 0x3c) return undefined;
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return 'svg'; }
  const clean = sanitizeSvg(text);
  return clean ? { type: 'svg', w: clean.w, h: clean.h, alpha: true, data: new TextEncoder().encode(clean.svg) } : 'svg';
}

// ── a film's pictures ──

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** the name's plain letters and digits, for a file name; 'asset' when it has none (a name in Chinese) */
const slug = (name: string) => name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'asset';
/** the content's hash in a file name core gave: the 10 characters before its extension */
const hashOf = (file: string) => file.slice(file.lastIndexOf('.') - 10, file.lastIndexOf('.'));
const contentHash = (data: Uint8Array) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);

/** a picture checked and ready to keep: refused (thrown, in the person's words) when it is too big, not one of the
 *  five types, or an SVG that doesn't parse cleanly. A small copy that isn't a PNG, JPEG or WebP under 512 KB is left
 *  out (the grid then shows the picture itself) */
export function prepareAsset(a: NewUserAsset) {
  const shown = line(a.name, 80) || 'file';
  if (a.data.byteLength > ASSET_BYTES) throw new Error(tr(`「${shown}」超过 10MB，换个小一点的图`, `“${shown}” is over 10 MB. Try a smaller picture.`));
  const s = sniff(a.data);
  if (s === 'svg') throw new Error(tr(`「${shown}」这个 SVG 读不干净，导出成 PNG 再试`, `“${shown}” is an SVG that can't be read cleanly. Export it as a PNG and try again.`));
  if (!s) throw new Error(tr(`「${shown}」不是 PNG、JPEG、WebP、GIF 或 SVG 图片`, `“${shown}” isn't a PNG, JPEG, WebP, GIF or SVG picture.`));
  let thumb: { data: Uint8Array; type: UserAssetType } | undefined;
  if (a.thumb && a.thumb.byteLength <= ASSET_THUMB_BYTES) {
    const t = sniff(a.thumb);
    if (t && t !== 'svg' && (t.type === 'png' || t.type === 'jpg' || t.type === 'webp')) thumb = { data: a.thumb, type: t.type };
  }
  const name = line(a.name.includes('.') ? a.name.slice(0, a.name.lastIndexOf('.')) : a.name, 60) || shown.slice(0, 60);
  return { ...s, hash: contentHash(s.data), name, note: line(a.note, 200), thumb, from: line(a.from, 80) || undefined };
}
type Prepared = ReturnType<typeof prepareAsset>;

/** the film's pictures, as its list says now */
export function listAssets(dir: string): UserAsset[] { return userAssets(dir); }

function save(dir: string, assets: UserAsset[]) {
  writeIn(dir, USER_ASSETS_MANIFEST, JSON.stringify({ assets }, null, 2) + '\n');
}

/** Keep a picture in the film. The same content already there: that one, with the new name and note (and a small
 *  copy, if it had none). Refused past USER_ASSETS_MAX pictures */
export function addAsset(dir: string, a: NewUserAsset | Prepared): UserAsset {
  const p = 'hash' in a ? a : prepareAsset(a);
  const assets = listAssets(dir);
  const same = assets.find((x) => hashOf(x.file) === p.hash && x.type === p.type);
  if (same) {
    if (p.name) same.name = p.name;
    if (p.note) same.note = p.note;
    if (p.thumb && !same.thumb) same.thumb = keepThumb(dir, same.file, p.thumb);
    if (p.from && !same.from) same.from = p.from;
    save(dir, assets);
    return same;
  }
  if (assets.length >= USER_ASSETS_MAX) throw new Error(tr(`一个视频最多 ${USER_ASSETS_MAX} 个素材，先删掉几个`, `A film holds at most ${USER_ASSETS_MAX} pictures. Remove some first.`));
  const file = `${slug(p.name)}-${p.hash}.${p.type}`;
  writeIn(dir, `${USER_ASSETS_DIR}/${file}`, p.data);
  const asset: UserAsset = { file, name: p.name || file, note: p.note, type: p.type, w: p.w, h: p.h, alpha: p.alpha, bytes: p.data.byteLength, addedAt: new Date().toISOString() };
  if (p.thumb) asset.thumb = keepThumb(dir, file, p.thumb);
  if (p.from) asset.from = p.from;
  // cleaned on the way in too, so what is returned is what the list will read back
  const next = cleanUserAssets({ assets: [...assets, asset] });
  save(dir, next);
  return next.find((x) => x.file === file)!;
}

function keepThumb(dir: string, file: string, t: { data: Uint8Array; type: UserAssetType }) {
  const rel = `thumbs/${file.slice(0, file.lastIndexOf('.'))}.${t.type}`;
  writeIn(dir, `${USER_ASSETS_DIR}/${rel}`, t.data);
  return rel;
}

const notFound = (file: string) => new Error(tr(`素材「${file}」不存在`, `Picture “${file}” not found`));

/** a picture's name or note changed; its file stays */
export function updateAsset(dir: string, file: string, patch: { name?: string; note?: string }): UserAsset {
  const assets = listAssets(dir);
  const a = assets.find((x) => x.file === file);
  if (!a) throw notFound(file);
  if (patch.name !== undefined) a.name = line(patch.name, 60) || a.name;
  if (patch.note !== undefined) a.note = line(patch.note, 200);
  save(dir, assets);
  return a;
}

/** a picture taken out of the film: its file, its small copy and its entry */
export function removeAsset(dir: string, file: string): void {
  const assets = listAssets(dir);
  const a = assets.find((x) => x.file === file);
  if (!a || !USER_ASSET_FILE.test(file)) throw notFound(file);
  save(dir, assets.filter((x) => x !== a));
  unlinkIn(dir, `${USER_ASSETS_DIR}/${a.file}`);
  if (a.thumb) unlinkIn(dir, `${USER_ASSETS_DIR}/${a.thumb}`);
}

/** a file of the project removed, only when its folder really is in the project (the agents' shell can swap a folder
 *  for a link, and unlinking through it would remove a file elsewhere); a link itself is only a name, removed as one */
function unlinkIn(dir: string, rel: string) {
  const abs = path.join(dir, rel);
  try {
    const root = fs.realpathSync(dir), folder = fs.realpathSync(path.dirname(abs));
    const r = path.relative(root, folder);
    if (r.startsWith('..') || path.isAbsolute(r)) return;
    const target = path.join(folder, path.basename(abs));
    if (fs.lstatSync(target).isDirectory()) return;
    fs.unlinkSync(target);
  } catch { /* already gone */ }
}
