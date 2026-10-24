import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, CircleDashed, Clapperboard, Coins, Download, Loader2, Pause, Play, TriangleAlert } from 'lucide-react';
import { client, downloadUrl, hosted, type ProjectView } from '../lib/client';
import { clock, film, finished, relPath, shownStages, STAGE_NAME, STAGES, type FeedItem, type PageView, type RunView, type Stage, type Storyboard, isWorking } from '../lib/run';
import { pageName, stepText, summarizeTools } from '../lib/describe';
import { useNow } from '../lib/hooks';
import { Crest } from '../components/Logo';
import { FilmCredits, orShort, reportShort, ShortNotice, useShort, useSpent } from '../components/Credits';
import { STYLE_NAME } from '../lib/styles';
import { Composer, RefChip } from './Composer';
import { DeckControls, ExportControls, RevealFile } from './Export';
import type { Ref } from '../lib/refs';
import { track } from '../lib/track';
import { t, useT } from '../i18n';

// ── small pieces ────────────────────────────────────────────────────────────────────────────────────────────────────

/** **bold** and `code` only: the director writes plain sentences */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={i} className="rounded bg-ink/[0.07] px-1 py-px font-mono text-[0.86em]">{p.slice(1, -1)}</code> : <span key={i}>{p}</span>))}</>;
}

/** the director's words; long reports fold to a few lines */
function Said({ text }: { text: string }) {
  useT();
  const long = text.length > 220;
  const [open, setOpen] = useState(false);
  return (
    <div className="animate-rise">
      <p className={`whitespace-pre-wrap text-[13.5px] leading-[1.75] text-ink-2 ${long && !open ? 'line-clamp-5' : ''}`}><Rich text={text} /></p>
      {long && <button className="mt-1 text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => setOpen(!open)}>{open ? t('conversation.showLess') : t('conversation.showAll')}</button>}
    </div>
  );
}

/** a stage's work in plain words, folded: “Steps · Read “Pomodoro”, Wrote the storyboard, Checked the storyboard ×2” */
function Process({ items }: { items: FeedItem[] }) {
  const { locale } = useT();
  const [open, setOpen] = useState(false);
  const steps = useMemo(() => summarizeTools(items.flatMap((i) => (i.kind === 'tools' ? i.calls : []))), [items, locale]);
  const thoughts = items.filter((i): i is Extract<FeedItem, { kind: 'think' }> => i.kind === 'think');
  if (!steps.length && !thoughts.length) return null;
  const preview = steps.slice(0, 3).map(stepText).join(t('conversation.listJoin'));
  return (
    <div>
      <button className="group flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-ink-3 hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={13} className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden />
        <span className="truncate">{preview ? t('conversation.processPreview', { list: preview, more: steps.length }) : t('conversation.process')}</span>
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 animate-fade pl-5">
          {steps.map((s, i) => <li key={i} className="text-[12.5px] text-ink-2">{s.text}{s.count > 1 && <span className="ml-1 text-ink-3">{t('conversation.times', { n: s.count })}</span>}</li>)}
          {thoughts.map((t) => <li key={t.key} className="line-clamp-3 border-l border-line pl-2.5 text-[12px] italic leading-relaxed text-ink-3">{t.text}</li>)}
        </ol>
      )}
    </div>
  );
}

/** stage detail in people's words: "pages=5 cues=16 duration=01:05.7" → "5 pages · 16 lines · about 1m 6s" */
function humanDetail(stage: Stage, detail?: string, sb?: Storyboard) {
  if (!detail) return stage === 'storyboard' && sb ? t('conversation.pagesCount', { n: sb.pages.length }) : undefined;
  const m = /pages=(\d+) cues=(\d+) duration=(\d+):([\d.]+)/.exec(detail);
  if (m) return t('conversation.scriptDetail', { pages: m[1], cues: m[2], min: +m[3], sec: Math.round(+m[4]) });
  const s = /^([\d.]+)s/.exec(detail);
  if (s && stage === 'narrate') return t('conversation.voiceDetail', { s: Math.round(+s[1]) });
  return detail.length > 40 ? undefined : detail;
}

function StageMark({ n, status }: { n: number; status: RunView['stages'][Stage]['status'] }) {
  const base = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular';
  if (status === 'done' || status === 'skipped') return <span className={`${base} bg-jade-soft text-jade`} aria-hidden><Check size={12} strokeWidth={3} /></span>;
  if (status === 'running') return <span className={`${base} bg-accent-soft text-accent-ink`} aria-hidden><Loader2 size={12} className="animate-spin" /></span>;
  if (status === 'failed') return <span className={`${base} bg-seal-soft text-seal`} aria-hidden><TriangleAlert size={11} /></span>;
  return <span className={`${base} border border-line-2 text-ink-3`} aria-hidden>{n}</span>;
}

