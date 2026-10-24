// The user's own pictures for a film (素材): a logo, a product shot, a chart they made. They are given to be seen in the
// film, so the director plans where each goes and the page agent places the very file. They live in the project's
// assets/user/, listed in its assets.json (written by core); the prompts read that list when they are built, so a
// picture added while the film is made reaches the change director and the pages drawn after it.
import { readIn } from './projectfs.js';

/** where a film keeps the user's pictures */
export const USER_ASSETS_DIR = 'assets/user';
/** their list, with what each is */
export const USER_ASSETS_MANIFEST = `${USER_ASSETS_DIR}/assets.json`;

export type UserAssetType = 'png' | 'jpg' | 'webp' | 'gif' | 'svg';
export interface UserAsset {
  /** '<slug>-<sha256 first 10 hex>.<ext>', unique in the film: a changed picture is a new file, so the render's segment
   *  cache never draws a stale one */
  file: string;
  /** shown to the person and the director (≤ 60 chars) */
  name: string;
  /** ≤ 200 chars, '' when none */
  note: string;
  /** from the first bytes, never the name */
  type: UserAssetType;
  /** from the header (SVG: viewBox / width-height) */
  w: number; h: number;
  alpha: boolean;
  bytes: number;
  /** 'thumbs/<stem>.webp' relative to assets/user, when the client sent one */
  thumb?: string;
  /** a host's library id (Cloud 素材库), when it came from there */
  from?: string;
  /** ISO time */
  addedAt: string;
}

const TYPES: UserAssetType[] = ['png', 'jpg', 'webp', 'gif', 'svg'];
/** the file names core gives: a plain slug, the content's hash, the type */
export const USER_ASSET_FILE = /^[a-z0-9][a-z0-9-]{0,47}-[0-9a-f]{10}\.(png|jpg|webp|gif|svg)$/;
const THUMB = /^thumbs\/[a-z0-9][a-z0-9-]{0,47}-[0-9a-f]{10}\.(webp|png|jpg)$/;
export const USER_ASSETS_MAX = 60;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const px = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(100000, Math.round(v)) : 0);
/** a size in bytes: core takes nothing over 10 MB, so a larger number is not one it wrote */
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 64 << 20 ? Math.round(v) : 0);

/** the list as a film keeps it: only entries with a file name core gives, each once; [] for anything else */
export function cleanUserAssets(x: unknown): UserAsset[] {
  const list = x && typeof x === 'object' && Array.isArray((x as { assets?: unknown }).assets) ? (x as { assets: unknown[] }).assets : [];
  const seen = new Set<string>();
  return list.flatMap((a): UserAsset[] => {
    if (!a || typeof a !== 'object') return [];
    const r = a as Record<string, unknown>;
    if (typeof r.file !== 'string' || !USER_ASSET_FILE.test(r.file) || seen.has(r.file)) return [];
    const type = TYPES.find((t) => t === r.type);
    if (!type) return [];
    seen.add(r.file);
    const out: UserAsset = {
      file: r.file, name: text(r.name, 60) || r.file, note: text(r.note, 200), type, w: px(r.w), h: px(r.h), alpha: r.alpha === true,
      bytes: count(r.bytes), addedAt: typeof r.addedAt === 'string' ? r.addedAt : '',
    };
    if (typeof r.thumb === 'string' && THUMB.test(r.thumb)) out.thumb = r.thumb;
    const from = text(r.from, 80);
    if (from) out.from = from;
    return [out];
  }).slice(0, USER_ASSETS_MAX);
}

/** the film's pictures, read now from its list (through the checked reader: the agents' shell writes the project);
 *  [] when there is none or it doesn't read */
export function userAssets(dir: string): UserAsset[] {
  try { return cleanUserAssets(JSON.parse(readIn(dir, USER_ASSETS_MANIFEST).toString('utf8'))); } catch { return []; }
}

