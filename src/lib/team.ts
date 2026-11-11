import { useEffect, useState } from 'react';
import { db } from './store';

/** People come from the `members` table: everyone who signs in is added automatically; names and teams are edited on the People page. */
export type Member = { id: string; email: string; name?: string | null; team?: string | null; role?: string | null; district?: string | null };

let PEOPLE: Member[] = [];
let loading: Promise<Member[]> | null = null;
const subs = new Set<() => void>();

export function loadPeople(force = false): Promise<Member[]> {
  if (!loading || force) {
    loading = db
      .list<Member>('members')
      .catch(() => [] as Member[])
      .then((rows) => {
        PEOPLE = rows.sort((a, b) => displayName(a).localeCompare(displayName(b)));
        subs.forEach((f) => f());
        return PEOPLE;
      });
  }
  return loading;
}

export function usePeople(): Member[] {
  const [people, setPeople] = useState(PEOPLE);
  useEffect(() => {
    const f = () => setPeople([...PEOPLE]);
    subs.add(f);
    loadPeople().then(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return people;
}

const displayName = (m: Member) => m.name || m.email.split('@')[0];

/** Options for an owner / POC picker; keeps the current value even if that person is not a member yet. */
export function peopleOptions(people: Member[], current?: string | null, withTeam = false) {
  const opts = people.map((m) => ({ value: m.email, label: withTeam && m.team ? `${displayName(m)} · ${m.team}` : displayName(m) }));
  if (current && !opts.find((o) => o.value === current)) opts.unshift({ value: current, label: personName(current) });
  return opts;
}

/** Teams in use: from people's teams plus any already set on tasks or milestones. */
export function teamOptions(people: Member[], ...used: (string | null | undefined)[][]) {
  const all = new Set<string>();
  for (const m of people) if (m.team) all.add(m.team);
  for (const list of used) for (const t of list) if (t) all.add(t);
  return Array.from(all).sort().map((t) => ({ value: t, label: t }));
}

export const NEW_TEAM = '__new_team__';
/** Handles the "New team…" choice in a team picker. */
export function pickTeam(v: string): string | null {
  if (v !== NEW_TEAM) return v;
  const name = window.prompt('New team name');
  return name && name.trim() ? name.trim() : null;
}

export function personName(v?: string | null) {
  if (!v) return 'Unassigned';
  const p = PEOPLE.find((t) => t.email === v.toLowerCase() || t.name === v);
  return p ? displayName(p) : v.includes('@') ? v.split('@')[0] : v;
}

export const GRANT_STAGES = [
  { key: 'submission', label: 'Submission' },
  { key: 'review1', label: 'Review 1' },
  { key: 'review2', label: 'Review 2' },
  { key: 'grant', label: 'Grant' },
];
