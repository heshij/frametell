import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCss, sanitizeSvg } from './svg.js';

const clean = (s: string) => { const r = sanitizeSvg(s); assert.ok(r, 'parses'); return r.svg; };

test('script, foreignObject and every on* attribute go, whatever their case or prefix', () => {
  const out = clean(`<?xml version="1.0"?><!-- made by hand --><svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 100 50" onload="alert(1)">
    <script>alert(1)</script><s:script>alert(2)</s:script>
    <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
    <rect width="10" height="10" ONCLICK="x()" fill="red"/>
  </svg>`);
  assert.doesNotMatch(out, /script|foreignObject|onload|onclick|alert/i);
  assert.match(out, /<rect width="10" height="10" fill="red"\/>/);
});

test('links outside the file go; local references, gradients and use #id stay', () => {
  const out = clean(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20px" height="10">
    <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><path id="p" d="M0 0h1"/></defs>
    <rect fill="url(#g)" width="1" height="1"/><rect fill="url(https://evil.example/x.svg#g)" width="1" height="1"/>
    <use href="#p"/><use xlink:href="#p"/>
    <a href="javascript:alert(1)"><text>x</text></a><a xlink:href="&#106;avascript:alert(1)"><text>y</text></a>
    <image href="https://evil.example/track.png"/><image href="data:image/svg+xml;base64,PHN2Zy8+"/><image href="data:image/png;base64,iVBOR"/>
  </svg>`);
  assert.match(out, /<linearGradient id="g">/);
  assert.match(out, /fill="url\(#g\)"/);
  assert.doesNotMatch(out, /evil|javascript|svg\+xml/);
  assert.equal(out.match(/<use (xlink:)?href="#p"\/>/g)?.length, 2);
  assert.match(out, /<image href="data:image\/png;base64,iVBOR"\/>/, 'an inline bitmap on <image> stays');
  assert.deepEqual({ w: sanitizeSvg(out)!.w, h: sanitizeSvg(out)!.h }, { w: 20, h: 10 });
});

test('styles lose @import and outside url(), and CSS with escapes goes whole', () => {
  const out = clean(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,64.4,32">
    <style><![CDATA[@import url("https://evil.example/a.css"); .a { fill: url(#g); background: url(//evil.example/b.png) } ]]></style>
    <style>.b { background: \\75 rl(https://evil.example) }</style>
    <rect class="a" style="fill:url('http://evil.example/c'); stroke: url(#g)" width="1" height="1"/>
  </svg>`);
  assert.doesNotMatch(out, /evil|@import|\\75/);
  assert.match(out, /\.a \{ fill: url\(#g\); background: none \}/);
  assert.match(out, /style="fill:none; stroke: url\(#g\)"/);
  assert.equal(sanitizeSvg(out)!.w, 64);
  assert.equal(cleanCss('a{b:c}'), 'a{b:c}');
  assert.equal(cleanCss('@im\\port "x"'), undefined);
});

test('an animation that would set a link or a handler goes', () => {
  const out = clean(`<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="onclick" values="x"/><animate attributeName="opacity" values="0;1" dur="1s"/><text>t</text></a></svg>`);
  assert.doesNotMatch(out, /javascript|onclick|<set/);
  assert.match(out, /attributeName="opacity"/);
});

test('what does not parse, or is not an SVG, is refused', () => {
  for (const bad of [
    '<svg><g></svg>', '<svg><rect></g></svg>', '<svg a=1/>', '<svg a="1" a="2"/>', '<svg>&nbsp;</svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>', '<html/>', '<svg/><svg/>', 'hello <svg/>', '', 'not xml', '<svg><!-- open',
  ]) assert.equal(sanitizeSvg(bad), undefined, bad);
  assert.ok(sanitizeSvg('﻿<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>'));
});

test('text is escaped again on the way out', () => {
  const out = clean('<svg xmlns="http://www.w3.org/2000/svg"><text title="a &quot;b&quot; &lt;c">1 &lt; 2 &amp;&#x26; <![CDATA[<b>]]></text></svg>');
  assert.match(out, /title="a &quot;b&quot; &lt;c"/);
  assert.match(out, />1 &lt; 2 &amp;&amp; &lt;b&gt;</);
});
