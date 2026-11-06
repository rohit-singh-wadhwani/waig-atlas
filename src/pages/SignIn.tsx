import React, { useState } from 'react';
import { ALLOWED_DOMAIN, signInWithEmail } from '../lib/store';
import { Button, TextInput } from '../components/ui';
import Icon from '../components/Icon';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const m = await signInWithEmail(email.trim().toLowerCase());
    setBusy(false);
    if (m) setErr(m);
    else setSent(true);
  };
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-card w-full max-w-md p-8">
        <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="Wadhwani AI Global" className="h-[52px]" />
        <h1 className="text-2xl font-bold text-gray-900 mt-6">WAIG Atlas</h1>
        <p className="text-gray-600 mt-1">Grants, health intelligence and project dashboards.</p>
        {sent ? (
          <div className="mt-6 bg-brand-50 border border-brand-100 rounded-xl p-4 text-[15px] text-brand-800 flex gap-3">
            <Icon name="checkCircle" size={20} className="mt-0.5 shrink-0" />
            <div>Check <b>{email}</b> for a sign-in link. It works once and expires in an hour.</div>
          </div>
        ) : (
          <form onSubmit={go} className="mt-6 space-y-3">
            <label className="block text-sm font-medium text-gray-700">Work email</label>
            <TextInput type="email" required autoFocus className="w-full" placeholder={`you@${ALLOWED_DOMAIN}`} value={email} onChange={(e) => setEmail(e.target.value)} />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <Button variant="primary" className="w-full h-11" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</Button>
            <p className="text-xs text-gray-500">Only @{ALLOWED_DOMAIN} addresses can sign in.</p>
          </form>
        )}
      </div>
    </div>
  );
}
