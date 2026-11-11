import React, { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon, { IconName } from './Icon';
import { Avatar, Badge, cx } from './ui';
import { DEMO, Me, onSaveError, signOut } from '../lib/store';
import { useLocalPref } from '../lib/hooks';

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;

const NAV: { to: string; label: string; icon: IconName; group?: string }[] = [
  { to: '/', label: 'Overview', icon: 'home' },
  { to: '/grants', label: 'Funds & Grants', icon: 'coins', group: 'Market View' },
  { to: '/health', label: 'Health Map', icon: 'globe', group: 'Market View' },
  { to: '/insights', label: 'Latest Insights', icon: 'newspaper', group: 'Market View' },
  { to: '/sources', label: 'Sources & Status', icon: 'rss', group: 'Market View' },
  { to: '/projects', label: 'Projects', icon: 'folder', group: 'Project Dashboards' },
  { to: '/templates', label: 'Milestone Templates', icon: 'layers', group: 'Project Dashboards' },
  { to: '/context', label: 'Org Context', icon: 'building', group: 'Settings' },
  { to: '/people', label: 'People', icon: 'users', group: 'Settings' },
];

export function Sidebar() {
  const me = useMe();
  const [collapsed, setCollapsed] = useLocalPref('sidebar-collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);

  let lastGroup: string | undefined;
  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      {NAV.map((n) => {
        const header = n.group && n.group !== lastGroup && !collapsed ? n.group : null;
        lastGroup = n.group;
        return (
          <React.Fragment key={n.to}>
            {header && <div className="px-3 pt-4 pb-1 text-[12px] font-medium tracking-wider uppercase text-gray-400">{header}</div>}
            <NavLink
              to={n.to}
              end={n.to === '/'}
              title={collapsed ? n.label : undefined}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-4 rounded-xl px-4 h-12 text-[16px] transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive ? 'bg-brand-50 text-brand-700 font-medium shadow-sm ring-1 ring-brand-100 border-l-[3px] border-brand-600' : 'text-gray-700 hover:bg-gray-50'
                )
              }
            >
              <Icon name={n.icon} size={21} className="shrink-0" />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </NavLink>
          </React.Fragment>
        );
      })}
    </nav>
  );

  const body = (
    <div className="flex flex-col h-full">
      <div className={cx('px-6 pt-6 pb-5 border-b border-gray-200', collapsed && 'px-3')}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-3">
            <img src={`${process.env.PUBLIC_URL}/favicon.png`} alt="Wadhwani AI Global" className="w-10 h-10" />
            <button type="button" onClick={() => setCollapsed(false)} title="Expand sidebar" aria-label="Expand sidebar" className="hidden lg:flex w-9 h-9 rounded-lg items-center justify-center text-gray-500 hover:bg-gray-100">
              <Icon name="chevronsRight" size={18} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="Wadhwani AI Global" className="h-[52px] w-auto" />
              <button type="button" onClick={() => setCollapsed(true)} title="Collapse sidebar" aria-label="Collapse sidebar" className="hidden lg:flex w-9 h-9 rounded-lg items-center justify-center text-gray-500 hover:bg-gray-100 shrink-0">
                <Icon name="chevronsLeft" size={18} />
              </button>
            </div>
            <div className="mt-4 text-[17px] text-gray-900 font-medium">WAIG Atlas</div>
            <div className="text-[15px] text-gray-500">Grants · health intelligence · projects</div>
          </>
        )}
      </div>
      {nav}
      <div className="border-t border-gray-200 px-4 py-4 min-w-0 overflow-hidden">
        <div className={cx('flex items-center gap-3', collapsed && 'justify-center')}>
          <Avatar name={me.name} size={collapsed ? 36 : 46} />
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 truncate">{me.name}</span>
                <Badge>{me.demo ? 'Demo' : 'Member'}</Badge>
              </div>
              <div className="text-sm text-gray-500 truncate">{me.email}</div>
            </div>
          )}
        </div>
        {!collapsed && (
          <p className="text-[13px] text-gray-500 mt-3 leading-relaxed flex gap-1.5 min-w-0">
            <Icon name="bars" size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">
              {DEMO
                ? 'Demo mode: your edits are saved in this browser only. Feeds refresh on schedule.'
                : 'Signed in. Edits are shared with the team. Feeds refresh on schedule.'}
              {process.env.REACT_APP_BUILD && (
                <span className="block text-gray-400 mt-1 truncate" title={`Build ${process.env.REACT_APP_BUILD}`}>
                  Build {process.env.REACT_APP_BUILD.replace(/^(\d+)-([0-9a-f]{7})[0-9a-f]*$/, '$1 · $2')}
                </span>
              )}
            </span>
          </p>
        )}
      </div>
      <button type="button" onClick={() => setCollapsed(!collapsed)} className={cx('hidden lg:flex items-center gap-3 border-t border-gray-200 px-6 h-14 text-gray-700 hover:bg-gray-50', collapsed && 'justify-center px-0')}>
        <Icon name={collapsed ? 'chevronsRight' : 'chevronsLeft'} size={20} />
        {!collapsed && <span>Hide</span>}
      </button>
    </div>
  );

  return (
    <>
      <button type="button" className="lg:hidden fixed top-3 left-3 z-40 w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center shadow-card" onClick={() => setMobileOpen(true)} aria-label="Open menu">
        <Icon name="menu" />
      </button>
      <aside className={cx('hidden lg:block shrink-0 bg-white border-r border-gray-200 h-screen sticky top-0 overflow-x-hidden', collapsed ? 'w-[84px]' : 'w-[300px]')}>{body}</aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-gray-900/30" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-[290px] max-w-[85vw] h-full bg-white shadow-xl overflow-x-hidden">{body}</aside>
        </div>
      )}
    </>
  );
}

