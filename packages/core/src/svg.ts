// SVG files made safe before they are kept: an SVG is a document that can run script, reach other hosts and pull in
// other documents, and a picture a person gives a film (or a brand's logo) is opened in the studio, in previews and in
// every film it goes into. The file is parsed (a small XML reader: elements, attributes, text, CDATA; comments,
// processing instructions and the doctype are dropped, any entity but the five XML ones and character references is
// refused), cleaned and written out again from the tree, so nothing the reader did not understand survives. What goes:
//   - <script> and <foreignObject>, whatever their prefix
//   - every on* attribute
//   - href / xlink:href that isn't a local reference ('#…'), except an inline PNG, JPEG, WebP or GIF on <image> (logos
//     exported from design tools often carry their bitmap that way; a bitmap runs nothing)
//   - <set> / <animate…> that would change an href or an on* attribute
//   - in <style> and style attributes: @import, and url(…) to anything but '#…'; CSS with escapes (\…) is dropped whole,
//     since an escape can spell url( or @import past any check
//   - any other attribute whose url(…) points outside the file
// What doesn't parse is refused: the person is asked to export a PNG instead. (Cloud's apps/api/src/svg.ts is the same.)

export interface CleanSvg { svg: string; w: number; h: number }

interface El { name: string; attrs: [string, string][]; kids: Node[] }
type Node = El | { text: string };

const MAX_DEPTH = 256;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** the text with its entity and character references read; undefined when it names an entity XML doesn't define */
function decode(s: string): string | undefined {
  let out = '', i = 0;
  while (i < s.length) {
    const amp = s.indexOf('&', i);
    if (amp < 0) { out += s.slice(i); break; }
    out += s.slice(i, amp);
    const semi = s.indexOf(';', amp);
    if (semi < 0 || semi - amp > 12) return undefined;
    const ref = s.slice(amp + 1, semi);
    if (ref.startsWith('#')) {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const digits = ref.slice(hex ? 2 : 1);
      if (!digits || ![...digits].every((ch) => (hex ? '0123456789abcdefABCDEF' : '0123456789').includes(ch))) return undefined;
      const code = parseInt(digits, hex ? 16 : 10);
      if (!(code > 0 && code <= 0x10ffff)) return undefined;
      out += String.fromCodePoint(code);
    } else if (Object.hasOwn(ENTITIES, ref)) out += ENTITIES[ref];
    else return undefined;
    i = semi + 1;
  }
  return out;
}

const isSpace = (ch: string | undefined) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
const isNameChar = (ch: string | undefined) => !!ch && !isSpace(ch) && !'<>/="\'&'.includes(ch);

/** the document's root element, or undefined when it isn't well-formed XML */
export function parseXml(src: string): El | undefined {
  const root: El = { name: '', attrs: [], kids: [] };
  const stack: El[] = [root];
  let i = 0;
  const text = (t: string) => { if (t) stack[stack.length - 1].kids.push({ text: t }); };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { const t = decode(src.slice(i)); if (t === undefined) return undefined; text(t); break; }
    if (lt > i) { const t = decode(src.slice(i, lt)); if (t === undefined) return undefined; text(t); }
    if (src.startsWith('<!--', lt)) { const end = src.indexOf('-->', lt + 4); if (end < 0) return undefined; i = end + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const end = src.indexOf(']]>', lt + 9); if (end < 0) return undefined; text(src.slice(lt + 9, end)); i = end + 3; continue; }
    if (src.startsWith('<?', lt)) { const end = src.indexOf('?>', lt + 2); if (end < 0) return undefined; i = end + 2; continue; }
    if (src.startsWith('<!DOCTYPE', lt) || src.startsWith('<!doctype', lt)) {
      // an internal subset is where entities are declared: refused rather than read
      const end = src.indexOf('>', lt);
      if (end < 0 || src.slice(lt, end).includes('[')) return undefined;
      i = end + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      if (end < 0) return undefined;
      const name = src.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open === root || open.name !== name) return undefined;
      i = end + 1;
      continue;
    }
    // a start tag: its name, then attributes, each quoted
    let j = lt + 1;
    while (isNameChar(src[j])) j++;
    const name = src.slice(lt + 1, j);
    if (!name) return undefined;
    const el: El = { name, attrs: [], kids: [] };
    for (;;) {
      while (isSpace(src[j])) j++;
      if (src[j] === '>' || src.startsWith('/>', j)) break;
      const a = j;
      while (isNameChar(src[j])) j++;
      const key = src.slice(a, j);
      if (!key) return undefined;
      while (isSpace(src[j])) j++;
      if (src[j] !== '=') return undefined;
      j++;
      while (isSpace(src[j])) j++;
      const q = src[j];
      if (q !== '"' && q !== "'") return undefined;
      const close = src.indexOf(q, j + 1);
      if (close < 0) return undefined;
      const raw = src.slice(j + 1, close);
      if (raw.includes('<')) return undefined;
      const value = decode(raw);
      if (value === undefined || el.attrs.some(([k]) => k === key)) return undefined;
      el.attrs.push([key, value]);
      j = close + 1;
    }
    stack[stack.length - 1].kids.push(el);
    if (src[j] === '>') { stack.push(el); if (stack.length > MAX_DEPTH) return undefined; i = j + 1; }
    else i = j + 2;
  }
  if (stack.length !== 1) return undefined;
  const els = root.kids.filter((k): k is El => 'name' in k);
  // one root element, and nothing but white space beside it
  if (els.length !== 1 || root.kids.some((k) => 'text' in k && k.text.trim())) return undefined;
  return els[0];
}

