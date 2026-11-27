import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Select, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useData } from '../../lib/hooks';
import { LEVELS, loadDistrictDetail, TbCampaign, TbDistrict, TbLevel, TbStaffRole, TbTask } from '../../lib/tb';
import { Panel, Tip } from './common';

/* Who does what, by level, from the MoH Staffing Norms (2018), and a preview of what each role would see.
 * The preview only filters the screen: sign-in access by role comes later (Ghana Health Information Exchange). */

export const NORMS_DOC = 'Staffing Norms for the Health Sector in Ghana, Ministry of Health, validated May 2018';
const levelLabel = (l: TbLevel) => LEVELS.find((x) => x.key === l)!.label;
/** The directorate category a district's staffing norms use, from its politico-administrative name. */
export const directorateOf = (d: Pick<TbDistrict, 'name'>) => (/metropolitan/i.test(d.name) ? 'Metropolitan' : /municipal/i.test(d.name) ? 'Municipal' : 'District');
/** The lead role at a level (the one that owns the work there). */
export const leadOf = (roles: TbStaffRole[], level: TbLevel) => roles.filter((r) => r.level === level).sort((a, b) => a.sort - b.sort)[0] || null;
/** The name a task uses for a role: its playbook role when it fills one, else the cadre. */
export const roleName = (r: TbStaffRole) => r.tb_role || r.cadre;

/** Staff in post for a role, as "2–4" for one category or the span across categories, with the full list for a tooltip. */
export function normText(r: TbStaffRole, category?: string) {
  const n = r.norms;
  if (!n) return null;
  const one = category && n[category];
  const list = Object.entries(n).map(([k, [a, b]]) => `${k}: ${a === b ? a : `${a}–${b}`}`).join(' · ');
  if (one) return { text: `${one[0] === one[1] ? one[0] : `${one[0]}–${one[1]}`} in post`, tip: `${category} norm. All categories: ${list}` };
  const lo = Math.min(...Object.values(n).map((x) => x[0])), hi = Math.max(...Object.values(n).map((x) => x[1]));
  return { text: `${lo === hi ? lo : `${lo}–${hi}`} in post, by size`, tip: list };
}
const sourceWords = (r: TbStaffRole) => (r.basis === 'assumed' ? 'Not in the staffing norms; assumed for the prototype.' : `${NORMS_DOC}, ${r.source_table}${r.source_page ? `, p.${r.source_page}` : ''}.`);

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

/** Who does the TB work at the levels shown here, with the staff the norms expect in post. */
export function WhoDoesWhat({ roles, levels, categories, here, active }: { roles: TbStaffRole[]; levels: TbLevel[]; categories?: Partial<Record<TbLevel, string>>; here: string; active?: TbLevel | null }) {
  const [open, setOpen] = useState(false);
  const shown = levels.map((l) => ({ l, rows: roles.filter((r) => r.level === l).sort((a, b) => a.sort - b.sort) })).filter((x) => x.rows.length);
  if (!shown.length) return null;
  return (
    <Panel title="Who does what here" sub={`TB case-finding roles for ${here}, from the MoH staffing norms`}
      right={<button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">{open ? 'Hide' : `Show ${shown.reduce((a, x) => a + x.rows.length, 0)} roles`}<Icon name="chevronDown" size={14} className={open ? 'rotate-180' : ''} /></button>}>
      {!open ? (
        <ul className="space-y-1.5 text-sm">
          {shown.map(({ l, rows }) => (
            <li key={l} className="flex gap-2"><span className="w-28 shrink-0 text-gray-500">{levelLabel(l)}</span><span className="min-w-0 text-gray-900"><b className="font-medium">{rows[0].cadre}</b>{rows.length > 1 ? <span className="text-gray-500"> + {rows.length - 1} more</span> : null}</span></li>
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          {shown.map(({ l, rows }) => (
            <div key={l}>
              <div className="flex items-baseline justify-between gap-2 border-b border-gray-100 pb-1 mb-2">
                <span className="text-sm font-semibold text-gray-900">{levelLabel(l)}</span>
                <span className="text-xs text-gray-500 text-right">{rows[0].unit_type}{categories?.[l] ? ` · ${categories[l]}` : ''}</span>
              </div>
              <ul className="space-y-2.5">
                {rows.map((r, i) => {
                  const n = normText(r, categories?.[l]);
                  return (
                    <li key={r.id} className={cx('text-sm rounded-lg', active === l && i === 0 && 'bg-violet-50 -mx-2 px-2 py-1.5')}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-gray-900">{r.cadre}{r.tb_role && r.tb_role !== r.cadre && <span className="ml-1.5 text-xs font-normal text-gray-500">({r.tb_role})</span>}</span>
                        <Tip label={sourceWords(r)} text={<>{n?.tip && <span className="block mb-1">{n.tip}</span>}{sourceWords(r)}</>}>
                          <span className={cx('text-xs whitespace-nowrap tabular-nums', r.basis === 'assumed' ? 'text-amber-700' : 'text-gray-500')}>{n ? n.text : 'assumed'}</span>
                        </Tip>
                      </div>
                      {r.duty && <p className="text-gray-600 mt-0.5">{r.duty}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-xs text-gray-500">Staff numbers: {NORMS_DOC}. The TB duties are the prototype's reading of each cadre's job; the norms give numbers, not tasks.</p>
        </div>
      )}
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
