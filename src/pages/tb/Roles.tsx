import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Select, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useData } from '../../lib/hooks';
import { personName } from '../../lib/team';
import { LEVELS, loadDistrictDetail, TbCampaign, TbDistrict, TbLevel, TbStaffRole, TbTask } from '../../lib/tb';
import { Panel } from './common';

/* Roles from the MoH Staffing Norms (2018): who is assigned to the campaigns in view, and a preview of what each role
 * would see. The preview only filters the screen: sign-in access by role comes later (Ghana Health Information Exchange). */

export const NORMS_DOC = 'Staffing Norms for the Health Sector in Ghana, Ministry of Health, validated May 2018';
const levelLabel = (l: TbLevel) => LEVELS.find((x) => x.key === l)!.label;
/** The lead role at a level (the one that owns the work there). */
export const leadOf = (roles: TbStaffRole[], level: TbLevel) => roles.filter((r) => r.level === level).sort((a, b) => a.sort - b.sort)[0] || null;
/** The name a task uses for a role: its playbook role when it fills one, else the cadre. */
export const roleName = (r: TbStaffRole) => r.tb_role || r.cadre;


/* ---------------- preview a role ---------------- */
export type Persona = { level: TbLevel; region?: string; district?: string; town?: string };
export type Scope = { persona: Persona; lead: TbStaffRole | null; districts: Set<string> | null; town: string | null; taskRoles: string[] | null; place: string };

export function scopeOf(p: Persona | null, list: TbDistrict[], roles: TbStaffRole[]): Scope | null {
  if (!p) return null;
  const lead = leadOf(roles, p.level);
  const d = list.find((x) => x.id === p.district);
  const districts = p.level === 'national' ? null : p.level === 'regional' ? new Set(list.filter((x) => x.region === p.region).map((x) => x.id)) : new Set(d ? [d.id] : []);
  const town = ['subdistrict', 'facility', 'community'].includes(p.level) ? p.town || null : null;
  // facility and community staff see only the tasks their roles carry; everyone above sees all tasks in their area
  const taskRoles = p.level === 'facility' || p.level === 'community' ? roles.filter((r) => r.level === p.level).sort((a, b) => a.sort - b.sort).map(roleName) : null;
  const place = p.level === 'national' ? 'Ghana' : p.level === 'regional' ? `${p.region} region` : town ? `${town}, ${d?.name || ''}` : d?.name || '';
  return { persona: p, lead, districts, town, taskRoles, place };
}

export const inScope = {
  campaign: (s: Scope | null, c: TbCampaign) => !s || ((!s.districts || (!!c.district_id && s.districts.has(c.district_id))) && (!s.town || c.town === s.town)),
  task: (s: Scope | null, t: TbTask, camps: TbCampaign[]) => {
    if (!s) return true;
    const c = camps.find((x) => x.id === t.campaign_id);
    const placeOk = c ? inScope.campaign(s, c) : (!s.districts || (!!t.district_id && s.districts.has(t.district_id))) && !s.town;
    return placeOk && (!s.taskRoles || (!!t.role && s.taskRoles.includes(t.role)));
  },
};

