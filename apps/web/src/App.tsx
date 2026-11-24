import React, { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LocalQuestion } from '@/db';
import { useAuthStore } from '@/store/useAuthStore';
import { useQuizStore } from '@/store/useQuizStore';
import { useLiveStudyData, useStudyStats } from '@/sync/hooks';
import { syncApi } from '@/lib/api';
import { naturalCompare } from '@/lib/text';
import { ShellLayout, type NavTab } from '@/components/layout/ShellLayout';
import { ToastHost } from '@/components/ui/ToastHost';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AuthGate } from '@/features/auth/AuthGate';
import { DashboardView } from '@/features/dashboard/DashboardView';
import { PracticeSetupView } from '@/features/setup/PracticeSetupView';
import { QuizView } from '@/features/quiz/QuizView';
import { LibraryView } from '@/features/library/LibraryView';
import { QuestionEditorModal } from '@/features/library/QuestionEditorModal';
import { QuestionInsightDrawer } from '@/features/library/QuestionInsightDrawer';
import { ImportCenterModal } from '@/features/library/ImportCenterModal';
import { BankManagerModal } from '@/features/library/BankManagerModal';
import { PrintExportModal } from '@/features/library/PrintExportModal';
import { AnalyticsView } from '@/features/analytics/AnalyticsView';
import { EnglishView } from '@/features/english/EnglishView';
import { ProfileView } from '@/features/profile/ProfileView';

const queryClient = new QueryClient();

const VALID_TABS: NavTab[] = ['dashboard', 'setup', 'library', 'analytics', 'english', 'profile'];

function readInitialTab(): NavTab {
  const hash = window.location.hash.replace(/^#\/?/, '') as NavTab;
  return VALID_TABS.includes(hash) ? hash : 'dashboard';
}

const AuthenticatedApp: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const data = useLiveStudyData();
  const stats = useStudyStats(data);
  const quizActive = useQuizStore((s) => s.active);
  const setQuizUserId = useQuizStore((s) => s.setUserId);

  useEffect(() => {
    setQuizUserId(user?.id || '');
  }, [user?.id, setQuizUserId]);

  const [activeTab, setActiveTab] = useState<NavTab>(readInitialTab);
  const [libJump, setLibJump] = useState<{ sub: string; chap: string; nonce: number } | null>(null);

  // Shared modals & drawer state
  const [editorState, setEditorState] = useState<{
    open: boolean;
    question: LocalQuestion | null;
    presetSub?: string;
    presetChap?: string;
  }>({ open: false, question: null });
  const [inspectQ, setInspectQ] = useState<LocalQuestion | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bankMgrOpen, setBankMgrOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const selectTab = (tab: NavTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, '', `#${tab}`);
  };

  useEffect(() => {
    const onHash = () => setActiveTab(readInitialTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const chaptersBySubject = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of stats.subjectTree) {
      m.set(
        s.sub,
        s.chapters.map((c) => c.chap).sort(naturalCompare),
      );
    }
    return m;
  }, [stats.subjectTree]);

  const anyModalOpen =
    editorState.open || Boolean(inspectQ) || importOpen || bankMgrOpen || printOpen;

  return (
    <ShellLayout
      activeTab={activeTab}
      onSelectTab={selectTab}
      focusMode={quizActive}
      pendingWrongCount={stats.visibleMistakeIds.size}
    >
      {quizActive ? (
        <div className="anim-page-in">
          <QuizView
            data={data}
            anyModalOpen={anyModalOpen}
            onEditQuestion={(q) => setEditorState({ open: true, question: q })}
            onInspectQuestion={(q) => setInspectQ(q)}
          />
        </div>
      ) : (
        <div key={activeTab} className="anim-page-in">
          {activeTab === 'dashboard' && (
            <DashboardView
              data={data}
              stats={stats}
              onNavigate={selectTab}
              onOpenImport={() => setImportOpen(true)}
            />
          )}
          {activeTab === 'setup' && (
            <PracticeSetupView
              data={data}
              stats={stats}
              onOpenImport={() => setImportOpen(true)}
            />
          )}
          {activeTab === 'library' && (
            <LibraryView
              data={data}
              stats={stats}
              jumpFilter={libJump}
              onEditQuestion={(q, presetSub, presetChap) =>
                setEditorState({ open: true, question: q, presetSub, presetChap })
              }
              onInspectQuestion={(q) => setInspectQ(q)}
              onOpenImport={() => setImportOpen(true)}
              onOpenBankManager={() => setBankMgrOpen(true)}
              onOpenPrintExport={() => setPrintOpen(true)}
            />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsView
              data={data}
              stats={stats}
              onInspectQuestion={(q) => setInspectQ(q)}
            />
          )}
          {activeTab === 'english' && <EnglishView data={data} />}
          {activeTab === 'profile' && <ProfileView data={data} stats={stats} />}
        </div>
      )}

      <QuestionEditorModal
        open={editorState.open}
        question={editorState.question}
        defaultSub={editorState.presetSub}
        defaultChap={editorState.presetChap}
        existingSubjects={stats.subjectTree.map((s) => s.sub)}
        chaptersBySubject={chaptersBySubject}
        onClose={() => setEditorState({ open: false, question: null })}
      />

      <QuestionInsightDrawer
        question={inspectQ}
        history={data.history}
        onClose={() => setInspectQ(null)}
      />

      <ImportCenterModal
        open={importOpen}
        existingQuestions={data.questions}
        onClose={() => setImportOpen(false)}
      />

      <BankManagerModal
        open={bankMgrOpen}
        data={data}
        stats={stats}
        onJumpFilter={(sub, chap) => {
          setLibJump({ sub, chap: chap || 'all', nonce: Date.now() });
          selectTab('library');
        }}
        onCreateQuestionIn={(sub, chap) => {
          setEditorState({ open: true, question: null, presetSub: sub, presetChap: chap });
        }}
        onClose={() => setBankMgrOpen(false)}
      />

      <PrintExportModal
        open={printOpen}
        questions={data.questions}
        subjects={stats.subjectTree.map((s) => s.sub)}
        onClose={() => setPrintOpen(false)}
      />
    </ShellLayout>
  );
};

class ErrorBoundary extends React.Component<
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
      window.location.hash || '/',
    );
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-surface border border-line rounded-2xl p-6 space-y-3 text-center">
            <h2 className="text-base font-semibold text-ink">页面渲染异常</h2>
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

export const App: React.FC = () => {
  const { status, bootstrap } = useAuthStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {status === 'booting' ? (
          <div className="min-h-screen bg-canvas flex items-center justify-center text-xs text-ink-muted">
            正在载入在线刷题平台…
          </div>
        ) : status === 'authenticated' ? (
          <AuthenticatedApp />
        ) : (
          <AuthGate />
        )}
        <ToastHost />
        <ConfirmDialog />
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
