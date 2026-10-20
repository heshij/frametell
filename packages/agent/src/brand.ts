// A brand a film is made for: who it speaks for (name, what it does, its tone, its tagline) and its files (logos,
// icons, pictures), copied into the project's assets/brand/ when the film is made. The director reads it after the
// style card; a page that places one of its files is told how. Its colours and typeface reach the film as its `look`.

/** a logo, the logo for dark grounds, a mark with no words, an icon, or any other picture */
export type BrandAssetKind = 'logo' | 'logo-dark' | 'mark' | 'icon' | 'image';
export interface BrandAsset {
  /** its file name in assets/brand/ */
  file: string;
  kind: BrandAssetKind;
  name: string;
  /** one sentence on what it is: where it belongs is decided by it */
  note: string;
  /** its size in pixels (an SVG's viewBox) */
  w: number; h: number;
  /** a transparent background */
  alpha: boolean;
}
export interface BrandBrief {
  /** the host's own id for the brand, kept with the film */
  id?: string;
  name: string;
  /** what it does, and for whom */
  about?: string;
  /** how its words sound */
  tone?: string;
  tagline?: string;
  /** the director may give the logo a few planned moments (default: yes); false: no logo on screen at all, the brand
   *  only in its colours and tone */
  showLogo?: boolean;
  /** the corner where the engine keeps a small logo on every page (top-right, bottom-right, bottom-left; never top-left,
   *  where each page's title sits); absent: no corner logo */
  corner?: BrandCorner;
  /** the palette name that carries the brand's main colour in the film's style (the host maps the colours) */
  emphasis?: string;
  /** the film's palette as the host set it from the brand's colours (name → #RRGGBB), so its colours are described as
   *  they are now */
  palette?: Record<string, string>;
  assets: BrandAsset[];
}

export type BrandCorner = 'tr' | 'br' | 'bl';
const CORNERS: Record<BrandCorner, string> = { tr: 'top-right', br: 'bottom-right', bl: 'bottom-left' };

/** where a film keeps its brand's files */
export const BRAND_DIR = 'assets/brand';
const KINDS: BrandAssetKind[] = ['logo', 'logo-dark', 'mark', 'icon', 'image'];
const LOGOS: BrandAssetKind[] = ['logo', 'logo-dark', 'mark'];
/** a plain file name of a picture: no folders, nothing hidden */
const FILE = /^[\w][\w.-]{0,95}\.(svg|png|jpe?g|webp)$/i;
const MAX_ASSETS = 30;
/** a palette name: a plain identifier */
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const block = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const px = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(20000, Math.round(v)) : 0);

/** the brief as a film keeps it: its fields trimmed to size, only files with plain picture names, each named once;
 *  undefined without a name */
