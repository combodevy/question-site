import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLabAuthStore } from '@/lab/useLabAuthStore';
import { useLabQuizStore } from '@/lab/useLabQuizStore';
import { useLiveLabData, useLabStats } from '@/lab/hooks';
import { syncApi } from '@/lib/api';
import { ToastHost } from '@/components/ui/ToastHost';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LabAuthGate } from '@/lab/LabAuthGate';
import { LabShellLayout, type LabNavTab } from '@/lab/LabShellLayout';
import { LabOverviewView } from '@/lab/LabOverviewView';
import { LabSetupView } from '@/lab/LabSetupView';
import { LabQuizView } from '@/lab/LabQuizView';
import { LabMistakesView } from '@/lab/LabMistakesView';
import { LabAnalyticsView } from '@/lab/LabAnalyticsView';
import { LabSettingsView } from '@/lab/LabSettingsView';

const queryClient = new QueryClient();
const VALID_LAB_TABS: LabNavTab[] = ['overview', 'setup', 'mistakes', 'analytics', 'settings'];

function readInitialLabTab(): LabNavTab {
  const hash = window.location.hash.replace(/^#\/?/, '') as LabNavTab;
  return VALID_LAB_TABS.includes(hash) ? hash : 'overview';
}

const AuthenticatedLabApp: React.FC = () => {
  const user = useLabAuthStore((s) => s.user);
  const data = useLiveLabData();
  const stats = useLabStats(data);
  const quizActive = useLabQuizStore((s) => s.active);
  const setQuizUserId = useLabQuizStore((s) => s.setUserId);

  useEffect(() => {
    setQuizUserId(user?.id || '');
  }, [user?.id, setQuizUserId]);

  const [activeTab, setActiveTab] = useState<LabNavTab>(readInitialLabTab);

  const selectTab = (tab: LabNavTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, '', `#${tab}`);
  };

  useEffect(() => {
    const onHash = () => setActiveTab(readInitialLabTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const riskCount = stats.hyperRiskIds.size + stats.luckyGuessIds.size;

  return (
    <LabShellLayout
      activeTab={activeTab}
      onSelectTab={selectTab}
      focusMode={quizActive}
      riskCount={riskCount}
    >
      {quizActive ? (
        <div className="anim-page-in">
          <LabQuizView data={data} stats={stats} anyModalOpen={false} />
        </div>
      ) : (
        <div key={activeTab} className="anim-page-in">
          {activeTab === 'overview' && (
            <LabOverviewView data={data} stats={stats} onNavigate={selectTab} />
          )}
          {activeTab === 'setup' && <LabSetupView data={data} stats={stats} />}
          {activeTab === 'mistakes' && <LabMistakesView data={data} stats={stats} />}
          {activeTab === 'analytics' && <LabAnalyticsView data={data} stats={stats} />}
          {activeTab === 'settings' && <LabSettingsView data={data} stats={stats} />}
        </div>
      )}
    </LabShellLayout>
  );
};

class LabErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void syncApi.reportClientError(
      error.message,
      `${error.stack || ''}\n${info.componentStack || ''}`,
      `/lab.html${window.location.hash || ''}`,
    );
  }
  render() {
    if (this.state.error) {
      return (
        <div className="lab-theme min-h-screen bg-canvas flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-surface border border-line rounded-2xl p-6 space-y-3 text-center">
            <h2 className="text-base font-semibold text-ink">科学精练页面异常</h2>
            <p className="text-xs text-ink-muted">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-medium"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const LabApp: React.FC = () => {
  const { status, user, bootstrap } = useLabAuthStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <LabErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {status === 'booting' ? (
          <div className="lab-theme min-h-screen bg-canvas flex items-center justify-center text-xs text-ink-muted">
            正在载入科学精练系统…
          </div>
        ) : status === 'authenticated' ? (
          <AuthenticatedLabApp key={user?.id || 'lab-auth'} />
        ) : (
          <LabAuthGate />
        )}
        <ToastHost />
        <ConfirmDialog />
      </QueryClientProvider>
    </LabErrorBoundary>
  );
};