const stageDoing = (s: Stage) => t(`conversation.doing.${s}`);

// ── cards ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** the look the director designed for a film whose style has none of its own: the card's first plain sentence, and up to
 *  five of its colours (paper and ink first) */
function designedLook(sb: Storyboard) {
  const look = (sb as { look?: { card?: unknown; palette?: Record<string, unknown> } }).look;
  if (!look || typeof look.card !== 'string') return undefined;
  const line = look.card.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim()).find((l) => l.length > 12);
  const p = look.palette ?? {};
  const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  const colours = [p.paper, p.ink, ...Object.entries(p).filter(([k]) => k !== 'paper' && k !== 'ink' && !k.endsWith('F')).map(([, v]) => v)].map(hex).filter(Boolean).slice(0, 5) as string[];
  return line ? { line, colours } : undefined;
}

function Approval({ sb, project, run, active }: { sb: Storyboard; project: ProjectView; run: RunView; active: boolean }) {
  useT();
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState<string>();
  const live = active && !sent;
  const look = useMemo(() => designedLook(sb), [sb]);
  // short of credits for the go-ahead: the notice above the composer says so, and the button waits for the balance
  const short = useShort(project.id, run);
  // a go-ahead that was refused (credits, or anything else) leaves the card as it was, to press again
  const approve = async () => {
    setSent(true); setFailed(undefined);
    try { await client.approve(project.id); } catch (e) { setSent(false); if (!reportShort(project.id, e)) setFailed((e as Error).message); }
  };
  return (
    <div className={`rounded-2xl border bg-surface transition-shadow duration-300 ${live ? 'border-accent/50 shadow-[0_0_0_4px_rgb(var(--fs-accent)/0.07)]' : 'border-line'}`}>
      <div className="px-4 pb-3 pt-3.5">
        <h4 className="text-balance text-[14.5px] font-semibold leading-snug">{sb.title}</h4>
        {sb.summary && sb.summary !== sb.title && <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{sb.summary}</p>}
        {look && (
          <p className="mt-2.5 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-2">
            <span className="mt-[3px] flex shrink-0" aria-hidden>{look.colours.map((c, i) => <i key={i} className="-ml-1 h-3.5 w-3.5 rounded-full ring-2 ring-surface first:ml-0" style={{ background: c }} />)}</span>
            <span><span className="mr-1.5 text-ink-3">{t('conversation.approval.look')}</span>{look.line}</span>
          </p>
        )}
      </div>
      <ol className="divide-y divide-line border-t border-line">
        {sb.pages.map((p, i) => (
          <li key={p.id} className="grid grid-cols-[22px_1fr] gap-2 px-4 py-2.5">
            <span className="pt-px font-mono text-[12px] text-ink-3 tabular">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-snug">{p.section}</span>
              {p.say && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-ink-3">{p.say}</span>}
            </span>
          </li>
        ))}
      </ol>
      {live ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className={`text-[12.5px] ${short || failed ? 'text-seal' : 'text-ink-3'}`} role={failed ? 'alert' : undefined}>{short ? t('common.short.approveHint') : failed ?? t('conversation.approval.hint')}</span>
          <button className="fs-btn fs-btn-accent" disabled={!!short} onClick={() => void approve()}>{t('conversation.approval.approve')}</button>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 border-t border-line px-4 py-3 text-[12.5px] text-jade"><Check size={14} aria-hidden /> {t('conversation.approval.approved')}</p>
      )}
    </div>
  );
}

/** what a page's agent is doing now, without the page's name (the row already says which page) */
const moment = (p?: PageView) => {
  const a = p?.activity;
  if (!a?.text || !p) return undefined;
  const prefix = t('run.now.who', { page: pageName(p.id), doing: '' });
  const text = a.text.startsWith(prefix) ? a.text.slice(prefix.length) : a.text;
  return p.progress && !text.includes(p.progress) ? `${text} · ${p.progress}` : text;
};

