// The film's assets (素材): pictures given to be *seen* in the film, kept apart from the documents the director reads.
// Here: what counts as one, and the small copy the browser makes for the grids (a 480 px wide WebP; none for an SVG,
// which is shown as itself), so a grid never decodes the full files.
import type { UserAsset } from './client';

/** @frametell/core's USER_ASSETS_DIR; a value, so not imported from the core's (Node) entry into the browser bundle */
export const USER_ASSETS_DIR = 'assets/user';
export const ASSET_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg';
export const ASSET_MAX_BYTES = 10 << 20;
export const ASSET_MAX_COUNT = 60;
const ASSET_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const ASSET_MIME = /^image\/(png|jpeg|webp|gif|svg\+xml)$/i;

/** a file that can be an asset, by its type (or its name when the browser gives no type) */
export const isAssetFile = (f: File) => (f.type ? ASSET_MIME.test(f.type) : ASSET_EXT.test(f.name));
export const isSvgFile = (f: File) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);

/** why a file can't be an asset ('type' or 'size'), or undefined when it can */
export function refuse(f: File): 'type' | 'size' | undefined {
  if (!isAssetFile(f)) return 'type';
  if (f.size > ASSET_MAX_BYTES) return 'size';
  return undefined;
}

/** the name shown for an upload: its file name without the extension */
export const nameOf = (f: File) => f.name.replace(/\.[^.]+$/, '').slice(0, 60) || f.name;

const THUMB_W = 480;

/** the small copy of a picture: 480 px wide (never wider than it is), WebP. None for an SVG (shown as itself) or when the
 *  browser can't decode it. A GIF gives its first frame, which is what createImageBitmap decodes */
export async function makeThumb(f: File): Promise<Blob | undefined> {
  if (isSvgFile(f) || typeof createImageBitmap !== 'function') return undefined;
  let bmp: ImageBitmap | undefined;
  try {
    bmp = await createImageBitmap(f);
    const w = Math.min(THUMB_W, bmp.width), h = Math.max(1, Math.round((bmp.height * w) / bmp.width));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.86));
    // a browser without a WebP encoder answers with a PNG: still a small copy, and the hosts take PNG too
    return blob && blob.size <= 512 << 10 ? blob : undefined;
  } catch { return undefined; }
  finally { bmp?.close(); }
}

/** the picture's width and height, read in the browser for an upload still on its way */
export async function sizeOf(f: File): Promise<{ w: number; h: number } | undefined> {
  if (isSvgFile(f)) return undefined;
  try { const b = await createImageBitmap(f); const s = { w: b.width, h: b.height }; b.close(); return s; } catch { return undefined; }
}

/** project-relative paths of an asset's file and of its small copy, as the manifest names it (its extension is the
 *  copy's own: webp, png or jpg); the file itself for an SVG or when there is none */
export const assetPath = (a: Pick<UserAsset, 'file'>) => `${USER_ASSETS_DIR}/${a.file}`;
export const assetThumbPath = (a: Pick<UserAsset, 'file' | 'thumb'>) => (a.thumb ? `${USER_ASSETS_DIR}/${a.thumb}` : assetPath(a));

export const fmtBytes = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** ask the workbench to open its 素材 panel (the composer's “Add assets”) */
export const openAssets = () => dispatchEvent(new CustomEvent('studio:assets'));
