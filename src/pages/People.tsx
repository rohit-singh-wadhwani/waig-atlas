import React, { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Avatar, Button, Card, CardHeader, TextInput } from '../components/ui';
import { ALLOWED_DOMAIN, db } from '../lib/store';
import { loadPeople, Member, usePeople } from '../lib/team';

/** Everyone who signs in appears here automatically. Add people who haven't signed in yet so they can be assigned. */
export default function PeoplePage() {
  const people = usePeople();
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const save = async (m: Member, patch: Partial<Member>) => {
    await db.upsert('members', { ...m, ...patch } as any);
    await loadPeople(true);
  };
  const add = async () => {
    const e = email.trim().toLowerCase();
    if (!e.endsWith('@' + ALLOWED_DOMAIN)) return setErr(`Use an @${ALLOWED_DOMAIN} email.`);
    setErr('');
    await db.upsert('members', { id: e, email: e } as any);
    setEmail('');
    await loadPeople(true);
  };
  return (
    <>
      <PageHeader title="People" subtitle="Everyone who signs in is added automatically. Set names and teams here; they appear in every owner, POC and team picker." />
      <Card>
        <CardHeader title={`${people.length} people`} subtitle="Changes save when you leave a field" />
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 px-2 font-medium">Name</th>
                <th className="py-2 px-2 font-medium">Team</th>
              </tr>
            </thead>
            <tbody>
              {people.map((m) => (
                <Row key={m.id} m={m} save={save} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <TextInput className="flex-1 min-w-[240px]" placeholder={`Add someone who hasn't signed in yet: name@${ALLOWED_DOMAIN}`} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Button variant="primary" icon="plus" onClick={add} disabled={!email.trim()}>Add person</Button>
        </div>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </Card>
    </>
  );
}

function Row({ m, save }: { m: Member; save: (m: Member, p: Partial<Member>) => Promise<void> }) {
  const [name, setName] = useState(m.name || '');
  const [team, setTeam] = useState(m.team || '');
  React.useEffect(() => {
    setName(m.name || '');
    setTeam(m.team || '');
  }, [m.name, m.team]);
  return (
    <tr className="border-b border-gray-100">
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-3 min-w-[220px]">
          <Avatar name={m.name || m.email} size={32} />
          <span className="text-gray-600 text-sm break-all">{m.email}</span>
        </div>
      </td>
      <td className="py-2.5 px-2 min-w-[180px]">
        <TextInput className="w-full h-9 text-sm" placeholder={m.email.split('@')[0]} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (m.name || '') && save(m, { name: name.trim() || null })} />
      </td>
      <td className="py-2.5 px-2 min-w-[180px]">
        <TextInput className="w-full h-9 text-sm" placeholder="e.g. Product & Tech" value={team} onChange={(e) => setTeam(e.target.value)} onBlur={() => team !== (m.team || '') && save(m, { team: team.trim() || null })} />
      </td>
    </tr>
  );
}