export function cleanBrand(x: unknown): BrandBrief | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const o = x as Record<string, unknown>;
  const name = text(o.name, 60);
  if (!name) return undefined;
  const seen = new Set<string>();
  const assets: BrandAsset[] = (Array.isArray(o.assets) ? o.assets : []).flatMap((a): BrandAsset[] => {
    if (!a || typeof a !== 'object') return [];
    const r = a as Record<string, unknown>;
    if (typeof r.file !== 'string' || !FILE.test(r.file) || seen.has(r.file.toLowerCase())) return [];
    seen.add(r.file.toLowerCase());
    const kind = KINDS.includes(r.kind as BrandAssetKind) ? r.kind as BrandAssetKind : 'image';
    return [{ file: r.file, kind, name: text(r.name, 80) || r.file, note: text(r.note, 200), w: px(r.w), h: px(r.h), alpha: r.alpha === true }];
  }).slice(0, MAX_ASSETS);
  const brief: BrandBrief = { name, assets };
  const id = text(o.id, 80);
  if (id) brief.id = id;
  const about = block(o.about, 500), tone = block(o.tone, 1000), tagline = text(o.tagline, 80);
  if (about) brief.about = about;
  if (tone) brief.tone = tone;
  if (tagline) brief.tagline = tagline;
  if (o.showLogo === false) brief.showLogo = false;
  if (typeof o.corner === 'string' && o.corner in CORNERS) brief.corner = o.corner as BrandCorner;
  if (typeof o.emphasis === 'string' && NAME.test(o.emphasis)) brief.emphasis = o.emphasis;
  if (o.palette && typeof o.palette === 'object' && !Array.isArray(o.palette)) {
    const palette = Object.fromEntries(Object.entries(o.palette as Record<string, unknown>)
      .filter((e): e is [string, string] => NAME.test(e[0]) && typeof e[1] === 'string' && /^#[0-9a-f]{6}$/i.test(e[1])).slice(0, 24).map(([k, v]) => [k, v.toUpperCase()]));
    if (Object.keys(palette).length) brief.palette = palette;
  }
  return brief;
}

const pathOf = (a: BrandAsset) => `${BRAND_DIR}/${a.file}`;
const size = (a: BrandAsset) => (a.w && a.h ? `${a.w}×${a.h}` : 'size unknown');
const line = (a: BrandAsset) => `- \`${pathOf(a)}\`: ${a.kind}, ${size(a)}, ${a.alpha ? 'transparent background' : 'opaque background'}${a.name && a.name !== a.file ? `, “${a.name}”` : ''}${a.note ? `: ${a.note}` : ''}`;

/** How the brand's logo shows in a film: in a few moments the director plans, never stamped on pages by rule. The
 *  rules as the director reads them (a host writing the brand down for a film, as brand.md, can use the same words). */
export const BRAND_MOMENT_RULES = `- The logo appears only in brand moments you plan: the closing sign-off, and at most one other. Restraint beats repetition.
- The film ends on the sign-off. In a short film (up to about 3 minutes) it is normally the one moment. Leave it out only when the content makes it wrong, and then say why when you report the storyboard.
- Each brand moment is its own beat, and that beat says so in its object: \`brand moment: ${BRAND_DIR}/<file>\`, the kind of moment, and roughly where and when (e.g. \`brand moment: ${BRAND_DIR}/logo.svg, closing sign-off, centred once the scene has cleared, tagline under it\`). The page agent draws exactly that, and only there.
- The sign-off comes after the narration's last line, in the hold the film keeps for it (about 3 seconds before the film fades out): the story lands with the last line, then the brand signs it in silence. Its beat is the last page's last beat, timed to the last cue, and its object says it follows the last line. The narration never introduces it ("brought to you by…", the brand's name tacked onto the last line): the last line finishes the story.
- The sign-off is a composed beat of its own: the scene clears or settles first, then the logo enters with the style's own motion (drawn, stamped, faded in), the tagline under it, and holds at least 2 seconds. In a sign-off the logo is the largest thing in the moment, about 18–30% of the frame's width, centred or on a clear axis, on clean ground: no line, horizon, edge or object within its clear space. The tagline is narrower than the logo and clearly smaller.
- The other moment, if any, is a placement native to the style: in ink and wash a seal-like mark in a corner near the title, on a chalkboard signed in a corner, in an editorial layout a masthead. A small corner mark (about 6–10% of the frame's width, no tagline) is this kind of moment: a supplement to the sign-off, never a substitute for it, and it stays for a whole section (at least about 8 seconds), never a flicker at the very end.
- Never on top of or crowding a title, a label, a diagram or the subject, never in the middle of a content page, and at most one logo in a frame.
- The logo file itself is never distorted, recoloured, cropped or framed, whatever the moment.`;

/** how long the film holds after its last line when it ends on a brand's sign-off (META.pace.tail), seconds */
export const SIGN_OFF_HOLD = 3.6;

/** the film ends on the brand's sign-off: its last page places a logo */
export function signsOff(brand: BrandBrief | undefined, pages: Parameters<typeof brandFilesOn>[1]) {
  const last = pages[pages.length - 1];
  return !!last && brandFilesOn(brand, pages, last.id).some((a) => LOGOS.includes(a.kind));
}

/** The engine's corner mark (META.mark): the brand's wordless mark, else its logo, in the corner the brand chose, on
 *  every page; its dark-ground logo with it when it has one. undefined when the brand shows no logo or chose no corner. */
export function cornerMark(brand: BrandBrief | undefined, signOff = false) {
  if (!brand?.corner || brand.showLogo === false) return undefined;
  const a = brand.assets.find((x) => x.kind === 'mark') ?? brand.assets.find((x) => x.kind === 'logo') ?? brand.assets.find((x) => x.kind === 'logo-dark');
  if (!a) return undefined;
  const dark = a.kind === 'logo' ? brand.assets.find((x) => x.kind === 'logo-dark') : undefined;
  return { src: pathOf(a), ...(dark ? { dark: pathOf(dark) } : {}), corner: brand.corner, w: a.w || 1, h: a.h || 1, ...(signOff ? { signOff: true } : {}) };
}

/** where the corner mark sits, for the agents who must keep it clear: the corner and the box it takes (1920×1080) */
const cornerRule = (c: BrandCorner) => `- The film already carries the brand's logo, small, in the **${CORNERS[c]} corner of every page**: the engine draws it there by itself, above the page and still while the camera moves. Never draw a logo or the brand's name in that corner, and keep that corner clear: nothing in the ${c === 'tr' ? 'top' : 'bottom'} ${c === 'bl' ? 'left' : 'right'} ${'240×150'} px of the frame.`;

/** The brand, for the director (storyboard, script, changes): after the style card, so it reads as who the film
 *  speaks for, not as a new style. '' without a brand, so the prompt stays as it was. */
export function brandSection(brand?: BrandBrief) {
  if (!brand) return '';
  const logo = brand.assets.some((a) => LOGOS.includes(a.kind));
  const shown = brand.showLogo !== false;
  const files = brand.assets.filter((a) => shown || !LOGOS.includes(a.kind));
  const corner = cornerMark(brand) ? brand.corner : undefined;
  return `---
# This film's brand

The film is made for a brand and speaks for it. Its colours and typeface, when it has them, are already the film's palette and fonts (use them by name); what follows is who it is.

- Name: ${brand.name}${brand.about ? `\n- About: ${brand.about}` : ''}${brand.tagline ? `\n- Tagline: “${brand.tagline}”` : ''}${brand.tone ? `\n- Tone of voice:\n\n<brand-tone>\n${brand.tone}\n</brand-tone>` : ''}

Its files, in the project (open a picture with read to see it):
${files.length ? files.map(line).join('\n') : '(none)'}

${logo && shown ? `## Brand moments\n\n${BRAND_MOMENT_RULES}\n\n## Everything else\n\n` : ''}${!shown ? '- No logo on screen anywhere in this film: the brand shows in its colours and its tone only.\n' : ''}${corner ? `${cornerRule(corner)} It is the brand's moment on every page: plan no other corner mark, seal or masthead. The closing sign-off still happens as above (the corner logo fades out before it).\n` : ''}- Use the other files only where the content calls for them (the product's screenshot where the film shows the product); never put one in because it is there. A beat that places one names its path in its object (\`${BRAND_DIR}/…\`), so the page agent places that very file.
${brand.palette ? `- In this film the palette's colours are: ${Object.entries(brand.palette).map(([k, v]) => `${k} ${v}`).join(', ')}. Describe colours by what they are now, not by the style card's names.\n` : ''}${brand.emphasis ? `${emphasisRule(brand.emphasis)}\n` : ''}- Write the narration and the words on screen in the brand's tone. The rules on facts still hold: the tone never adds a claim, a number or a promise the material doesn't support.`;
}

/** the brand's files a page places: those its storyboard names (no logo when the film shows none), the logo bringing
 *  its dark version along for a dark ground */
export function brandFilesOn(brand: BrandBrief | undefined, pages: { id: string; section?: string; say?: string; beats?: { object?: string; action?: string; text?: string }[] }[], id: string): BrandAsset[] {
  if (!brand?.assets.length) return [];
  const p = pages.find((x) => x.id === id);
  if (!p) return [];
  const allowed = brand.assets.filter((a) => brand.showLogo !== false || !LOGOS.includes(a.kind));
  const words = [p.section, p.say, ...(p.beats ?? []).flatMap((b) => [b.object, b.action, b.text])].filter(Boolean).join('\n');
  const used = allowed.filter((a) => words.includes(a.file));
  if (used.some((a) => a.kind === 'logo')) for (const a of allowed) if (a.kind === 'logo-dark' && !used.includes(a)) used.push(a);
  return allowed.filter((a) => used.includes(a));
}

const call = (a: BrandAsset) => {
  const h = a.w && a.h ? `w * ${a.h} / ${a.w}` : 'h';
  // a logo or an icon stands on the page as it is: P.img frames a picture (rounded corners, an outline, a shadow) unless told not to
  return LOGOS.includes(a.kind) || a.kind === 'icon'
    ? `P.img('${pathOf(a)}', x, y, w, ${h}, { fit: 'contain', border: false, shadow: false, r: 0, pop: 0, at, dur: 0.8 })`
    : `P.img('${pathOf(a)}', x, y, w, ${h}, { fit: 'cover' })`;
};

const emphasisRule = (name: string) => `- The brand's main colour is the palette's \`${name}\`: use it for emphasis (highlights, underlines, the key number) rather than other accents.`;

/** For the page agent: the brand's colour for emphasis, and the brand's files this page places, with the call that
 *  places each, and how a logo is treated. '' when there is neither, so the prompt stays as it was. */
export function brandPageNote(files: BrandAsset[], emphasis?: string, corner?: BrandCorner) {
  if (!files.length) return emphasis || corner ? `\n\n## The brand\n${[corner && cornerRule(corner), emphasis && emphasisRule(emphasis)].filter(Boolean).join('\n')}` : '';
  const logos = files.some((a) => LOGOS.includes(a.kind));
  const dark = files.find((a) => a.kind === 'logo-dark');
  return `

## The brand's files on this page
${files.map((a) => `${line(a)}\n  \`${call(a)}\``).join('\n')}
${logos ? `
- The storyboard plans the brand moment: draw exactly the beat that names the logo, where and when it says, and nowhere else on the page.
- Compose the moment around the logo: nothing else within about one logo-height of it, never over or crowding a title, a label, a diagram or the subject, and only one logo in a frame.
- It enters with the style's own motion (drawn on, stamped, faded in: \`pop: 0\` and a slow \`dur\`, as in the calls above), never a pop; a sign-off holds at least 2 seconds.
- A sign-off follows the last line: the scene settles or recedes (fade or dim the rest, never a cut to blank) right after \`P.endT\`, the logo enters about 0.3s later and stays until the film's own fade-out. It never arrives while the narration is still speaking.
- A sign-off makes the logo the largest thing in the moment, about 18–30% of the frame's width, centred or on a clear axis, on clean ground with no line, horizon, edge or object within its clear space; its tagline is narrower than the logo and clearly smaller. A corner mark is small (about 6–10% of the width) and has no tagline.
- A logo keeps its own proportions (height = width × its h / w, \`fit: 'contain'\`): never stretch, crop, recolour, filter, blend or rotate it, and never draw it yourself.
- A logo or an icon is never framed, bordered or shadowed: keep \`border: false, shadow: false, r: 0\` as in the calls above, so it stands on the page as it is.
- ${dark ? `On a dark ground use \`${pathOf(dark)}\`; on a light ground the logo.` : 'On a dark ground, set the logo on a light card of its own rather than on the dark.'}
- A logo with an opaque background sits on a ground that matches it, or on a card, never cut out.` : ''}
- Place only these files, where and when the storyboard puts them.${corner ? `\n${cornerRule(corner)}` : ''}${emphasis ? `\n${emphasisRule(emphasis)}` : ''}`;
}

