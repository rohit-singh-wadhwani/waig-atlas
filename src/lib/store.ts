import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import type {
  Attachment, Comment, Grant, GrantTracking, HealthData, Insight, MilestoneTemplate, OrgContext, Page,
  Project, ProjectMilestone, Source, Task,
} from './types';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || '';
export const ALLOWED_DOMAIN = process.env.REACT_APP_ALLOWED_DOMAIN || 'wadhwaniaiglobal.com';

export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })
    : null;
export const DEMO = !supabase;

const base = process.env.PUBLIC_URL || '.';
export const dataUrl = (file: string) => `${base}/data/${file}`;

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(dataUrl(file), { cache: 'no-cache' });
    if (!r.ok) return fallback;
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

/* ---------- Demo mode: seed JSON + localStorage overlay ---------- */

type Tables = {
  projects: Project[];
  project_milestones: ProjectMilestone[];
  pages: Page[];
  tasks: Task[];
  milestone_templates: MilestoneTemplate[];
  grant_tracking: (GrantTracking & { id: string })[];
  comments: Comment[];
  attachments: Attachment[];
  org_context: (OrgContext & { id: string })[];
  sources: Source[];
  members: { id: string; email: string; name?: string | null; team?: string | null }[];
};
type TableName = keyof Tables;

const LS_KEY = 'waig-atlas-demo-v1';
let demoState: Tables | null = null;
let demoLoading: Promise<Tables> | null = null;

function lsGet(): Partial<Tables> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function lsSet(t: Tables) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(t));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

async function demo(): Promise<Tables> {
  if (demoState) return demoState;
  if (!demoLoading) {
    demoLoading = (async () => {
      const seed = await fetchJson<Partial<Tables>>('seed.json', {});
      const sources = await fetchJson<Source[]>('sources.json', []);
      const saved = lsGet() || {};
      const t: Tables = {
        projects: saved.projects ?? seed.projects ?? [],
        project_milestones: saved.project_milestones ?? seed.project_milestones ?? [],
        pages: saved.pages ?? seed.pages ?? [],
        tasks: saved.tasks ?? seed.tasks ?? [],
        milestone_templates: saved.milestone_templates ?? seed.milestone_templates ?? [],
        grant_tracking: saved.grant_tracking ?? seed.grant_tracking ?? [],
        comments: saved.comments ?? seed.comments ?? [],
        attachments: saved.attachments ?? seed.attachments ?? [],
        org_context: saved.org_context ?? seed.org_context ?? [],
        // source status always comes from the latest cron run; enabled flags can be overridden locally
        sources: mergeSources(sources, saved.sources),
        members: saved.members ?? [],
      };
      demoState = t;
      return t;
    })();
  }
  return demoLoading;
}

function mergeSources(fresh: Source[], saved?: Source[]): Source[] {
  if (!saved) return fresh;
  const byId = new Map(saved.map((s) => [s.id, s]));
  const merged = fresh.map((s) => (byId.has(s.id) ? { ...s, enabled: byId.get(s.id)!.enabled } : s));
  for (const s of saved) if (!fresh.find((f) => f.id === s.id)) merged.push(s);
  return merged;
}

type Row = { id: string } & Record<string, any>;

export const db = {
  async list<T>(table: TableName, match?: Record<string, any>): Promise<T[]> {
    if (supabase) {
      let q = supabase.from(table).select('*');
      if (match) for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as T[];
    }
    const t = await demo();
    let rows = ((t as any)[table] ||= []) as Row[];
    if (match) rows = rows.filter((r) => Object.entries(match).every(([k, v]) => r[k] === v));
    return rows as unknown as T[];
  },
  async upsert<T extends Row>(table: TableName, row: T): Promise<T> {
    if (supabase) {
      const { data, error } = await supabase.from(table).upsert(row).select().single();
      if (error) {
        notifyError(error.message);
        throw error;
      }
      emit(); // refresh every view that reads this data
      return data as T;
    }
    const t = await demo();
    const rows = ((t as any)[table] ||= []) as Row[];
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = { ...rows[i], ...row };
    else rows.push(row);
    lsSet(t);
    emit();
    return row;
  },
  async remove(table: TableName, id: string): Promise<void> {
    if (supabase) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) {
        notifyError(error.message);
        throw error;
      }
      emit();
      return;
    }
    const t = await demo();
    (t as any)[table] = (((t as any)[table] || []) as Row[]).filter((r) => r.id !== id);
    lsSet(t);
    emit();
  },
};

/* ---------- save errors, shown as a toast ---------- */
const errorListeners = new Set<(msg: string) => void>();
export function onSaveError(fn: (msg: string) => void) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}
function notifyError(msg: string) {
  errorListeners.forEach((f) => f(msg));
}

/* ---------- change listeners ---------- */
const listeners = new Set<() => void>();
export function onChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((f) => f());
}

export function resetDemo() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {}
  demoState = null;
  demoLoading = null;
  emit();
}

/* ---------- Public feeds (written by the scheduled jobs) ---------- */

export type Feed<T> = { items: T[]; updated_at: string | null };

export async function loadGrants(): Promise<Feed<Grant>> {
  const j = await fetchJson<{ grants: Grant[]; updated_at?: string }>('grants.json', { grants: [] });
  if (supabase) {
    // scores and private fields live in Supabase when it is connected
    const { data, error } = await supabase.from('grants').select('*');
    if (!error && data && data.length) return { items: data as Grant[], updated_at: j.updated_at || null };
  }
  return { items: j.grants || [], updated_at: j.updated_at || null };
}

export async function loadInsights(): Promise<Feed<Insight>> {
  const j = await fetchJson<{ insights: Insight[]; updated_at?: string }>('insights.json', { insights: [] });
  return { items: j.insights || [], updated_at: j.updated_at || null };
}

export async function loadHealth(): Promise<HealthData> {
  return fetchJson<HealthData>('health.json', { updated_at: null, indicators: [] });
}

export async function loadRunLog(): Promise<{ runs: { job: string; at: string; ok: boolean; message: string }[] }> {
  return fetchJson('runs.json', { runs: [] });
}

/* ---------- Auth ---------- */

export type Me = { email: string; name: string; demo: boolean };

export function meFromSession(s: Session | null): Me | null {
  if (DEMO) return { email: 'demo@wadhwaniaiglobal.com', name: 'Demo user', demo: true };
  const email = s?.user?.email;
  if (!email) return null;
  const name = (s?.user?.user_metadata?.full_name as string) || email.split('@')[0];
  return { email, name, demo: false };
}

export async function signInWithEmail(email: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.';
  if (!email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN)) return `Use your @${ALLOWED_DOMAIN} email.`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  return error ? error.message : null;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

export async function uploadFile(file: File, folder: string): Promise<string> {
  if (!supabase) throw new Error('File uploads need Supabase. Add a link instead.');
  const path = `${folder}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
  const { error } = await supabase.storage.from('attachments').upload(path, file);
  if (error) throw error;
  const { data } = await supabase.storage.from('attachments').createSignedUrl(path, 60 * 60 * 24 * 365);
  return data?.signedUrl || path;
}
