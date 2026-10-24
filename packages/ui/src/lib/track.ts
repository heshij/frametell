// What the person does in the workbench, for a hosted service that wants to know (Hosted.track): a film opened, its
// preview played, an export asked for, a change sent, the tab left while the film was being made. A name and a few
// small fields, never what was typed. Without a hosted service (the open-source app, the desktop app) nothing is
// sent anywhere: `hosted.track` is absent and every call here does nothing.
// Kept out of React state: a call never re-renders anything.
import { hosted } from './client';

export type TrackProps = Record<string, string | number | boolean | undefined>;

/** one thing done in the workbench; never throws (a host's failure is not the panel's) */
export function track(name: string, props: TrackProps = {}) {
  if (!hosted?.track) return;
  const kept: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined) kept[k] = v;
  try { hosted.track(name, kept); } catch { /* nothing to do */ }
}

// "once per open": what has been sent since the film's workbench last opened (the preview's first play, its 25/50/100 %)
const sent = new Set<string>();
/** `name` for this film, the first time `key` comes up since its workbench opened */
export function trackOnce(project: string, key: string, name: string, props: TrackProps = {}) {
  const k = `${project}\n${key}`;
  if (sent.has(k)) return;
  sent.add(k);
  track(name, { project, ...props });
}
/** the film's workbench opened (again): its once-per-open events may go again */
export function openedFilm(project: string) {
  for (const k of sent) if (k.startsWith(`${project}\n`)) sent.delete(k);
}

/** the milestones a play has reached, of 25, 50 and 100 %: the last is counted a moment before the very end (a player
 *  stops a frame or two short of it) */
export const milestones = (t: number, duration: number): (25 | 50 | 100)[] => {
  if (!(duration > 0) || !(t > 0)) return [];
  const f = t / duration;
  return ([[0.25, 25], [0.5, 50], [0.97, 100]] as const).filter(([at]) => f >= at).map(([, pct]) => pct);
};
