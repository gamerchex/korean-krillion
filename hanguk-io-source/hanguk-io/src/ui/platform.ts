// Where data lives. Three environments, decided at runtime and never pretended:
//
//   artifact  - published on claude.ai: the page's runtime capabilities (db, user, sample,
//               downloads) give a private per-viewer profile, a shared leaderboard and a
//               shared review queue for everyone who can open the page.
//   server    - served by the Node reference server (server/): see serverApi.ts.
//   local     - any other copy: localStorage only, no leaderboard.
//
// Every capability is optional: `claude.use()` may resolve null, calls may reject, and the
// UI degrades feature by feature.

import { mergeProfiles, coerceProfile, type Profile } from '../core/profile';
import { pruneRuns, type BoardDoc, type BoardRun } from '../core/leaderboard';

type AnyFn = (...args: any[]) => any;
interface ClaudeRuntime {
  use(name: string): Promise<any>;
}

function runtime(): ClaudeRuntime | null {
  try {
    const c = (globalThis as any).claude;
    return c && typeof c.use === 'function' ? (c as ClaudeRuntime) : null;
  } catch {
    return null;
  }
}

async function use<T = any>(name: string): Promise<T | null> {
  const rt = runtime();
  if (!rt) return null;
  try {
    return (await rt.use(name)) as T | null;
  } catch {
    return null;
  }
}

export interface Platform {
  kind: 'artifact' | 'local';
  db: any | null;
  user: any | null;
  sample: (AnyFn & { json?: AnyFn }) | null;
  downloads: { save(req: { filename: string; data: Blob | string }): Promise<{ status: string }> } | null;
  uid: string | null;
  isOwner: boolean;
  canEdit: boolean;
  /** null = the platform said nothing; try and let a refused write decide. */
  canWriteShared: boolean | null;
}

export const LOCAL_PLATFORM: Platform = {
  kind: 'local',
  db: null,
  user: null,
  sample: null,
  downloads: null,
  uid: null,
  isOwner: false,
  canEdit: false,
  canWriteShared: false,
};

export function hasRuntime(): boolean {
  return runtime() !== null;
}

/** Resolve the artifact runtime's capabilities (null-safe; resolves within ~10 s). */
export async function initPlatform(): Promise<Platform> {
  if (!runtime()) return LOCAL_PLATFORM;
  const [db, user, sample, downloads] = await Promise.all([use('db'), use('user'), use('sample'), use('downloads')]);
  let uid: string | null = null;
  let isOwner = false;
  let canEdit = false;
  let canWriteShared: boolean | null = null;
  if (user) {
    try {
      [uid, isOwner, canEdit, canWriteShared] = await Promise.all([
        user.id(),
        user.isOwner(),
        user.canEdit(),
        user.can('data.write'),
      ]);
    } catch {
      /* reads never reject by contract; keep defaults */
    }
  }
  return { kind: db || user ? 'artifact' : 'local', db, user, sample, downloads, uid, isOwner, canEdit, canWriteShared };
}

// --- Permissions (built in; asking happens only on a viewer's click) --------------------

export type PermissionState = 'granted' | 'prompt' | 'denied' | 'unavailable';

export async function permissionState(name: string): Promise<PermissionState> {
  const perms = await use<{ state(n: string): Promise<PermissionState> }>('permissions');
  if (!perms) return 'unavailable';
  try {
    return await perms.state(name);
  } catch {
    return 'unavailable';
  }
}

