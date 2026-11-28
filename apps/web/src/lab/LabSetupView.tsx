import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Check,
  CheckSquare,
  FlaskConical,
  Layers,
  Play,
  RefreshCw,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
} from 'lucide-react';
import {
  composeLabSession,
  estimateSessionAccuracy,
  type LabPracticeMode,
  type LabSettings,
  type QuestionType,
} from '@qs/shared';
import type { LiveLabSnapshot, LabStats } from '@/lab/hooks';
import { useLabAuthStore } from '@/lab/useLabAuthStore';
import { useLabQuizStore } from '@/lab/useLabQuizStore';
import { getLabSyncEngine } from '@/lab/syncEngine';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

interface LabSetupViewProps {
  data: LiveLabSnapshot;
  stats: LabStats;
}

type SetupLimit = '10' | '20' | '30' | '50' | 'all';

interface StoredLabSetupPrefs {
  mode?: LabPracticeMode;
  type?: 'all' | QuestionType;
  limit?: SetupLimit;
  checked?: string[];
  seen?: string[];
}

export const LabSetupView: React.FC<LabSetupViewProps> = ({ data, stats }) => {
  const { bi } = useBi();
  const user = useLabAuthStore((s) => s.user);
  const startSession = useLabQuizStore((s) => s.startSession);
  const { pushToast } = useUiStore();

  const prefKey = `qs_lab_setup_prefs_${user?.id || 'anon'}`;

  const [mode, setMode] = useState<LabPracticeMode>('smart_interleave');
  const [typeFilter, setTypeFilter] = useState<'all' | QuestionType>('all');
  const [limit, setLimit] = useState<SetupLimit>('20');
  const [selectedChaps, setSelectedChaps] = useState<Set<string>>(new Set());
  const [seenChaps, setSeenChaps] = useState<Set<string>>(new Set());
  const [initializedForUser, setInitializedForUser] = useState<string | null>(null);
  const [settings, setSettings] = useState<LabSettings>(data.settings);

  useEffect(() => {
    setSettings(data.settings);
  }, [data.settings]);

  const persistPrefs = (
    nextSelected: Set<string>,
    nextSeen: Set<string>,
    nextMode: LabPracticeMode = mode,
    nextType: 'all' | QuestionType = typeFilter,
    nextLimit: SetupLimit = limit,
  ) => {
    try {
      const payload: StoredLabSetupPrefs = {
        mode: nextMode,
        type: nextType,
        limit: nextLimit,
        checked: Array.from(nextSelected),
        seen: Array.from(nextSeen),
      };
      localStorage.setItem(prefKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const allKeys = new Set<string>();
    for (const s of stats.subjectTree) {
      for (const c of s.chapters) allKeys.add(`${s.sub}\u0001${c.chap}`);
    }
    if (allKeys.size === 0) return;

    const uidTag = user?.id || 'anon';
    if (initializedForUser !== uidTag) {
      let nextMode: LabPracticeMode = 'smart_interleave';
      let nextType: 'all' | QuestionType = 'all';
      let nextLimit: SetupLimit = '20';
      let nextChecked = new Set<string>(allKeys);
      let nextSeen = new Set<string>(allKeys);

      try {
        const raw = JSON.parse(localStorage.getItem(prefKey) || 'null') as StoredLabSetupPrefs | null;
        if (raw) {
          if (
            raw.mode &&
            [
              'smart_interleave',
              'fsrs_review',
              'dual_track',
              'blocked_build',
              'blocked_to_interleaved',
              'starred',
            ].includes(raw.mode)
          ) {
            nextMode = raw.mode;
          }
          if (raw.type && ['all', 'mcq', 'multi', 'tf', 'fill', 'qa'].includes(raw.type)) {
            nextType = raw.type;
          }
          if (raw.limit && ['10', '20', '30', '50', 'all'].includes(raw.limit)) {
            nextLimit = raw.limit;
          }
          if (Array.isArray(raw.checked)) {
            const savedChecked = new Set(raw.checked);
            const savedSeen = new Set(Array.isArray(raw.seen) ? raw.seen : raw.checked);
            nextChecked = new Set<string>();
            for (const k of allKeys) {
              if (!savedSeen.has(k) || savedChecked.has(k)) {
                nextChecked.add(k);
              }
            }
            nextSeen = new Set([...savedSeen, ...allKeys]);
          }
        }
      } catch {
        // fallback defaults
      }

      setMode(nextMode);
      setTypeFilter(nextType);
      setLimit(nextLimit);
      setSelectedChaps(nextChecked);
      setSeenChaps(nextSeen);
      setInitializedForUser(uidTag);
      persistPrefs(nextChecked, nextSeen, nextMode, nextType, nextLimit);
      return;
    }

    const unseenNew: string[] = [];
    for (const k of allKeys) {
      if (!seenChaps.has(k)) unseenNew.push(k);
    }
    if (unseenNew.length > 0) {
      const nextChecked = new Set(selectedChaps);
      const nextSeen = new Set(seenChaps);
      for (const k of unseenNew) {
        nextChecked.add(k);
        nextSeen.add(k);
      }
      setSelectedChaps(nextChecked);
      setSeenChaps(nextSeen);
      persistPrefs(nextChecked, nextSeen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.subjectTree, user?.id, initializedForUser]);

  const updateChecked = (nextSelected: Set<string>) => {
    setSelectedChaps(nextSelected);
    persistPrefs(nextSelected, seenChaps);
  };

  const updateStrategySetting = <K extends keyof LabSettings>(key: K, val: LabSettings[K]) => {
    const next: LabSettings = { ...settings, [key]: val };
    setSettings(next);
    void getLabSyncEngine()?.updateSettings(next);
  };

  const toggleChap = (key: string) => {
    const next = new Set(selectedChaps);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateChecked(next);
  };

  const toggleSubject = (sub: string, chaps: Array<{ chap: string }>) => {
    const keys = chaps.map((c) => `${sub}\u0001${c.chap}`);
    const allChecked = keys.every((k) => selectedChaps.has(k));
    const next = new Set(selectedChaps);
    for (const k of keys) {
      if (allChecked) next.delete(k);
      else next.add(k);
    }
    updateChecked(next);
  };

  const selectOnlySubject = (sub: string, chaps: Array<{ chap: string }>) => {
    const next = new Set(chaps.map((c) => `${sub}\u0001${c.chap}`));
    updateChecked(next);
    if (mode === 'fsrs_review' || mode === 'dual_track' || mode === 'starred') {
      setMode('smart_interleave');
      persistPrefs(next, seenChaps, 'smart_interleave', typeFilter, limit);
    }
    pushToast(bi(`已切换为仅练习 ${sub}`, `Scoped to ${sub}`), 'info');
  };

  const selectOnlyChapter = (key: string, chapName: string) => {
    const next = new Set([key]);
    updateChecked(next);
    if (mode === 'fsrs_review' || mode === 'dual_track' || mode === 'starred') {
      setMode('smart_interleave');
      persistPrefs(next, seenChaps, 'smart_interleave', typeFilter, limit);
    }
    pushToast(bi(`已选中：${chapName}`, `Selected: ${chapName}`), 'info');
  };

  const invertAllChapters = () => {
    const next = new Set<string>();
    for (const s of stats.subjectTree) {
      for (const c of s.chapters) {
        const k = `${s.sub}\u0001${c.chap}`;
        if (!selectedChaps.has(k)) next.add(k);
      }
    }
    updateChecked(next);
  };

  const isGlobalPoolMode = mode === 'fsrs_review' || mode === 'dual_track' || mode === 'starred';

  const previewComposed = useMemo(() => {
    let pool = data.questions;
    if (!isGlobalPoolMode) {
      if (selectedChaps.size === 0) pool = [];
      else pool = pool.filter((q) => selectedChaps.has(`${q.sub}\u0001${q.chap}`));
    }
    if (typeFilter !== 'all') pool = pool.filter((q) => q.type === typeFilter);

    const parsedLim = limit === 'all' ? 'all' : parseInt(limit, 10);
    return composeLabSession({
      questions: pool,
      cardStates: stats.cardMap,
      mode,
      limit: parsedLim,
      desiredRetention: settings.desiredRetention,
      starredIds: stats.starredIds,
      hiddenMistakeIds: stats.hiddenMistakeIds,
    });
  }, [
    data.questions,
    isGlobalPoolMode,
    selectedChaps,
    typeFilter,
    limit,
    mode,
    stats.cardMap,
    stats.starredIds,
    stats.hiddenMistakeIds,
    settings.desiredRetention,
  ]);

  const predictedAcc = useMemo(
    () => estimateSessionAccuracy(previewComposed, stats.cardMap),
    [previewComposed, stats.cardMap],
  );

  const launch = (overrideChaps?: string[], overrideTitle?: string) => {
    let pool = data.questions;
    let effectiveMode = mode;
    if (overrideChaps) {
      const set = new Set(overrideChaps);
      pool = pool.filter((q) => set.has(`${q.sub}\u0001${q.chap}`));
      if (isGlobalPoolMode) effectiveMode = 'smart_interleave';
    } else if (!isGlobalPoolMode) {
      if (selectedChaps.size === 0) {
        pushToast(bi('请至少勾选一个章节', 'Select at least one chapter'), 'warning');
        return;
      }
      pool = pool.filter((q) => selectedChaps.has(`${q.sub}\u0001${q.chap}`));
    }

    if (typeFilter !== 'all') {
      pool = pool.filter((q) => q.type === typeFilter);
    }

    const parsedLim = limit === 'all' ? 'all' : parseInt(limit, 10);
    const composed = composeLabSession({
      questions: pool,
      cardStates: stats.cardMap,
      mode: effectiveMode,
      limit: parsedLim,
      desiredRetention: settings.desiredRetention,
      starredIds: stats.starredIds,
      hiddenMistakeIds: stats.hiddenMistakeIds,
    });

    if (!composed.length) {
      pushToast(bi('当前筛选条件下没有可组卷题目', 'No questions match current configuration'), 'warning');
      return;
    }

    const modeNames: Record<LabPracticeMode, string> = {
      smart_interleave: bi('智能穿插精练', 'Smart Interleave'),
      fsrs_review: bi('FSRS 到期复习', 'FSRS Review'),
      dual_track: bi('双轨错题攻坚', 'Dual-Track Mistakes'),
      blocked_build: bi('分块建图式', 'Blocked Schema Build'),
      blocked_to_interleaved: bi('先分块后穿插', 'Blocked -> Interleaved'),
      starred: bi('精练收藏专练', 'Lab Starred'),
    };

    startSession({
      mode: effectiveMode,
      questions: composed,
      title: overrideTitle || modeNames[effectiveMode],
      settings,
    });
  };

  if (data.questions.length === 0) {
    return (
      <EmptyState
        icon={<FlaskConical className="w-5 h-5" />}
        title={bi('共享题库暂无题目', 'No Shared Questions')}
        description={bi('请先在经典版题库管理中添加题目，即可在此进行科学组卷。', 'Add questions in Classic Library first.')}
        action={
          <a
            href="/#library"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-fg text-xs font-medium hover:bg-accent-hover transition-colors"
          >
            {bi('打开共享题库', 'Open Shared Library')}
          </a>
        }
      />
    );
  }

  const modeCards: Array<{
    key: LabPracticeMode;
    label: string;
    hint: string;
    badge?: string | number;
    badgeTone?: 'accent' | 'warning' | 'danger' | 'neutral' | 'success';
    icon: React.ReactNode;
    iconTone: string;
  }> = [
    {
      key: 'smart_interleave',
      label: bi('智能穿插 (75-85%)', 'Smart Interleave'),
      hint: bi('临近遗忘 + 双轨风险 + 跨章混编', 'Sweet spot + cross-chapter mix'),
      icon: <Shuffle className="w-4 h-4" />,
      iconTone: 'bg-accent-soft text-accent',
      badge: bi('推荐', 'Best'),
      badgeTone: 'accent',
    },
    {
      key: 'fsrs_review',
      label: bi('FSRS 到期复习', 'FSRS Due Queue'),
      hint: bi('优先抢救濒临遗忘与高危误区', 'Lowest retrievability first'),
      icon: <Brain className="w-4 h-4" />,
      iconTone: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
      badge: stats.dueCount,
      badgeTone: stats.dueCount > 0 ? 'warning' : 'neutral',
    },
    {
      key: 'dual_track',
      label: bi('双轨错题攻坚', 'Dual-Track Errors'),
      hint: bi('高自信误区优先 + 蒙对隐患复测', 'Hypercorrection + lucky guesses'),
      icon: <AlertTriangle className="w-4 h-4" />,
      iconTone: 'bg-red-500/15 text-red-600 dark:text-red-400',
      badge: stats.visibleMistakeIds.size,
      badgeTone: stats.visibleMistakeIds.size > 0 ? 'danger' : 'neutral',
    },
    {
      key: 'blocked_to_interleaved',
      label: bi('先分块后穿插', 'Blocked -> Interleaved'),
      hint: bi('前 40% 小组抓共性，后 60% 辨差异', '40% schema + 60% discrimination'),
      icon: <Layers className="w-4 h-4" />,
      iconTone: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    },
    {
      key: 'blocked_build',
      label: bi('分块建图式', 'Blocked Practice'),
      hint: bi('新手入门与词汇表按章集中', 'Chapter-grouped for novices/vocab'),
      icon: <BookOpen className="w-4 h-4" />,
      iconTone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    },
    {
      key: 'starred',
      label: bi('精练收藏专练', 'Lab Starred'),
      hint: bi('仅练科学精练内加星标的题', 'Isolated Lab bookmarks'),
      icon: <Star className="w-4 h-4" />,
      iconTone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      badge: stats.starredIds.size,
      badgeTone: 'neutral',
    },
  ];

  const strategyToggles: Array<{
    key: 'shuffleOptions' | 'blindRecall' | 'requeueWrong' | 'delayedFeedback' | 'hideTimer';
    label: string;
    desc: string;
  }> = [
    {
      key: 'shuffleOptions',
      label: bi('选项随机乱序', 'Shuffle Options'),
      desc: bi('消除记住 A/B/C/D 位置的虚假熟练', 'Prevents position memorization'),
    },
    {
      key: 'blindRecall',
      label: bi('盲答先思考模式', 'Blind Recall Mode'),
      desc: bi('选择题先遮挡选项，回忆后再展开对照', 'Hide choices until recalled'),
    },
    {
      key: 'requeueWrong',
      label: bi('错题组内回炉', 'In-Session Requeue'),
      desc: bi('答错自动延后 4-5 题再测，落实连续重学', 'Re-test missed items 4-5 slots later'),
    },
    {
      key: 'delayedFeedback',
      label: bi('整组延迟反馈', 'Delayed Exam Feedback'),
      desc: bi('交卷后统一看解析，防卡漏洞与读秒焦虑', 'Grade entire session upon completion'),
    },
    {
      key: 'hideTimer',
      label: bi('隐藏读秒倒数感', 'Hide Live Timer'),
      desc: bi('后台继续测反应时，界面不制造限时焦虑', 'Still logs ARTS speed silently'),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center">
            <SlidersHorizontal className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {bi('科学组卷配置', 'Cognitive Session Composer')}
            </h1>
            <p className="text-xs text-ink-muted">
              {bi('支持穿插调度、盲答提取、组内回炉与置信度捕捉', 'Interleaving, blind recall, requeuing & confidence calibration')}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Mode + Strategy Panel */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="space-y-4">
            <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              {bi('选择练习序列模式', 'Sequencing Mode')}
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="lab-setup-mode-grid">
              {modeCards.map((m) => {
                const selected = mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    data-testid={`lab-mode-${m.key}`}
                    onClick={() => {
                      setMode(m.key);
                      persistPrefs(selectedChaps, seenChaps, m.key, typeFilter, limit);
                    }}
                    className={`group relative text-left p-3 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.985] flex items-start gap-2.5 ${
                      selected
                        ? 'border-accent bg-accent-soft/50 shadow-sm ring-1 ring-accent/25'
                        : 'border-line bg-canvas/70 hover:bg-canvas hover:border-ink-muted/35'
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-xl inline-flex items-center justify-center flex-shrink-0 ${m.iconTone}`}>
                      {m.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-ink truncate">{m.label}</span>
                        {m.badge !== undefined && (
                          <Badge tone={m.badgeTone || 'neutral'}>{m.badge}</Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5 line-clamp-1">{m.hint}</div>
                    </div>
                    {selected && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-accent text-accent-fg flex items-center justify-center shadow-sm">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1.5">
                  {bi('题型过滤', 'Type Filter')}
                </label>
                <select
                  value={typeFilter}
                  onChange={(e) => {
                    const v = e.target.value as 'all' | QuestionType;
                    setTypeFilter(v);
                    persistPrefs(selectedChaps, seenChaps, mode, v, limit);
                  }}
                  className="w-full h-9 px-2.5 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="all">{bi('全部题型', 'All Types')}</option>
                  <option value="mcq">{bi('单选题', 'Single Choice')}</option>
                  <option value="multi">{bi('多选题', 'Multiple Choice')}</option>
                  <option value="tf">{bi('判断题', 'True / False')}</option>
                  <option value="fill">{bi('填空题', 'Fill in Blank')}</option>
                  <option value="qa">{bi('问答题', 'Q&A')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1.5">
                  {bi('本组题数', 'Session Size')}
                </label>
                <select
                  value={limit}
                  onChange={(e) => {
                    const v = e.target.value as SetupLimit;
                    setLimit(v);
                    persistPrefs(selectedChaps, seenChaps, mode, typeFilter, v);
                  }}
                  className="w-full h-9 px-2.5 rounded-xl bg-canvas border border-line text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="10">10 {bi('题', 'Q')}</option>
                  <option value="20">20 {bi('题', 'Q')}</option>
                  <option value="30">30 {bi('题', 'Q')}</option>
                  <option value="50">50 {bi('题', 'Q')}</option>
                  <option value="all">{bi('全部', 'All')}</option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-line space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-ink-muted tabular-nums">
                  {bi(`拟组卷 ${previewComposed.length} 题`, `${previewComposed.length} questions queued`)}
                </span>
                {previewComposed.length > 0 && (
                  <Badge
                    tone={
                      predictedAcc >= 70 && predictedAcc <= 88
                        ? 'success'
                        : predictedAcc < 70
                        ? 'warning'
                        : 'neutral'
                    }
                  >
                    {bi(`预计正确率 ~${predictedAcc}%`, `Est. Accuracy ~${predictedAcc}%`)}
                  </Badge>
                )}
              </div>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={previewComposed.length === 0}
                onClick={() => launch()}
                data-testid="lab-setup-start-btn"
              >
                <Play className="w-4 h-4" />
                {bi('开始科学精练', 'Start Science Session')}
              </Button>
            </div>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                {bi('认知策略护栏（自动保存）', 'Cognitive Strategy Toggles')}
              </span>
            </div>

            <div className="space-y-2">
              {strategyToggles.map((t) => {
                const on = Boolean(settings[t.key]);
                return (
                  <label
                    key={t.key}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-canvas/70 border border-line cursor-pointer hover:border-accent/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-ink">{t.label}</div>
                      <div className="text-[11px] text-ink-muted">{t.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={on}
                      data-testid={`lab-toggle-${t.key}`}
                      onChange={(e) => updateStrategySetting(t.key, e.target.checked)}
                      className="accent-[var(--accent)] w-4 h-4 flex-shrink-0"
                    />
                  </label>
                );
              })}

              <div className="p-2.5 rounded-xl bg-canvas/70 border border-line space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink">{bi('自信度捕捉模式', 'Confidence Capture')}</span>
                  <select
                    value={settings.confidenceMode}
                    data-testid="lab-confidence-mode-select"
                    onChange={(e) =>
                      updateStrategySetting(
                        'confidenceMode',
                        e.target.value as LabSettings['confidenceMode'],
                      )
                    }
                    className="h-7 px-2 rounded-lg bg-surface border border-line text-xs text-ink outline-none focus:border-accent"
                  >
                    <option value="off">{bi('关闭', 'Off')}</option>
                    <option value="quick">{bi('轻量快捷 (默认)', 'Quick (Default)')}</option>
                    <option value="required">{bi('深度必选', 'Required')}</option>
                  </select>
                </div>
                <p className="text-[11px] text-ink-muted">
                  {bi(
                    '用于识别高自信误区（4天窗口强化复测）和低自信蒙对（缩短复现间隔）。',
                    'Detects hypercorrection errors (<=4d window) and low-confidence lucky guesses.',
                  )}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Subjects & Chapters Tree */}
        <Card className="lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent inline-flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5" />
              </span>
              <h3 className="text-sm font-semibold text-ink">{bi('科目与章节范围（共享题库）', 'Subjects & Chapters (Shared Bank)')}</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const all = new Set<string>();
                  stats.subjectTree.forEach((s) =>
                    s.chapters.forEach((c) => all.add(`${s.sub}\u0001${c.chap}`)),
                  );
                  updateChecked(all);
                }}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {bi('全选', 'All')}
              </Button>
              <Button size="sm" variant="outline" onClick={invertAllChapters}>
                <RefreshCw className="w-3.5 h-3.5" />
                {bi('反选', 'Invert')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => updateChecked(new Set())}>
                <Square className="w-3.5 h-3.5" />
                {bi('清空', 'Clear')}
              </Button>
            </div>
          </div>

          {isGlobalPoolMode && (
            <div className="px-3 py-2 rounded-xl bg-accent-soft/45 border border-accent/25 text-xs text-ink">
              {bi(
                '当前处于跨科智能审查模式（FSRS 到期 / 双轨错题 / 精练收藏），默认覆盖全部已勾选之外的全库记录；点击右侧“直练”可立即针对单章穿插练习。',
                'Current mode scopes globally across tracked questions; click Go on any chapter to launch a chapter-scoped session.',
              )}
            </div>
          )}

          <div className="space-y-3">
            {stats.subjectTree.map((s) => {
              const keys = s.chapters.map((c) => `${s.sub}\u0001${c.chap}`);
              const checkedCount = keys.filter((k) => selectedChaps.has(k)).length;
              const allChecked = keys.length > 0 && checkedCount === keys.length;
              return (
                <div key={s.sub} className="rounded-xl border border-line bg-canvas/50 p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSubject(s.sub, s.chapters)}
                      className="flex items-center gap-2 text-sm font-semibold text-ink hover:text-accent transition-colors text-left min-w-0"
                    >
                      {allChecked ? (
                        <CheckSquare className="w-4 h-4 text-accent flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-ink-muted flex-shrink-0" />
                      )}
                      <span className="truncate">{s.sub}</span>
                    </button>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[11px] text-ink-muted tabular-nums">
                        {checkedCount}/{s.chapters.length} {bi('章', 'ch')} ({s.total} {bi('题', 'Q')})
                      </span>
                      <button
                        type="button"
                        onClick={() => selectOnlySubject(s.sub, s.chapters)}
                        className="px-2 py-0.5 rounded-md border border-line bg-surface text-[11px] font-medium text-ink-muted hover:text-ink hover:border-accent/50 transition-colors"
                      >
                        {bi('仅此科', 'Only')}
                      </button>
                      <button
                        type="button"
                        onClick={() => launch(keys, s.sub)}
                        className="px-2 py-0.5 rounded-md bg-accent-soft text-accent text-[11px] font-medium hover:bg-accent hover:text-accent-fg transition-colors inline-flex items-center gap-1"
                      >
                        <Play className="w-2.5 h-2.5" />
                        {bi('直练', 'Go')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-1">
                    {s.chapters.map((c) => {
                      const key = `${s.sub}\u0001${c.chap}`;
                      const checked = selectedChaps.has(key);
                      return (
                        <div
                          key={key}
                          className={`flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                            checked ? 'border-accent/40 bg-surface' : 'border-line bg-surface/50 opacity-75'
                          }`}
                        >
                          <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleChap(key)}
                              className="accent-[var(--accent)] w-3.5 h-3.5 flex-shrink-0"
                            />
                            <span className="truncate text-ink">{c.chap}</span>
                          </label>
                          <span className="text-[11px] text-ink-muted tabular-nums flex-shrink-0">
                            {c.total}
                          </span>
                          <button
                            type="button"
                            onClick={() => selectOnlyChapter(key, c.chap)}
                            className="px-1.5 py-0.5 rounded text-[11px] text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors flex-shrink-0"
                          >
                            {bi('仅此章', 'Only')}
                          </button>
                          <button
                            type="button"
                            onClick={() => launch([key], c.chap)}
                            className="px-1.5 py-0.5 rounded bg-accent-soft text-accent text-[11px] font-medium hover:bg-accent hover:text-accent-fg transition-colors flex-shrink-0"
                          >
                            {bi('直练', 'Go')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
};