/** "View as" control in the page header: pick a level's lead role and the place it covers. */
export function ViewAs({ value, onChange, roles, list, focus }: { value: Persona | null; onChange: (p: Persona | null) => void; roles: TbStaffRole[]; list: TbDistrict[]; focus: TbDistrict | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);
  const regions = useMemo(() => Array.from(new Set(list.map((d) => d.region))).sort(), [list]);
  const districts = useMemo(() => [...list].sort((a, b) => a.name.localeCompare(b.name)), [list]);
  const districtId = value?.district || focus?.id || '';
  const det = useData(() => (districtId && value && ['subdistrict', 'facility', 'community'].includes(value.level) ? loadDistrictDetail(districtId) : Promise.resolve(null)), [districtId, value?.level], null);
  const towns = useMemo(() => (det.data?.towns || []).filter((t) => !t.nodata).sort((a, b) => b.pop - a.pop), [det.data]);
  // a town-level preview needs a town: the district's largest until one is chosen
  useEffect(() => {
    if (value && ['subdistrict', 'facility', 'community'].includes(value.level) && !value.town && towns.length) onChange({ ...value, town: towns[0].name });
  }, [towns, value, onChange]);
  const pick = (level: TbLevel | '') => {
    if (!level) return onChange(null);
    const d = list.find((x) => x.id === districtId) || focus;
    onChange({ level, region: value?.region || d?.region, district: d?.id, town: value?.level && ['subdistrict', 'facility', 'community'].includes(value.level) ? value.town : undefined });
  };
  const lead = value ? leadOf(roles, value.level) : null;
  if (!roles.length) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className={cx('h-14 inline-flex items-center gap-2 rounded-2xl border px-4 shadow-card text-left', value ? 'border-violet-300 bg-violet-50' : 'border-gray-200 bg-white hover:bg-gray-50')}>
        <Icon name="users" size={18} className={value ? 'text-violet-700' : 'text-gray-600'} />
        <span className="min-w-0">
          <span className="block text-[11px] text-gray-500 leading-tight">View as</span>
          <span className="block text-sm font-medium text-gray-900 max-w-[220px] truncate">{lead ? `${levelLabel(value!.level)}: ${roleName(lead)}` : 'Programme officer (all)'}</span>
        </span>
        <Icon name="chevronDown" size={15} className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-[360px] max-w-[calc(100vw-32px)] rounded-2xl border border-gray-200 bg-white p-4 shadow-xl space-y-3">
          <p className="text-xs text-gray-500">See the dashboard as one role would: only their places and their tasks. Roles follow the {NORMS_DOC.split(',')[0]}. This is a preview; sign-in access by role is not switched on yet.</p>
          <div className="space-y-1">
            {([['', 'Programme officer (all)'] as const, ...LEVELS.map((l) => [l.key, `${l.label}: ${leadOf(roles, l.key) ? roleName(leadOf(roles, l.key)!) : '—'}`] as const)]).map(([k, label]) => (
              <label key={k || 'all'} className={cx('flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer text-sm', (value?.level || '') === k ? 'bg-violet-50 text-violet-900 font-medium' : 'hover:bg-gray-50')}>
                <input type="radio" name="viewas" checked={(value?.level || '') === k} onChange={() => pick(k as TbLevel | '')} />{label}
              </label>
            ))}
          </div>
          {value?.level === 'regional' && <Select className="w-full" value={value.region || ''} onChange={(v) => onChange({ ...value, region: v })} options={regions.map((r) => ({ value: r, label: `${r} region` }))} />}
          {value && ['district', 'subdistrict', 'facility', 'community'].includes(value.level) && (
            <Select className="w-full" value={value.district || ''} onChange={(v) => onChange({ ...value, district: v, region: list.find((x) => x.id === v)?.region, town: undefined })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          )}
          {value && ['subdistrict', 'facility', 'community'].includes(value.level) && (
            <Select className="w-full" value={value.town || ''} onChange={(v) => onChange({ ...value, town: v })} placeholder={det.loading ? 'Loading towns…' : 'Pick a town'} options={towns.map((t) => ({ value: t.name, label: t.name }))} />
          )}
        </div>
      )}
    </div>
  );
}

const listWords = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Banner under the header while previewing a role. */
export function ScopeBanner({ scope, counts, onExit }: { scope: Scope; counts: { districts: number; campaigns: number; tasks: number }; onExit: () => void }) {
  const l = scope.lead;
  return (
    <div className="mb-5 flex flex-wrap items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-3.5 text-[15px] text-violet-950">
      <Icon name="users" size={18} className="mt-0.5 text-violet-700" />
      <div className="min-w-0 flex-1">
        <b>Previewing as {l ? l.cadre : levelLabel(scope.persona.level)}</b> · {scope.place}
        {l?.duty && <span className="block text-sm text-violet-900/80">{l.duty}</span>}
        <span className="block text-sm text-violet-900/80">Sees {counts.districts === 1 ? '1 district' : `${counts.districts} districts`}, {counts.campaigns} campaign{counts.campaigns === 1 ? '' : 's'} and {counts.tasks} open task{counts.tasks === 1 ? '' : 's'}{scope.taskRoles ? ` for ${listWords(scope.taskRoles)}` : ''}. Preview only: access by role is not enforced yet.</span>
      </div>
      <button type="button" onClick={onExit} className="shrink-0 rounded-lg bg-white px-3 h-9 text-sm font-medium text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100">Exit preview</button>
    </div>
  );
}