const local = (name: string) => name.slice(name.indexOf(':') + 1).toLowerCase();
const DROP = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object']);
const ANIMATE = new Set(['set', 'animate', 'animatetransform', 'animatemotion', 'animatecolor']);
const INLINE_BITMAP = ['data:image/png;', 'data:image/jpeg;', 'data:image/jpg;', 'data:image/webp;', 'data:image/gif;'];

/** every url(…) in a piece of CSS or an attribute, as written between the brackets (quotes taken off) */
function urls(css: string): string[] {
  const out: string[] = [];
  const lower = css.toLowerCase();
  let i = 0;
  while ((i = lower.indexOf('url(', i)) >= 0) {
    const end = css.indexOf(')', i + 4);
    out.push(css.slice(i + 4, end < 0 ? undefined : end).trim().replace(/^["']|["']$/g, '').trim());
    i += 4;
  }
  return out;
}
const isLocal = (u: string) => u.trim().startsWith('#');

/** CSS with @import and outside url(…) taken out; undefined when it can't be trusted to read as it looks */
export function cleanCss(css: string): string | undefined {
  if (css.includes('\\') || /expression\s*\(/i.test(css)) return undefined;
  // @import … ; (or to the end, when the semicolon is missing)
  let out = css.replace(/@import\b[^;]*(;|$)/gi, '');
  out = out.replace(/url\(\s*(['"]?)([^)]*?)\1\s*\)/gi, (m, _q, u: string) => (isLocal(u) ? m : 'none'));
  return /@import/i.test(out) ? undefined : out;
}

function cleanAttrs(el: El): [string, string][] {
  const tag = local(el.name);
  const kept: [string, string][] = [];
  for (const [k, v] of el.attrs) {
    const key = local(k);
    if (key.startsWith('on')) continue;
    if (key === 'href' || key === 'src') {
      const u = v.trim();
      if (isLocal(u) || (tag === 'image' && INLINE_BITMAP.some((p) => u.toLowerCase().startsWith(p)))) kept.push([k, v]);
      continue;
    }
    if (ANIMATE.has(tag) && key === 'attributename' && (local(v.trim()) === 'href' || local(v.trim()).startsWith('on'))) return [];
    if (key === 'style') { const css = cleanCss(v); if (css !== undefined) kept.push([k, css]); continue; }
    if (urls(v).some((u) => !isLocal(u))) continue;
    kept.push([k, v]);
  }
  return kept;
}

const escText = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const escAttr = (s: string) => s.replace(/[&<"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;' })[c]!);

function write(el: El): string {
  const tag = local(el.name);
  if (DROP.has(tag)) return '';
  const attrs = cleanAttrs(el);
  // an animation that would set a link or a handler goes whole
  if (ANIMATE.has(tag) && !attrs.length && el.attrs.length) return '';
  let inner = '';
  if (tag === 'style') {
    const css = cleanCss(el.kids.map((k) => ('text' in k ? k.text : '')).join(''));
    if (css === undefined) return '';
    inner = escText(css);
  } else inner = el.kids.map((k) => ('text' in k ? escText(k.text) : write(k))).join('');
  const open = `<${el.name}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}`;
  return inner ? `${open}>${inner}</${el.name}>` : `${open}/>`;
}

/** its size: the viewBox's, else its width and height in pixels (0 when it gives neither) */
function sizeOf(svg: El): { w: number; h: number } {
  const get = (k: string) => svg.attrs.find(([n]) => n === k)?.[1];
  const box = get('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) return { w: Math.round(box[2]), h: Math.round(box[3]) };
  const px = (v?: string) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) && n > 0 && /^\s*[\d.]+\s*(px)?\s*$/.test(v ?? '') ? Math.round(n) : 0; };
  return { w: px(get('width')), h: px(get('height')) };
}

/** the SVG made safe, with its size; undefined when it isn't an SVG that parses */
export function sanitizeSvg(src: string): CleanSvg | undefined {
  const root = parseXml(src.replace(/^﻿/, ''));
  if (!root || local(root.name) !== 'svg') return undefined;
  return { svg: write(root) + '\n', ...sizeOf(root) };
}
