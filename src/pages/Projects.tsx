import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, useMe } from '../components/Layout';
import { Badge, Button, Card, Empty, Field, KpiCard, Modal, Progress, Select, TextArea, TextInput } from '../components/ui';
import Icon from '../components/Icon';
import { useData } from '../lib/hooks';
import { db } from '../lib/store';
import { createProject, milestoneProgress } from '../lib/projects';
import { useWorld, NO_COUNTRIES } from '../lib/world';
import { daysUntil, fmtDate } from '../lib/format';
import { peopleOptions, personName, usePeople } from '../lib/team';
import type { MilestoneTemplate, Project, ProjectMilestone, Task } from '../lib/types';
import { placeLabel } from './Grants';

export const PROJECT_STATUS: { value: Project['status']; label: string; cls: string }[] = [
  { value: 'idea', label: 'Idea', cls: 'bg-gray-100 text-gray-700' },
  { value: 'applying', label: 'Applying', cls: 'bg-amber-50 text-amber-700' },
  { value: 'active', label: 'Active', cls: 'bg-brand-50 text-brand-700' },
  { value: 'scaling', label: 'Scaling', cls: 'bg-purple-50 text-purple-700' },
  { value: 'closed', label: 'Closed', cls: 'bg-gray-100 text-gray-500' },
];

export default function ProjectsPage() {
  const world = useWorld();
  const countries = world?.countries ?? NO_COUNTRIES;
  const projects = useData(() => db.list<Project>('projects'), [], []);
  const milestones = useData(() => db.list<ProjectMilestone>('project_milestones'), [], []);
  const tasks = useData(() => db.list<Task>('tasks'), [], []);
  const [creating, setCreating] = useState(false);

  const msOf = (id: string) => milestones.data.filter((m) => m.project_id === id).sort((a, b) => a.order - b.order);
  const upcoming = milestones.data
    .filter((m) => m.status !== 'done' && m.target_date && (daysUntil(m.target_date) ?? 999) <= 30)
    .sort((a, b) => (a.target_date || '').localeCompare(b.target_date || ''));

  return (
    <>
      <PageHeader title="Projects" subtitle="One page per project: milestones, documents, dashboards and team progress" actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New project</Button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard icon="folder" label="Projects" value={projects.data.length} foot={`${projects.data.filter((p) => p.status === 'active').length} active`} />
        <KpiCard icon="calendar" tint="orange" label="Milestones due in 30 days" value={upcoming.length} foot={upcoming[0] ? `next: ${upcoming[0].name}, ${fmtDate(upcoming[0].target_date)}` : undefined} />
        <KpiCard icon="checkCircle" tint="green" label="Milestones done" value={`${milestones.data.filter((m) => m.status === 'done').length} / ${milestones.data.length}`} />
        <KpiCard icon="clipboard" tint="purple" label="Open tasks" value={tasks.data.filter((t) => t.status !== 'done').length} foot={`${tasks.data.filter((t) => t.status === 'blocked').length} blocked`} />
      </div>

      {projects.data.length === 0 && !projects.loading ? (
        <Card><Empty icon="folder" title="No projects yet">Create one from a milestone template.</Empty></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
          {projects.data.map((p) => {
            const ms = msOf(p.id);
            const next = ms.find((m) => m.status !== 'done');
            const st = PROJECT_STATUS.find((s) => s.value === p.status) || PROJECT_STATUS[0];
            const pr = milestoneProgress(ms);
            return (
              <Link key={p.id} to={`/projects/${p.slug}`} className="block">
                <Card className="h-full hover:border-brand-300 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[19px] font-semibold text-gray-900 leading-snug">{p.name}</h3>
                    <Badge className={st.cls}>{st.label}</Badge>
                  </div>
                  <p className="text-[15px] text-gray-600 mt-2 line-clamp-2">{p.summary}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mt-3">
                    <span className="inline-flex items-center gap-1"><Icon name="pin" size={15} />{placeLabel(p.countries, countries)}</span>
                    {p.funder && <span className="inline-flex items-center gap-1"><Icon name="coins" size={15} />{p.funder}</span>}
                    <span className="inline-flex items-center gap-1"><Icon name="user" size={15} />{personName(p.lead)}</span>
                  </div>
                  <div className="mt-5">
                    <div className="flex justify-between text-sm mb-1.5"><span className="text-gray-600">{ms.filter((m) => m.status === 'done').length} of {ms.length} milestones</span><span className="font-medium tabular-nums">{pr}%</span></div>
                    <Progress value={pr} />
                  </div>
                  {next && (
                    <div className="mt-4 text-sm bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                      <span className="text-gray-500">Next:</span> <span className="font-medium text-gray-800">{next.name}</span>
                      {next.target_date && <span className="text-gray-500"> · due {fmtDate(next.target_date)}</span>}
                    </div>
                  )}
                  {p.links?.length ? (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {p.links.slice(0, 3).map((l) => (
                        <span key={l.url} className="inline-flex items-center gap-1 text-sm text-brand-700 bg-brand-50 rounded-lg px-2 py-1">
                          <Icon name={l.kind === 'dashboard' ? 'dashboard' : 'link'} size={14} />{l.title}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      <NewProject open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function NewProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const nav = useNavigate();
  const world = useWorld();
  const templates = useData(() => db.list<MilestoneTemplate>('milestone_templates'), [], []);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [country, setCountry] = useState('');
  const [funder, setFunder] = useState('');
  const [lead, setLead] = useState(me.email);
  const people = usePeople();
  const [tpl, setTpl] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const t = templates.data.find((x) => x.id === (tpl || templates.data[0]?.id)) || null;
    const p = await createProject({ name: name.trim(), summary, countries: country ? [country] : [], diseases: [], funder, status: 'idea', lead, links: [] }, t, me.email);
    setBusy(false);
    onClose();
    nav(`/projects/${p.slug}`);
  };
  return (
    <Modal open={open} onClose={onClose} title="New project" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create project'}</Button></>}>
      <Field label="Name"><TextInput className="w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Malaria microscopy AI, Nigeria" /></Field>
      <Field label="Summary"><TextArea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country"><Select value={country} onChange={setCountry} placeholder="Choose" options={(world?.countries || []).map((c) => ({ value: c.iso3, label: c.name }))} /></Field>
        <Field label="Funder"><TextInput className="w-full" value={funder} onChange={(e) => setFunder(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lead"><Select value={lead} onChange={setLead} placeholder="Choose" options={peopleOptions(people, lead)} /></Field>
        <Field label="Milestone template" hint="Edit templates under Milestone Templates"><Select value={tpl || templates.data[0]?.id || ''} onChange={setTpl} options={templates.data.map((t) => ({ value: t.id, label: t.name }))} /></Field>
      </div>
    </Modal>
  );
}