/** Who is assigned to the campaigns in view: each role, the people holding its tasks, and how far they have got. */
export function CampaignTeam({ campaigns, tasks, roles, here }: { campaigns: TbCampaign[]; tasks: TbTask[]; roles: TbStaffRole[]; here: string }) {
  const ids = new Set(campaigns.map((c) => c.id));
  const mine = tasks.filter((t) => t.campaign_id && ids.has(t.campaign_id));
  if (!mine.length) return null;
  const byRole = new Map<string, Map<string, { open: number; done: number; camps: Set<string> }>>();
  for (const t of mine) {
    const people = byRole.get(t.role || '') || new Map();
    const a = people.get(t.assignee || '') || { open: 0, done: 0, camps: new Set<string>() };
    if (t.status === 'done') a.done++; else a.open++;
    a.camps.add(t.campaign_id!);
    people.set(t.assignee || '', a);
    byRole.set(t.role || '', people);
  }
  // roles in the order of the health-system levels; a role the norms do not know goes last
  const staff = (name: string) => roles.find((r) => roleName(r) === name);
  const rank = (name: string) => { const r = staff(name); return r ? LEVELS.findIndex((l) => l.key === r.level) * 10 + r.sort : 999; };
  const rows = Array.from(byRole.entries()).sort((a, b) => rank(a[0]) - rank(b[0]));
  const people = new Set(mine.map((t) => t.assignee).filter(Boolean)).size;
  const open = mine.filter((t) => t.status !== 'done').length;
  const unassigned = mine.filter((t) => !t.assignee).length;
  return (
    <Panel title="Who is assigned" sub={`${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'} in ${here} · ${people} ${people === 1 ? 'person' : 'people'} · ${open} open task${open === 1 ? '' : 's'}${unassigned ? ` · ${unassigned} unassigned` : ''}`}>
      <ul className="divide-y divide-gray-100">
        {rows.map(([role, ppl]) => {
          const r = staff(role);
          return (
            <li key={role || 'none'} className="py-2.5">
              <div className="text-sm font-medium text-gray-900">{role || 'No role'}</div>
              {r && <div className="text-xs text-gray-500">{levelLabel(r.level)}{r.tb_role && r.tb_role !== r.cadre ? ` · ${r.cadre}` : ''}</div>}
              <ul className="mt-1.5 space-y-1">
                {Array.from(ppl.entries()).map(([email, a]) => (
                  <li key={email || 'nobody'} className="flex items-center gap-2 text-sm">
                    {email ? <Avatar name={personName(email)} size={22} /> : <span className="w-[22px] h-[22px] rounded-full border border-dashed border-gray-300 shrink-0" />}
                    <span className={cx('min-w-0 truncate', email ? 'text-gray-800' : 'text-amber-700')}>{email ? personName(email) : 'Unassigned'}</span>
                    <span className="ml-auto shrink-0 text-xs text-gray-500 tabular-nums">{a.open} open · {a.done} done · {a.camps.size} campaign{a.camps.size === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Roles a task can be given, grouped by level, for a select. A name used at two levels (a cadre and a playbook role)
 *  appears once, at the level whose role the playbooks assign. */
export const roleOptions = (roles: TbStaffRole[]) => {
  const owner = new Map<string, TbStaffRole>();
  for (const r of roles) if (!owner.has(roleName(r)) || r.tb_role) owner.set(roleName(r), r);
  return LEVELS.flatMap((l) => roles.filter((r) => r.level === l.key && owner.get(roleName(r)) === r).sort((a, b) => a.sort - b.sort)
    .map((r) => ({ value: roleName(r), label: `${l.label}: ${roleName(r)}${r.tb_role && r.tb_role !== r.cadre ? ` · ${r.cadre}` : ''}` })));
};