/** For the page's reviewer: the logo checked where the storyboard puts it, and looked for where it doesn't. '' for a
 *  film with no logo of a brand. */
export function brandReviewNote(brand: BrandBrief | undefined, files: BrandAsset[]) {
  if (!brand?.assets.some((a) => LOGOS.includes(a.kind))) return '';
  const logos = files.filter((a) => LOGOS.includes(a.kind));
  const c = cornerMark(brand) ? brand.corner! : undefined;
  // the engine's corner mark is on every page by design: the page is only failed for crowding it
  const corner = c ? `\nThe small logo in the ${CORNERS[c]} corner is the film's own corner mark, drawn by the engine on every page: it is right there. Fail the page only if something of the page itself sits in that corner, touches or crowds that logo, or if the page draws a second logo or the brand's name in that corner.\n` : '';
  if (!logos.length) return `${corner}\nThe storyboard puts no ${c ? 'other ' : ''}brand logo on this page: fail it if one appears${c ? ' anywhere but that corner' : ''}.\n`;
  return `${corner}\nThe storyboard puts the brand's logo on this page (${logos.map((a) => a.file).join(', ')}). Fail the page if the logo is stretched or squashed, cropped, recoloured, framed, covered by anything, overlapping or crowding any other element, in the middle of the content, more than one in a frame, or too small or faint to read. In a sign-off (the logo with its tagline), also fail it if the logo is smaller or narrower than its tagline, touches or sits on a line, horizon or edge, reads as a watermark rather than the moment's subject, or arrives before the narration's last line has ended.\n`;
}