export const assetPath = (a: UserAsset) => `${USER_ASSETS_DIR}/${a.file}`;
/** it stands on the page as it is (an SVG, a cut-out): contained, never cropped */
const standsAlone = (a: UserAsset) => a.type === 'svg' || a.alpha;
const size = (a: UserAsset) => (a.w && a.h ? `${a.w}×${a.h}` : 'size unknown');
const line = (a: UserAsset) => `- \`${assetPath(a)}\`: ${a.type.toUpperCase()}, ${size(a)}, ${a.alpha ? 'transparent background' : 'opaque background'}, “${a.name}”${a.note ? `: ${a.note}` : ''}`;

const GIF_RULE = 'A GIF may show as a still in the exported film: never make a beat depend on its motion.';

/** The user's pictures, for the director (storyboard, script, changes): what each is, and that they are there to be
 *  seen. '' without any, so the prompt stays as it was. */
export function assetsSection(assets: UserAsset[] = []) {
  if (!assets.length) return '';
  return `---
# The user's assets

The user added these pictures to the film, to be seen in it (open one with read to see it):
${assets.map(line).join('\n')}

- Use each one where the content calls for it: the product's photo where the film shows the product, their chart where it makes the point. A beat that places one names its path in its object (\`${USER_ASSETS_DIR}/…\`), so the page agent places that very file; in a change, the note for the page names it the same way.
- The user gave them to be seen: a picture left out of the film needs a reason, and you say it when you report the storyboard (or the change).
- Each is shown as it is: never stretched, recoloured or redrawn, and given room to be read (a screenshot or a chart large enough for its words).${assets.some((a) => a.type === 'gif') ? `\n- ${GIF_RULE}` : ''}`;
}

/** the user's pictures a page places: those its storyboard names, or the change asked of it (`change`) */
export function assetsOn(assets: UserAsset[], pages: { id: string; section?: string; say?: string; beats?: { object?: string; action?: string; text?: string }[] }[], id: string, change?: string): UserAsset[] {
  if (!assets.length) return [];
  const p = pages.find((x) => x.id === id);
  const words = [p?.section, p?.say, ...(p?.beats ?? []).flatMap((b) => [b.object, b.action, b.text]), change].filter(Boolean).join('\n');
  return assets.filter((a) => words.includes(a.file));
}

/** the call that places it at its own proportions: contained and unframed when it stands alone, else a framed photo */
export const assetCall = (a: UserAsset) => {
  const h = a.w && a.h ? `w * ${a.h} / ${a.w}` : 'h';
  return standsAlone(a)
    ? `P.img('${assetPath(a)}', x, y, w, ${h}, { fit: 'contain', border: false, shadow: false, r: 0, at })`
    : `P.img('${assetPath(a)}', x, y, w, ${h}, { fit: 'cover', at })`;
};

/** For the page agent: the user's pictures this page places, each with the call that places it. '' when none. */
export function assetPageNote(files: UserAsset[]) {
  if (!files.length) return '';
  return `

## The user's pictures on this page
${files.map((a) => `${line(a)}\n  \`${assetCall(a)}\``).join('\n')}
- The user gave these to be seen: place each where and when the storyboard says, large enough to read, never covered by anything.
- Keep its proportions (height = width × its h / w, as in the call): never stretch, squash, crop away its content, recolour, filter or redraw it.
- A transparent picture or an SVG stands on the page as it is (\`fit: 'contain'\`, no frame); a photo or a screenshot may be framed.${files.some((a) => a.type === 'gif') ? `\n- ${GIF_RULE}` : ''}`;
}

/** For the page's reviewer: the user's pictures the storyboard puts on this page. '' when none. */
export function assetReviewNote(files: UserAsset[]) {
  if (!files.length) return '';
  return `\nThe storyboard puts the user's own picture${files.length > 1 ? 's' : ''} on this page (${files.map((a) => `“${a.name}”`).join(', ')}). Fail the page if one is missing, stretched or squashed, cropped so its content is lost, covered, or too small to make out.\n`;
}