export function PageHeader({ title, subtitle, updatedAt, actions }: { title: string; subtitle?: string; updatedAt?: string | null; actions?: React.ReactNode }) {
  const me = useMe();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const stamp = updatedAt ? new Date(updatedAt) : now;
  return (
    <header className="flex flex-col xl:flex-row items-start gap-4 justify-between mb-7 pl-12 lg:pl-0">
      <div className="min-w-0 flex-1">
        <h1 className="text-[34px] sm:text-[40px] font-bold tracking-tight text-gray-900 leading-tight">{title}</h1>
        {subtitle && <p className="text-[17px] text-gray-600 mt-2">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        {actions}
        <span className="hidden md:inline-flex items-center gap-1.5 text-[15px] text-gray-400" title={updatedAt ? 'Last data refresh' : 'Live clock'}>
          <Icon name="refresh" size={16} />
          {updatedAt ? 'updated' : 'live'} · {stamp.toLocaleString('en-GB', updatedAt ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' })}
        </span>
        <div className="hidden md:flex items-center gap-3 bg-white border border-gray-200 rounded-2xl pl-3 pr-4 py-2.5 shadow-card">
          <Avatar name={me.name} size={44} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900">{me.name}</span>
              <Badge>{me.demo ? 'Demo' : 'Member'}</Badge>
            </div>
            <div className="text-sm text-gray-500">{me.email.split('@')[0]} · INTERNAL</div>
          </div>
        </div>
        {!me.demo && (
          <button type="button" onClick={() => signOut()} title="Sign out" className="w-14 h-14 rounded-2xl bg-white border border-gray-200 shadow-card flex items-center justify-center text-gray-700 hover:bg-gray-50">
            <Icon name="logout" size={22} />
          </button>
        )}
      </div>
    </header>
  );
}

function useNewVersion() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const current = Array.from(document.scripts).map((s) => s.src).find((s) => /static\/js\/main\.[\w]+\.js/.test(s));
    if (!current) return;
    const check = async () => {
      try {
        const r = await fetch(`${process.env.PUBLIC_URL}/asset-manifest.json`, { cache: 'no-store' });
        const j = await r.json();
        const latest = j?.files?.['main.js'];
        if (latest && !current.endsWith(latest.replace(/^\.\//, '').replace(/^\//, ''))) setStale(true);
      } catch {}
    };
    const t = setInterval(check, 5 * 60 * 1000);
    check();
    return () => clearInterval(t);
  }, []);
  return stale;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const stale = useNewVersion();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    const off = onSaveError((m) => {
      setToast(`Couldn't save: ${m}`);
      setTimeout(() => setToast(null), 6000);
    });
    return () => {
      off();
    };
  }, []);
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 min-w-0 px-4 sm:px-8 lg:px-12 py-6 lg:py-10">
        {stale && (
          <div className="mb-5 flex flex-wrap items-center gap-3 bg-brand-50 border border-brand-200 text-brand-800 rounded-2xl px-5 py-3 text-[15px]">
            <Icon name="refresh" size={18} />
            <span className="flex-1">A newer version of Atlas is available.</span>
            <button type="button" onClick={() => window.location.reload()} className="px-3 h-9 rounded-lg bg-brand-600 text-white text-sm font-medium">Reload</button>
          </div>
        )}
        {children}
      </main>
      {toast && (
        <div role="alert" className="fixed bottom-5 right-5 z-[70] max-w-sm bg-gray-900 text-white text-sm rounded-xl px-4 py-3 shadow-2xl">{toast}</div>
      )}
    </div>
  );
}