const PAGE_STATE: Record<PageView['status'], { text: (p?: PageView) => string; icon: React.ReactNode; tone: string }> = {
  queued: { text: () => t('conversation.page.queued'), icon: <CircleDashed size={14} />, tone: 'text-ink-3' },
  drawing: { text: (p) => moment(p) ?? t('conversation.page.drawing', { progress: p?.progress }), icon: <Loader2 size={14} className="animate-spin" />, tone: 'text-accent-ink' },
  checking: { text: (p) => moment(p) ?? t('conversation.page.checking', { round: p?.round ?? 0 }), icon: <Loader2 size={14} className="animate-spin" />, tone: 'text-accent-ink' },
  ok: { text: () => t('conversation.page.ok'), icon: <Check size={14} />, tone: 'text-jade' },
  // drawn, with a check it did not pass: a warning to look at, not an error
  flagged: { text: () => t('conversation.page.flagged'), icon: <TriangleAlert size={14} />, tone: 'text-warn' },
  failed: { text: () => t('conversation.page.failed'), icon: <TriangleAlert size={14} />, tone: 'text-seal' },
};

function Pages({ run, onSelect, onPlay, selected }: { run: RunView; onSelect: (id: string) => void; onPlay: (id: string) => void; selected?: string }) {
  useT();
  const ids = run.pageOrder.length ? run.pageOrder : run.storyboard?.pages.map((p) => p.id) || [];
  return (
    <ul className="space-y-0.5" aria-label={t('conversation.page.progressLabel')}>
      {ids.map((id) => {
        const p = run.pages[id], st = PAGE_STATE[p?.status ?? 'queued'];
        const section = run.storyboard?.pages.find((x) => x.id === id)?.section;
        // a page being drawn or checked has nothing steady to show yet: it opens once it is done
        const busy = p?.status === 'drawing' || p?.status === 'checking';
        // a drawn page plays where it is shown, on a double click (one click only opens it). The hint takes the status's
        // place in the row as soon as the pointer is on it: no layer over the rows either side, nothing that moves
        const playable = p?.status === 'ok' || p?.status === 'flagged';
        return (
          <li key={id}>
            <button onClick={() => onSelect(id)} onDoubleClick={playable ? () => onPlay(id) : undefined} aria-pressed={selected === id} disabled={busy}
              className={`group/page -mx-2 flex w-[calc(100%+16px)] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${busy ? 'cursor-default' : 'hover:bg-ink/[0.04]'} ${selected === id ? 'bg-accent-soft/50' : ''}`}>
              <span className={`shrink-0 ${st.tone}`} aria-hidden>{st.icon}</span>
              <span className="w-[42px] shrink-0 text-[12.5px] text-ink-3 tabular">{pageName(id)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{section}</span>
              {playable ? (
                <span className="relative grid shrink-0 justify-items-end text-[12px]">
                  <span className={`col-start-1 row-start-1 transition-opacity duration-100 group-hover/page:opacity-0 ${st.tone}`}>{st.text(p)}</span>
                  <span className="col-start-1 row-start-1 flex items-center gap-1 text-accent-ink opacity-0 transition-opacity duration-100 group-hover/page:opacity-100" aria-hidden>
                    <Play size={10} className="fill-current" />{t('conversation.page.playHint')}
                  </span>
                </span>
              ) : <span className={`shrink-0 text-[12px] ${st.tone}`}>{st.text(p)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** this film's own components: being written and checked, ready (with what each draws), or given up */
function KitLine({ run }: { run: RunView }) {
  useT();
  const k = run.kit;
  if (!k) return null;
  const plan = ((run.storyboard?.look as { kit?: { name: string; what: string }[] } | undefined)?.kit ?? []);
  const what = (n: string) => plan.find((x) => x.name === n)?.what ?? n;
  if (k.status === 'done') return (
    <div className="text-[12.5px] leading-relaxed text-ink-2">
      <p className="flex items-center gap-1.5 text-jade"><Check size={13} aria-hidden /> {t('conversation.kit.done', { n: k.components.length })}</p>
      <ul className="mt-1 space-y-0.5 text-ink-3">{k.components.map((n) => <li key={n} className="truncate">· {what(n)}</li>)}</ul>
    </div>
  );
  if (k.status === 'failed') return <p className="text-[12.5px] leading-relaxed text-ink-3">{t('conversation.kit.failed')}</p>;
  return <p className="flex items-center gap-1.5 text-[12.5px] text-accent-ink"><Loader2 size={13} className="animate-spin" aria-hidden /> {t(k.status === 'checking' ? 'conversation.kit.checking' : 'conversation.kit.writing', { n: k.components.length, round: k.round ?? 1 })}</p>;
}

function PausedCard({ item, run, project, latest }: { item: Extract<FeedItem, { kind: 'paused' }>; run: RunView; project: ProjectView; latest: boolean }) {
  useT();
  const where = item.stage ? t('conversation.paused.whereStage', { stage: STAGE_NAME[item.stage] }) : t('conversation.paused.whereHere');
  const text = item.reason === 'credits' ? t('conversation.paused.credits', { where }) : item.reason === 'user' ? t('conversation.paused.user', { where }) : item.reason === 'interrupted' ? t('conversation.paused.interrupted', { where }) : t('conversation.paused.error', { where, msg: item.message ?? t('conversation.paused.unknownError') });
  const canContinue = latest && !!run.paused;
  // the error's first line says what happened; the lines after it, what to do next
  const [what, ...next] = text.split('\n');
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <p className="flex items-start gap-2 text-[13.5px] leading-relaxed text-ink">
        {item.reason === 'error' ? <TriangleAlert size={15} className="mt-0.5 shrink-0 text-seal" aria-hidden /> : item.reason === 'credits' ? <Coins size={15} className="mt-0.5 shrink-0 text-seal" aria-hidden /> : <Pause size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />}
        <span className="min-w-0 break-words">{what}</span>
      </p>
      {next.length > 0 && <p className="ml-[23px] mt-1.5 text-[13px] font-medium leading-relaxed text-ink-2">{next.join(' ')}</p>}
      <p className="ml-[23px] mt-1 text-[12.5px] leading-relaxed text-ink-3">{t('conversation.paused.kept')}</p>
      {/* out of credits: topping up comes first, continuing second */}
      {canContinue && item.reason === 'credits' && hosted?.credits?.url ? (
        <div className="ml-[23px] mt-3 flex flex-wrap gap-2">
          <a className="fs-btn fs-btn-accent" href={hosted.credits.url} target="_blank" rel="noopener"><Coins size={14} aria-hidden /> {t('common.short.topUp')}<ArrowUpRight size={13} aria-hidden /></a>
          <button className="fs-btn fs-btn-secondary" onClick={() => client.start(project.id).catch(orShort(project.id))}><Play size={14} aria-hidden /> {t('conversation.paused.continue')}</button>
        </div>
      ) : canContinue && <button className="fs-btn fs-btn-accent ml-[23px] mt-3" onClick={() => client.start(project.id).catch(orShort(project.id))}><Play size={14} aria-hidden /> {t('conversation.paused.continue')}</button>}
    </div>
  );
}

function DoneCard({ run, project, onPlay }: { run: RunView; project: ProjectView; onPlay: () => void }) {
  useT();
  const ids = run.pageOrder;
  const poster = ids.map((id) => run.pages[id]?.thumb).find(Boolean);
  const took = run.startedAt && run.activeAt ? clock((run.ready?.at ?? run.activeAt) - run.startedAt) : undefined;
  const seconds = run.ready?.duration ?? run.video?.duration;
  const spent = useSpent(project.id, run);
  return (
    <div className="overflow-hidden rounded-2xl border border-jade/30 bg-surface animate-rise">
      {poster && (
        <button onClick={onPlay} className="group relative block aspect-video w-full overflow-hidden" aria-label={t('conversation.done.play')}>
          <img src={client.fileUrl(project, relPath(poster, project.id))} alt="" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/30">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper/90 text-ink shadow-lg"><Play size={20} className="translate-x-px" aria-hidden /></span>
          </span>
        </button>
      )}
      <div className="px-4 py-4">
        <p className="font-display text-[22px] leading-tight text-ink">{t('conversation.done.title')}</p>
        <p className="mt-1.5 text-[12.5px] text-ink-3 tabular">{t('conversation.done.meta', { secs: seconds ? Math.round(seconds) : undefined, took, cost: spent ?? undefined })}</p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button className="fs-btn fs-btn-accent" onClick={onPlay}><Clapperboard size={14} aria-hidden /> {t('conversation.done.play')}</button>
          <ExportControls run={run} project={project} />
          <DeckControls project={project} />
        </div>
        <p className="mt-3 text-[12.5px] text-ink-3">{t('conversation.done.hint')}</p>
      </div>
    </div>
  );
}

/** an export in the conversation: one line, with the files when it is done */
function ExportLine({ it, project }: { it: Extract<FeedItem, { kind: 'export' }>; project: ProjectView }) {
  useT();
  const now = useNow(it.status === 'running');
  const took = clock((it.endedAt ?? now) - it.at);
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[12.5px] animate-rise">
      {it.status === 'running' ? <Loader2 size={14} className="animate-spin text-accent-ink" aria-hidden /> : it.status === 'done' ? <Check size={14} className="text-jade" aria-hidden /> : <TriangleAlert size={14} className="text-seal" aria-hidden />}
      <span className={it.status === 'failed' ? 'text-seal' : 'text-ink-2'}>{it.status === 'running' ? t('conversation.export.running') : it.status === 'done' ? t('conversation.export.done') : it.detail ?? t('conversation.export.failed')}</span>
      <span className="text-ink-3 tabular">{took}</span>
      {it.status === 'done' && it.video && (
        <span className="flex gap-1.5">
          <a className="fs-btn fs-btn-ghost fs-btn-sm" href={downloadUrl(project, relPath(it.video, project.id))} download onClick={() => track('download', { project: project.id, subs: true })}><Download size={13} aria-hidden /> {t('conversation.export.withSubs')}</a>
          {it.noSubs && <a className="fs-btn fs-btn-ghost fs-btn-sm" href={downloadUrl(project, relPath(it.noSubs, project.id), true)} download onClick={() => track('download', { project: project.id, subs: false })}><Download size={13} aria-hidden /> {t('conversation.export.noSubs')}</a>}
          <RevealFile file={it.saved ?? it.video} size="fs-btn-sm" />
        </span>
      )}
    </div>
  );
}

// ── the conversation ────────────────────────────────────────────────────────────────────────────────────────────────

type Block = { kind: 'chapter'; stage: Stage; items: FeedItem[]; key: string; latest?: boolean } | { kind: 'work'; items: FeedItem[]; key: string } | { kind: 'item'; item: FeedItem };

/** group the feed into stage chapters; user messages, notes and outcomes stay in the flow between them */
function blocks(feed: FeedItem[]): Block[] {
  const out: Block[] = [];
  for (const it of feed) {
    const loose = it.kind === 'user' || it.kind === 'paused' || it.kind === 'done' || it.kind === 'ready' || it.kind === 'export' || (it.kind === 'stage' && it.status === 'running');
    const stage = it.kind === 'stage' ? it.stage : it.stage;
    const last = out[out.length - 1];
    // the director working outside a stage (planning a change to the finished film) gets a chapter of its own
    if (!loose && !stage && (it.kind === 'say' || it.kind === 'think' || it.kind === 'tools')) {
      if (last?.kind === 'work') last.items.push(it); else out.push({ kind: 'work', items: [it], key: `w-${it.key}` });
      continue;
    }
    if (loose || !stage) { out.push({ kind: 'item', item: it }); continue; }
    if (last?.kind === 'chapter' && last.stage === stage) last.items.push(it);
    else out.push({ kind: 'chapter', stage, items: [it], key: `c-${it.key}` });
  }
  // a stage can run again (a revision redraws pages, a new voice narrates again): only its latest chapter is live,
  // earlier ones are history. A run that has started but said nothing yet has no chapter of its own: the old one must
  // not take its spinner.
  const seen = new Set<Stage>();
  for (let i = out.length - 1; i >= 0; i--) {
    const b = out[i];
    if (b.kind === 'item' && b.item.kind === 'stage' && b.item.status === 'running') seen.add(b.item.stage);
    else if (b.kind === 'chapter' && !seen.has(b.stage)) { b.latest = true; seen.add(b.stage); }
  }
  return out;
}

/** the director planning a change: what it read and decided, folded like a stage */
function WorkChapter({ b, live }: { b: Extract<Block, { kind: 'work' }>; live: boolean }) {
  useT();
  return (
    <section aria-label={t('conversation.plan.title')}>
      <header className="flex items-center gap-2.5">
        <StageMark n={0} status={live ? 'running' : 'done'} />
        <h3 className="text-[13.5px] font-semibold text-ink">{t('conversation.plan.title')}</h3>
        <span className={`truncate text-[12.5px] ${live ? 'text-accent-ink' : 'text-ink-3'}`}>{live ? t('conversation.plan.looking') : ''}</span>
      </header>
      <div className="ml-2.5 mt-2.5 space-y-3 border-l border-line pb-1 pl-[22px]">
        {b.items.filter((i): i is Extract<FeedItem, { kind: 'say' }> => i.kind === 'say').map((it) => <Said key={it.key} text={it.text} />)}
        {live && <Process items={b.items} />}
      </div>
    </section>
  );
}

/** the last line of the conversation while something is being made: who is doing what, right now, for how long */
function LiveLine({ run }: { run: RunView }) {
  useT();
  const now = useNow(true);
  // several pages at once: one steady line for all of them; each page's own moment is on its row in the list
  const busy = run.current === 'pages' ? run.pageOrder.filter((id) => ['drawing', 'checking'].includes(run.pages[id]?.status)) : [];
  if (busy.length > 1) {
    const since = run.stages.pages.startedAt;
    const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
    return (
      <div className="flex items-center gap-2.5" role="status">
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-accent/40 motion-safe:animate-halo" />
          <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-paper ring-1 ring-accent/50"><Crest size={11} /></span>
        </span>
        <span className="fs-shimmer min-w-0 truncate text-[13px]">{t('conversation.live.pagesAtOnce', { n: busy.length })}…</span>
        {secs > 2 && <span className="shrink-0 text-[12px] text-ink-3 tabular">{secs < 60 ? t('conversation.live.sec', { n: secs }) : clock(secs * 1000)}</span>}
      </div>
    );
  }
  const a = run.activity;
  // thinking that has gone quiet, with nothing done yet: the model is writing an answer it hands over only when whole
  const writing = !!a?.updated && !!a.thinking && now - a.updated > 4000;
  const writingText = a?.page ? t('run.now.who', { page: pageName(a.page), doing: t('run.now.writingPicture') }) : t('run.now.writing');
  const text = writing ? writingText : a?.text ?? (run.revising ? t('conversation.plan.looking') : run.current ? stageDoing(run.current) : t('conversation.live.preparing'));
  const since = writing ? a!.updated : a?.at ?? run.revising ?? (run.current ? run.stages[run.current].startedAt : undefined);
  const secs = since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
  return (
    <div className="flex items-start gap-2.5 animate-fade" role="status">
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-accent/40 motion-safe:animate-halo" />
        <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-paper ring-1 ring-accent/50"><Crest size={11} /></span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2.5">
          <span className="fs-shimmer min-w-0 truncate text-[13px]">{text}…</span>
          {secs > 2 && <span className="shrink-0 text-[12px] text-ink-3 tabular">{secs < 60 ? t('conversation.live.sec', { n: secs }) : clock(secs * 1000)}</span>}
        </span>
        {/* the line it is writing right now, so a long write is seen growing */}
        {(writing || a?.writing) && !a?.detail && secs > 8 && <span className="mt-0.5 block text-[11.5px] text-ink-3">{t('conversation.live.wholeAnswer')}</span>}
        {a?.detail && <code key={a.detail} className="mt-1 block truncate font-mono text-[11.5px] leading-5 text-ink-3 animate-fade">{a.detail}</code>}
      </span>
    </div>
  );
}

function Chapter({ b, run, project, onSelectPage, onPlayPage, selected }: { b: Extract<Block, { kind: 'chapter' }>; run: RunView; project: ProjectView; onSelectPage: (id: string) => void; onPlayPage: (id: string) => void; selected?: string }) {
  useT();
  const live = run.stages[b.stage];
  const st = b.latest ? live : { ...live, status: 'done' as const, startedAt: undefined, endedAt: undefined };
  const n = shownStages(run).indexOf(b.stage) + 1;
  const now = useNow(st.status === 'running');
  const took = st.startedAt ? clock((st.endedAt ?? now) - st.startedAt) : undefined;
  const statusText = st.status === 'running' ? `${stageDoing(b.stage)} · ${took}` : st.status === 'done' ? [took, humanDetail(b.stage, st.detail, run.storyboard)].filter(Boolean).join(' · ') : st.status === 'skipped' ? t('conversation.chapter.skipped') : st.status === 'stopped' ? t('conversation.chapter.stopped') : st.status === 'failed' ? t('conversation.chapter.failed') : '';
  const approvals = b.items.filter((i) => i.kind === 'approval');
  return (
    <section aria-label={t('conversation.chapter.aria', { n, stage: STAGE_NAME[b.stage] })} className="relative">
      <header className="flex items-center gap-2.5">
        <StageMark n={n} status={st.status} />
        <h3 className="text-[13.5px] font-semibold text-ink">{STAGE_NAME[b.stage]}</h3>
        <span className={`truncate text-[12.5px] ${st.status === 'running' ? 'text-accent-ink' : 'text-ink-3'}`}>{statusText}</span>
      </header>
      <div className="ml-2.5 mt-2.5 space-y-3 border-l border-line pb-1 pl-[22px]">
        {b.items.map((it) => {
          if (it.kind === 'say') return <Said key={it.key} text={it.text} />;
          if (it.kind === 'note') return <p key={it.key} className="text-[13px] leading-relaxed text-ink-2 animate-rise">{it.text}</p>;
          if (it.kind === 'kit') return <KitLine key={it.key} run={run} />;
          if (it.kind === 'check') return it.reds + it.yellows === 0
            ? <p key={it.key} className="flex items-center gap-1.5 text-[12.5px] text-jade"><Check size={13} aria-hidden /> {t('conversation.chapter.checkPassed')}</p>
            : <p key={it.key} className="text-[12.5px] leading-relaxed text-ink-3">{t('conversation.chapter.checkIssues', { reds: it.reds, yellows: it.yellows })}</p>;
          if (it.kind === 'approval') return <Approval key={it.key} sb={it.storyboard} project={project} run={run} active={run.awaitingApproval && approvals.at(-1) === it} />;
          if (it.kind === 'pages' && !b.latest) return <p key={it.key} className="text-[12.5px] text-ink-3">{t('conversation.chapter.pagesDone', { n: run.pageOrder.length })}</p>;
          if (it.kind === 'pages') return <Pages key={it.key} run={run} onSelect={onSelectPage} onPlay={onPlayPage} selected={selected} />;
          if (it.kind === 'error') return <p key={it.key} className="flex items-start gap-1.5 text-[12.5px] leading-relaxed text-seal"><TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />{it.message}</p>;
          return null;
        })}
        {/* the steps are worth seeing while they happen, or when they went wrong; once the stage has its result
            (a storyboard to confirm, pages drawn) they say nothing the result does not */}
        {(st.status === 'running' || st.status === 'failed') && !approvals.length && <Process items={b.items} />}
      </div>
    </section>
  );
}

const ESTIMATE: Record<Stage, (pages: number) => number> = { research: () => 300, storyboard: () => 100, script: () => 80, narrate: () => 20, pages: (n) => Math.ceil(Math.max(n, 1) / 10) * 240, review: () => 60, render: () => 120 };

/** the line above the composer: what is happening now, how long it has taken, about how long is left */
function NowBar({ run, project }: { run: RunView; project: ProjectView }) {
  const spent = useSpent(project.id, run);
  useT();
  const running = isWorking(run);
  const now = useNow(running);
  const todo = run.pageOrder.filter((id) => !['ok', 'flagged', 'failed'].includes(run.pages[id]?.status ?? 'queued')).length;
  const pages = finished(run) ? Math.max(todo, 1) : run.pageOrder.length || run.storyboard?.pages.length || 5;
  let left = 0;
  if (running && run.current && !run.exporting) {
    const i = STAGES.indexOf(run.current!);
    const cur = run.stages[run.current!];
    left = Math.max(30, ESTIMATE[run.current!](pages) - (cur.startedAt ? (now - cur.startedAt) / 1000 : 0)) + STAGES.slice(i + 1).reduce((a, s) => a + ESTIMATE[s](pages), 0);
  }
  const busyPage = run.pageOrder.find((id) => run.pages[id]?.status === 'checking' || run.pages[id]?.status === 'drawing');
  const busyCount = run.pageOrder.filter((id) => run.pages[id]?.status === 'checking' || run.pages[id]?.status === 'drawing').length;
  if (running && !run.current) left = 0;
  const seconds = Math.round(run.ready?.duration ?? run.video?.duration ?? 0);
  const text = run.revising ? t('conversation.bar.revising')
    : run.exporting ? t('conversation.bar.exporting')
    : run.resuming ? t('conversation.live.preparing')
    : finished(run) && !running ? t('conversation.bar.ready', { secs: seconds, stale: !!run.stale })
    : run.awaitingApproval ? t('conversation.bar.awaiting')
    : run.paused ? t('conversation.bar.paused')
    : running && run.current === 'pages' && busyCount > 1 ? t('conversation.live.pagesAtOnce', { n: busyCount })
    : running ? `${stageDoing(run.current!)}${run.current === 'pages' && busyPage ? t('conversation.bar.busyPage', { page: pageName(busyPage), checking: run.pages[busyPage].status === 'checking' }) : ''}`
    : t('conversation.bar.idle');
  return (
    <div className="flex items-center gap-2.5 px-5 py-2.5 text-[12.5px]" aria-live="polite">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'animate-breathe bg-accent' : run.awaitingApproval ? 'bg-accent' : finished(run) ? 'bg-jade' : 'bg-line-2'}`} aria-hidden />
      <span className={`min-w-0 flex-1 truncate ${run.awaitingApproval ? 'text-accent-ink' : 'text-ink-2'}`}>{text}</span>
      {running && left > 0 && <span className="shrink-0 text-ink-3 tabular">{t('conversation.bar.left', { min: left < 90 ? 1 : Math.round(left / 60) })}</span>}
      {hosted ? <FilmCredits project={project.id} run={run} /> : spent && <span className="shrink-0 font-mono text-ink-3 tabular" title={t('conversation.bar.spent')}>{spent}</span>}
    </div>
  );
}

export function Conversation({ run, project, onSelectPage, onPlayPage, selected, onPlay, openSettings }: { run: RunView; project: ProjectView; onSelectPage: (id: string) => void; onPlayPage: (id: string) => void; selected?: string; onPlay: () => void; openSettings?: (section?: string) => void }) {
  const { locale } = useT();
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [run.feed.length, run.pages, run.stages, run.activity, run.revising]);
  const list = useMemo(() => blocks(run.feed), [run.feed]);
  const lastPaused = [...run.feed].reverse().find((f) => f.kind === 'paused');
  // the page open on the workbench, offered to the composer as a one-click reference
  const viewing = useMemo<Ref | undefined>(() => {
    if (!selected) return undefined;
    const ids = run.pageOrder.length ? run.pageOrder : run.storyboard?.pages.map((x) => x.id) || [];
    const n = ids.indexOf(selected) + 1, sec = run.storyboard?.pages.find((x) => x.id === selected)?.section;
    const thumb = run.pages[selected]?.thumb;
    return n ? { kind: 'page', page: selected, label: t('conversation.request.pageRef', { n, section: sec }), thumb: thumb ? relPath(thumb, project.id) : undefined } : undefined;
  }, [selected, run.pageOrder, run.storyboard, run.pages[selected ?? '']?.thumb, locale]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <div className="space-y-6">
          {/* the user's request opens the conversation, on the user's side */}
          <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-accent-soft/70 px-4 py-3 ring-1 ring-accent/15">
            <p className="text-[13.5px] leading-relaxed text-ink">{project.topic || project.notes || t('conversation.request.fallback')}</p>
            <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-ink-2">
              {project.materials.filter((m) => !/\.(md)$/.test(m) || !project.materials.some((o) => o !== m && o.startsWith(m.replace(/\.md$/, '')))).map((m) => <span key={m} className="max-w-[200px] truncate" title={m}>{m}</span>)}
              <span>{t('conversation.request.minutes', { n: Math.round(project.durationSec / 60) })}</span>
              <span>{STYLE_NAME[project.style] ?? project.style}</span>
              {(run.voice ?? project.voice)?.name && <span>{t('conversation.request.voice', { name: (run.voice ?? project.voice)!.name! })}</span>}
            </p>
          </div>
          {list.map((b) => {
            if (b.kind === 'work') return <WorkChapter key={b.key} b={b} live={!!run.revising && b === list.filter((x) => x.kind === 'work').at(-1)} />;
            if (b.kind === 'chapter') return <Chapter key={b.key} b={b} run={run} project={project} onSelectPage={onSelectPage} onPlayPage={onPlayPage} selected={selected} />;
            const it = b.item;
            if (it.kind === 'user') return (
              <div key={it.key} className="ml-auto flex w-fit max-w-[88%] flex-col items-end gap-1.5 animate-rise">
                {!!it.refs?.length && <div className="flex flex-wrap justify-end gap-1.5">{it.refs.map((r, j) => <RefChip key={j} r={r} project={project} />)}</div>}
                {it.text && <p className="whitespace-pre-wrap rounded-2xl rounded-tr-md bg-accent-soft/70 px-4 py-2.5 text-[13.5px] leading-relaxed text-ink ring-1 ring-accent/15">{it.text}</p>}
              </div>
            );
            if (it.kind === 'paused') return it === lastPaused && run.paused
              ? <PausedCard key={it.key} item={it} run={run} project={project} latest />
              : <p key={it.key} className="flex items-center gap-2 text-[12.5px] text-ink-3"><Pause size={13} aria-hidden />{t('conversation.paused.once', { error: it.reason === 'error', stage: it.stage ? STAGE_NAME[it.stage] : undefined })}</p>;
            if (it.kind === 'done' || it.kind === 'ready') return run.feed.filter((f) => f.kind === 'done' || f.kind === 'ready').at(-1) === it ? <DoneCard key={it.key} run={run} project={project} onPlay={onPlay} /> : null;
            if (it.kind === 'export') return <ExportLine key={it.key} it={it} project={project} />;
            if (it.kind === 'note') return <p key={it.key} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-2"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper ring-1 ring-line"><Crest size={11} /></span>{it.text}</p>;
            return null;
          })}
          {isWorking(run) && <LiveLine run={run} />}
        </div>
      </div>
      <div className="border-t border-line bg-paper-2">
        <ShortNotice project={project.id} run={run} />
        <NowBar run={run} project={project} />
        <Composer run={run} project={project} viewing={viewing} openSettings={openSettings} />
      </div>
    </div>
  );
}
