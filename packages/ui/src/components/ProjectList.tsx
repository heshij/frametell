import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, CheckSquare, Folder, FolderInput, FolderPlus, Loader2, MoreHorizontal, Play, Square, Trash2, X } from 'lucide-react';
import { client, type ProjectView, type StyleInfo } from '../lib/client';
import { go } from '../lib/hooks';
import { STAGE_NAME, type Stage } from '../lib/run';
import { STYLE_SWATCH } from '../lib/styles';
import { track } from '../lib/track';
import { intlTag, t } from '../i18n';

// The videos on the home page: filed under groups (a tab for each, the group a project names), each row with a menu to
// move it or delete it, and a way to pick several and do either to all of them at once.

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return t('home.justNow'); if (d < 3600) return t('home.minutesAgo', { n: Math.floor(d / 60) }); if (d < 86400) return t('home.hoursAgo', { n: Math.floor(d / 3600) });
  return new Date(iso).toLocaleDateString(intlTag(), { month: 'long', day: 'numeric' });
}

/** what a project row says and the one thing you can do with it */
function rowState(p: ProjectView): { label: string; tone: string; action?: { text: string; icon: React.ReactNode; run?: () => Promise<void> } } {
  const at = p.stage && p.stage in STAGE_NAME ? t('home.stoppedAt', { stage: STAGE_NAME[p.stage as Stage] }) : '';
  switch (p.status) {
    case 'done': return { label: t('home.status.done'), tone: 'text-jade', action: { text: t('home.action.watch'), icon: <Play size={13} aria-hidden /> } };
    case 'awaiting_approval': return { label: t('home.status.awaiting'), tone: 'text-accent-ink', action: { text: t('home.action.review'), icon: <ArrowRight size={13} aria-hidden /> } };
    case 'running': return { label: t('home.status.running'), tone: 'text-accent-ink', action: { text: t('home.action.progress'), icon: <ArrowRight size={13} aria-hidden /> } };
    case 'stopped': return { label: at ? t('home.status.pausedAt', { at }) : t('home.status.paused'), tone: 'text-ink-2', action: { text: t('home.action.resume'), icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
    case 'failed': return { label: at ? t('home.status.failedAt', { at }) : t('home.status.failed'), tone: 'text-seal', action: { text: t('home.action.resume'), icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
    default: return { label: t('home.status.idle'), tone: 'text-ink-3', action: { text: t('home.action.start'), icon: <Play size={13} aria-hidden />, run: () => client.start(p.id) } };
  }
}

const ALL = '*', NONE = '';
const TAB_KEY = 'frametell.home.group';
const readTab = () => { try { return localStorage.getItem(TAB_KEY) ?? ALL; } catch { return ALL; } };
const saveTab = (g: string) => { try { localStorage.setItem(TAB_KEY, g); } catch {} };

/** a small menu under its button: opens on its first item, arrows move through it, a click outside or Escape closes it
 *  (Escape gives the focus back to the button) */
function Popover({ open, onClose, align = 'right', children }: { open: boolean; onClose: () => void; align?: 'left' | 'right'; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const items = () => [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled), input') ?? [])];
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => items()[0]?.focus());
    const away = (e: MouseEvent) => { if (!root.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      root.current?.parentElement?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      onClose();
    };
    addEventListener('mousedown', away); addEventListener('keydown', esc);
    return () => { removeEventListener('mousedown', away); removeEventListener('keydown', esc); };
  }, [open]);
  const arrows = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = items(), at = all.indexOf(document.activeElement as HTMLElement);
    all[(at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  if (!open) return null;
  return (
    <div ref={root} role="menu" onKeyDown={arrows} className={`absolute top-[calc(100%+4px)] z-30 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35),0_2px_6px_rgb(0_0_0/0.12)] animate-pop [transform-origin:top] ${align === 'right' ? 'right-0' : 'left-0'}`}>
      {children}
    </div>
  );
}

const item = 'flex w-full items-center gap-2 px-3 py-[7px] text-left text-[13px] text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40';

/** the groups to move to, the way out of the one it is in, and a new one typed in place */
function MoveTo({ groups, current, canTakeOut, onPick }: { groups: string[]; current?: string; canTakeOut: boolean; onPick: (g: string) => void }) {
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState('');
  const commit = () => { const g = name.trim(); if (g) onPick(g); };
  return (
    <>
      <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-ink-3">{t('home.groups.moveTo')}</p>
      {groups.map((g) => (
        <button key={g} type="button" role="menuitemradio" aria-checked={g === current} className={`${item} ${g === current ? '!text-accent-ink' : ''}`} onClick={() => onPick(g)}>
          <Folder size={13} aria-hidden /><span className="min-w-0 flex-1 truncate">{g}</span>{g === current && <Check size={13} aria-hidden />}
        </button>
      ))}
      {canTakeOut && (
        <button type="button" role="menuitem" className={item} onClick={() => onPick(NONE)}><X size={13} aria-hidden />{t('home.groups.takeOut')}</button>
      )}
      {typing ? (
        <form className="flex items-center gap-1.5 px-2 py-1" onSubmit={(e) => { e.preventDefault(); commit(); }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('home.groups.nameHint')}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 text-[12.5px] text-ink outline-none focus:border-accent" />
          <button type="submit" className="fs-btn fs-btn-secondary fs-btn-sm" disabled={!name.trim()}>{t('home.groups.ok')}</button>
        </form>
      ) : (
        <button type="button" role="menuitem" className={item} onClick={() => setTyping(true)}><FolderPlus size={13} aria-hidden />{t('home.groups.new')}</button>
      )}
    </>
  );
}

export function ProjectList({ projects, loading, styles, reload }: { projects?: ProjectView[]; loading: boolean; styles?: StyleInfo[]; reload: () => void }) {
  const canGroup = !!client.moveProject;
  const all = projects || [];
  const groups = useMemo(() => [...new Set(all.map((p) => p.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b, intlTag())), [all]);
  const [tab, setTabState] = useState(readTab);
  const setTab = (g: string) => { setTabState(g); saveTab(g); };
  // a tab whose last film moved away or was deleted falls back to all
  const shownTab = !canGroup || (tab !== ALL && tab !== NONE && !groups.includes(tab)) || (tab === NONE && !groups.length) ? ALL : tab;
  const list = shownTab === ALL ? all : all.filter((p) => (p.group ?? NONE) === shownTab);

  const [menu, setMenu] = useState<string>();
  // the row asking to be deleted, and what went wrong deleting it
  const [removing, setRemoving] = useState<{ id: string; busy?: boolean; error?: string }>();
  // picking several: their ids, and whether deleting them is being asked / done
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ ask?: boolean; busy?: boolean; error?: string; move?: boolean }>({});
  const pickable = list.filter((p) => p.status !== 'running');
  const chosen = pickable.filter((p) => picked.has(p.id));
  const stopPicking = () => { setPicking(false); setPicked(new Set()); setBulk({}); };
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const remove = async (id: string) => {
    setRemoving({ id, busy: true });
    try { await client.deleteProject(id); track('film-delete', { project: id }); setRemoving(undefined); reload(); }
    catch (e) { setRemoving({ id, error: (e as Error).message }); }
  };
  const move = async (ids: string[], g: string) => {
    setMenu(undefined);
    try { await Promise.all(ids.map((id) => client.moveProject!(id, g))); }
    catch (e) { setBulk((b) => ({ ...b, error: (e as Error).message })); }
    reload();
  };
  const removeMany = async () => {
    setBulk({ ask: true, busy: true });
    const failed: string[] = [];
    for (const p of chosen) { try { await client.deleteProject(p.id); track('film-delete', { project: p.id, many: true }); } catch (e) { failed.push(`${p.title}: ${(e as Error).message}`); } }
    reload();
    if (failed.length) setBulk({ error: failed.join('\n') }); else stopPicking();
  };

  const count = (g: string) => (g === ALL ? all.length : all.filter((p) => (p.group ?? NONE) === g).length);
  const tabs = canGroup && groups.length ? [ALL, ...groups, ...(all.some((p) => !p.group) ? [NONE] : [])] : [];

  return (
    <section aria-labelledby="recent" className="mt-14">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="recent" className="text-[13px] font-semibold text-ink-2">{t('home.recent')}</h2>
        {all.length > 0 && (picking ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12.5px] text-ink-3 tabular">{t('home.groups.picked', { n: chosen.length })}</span>
            <button type="button" className="fs-btn fs-btn-sm fs-btn-ghost" onClick={() => setPicked(chosen.length === pickable.length ? new Set() : new Set(pickable.map((p) => p.id)))}>
              {chosen.length === pickable.length && pickable.length ? t('home.groups.pickNone') : t('home.groups.pickAll')}
            </button>
            {canGroup && (
              <span className="relative">
                <button type="button" className="fs-btn fs-btn-sm fs-btn-secondary" disabled={!chosen.length} aria-haspopup="menu" aria-expanded={!!bulk.move} onClick={() => setBulk((b) => ({ ...b, move: !b.move }))}>
                  <FolderInput size={13} aria-hidden />{t('home.groups.move')}
                </button>
                <Popover open={!!bulk.move} onClose={() => setBulk((b) => ({ ...b, move: false }))}>
                  <MoveTo groups={groups} current={chosen.length && chosen.every((p) => p.group === chosen[0].group) ? chosen[0].group : undefined} canTakeOut={chosen.some((p) => p.group)} onPick={(g) => { setBulk({}); void move(chosen.map((p) => p.id), g).then(stopPicking); }} />
                </Popover>
              </span>
            )}
            <button type="button" className="fs-btn fs-btn-sm fs-btn-secondary text-seal disabled:opacity-40" disabled={!chosen.length || bulk.ask} onClick={() => setBulk({ ask: true })}>
              <Trash2 size={13} aria-hidden />{t('home.deleteVideo.confirm')}
            </button>
            <button type="button" className="fs-btn fs-btn-sm fs-btn-ghost" onClick={stopPicking}>{t('home.deleteVideo.cancel')}</button>
          </div>
        ) : (
          <button type="button" className="-mr-1 inline-flex items-center gap-1 rounded-md px-1 text-[12px] text-ink-3 transition-colors hover:text-ink" onClick={() => { setPicking(true); setRemoving(undefined); }}>
            <CheckSquare size={13} aria-hidden />{t('home.groups.pick')}
          </button>
        ))}
      </div>

      {tabs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('home.groups.label')}>
          {tabs.map((g) => (
            <button key={g || '-'} type="button" role="radio" aria-checked={shownTab === g} className="fs-chip" onClick={() => { setTab(g); setPicked(new Set()); }}>
              {g !== ALL && g !== NONE && <Folder size={12} aria-hidden />}
              <span className="max-w-[160px] truncate">{g === ALL ? t('home.groups.all') : g === NONE ? t('home.groups.none') : g}</span>
              <span className="tabular opacity-60">{count(g)}</span>
            </button>
          ))}
        </div>
      )}

      {picking && bulk.ask && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-seal/30 bg-seal/[0.06] px-4 py-3" role="alertdialog" aria-label={t('home.groups.askMany', { n: chosen.length })}>
          <span className="text-[12.5px] text-ink-2">{t('home.groups.askMany', { n: chosen.length })}</span>
          <span className="flex gap-1.5">
            <button type="button" className="fs-btn fs-btn-sm fs-btn-ghost" onClick={() => setBulk({})} autoFocus>{t('home.deleteVideo.cancel')}</button>
            <button type="button" className="fs-btn fs-btn-sm bg-seal text-white hover:brightness-105" disabled={bulk.busy} onClick={() => void removeMany()}>
              {bulk.busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Trash2 size={13} aria-hidden />}{t('home.groups.deleteMany', { n: chosen.length })}
            </button>
          </span>
        </div>
      )}
      {bulk.error && <p className="mt-3 whitespace-pre-line text-[12.5px] text-seal" role="alert">{bulk.error}</p>}

      {loading && !projects ? (
        <div className="mt-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-ink/[0.05]" />)}</div>
      ) : all.length === 0 ? (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{t('home.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {list.map((p) => {
            const st = rowState(p);
            if (removing?.id === p.id) return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{p.title}</span>
                  <span className={`mt-0.5 block text-[12px] ${removing.error ? 'text-seal' : 'text-ink-2'}`} role={removing.error ? 'alert' : undefined}>{removing.error || t('home.deleteVideo.ask')}</span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <button className="fs-btn fs-btn-sm fs-btn-ghost" onClick={() => setRemoving(undefined)} autoFocus>{t('home.deleteVideo.cancel')}</button>
                  {!removing.error && <button className="fs-btn fs-btn-sm bg-seal text-white hover:brightness-105" disabled={removing.busy} onClick={() => remove(p.id)}>
                    {removing.busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Trash2 size={13} aria-hidden />}{t('home.deleteVideo.confirm')}
                  </button>}
                </span>
              </li>
            );
            const swatch = (STYLE_SWATCH[p.style] || styles?.find((x) => x.id === p.style)?.swatch || STYLE_SWATCH.study).slice(0, 3);
            const running = p.status === 'running';
            const meta = (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink group-hover:underline group-hover:underline-offset-4">{p.title}</span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                  {t('home.about', { n: Math.round(p.durationSec / 60) })} · {ago(p.updatedAt)} · <span className={st.tone}>{st.label}</span>
                  {p.group && shownTab === ALL && <span className="ml-1.5 inline-flex items-center gap-1 align-[-1px]"><Folder size={11} aria-hidden />{p.group}</span>}
                </span>
              </span>
            );
            if (picking) return (
              <li key={p.id}>
                <label className={`flex items-center gap-4 py-3.5 ${running ? 'opacity-50' : 'cursor-pointer'}`} title={running ? t('home.groups.runningNoPick') : undefined}>
                  <input type="checkbox" className="sr-only" checked={picked.has(p.id)} disabled={running} onChange={() => toggle(p.id)} aria-label={p.title} />
                  {picked.has(p.id) ? <CheckSquare size={16} className="shrink-0 text-accent-ink" aria-hidden /> : <Square size={16} className="shrink-0 text-ink-3" aria-hidden />}
                  {meta}
                </label>
              </li>
            );
            return (
              <li key={p.id} className="group/row flex items-center gap-4 py-3.5">
                <a href={`#/p/${p.id}`} className="group flex min-w-0 flex-1 items-center gap-4 rounded-lg">
                  <span className="flex -space-x-1" aria-hidden>{swatch.map((c) => <span key={c} className="h-3.5 w-3.5 rounded-full ring-1 ring-black/15" style={{ background: c }} />)}</span>
                  {meta}
                </a>
                {st.action && (
                  <button className={`fs-btn fs-btn-sm shrink-0 ${st.action.run ? 'fs-btn-secondary' : 'fs-btn-ghost'}`}
                    onClick={async () => { await st.action!.run?.(); go(`#/p/${p.id}`); }}>
                    {st.action.icon}{st.action.text}
                  </button>
                )}
                <span className="relative -ml-2 shrink-0">
                  <button type="button" className="fs-icon-btn" aria-label={t('home.groups.more', { title: p.title })} aria-haspopup="menu" aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? undefined : p.id)}>
                    <MoreHorizontal size={15} aria-hidden />
                  </button>
                  <Popover open={menu === p.id} onClose={() => setMenu(undefined)}>
                    {canGroup && <><MoveTo groups={groups} current={p.group} canTakeOut={!!p.group} onPick={(g) => void move([p.id], g)} /><div className="my-1 border-t border-line" /></>}
                    {/* a film being made is stopped first: it offers no delete */}
                    <button type="button" role="menuitem" className={`${item} hover:!text-seal`} disabled={running} title={running ? t('home.groups.runningNoPick') : undefined}
                      onClick={() => { setMenu(undefined); setRemoving({ id: p.id }); }}>
                      <Trash2 size={13} aria-hidden />{t('home.deleteVideo.confirm')}
                    </button>
                  </Popover>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
