import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { findSources } from './research/sources.js';
import { researchTools, type Handed } from './research/tools.js';
import { createWeb, htmlText, offlineWeb, searchProvider, type Web } from './research/web.js';
import { runResearch } from './research/research.js';
import { gitClone } from './git.js';
import { trimToolResults } from './runtime/pi.js';
import { Director } from './director.js';
import type { AgentRuntime, SessionOptions } from './runtime/types.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'frametell-research-'));
const noWeb: Web = { search: async () => [], read: async (url) => ({ url, text: `the page at ${url}` }) };
const run = (tool: { execute: Function }, args: object) => tool.execute('id', args, undefined) as Promise<{ content: { text: string }[]; terminate?: boolean }>;
const out = async (tool: { execute: Function }, args: object) => (await run(tool, args)).content[0].text;

test('a request points at pages, repositories and, on this machine, folders', () => {
  const dir = tmp();
  try {
    const s = findSources(`讲讲 https://github.com/sitor-ai/frametell/tree/main/packages/agent 这个，参考 https://example.com/post。还有 "${dir}" 和 /Users/nobody/nothing-here`, { local: true });
    assert.deepEqual(s.repos, [{ url: 'https://github.com/sitor-ai/frametell', host: 'github.com', owner: 'sitor-ai', name: 'frametell', sub: 'packages/agent' }]);
    assert.deepEqual(s.urls, ['https://example.com/post']);
    assert.deepEqual(s.local, [dir]);   // a path that does not exist is not a source
    // a hosted service never reads its own disk, whatever the request names
    assert.deepEqual(findSources(`看看 "${dir}" 和 /etc`, { local: false }).local, []);
    // a GitHub page that is not a repository is just a page
    assert.deepEqual(findSources('https://github.com/topics/ai', { local: false }).urls, ['https://github.com/topics/ai']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the search engine is the chosen one with a key, else the first with one', () => {
  assert.equal(searchProvider({}), undefined);
  assert.equal(searchProvider({ serper: 'k' }), 'serper');
  assert.equal(searchProvider({ provider: 'tavily', serper: 'k' }), 'serper');   // chosen but no key
  assert.equal(searchProvider({ provider: 'jina', serper: 'k', jina: 'j' }), 'jina');
  assert.equal(createWeb({}).provider, undefined);
});

test('an HTML page is reduced to its text', () => {
  const t = htmlText('<html><head><title>T</title><script>x()</script></head><body><nav>menu</nav><h2>Why</h2><p>It&amp;s <b>fast</b>.</p><ul><li>one</li></ul></body></html>');
  assert.ok(t.includes('## Why'));
  assert.ok(t.includes('It&s fast'));
  assert.ok(t.includes('- one'));
  assert.ok(!t.includes('x()') && !t.includes('menu'));
});

test('the research tools read only inside the folders they were given', async () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\nA queue that retries.\n');
    fs.writeFileSync(path.join(dir, 'src', 'queue.ts'), 'export function retry(n = 3) {\n  return n;\n}\n');
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'retry()');
    let handed: Handed | undefined;
    const { tools } = researchTools({ mounts: [{ name: 'demo', root: dir, about: 'a folder' }], web: noWeb, limits: { searches: 1, pages: 1, minutes: 5 }, onFinish: (h) => { handed = h; } });
    const tool = (n: string) => tools.find((x) => x.name === n)!;
    assert.deepEqual(tools.map((x) => x.name), ['list_files', 'read_file', 'search_files', 'read_url', 'finish']);   // no search engine: no web_search
    const listing = await out(tool('list_files'), { path: 'demo' });
    assert.ok(listing.includes('src/') && listing.includes('README.md') && !listing.includes('node_modules'));
    assert.ok((await out(tool('read_file'), { path: 'demo/src/queue.ts' })).includes('    1  export function retry'));
    const hits = await out(tool('search_files'), { pattern: 'retr(y|ies)' });
    assert.ok(hits.includes('demo/src/queue.ts:1') && hits.includes('demo/README.md:2') && !hits.includes('node_modules'));
    await assert.rejects(run(tool('read_file'), { path: 'demo/../../etc/passwd' }), /outside/);
    await assert.rejects(run(tool('read_file'), { path: 'etc/passwd' }), /unknown folder/);
    // one page allowed: reading it again in parts is free, another page is refused
    assert.ok((await out(tool('read_url'), { url: 'https://a.example' })).includes('the page at https://a.example'));
    await out(tool('read_url'), { url: 'https://a.example', offset: 5 });
    await assert.rejects(run(tool('read_url'), { url: 'https://b.example' }), /used up/);
    const done = await run(tool('finish'), { brief: '# Demo\n' + 'A queue that retries three times. '.repeat(10), sources: [{ title: 'README', ref: 'demo/README.md' }] });
    assert.equal(done.terminate, true);
    assert.equal(handed?.sources[0].ref, 'demo/README.md');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a link in a folder the research was given is never followed out of it', async () => {
  const base = tmp(), dir = path.join(base, 'materials'), outside = path.join(base, 'outside');
  try {
    fs.mkdirSync(dir); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'the secret retries');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'retries here\n');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
    fs.symlinkSync(outside, path.join(dir, 'away'));
    const { tools } = researchTools({ mounts: [{ name: 'm', root: dir, about: 'the material' }], web: noWeb, limits: { searches: 1, pages: 1, minutes: 5 }, onFinish: () => {} });
    const tool = (n: string) => tools.find((x) => x.name === n)!;
    await assert.rejects(run(tool('read_file'), { path: 'm/link.txt' }), /outside/);
    await assert.rejects(run(tool('read_file'), { path: 'm/away/secret.txt' }), /outside/);
    await assert.rejects(run(tool('list_files'), { path: 'm/away' }), /outside/);
    const listing = await out(tool('list_files'), { path: 'm' });
    assert.ok(listing.includes('notes.md') && !listing.includes('link.txt') && !listing.includes('away'), listing);
    const hits = await out(tool('search_files'), { pattern: 'retries' });
    assert.ok(hits.includes('m/notes.md:1') && !hits.includes('secret'), hits);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('with no web (a sandbox), the research has no web tool and its web neither searches nor reads', async () => {
  const dir = tmp();
  try {
    const { tools } = researchTools({ mounts: [{ name: 'm', root: dir, about: 'the material' }], web: offlineWeb, limits: { searches: 1, pages: 1, minutes: 5 }, onFinish: () => {} });
    assert.deepEqual(tools.map((x) => x.name), ['list_files', 'read_file', 'search_files', 'finish']);
    assert.equal(offlineWeb.provider, undefined);
    assert.equal(offlineWeb.reads, false);
    await assert.rejects(offlineWeb.read('https://example.com'), /no web/);
    await assert.rejects(offlineWeb.search('x', 1), /no web/);
    // and a clone is only ever of an https repository
    await assert.rejects(gitClone('file:///etc', path.join(dir, 'c')), /https/);
    await assert.rejects(gitClone('ext::sh -c touch% /tmp/x', path.join(dir, 'c')), /https/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a long session clears its oldest tool results first, keeping the newest', () => {
  const result = (n: number, size: number) => ({ role: 'toolResult', toolCallId: String(n), toolName: 'read_file', content: [{ type: 'text', text: 'x'.repeat(size) }], isError: false, timestamp: n }) as unknown as AgentMessage;
  const msgs = [result(1, 5000), { role: 'user', content: 'hi', timestamp: 0 } as AgentMessage, result(2, 5000), result(3, 5000)];
  const trimmed = trimToolResults(msgs, 11_000) as any[];
  assert.ok(trimmed[0].content[0].text.startsWith('(an older result'));
  assert.equal(trimmed[2].content[0].text.length, 5000);
  assert.equal(trimmed[3].content[0].text.length, 5000);
  assert.equal((msgs[0] as any).content[0].text.length, 5000);   // the transcript itself is untouched
});

/** a research model that reads the README, then hands in a brief (or, with `stall`, never does until told to) */
const researcher = (opts: { stall?: boolean } = {}): AgentRuntime & { sent: string[]; opened: SessionOptions[] } => {
  const sent: string[] = [], opened: SessionOptions[] = [];
  return {
    id: 'pi', model: { provider: 'x', id: 'flash' }, sent, opened,
    async open(o) {
      opened.push(o);
      const tool = (n: string) => o.agentTools!.find((x) => x.name === n)!;
      return {
        ref: 'r', close: async () => {},
        send: async (i) => {
          sent.push(i.text);
          o.onEvent?.({ type: 'turn', usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 } });
          if (opts.stall && sent.length === 1) return { ok: false, text: '', turns: 300, usage: {} as never, stopReason: 'max_turns', answers: [] };
          if (!opts.stall) await tool('read_file').execute('1', { path: 'materials/notes.md' } as never);
          else await assert.rejects(tool('read_file').execute('1', { path: 'materials/notes.md' } as never) as Promise<unknown>, /call finish now/i);   // only finish is open now
          await tool('finish').execute('2', { brief: '# 番茄工作法\n\n## One line\n' + '一种把工作切成 25 分钟一段的方法。'.repeat(12), sources: [{ title: 'notes', ref: 'materials/notes.md' }] } as never);
          return { ok: true, text: '', turns: 2, usage: {} as never, stopReason: 'done', answers: [] };
        },
      };
    },
  };
};

test('research reads the material and leaves a brief for the storyboard', async () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'materials'));
    fs.writeFileSync(path.join(dir, 'materials', 'notes.md'), '25 minutes of work, then 5 of rest.');
    const rt = researcher();
    const events: string[] = [];
    const d = new Director({ dir, runtime: rt, style: 'warm-story', brief: { durationSec: 60, topic: '番茄工作法', lang: 'zh' }, research: { runtime: rt, web: noWeb, sources: { urls: [], repos: [], local: [] }, search: false }, emit: (e) => events.push(e.type === 'stage' ? `${e.stage}:${e.status}` : e.type) });
    await d.research();
    const brief = fs.readFileSync(path.join(dir, 'materials', 'research.md'), 'utf8');
    assert.ok(brief.startsWith('# 番茄工作法') && brief.includes('## Sources\n\n- notes: materials/notes.md'));
    assert.deepEqual(events.filter((e) => e.startsWith('research')), ['research:start', 'research:done']);
    assert.ok(events.includes('cost'));   // its turns count toward the film's cost
    assert.ok(!rt.opened[0].agentTools!.some((x) => x.name === 'web_search'));   // not allowed to search
    assert.ok(rt.sent[0].includes('materials/ — the material the user uploaded'));
    // done once: a run that continues does not research again
    await d.research();
    assert.equal(rt.sent.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('research out of turns is asked for its brief; one that fails does not stop the film', async () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'materials'));
    fs.writeFileSync(path.join(dir, 'materials', 'notes.md'), 'notes');
    const rt = researcher({ stall: true });
    const r = await runResearch({ dir, runtime: rt, web: noWeb, sources: { urls: [], repos: [], local: [] }, search: false, brief: { durationSec: 60 } });
    assert.match(rt.sent[1], /Stop gathering now and call finish/);
    assert.ok(r.brief.length > 200);

    const broken: AgentRuntime = { id: 'pi', model: { provider: 'x', id: 'y' }, async open() { throw new Error('model unavailable'); } };
    const events: { type: string; stage?: string; status?: string }[] = [];
    const d = new Director({ dir: tmp(), runtime: broken, style: 'warm-story', brief: { durationSec: 60 }, research: { runtime: broken, web: noWeb, sources: { urls: ['https://a.example'], repos: [], local: [] }, search: false }, emit: (e) => events.push(e as never) });
    await d.research();
    assert.ok(events.some((e) => e.type === 'stage' && e.stage === 'research' && e.status === 'failed'));
    assert.ok(events.some((e) => e.type === 'note'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('read_file never drops text: a long line goes on in rows, and a full reply says where to read on mid-line', async () => {
  const dir = tmp();
  try {
    // a parsed PDF's paragraph is one line: 1,200 characters, then a line far longer than one reply holds
    const para = Array.from({ length: 120 }, (_, i) => `w${String(i).padStart(3, '0')}xxxxx`).join('');
    const huge = Array.from({ length: 8000 }, (_, i) => `h${String(i).padStart(4, '0')}xxxx`).join('');
    fs.writeFileSync(path.join(dir, 'paper.md'), `# Title\n${para}\n${huge}\nthe end\n`);
    const { tools } = researchTools({ mounts: [{ name: 'm', root: dir, about: 'the material' }], web: noWeb, limits: { searches: 1, pages: 1, minutes: 5 }, onFinish: () => {} });
    const read = tools.find((x) => x.name === 'read_file')!;
    let text = '', args: Record<string, unknown> = { path: 'm/paper.md' };
    for (let calls = 0; calls < 20; calls++) {
      const got = await out(read, args);
      const rows = got.split('\n').filter((l) => /^\s*\d+[ +] /.test(l));
      for (const r of rows) text += (r.slice(5, 6) === '+' ? '' : '\n') + r.slice(7);
      assert.ok(got.length < 31_000, 'each reply keeps to its budget');
      const next = /read on with offset (\d+)(?: and part (\d+))?/.exec(got);
      if (!next) break;
      args = { path: 'm/paper.md', offset: +next[1], ...(next[2] ? { part: +next[2] } : {}) };
    }
    assert.equal(text.slice(1), `# Title\n${para}\n${huge}\nthe end\n`);
    assert.ok((await out(read, { path: 'm/paper.md', offset: 2 })).includes('    2+ '), 'a long line goes on in rows marked with +');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