/** Ask for one capability (call from a click). Resolves the state after the dialog. */
export async function requestPermission(name: string): Promise<PermissionState> {
  const perms = await use<{ request(n: string[]): Promise<Record<string, PermissionState>> }>('permissions');
  if (!perms) return 'unavailable';
  try {
    return (await perms.request([name]))[name] ?? 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Open the platform's Permissions panel (call from a click). */
export async function managePermissions(): Promise<boolean> {
  const perms = await use<{ manage(): Promise<void> }>('permissions');
  if (!perms) return false;
  try {
    await perms.manage();
    return true;
  } catch {
    return false;
  }
}

// --- Local storage (per-viewer convenience; may be unavailable) -----------------------

const LOCAL_KEY = 'hanguk.profile.v1';
let memoryFallback: string | null = null;

export function localAvailable(): boolean {
  try {
    const k = '__hanguk_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function loadLocalProfile(now: number): Profile {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LOCAL_KEY);
  } catch {
    raw = memoryFallback;
  }
  if (!raw) return coerceProfile(null, now);
  try {
    return coerceProfile(JSON.parse(raw), now);
  } catch {
    return coerceProfile(null, now);
  }
}

export function saveLocalProfile(p: Profile): void {
  const json = JSON.stringify(p);
  try {
    localStorage.setItem(LOCAL_KEY, json);
  } catch {
    memoryFallback = json;
  }
}

export function clearLocalProfile(): void {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    memoryFallback = null;
  }
}

/** Keep a stored profile under the per-document limit by trimming old answer details. */
export function compactProfile(p: Profile, maxBytes = 200_000): Profile {
  let out = p;
  const size = () => new Blob([JSON.stringify(out)]).size;
  if (size() <= maxBytes) return out;
  const keys = Object.keys(out.dailies).sort();
  const dailies = { ...out.dailies };
  for (const k of keys.slice(0, Math.max(0, keys.length - 60))) {
    const s = dailies[k];
    dailies[k] = { ...s, answers: s.answers.map((a) => ({ ...a, input: '' })) };
  }
  out = { ...out, dailies, practice: { ...out.practice, recent: out.practice.recent.slice(0, 5) } };
  if (size() <= maxBytes) return out;
  const archive: Profile['archive'] = {};
  for (const [k, v] of Object.entries(out.archive).sort().slice(-60)) archive[k] = v;
  return { ...out, archive };
}

// --- Private cloud profile (artifact db, data/users/<uid>/profile) ----------------------

export async function loadCloudProfile(pf: Platform, now: number): Promise<Profile | null> {
  if (!pf.db || !pf.uid) return null;
  try {
    const snap = await pf.db.doc(`data/users/${pf.uid}/profile`).get();
    if (!snap.exists) return null;
    const body = snap.data() as { json?: string } | undefined;
    return body?.json ? coerceProfile(JSON.parse(body.json), now) : null;
  } catch {
    return null;
  }
}

let cloudWrite: Promise<unknown> = Promise.resolve();
let cloudPending: Profile | null = null;

/** Save the private profile copy; writes are serialized and coalesced (one at a time per doc). */
export function saveCloudProfile(pf: Platform, p: Profile): void {
  if (!pf.db || !pf.uid) return;
  const first = cloudPending === null;
  cloudPending = p;
  if (!first) return;
  cloudWrite = cloudWrite.then(async () => {
    const next = cloudPending;
    cloudPending = null;
    if (!next) return;
    try {
      const body = { json: JSON.stringify(compactProfile({ ...next, inProgress: next.inProgress })), updatedAt: next.updatedAt };
      await pf.db.doc(`data/users/${pf.uid}/profile`).set(body);
    } catch {
      /* private writes can be refused for view-only members: local copy still holds */
    }
  });
}

export function mergeLoaded(local: Profile, cloud: Profile | null): Profile {
  return cloud ? mergeProfiles(local, cloud) : local;
}

// --- Shared leaderboard (board/<uid>) -------------------------------------------------

export async function loadBoards(pf: Platform): Promise<Map<string, BoardDoc> | null> {
  if (!pf.db) return null;
  try {
    const snap = await pf.db.collection('board').limit(1000).get();
    const map = new Map<string, BoardDoc>();
    for (const d of snap.docs) {
      const data = d.data() as BoardDoc | undefined;
      if (data && typeof data === 'object' && data.runs) map.set(d.id, sanitizeBoard(data));
    }
    return map;
  } catch {
    return null;
  }
}

/** Board documents are written by other players: treat every field as untrusted. */
function sanitizeBoard(d: BoardDoc): BoardDoc {
  const name = typeof d.name === 'string' ? d.name.slice(0, 32) : '';
  const runs: Record<string, BoardRun> = {};
  for (const [k, r] of Object.entries(d.runs ?? {})) {
    if (!/^daily-\d{4}-\d{2}-\d{2}$/.test(k) || !r || typeof r !== 'object') continue;
    const s = Number(r.s);
    if (!Number.isFinite(s) || s < 0 || s > 700) continue;
    runs[k] = {
      s: Math.round(s),
      d: Math.round(s * 10),
      a: Array.isArray(r.a) ? r.a.slice(0, 7).map((x) => (typeof x === 'string' ? x.slice(0, 80) : null)) : [],
      t: Number(r.t) || 0,
      v: typeof r.v === 'string' ? r.v.slice(0, 20) : '',
    };
  }
  const at = d.allTime ?? { dives: 0, total: 0, best: 0 };
  return {
    name,
    updatedAt: Number(d.updatedAt) || 0,
    runs,
    allTime: { dives: Math.max(0, Number(at.dives) || 0), total: Math.max(0, Number(at.total) || 0), best: Math.min(700, Math.max(0, Number(at.best) || 0)) },
  };
}

export async function publishRun(
  pf: Platform,
  challengeId: string,
  run: BoardRun,
  name: string,
  todayKey: string,
): Promise<'published' | 'refused' | 'unavailable'> {
  if (!pf.db || !pf.uid) return 'unavailable';
  if (pf.canWriteShared === false) return 'refused';
  const ref = pf.db.doc(`board/${pf.uid}`);
  try {
    const snap = await ref.get();
    const prev = snap.exists ? sanitizeBoard(snap.data() as BoardDoc) : null;
    if (prev?.runs[challengeId]) return 'published'; // one official result per dive
    const runs = pruneRuns({ ...(prev?.runs ?? {}), [challengeId]: run }, todayKey, 120);
    const prevAll = prev?.allTime ?? { dives: 0, total: 0, best: 0 };
    const doc: BoardDoc = {
      name: name.slice(0, 32),
      updatedAt: Date.now(),
      runs,
      allTime: { dives: prevAll.dives + 1, total: prevAll.total + run.s, best: Math.max(prevAll.best, run.s) },
    };
    await ref.set(doc as unknown as Record<string, unknown>);
    return 'published';
  } catch {
    return 'refused';
  }
}

export async function renameOnBoard(pf: Platform, name: string): Promise<void> {
  if (!pf.db || !pf.uid) return;
  try {
    const ref = pf.db.doc(`board/${pf.uid}`);
    const snap = await ref.get();
    if (snap.exists) await ref.update({ name: name.slice(0, 32), updatedAt: Date.now() });
  } catch {
    /* read-only viewers */
  }
}

// --- Review queue -----------------------------------------------------------------------

export interface Report {
  id: string;
  promptId: string;
  input: string;
  reason: string;
  note: string;
  at: number;
  status: 'pending' | 'approved' | 'dismissed';
}

const LOCAL_REPORTS = 'hanguk.reports.v1';

function loadLocalReports(): Report[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_REPORTS) ?? '[]') as Report[];
  } catch {
    return [];
  }
}

