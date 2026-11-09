import React, { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { MeContext, Shell } from './components/Layout';
import { DEMO, meFromSession, supabase } from './lib/store';
import OverviewPage from './pages/Overview';
import GrantsPage from './pages/Grants';
import HealthPage from './pages/Health';
import InsightsPage from './pages/Insights';
import SourcesPage from './pages/Sources';
import ProjectsPage from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import TemplatesPage from './pages/Templates';
import OrgContextPage from './pages/OrgContext';
import PeoplePage from './pages/People';
import SignIn from './pages/SignIn';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(DEMO);

  useEffect(() => {
    if (!supabase) {
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const me = meFromSession(session);
  useEffect(() => {
    if (me && !me.demo) {
      if (window.location.search.includes('code=')) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.email]);

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  if (!me) return <SignIn />;

  return (
    <MeContext.Provider value={me}>
      <HashRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/grants" element={<GrantsPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/sources" element={<SourcesPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:slug" element={<ProjectDetail />} />
            <Route path="/projects/:slug/:mid" element={<ProjectDetail />} />
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/context" element={<OrgContextPage />} />
            <Route path="/people" element={<PeoplePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </HashRouter>
    </MeContext.Provider>
  );
}