function saveLocalReports(r: Report[]): void {
  try {
    localStorage.setItem(LOCAL_REPORTS, JSON.stringify(r.slice(-300)));
  } catch {
    /* ignore */
  }
}

export async function fileReport(pf: Platform, r: Report): Promise<'shared' | 'local'> {
  const local = loadLocalReports();
  saveLocalReports([...local.filter((x) => x.id !== r.id), r]);
  if (!pf.db || !pf.uid) return 'local';
  try {
    const ref = pf.db.doc(`reports/${pf.uid}`);
    const snap = await ref.get();
    const items = ((snap.exists ? (snap.data() as { items?: Report[] })?.items : []) ?? []).slice(-199);
    await ref.set({ items: [...items, r], updatedAt: Date.now() });
    return 'shared';
  } catch {
    return 'local';
  }
}

export async function myReports(pf: Platform): Promise<Report[]> {
  if (pf.db && pf.uid) {
    try {
      const snap = await pf.db.doc(`reports/${pf.uid}`).get();
      if (snap.exists) return ((snap.data() as { items?: Report[] })?.items ?? []).slice();
    } catch {
      /* fall through */
    }
  }
  return loadLocalReports();
}

export interface QueueItem extends Report {
  by: string;
}

/** Owner/editor view of every player's reports. Rules make this read admin-only. */
export async function allReports(pf: Platform): Promise<QueueItem[] | null> {
  if (!pf.db) return null;
  try {
    const snap = await pf.db.collection('reports').limit(1000).get();
    const out: QueueItem[] = [];
    for (const d of snap.docs) {
      const items = ((d.data() as { items?: Report[] })?.items ?? []).filter((x) => x && typeof x.input === 'string');
      for (const it of items) out.push({ ...it, input: it.input.slice(0, 80), note: String(it.note ?? '').slice(0, 300), by: d.id });
    }
    return out.sort((a, b) => b.at - a.at);
  } catch {
    return null;
  }
}

export async function setReportStatus(pf: Platform, by: string, id: string, status: Report['status']): Promise<boolean> {
  if (!pf.db) return false;
  try {
    const ref = pf.db.doc(`reports/${by}`);
    const snap = await ref.get();
    if (!snap.exists) return false;
    const items = ((snap.data() as { items?: Report[] })?.items ?? []).map((x) => (x.id === id ? { ...x, status } : x));
    await ref.set({ items, updatedAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

// --- Owner-approved answers (approved/answers) ----------------------------------------

export type Approved = Record<string, string[]>;

export async function loadApproved(pf: Platform): Promise<Approved> {
  if (!pf.db) return {};
  try {
    const snap = await pf.db.doc('approved/answers').get();
    const prompts = (snap.exists ? (snap.data() as { prompts?: Approved })?.prompts : null) ?? {};
    const out: Approved = {};
    for (const [k, v] of Object.entries(prompts)) if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 80));
    return out;
  } catch {
    return {};
  }
}

export async function approveAnswer(pf: Platform, promptId: string, text: string): Promise<boolean> {
  if (!pf.db) return false;
  try {
    const ref = pf.db.doc('approved/answers');
    const current = await loadApproved(pf);
    const list = new Set(current[promptId] ?? []);
    list.add(text.trim());
    await ref.set({ prompts: { ...current, [promptId]: [...list] }, updatedAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

// --- Files ----------------------------------------------------------------------------

/** Offer a generated file: the downloads capability when present, else a plain link (standalone only). */
export async function saveFile(pf: Platform, filename: string, data: Blob): Promise<'saved' | 'declined' | 'unavailable'> {
  if (pf.downloads) {
    try {
      await pf.downloads.save({ filename, data });
      return 'saved';
    } catch (e) {
      return (e as { code?: string })?.code === 'declined' ? 'declined' : 'unavailable';
    }
  }
  if (hasRuntime()) return 'unavailable'; // inside a viewer a plain download link is inert
  try {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}
