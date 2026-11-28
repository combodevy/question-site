import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import type { LiveLabSnapshot, LabStats } from '@/lab/hooks';
import { getLabSyncEngine } from '@/lab/syncEngine';
import { useLabQuizStore } from '@/lab/useLabQuizStore';
import { useUiStore } from '@/store/useUiStore';
import { useBi } from '@/i18n/useBi';
import { matchesSearchQuery, naturalCompare } from '@/lib/text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { QuestionPreviewBlock } from '@/components/ui/QuestionPreviewBlock';

interface LabMistakesViewProps {
  data: LiveLabSnapshot;
  stats: LabStats;
}

type TrackFilter = 'all' | 'hyper' | 'guess' | 'starred';

const INITIAL_BATCH = 30;
const BATCH_STEP = 30;

export const LabMistakesView: React.FC<LabMistakesViewProps> = ({ data, stats }) => {
  const { bi } = useBi();
  const startSession = useLabQuizStore((s) => s.startSession);
  const { pushToast } = useUiStore();

  const [track, setTrack] = useState<TrackFilter>('all');
  const [subFilter, setSubFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [showAnswers, setShowAnswers] = useState(true);
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_BATCH);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const subjects = useMemo(() => stats.subjectTree.map((s) => s.sub), [stats.subjectTree]);

  const filtered = useMemo(() => {
    const out = data.questions.filter((q) => {
      if (track === 'all' && !stats.visibleMistakeIds.has(q.id)) return false;
      if (track === 'hyper' && !stats.hyperRiskIds.has(q.id)) return false;
      if (track === 'guess' && !stats.luckyGuessIds.has(q.id)) return false;
      if (track === 'starred' && !stats.starredIds.has(q.id)) return false;
      if (subFilter !== 'all' && q.sub !== subFilter) return false;
      if (query.trim()) {
        const hay = `${q.q} ${q.o.join(' ')} ${q.a} ${q.d} ${q.sub} ${q.chap}`;
        if (!matchesSearchQuery(hay, query)) return false;
      }
      return true;
    });

    out.sort((a, b) => {
      const ca = stats.cardMap.get(a.id);
      const cb = stats.cardMap.get(b.id);
      const ra = ca?.isHyperRisk ? 3 : ca?.isLuckyGuess ? 2 : 1;
      const rb = cb?.isHyperRisk ? 3 : cb?.isLuckyGuess ? 2 : 1;
      if (ra !== rb) return rb - ra;
      return (cb?.errorRate || 0) - (ca?.errorRate || 0) || naturalCompare(a.chap, b.chap);
    });
    return out;
  }, [data.questions, track, subFilter, query, stats]);

  useEffect(() => {
    setVisibleLimit(INITIAL_BATCH);
  }, [track, subFilter, query]);

  const visibleItems = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
  const hasMore = visibleItems.length < filtered.length;

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleLimit((prev) => Math.min(filtered.length, prev + BATCH_STEP));
        }
      },
      { rootMargin: '320px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, filtered.length]);

  const practiceFiltered = () => {
    if (!filtered.length) return;
    startSession({
      mode: track === 'starred' ? 'starred' : 'dual_track',
      questions: filtered,
      title:
        track === 'hyper'
          ? bi('易混错题专练', 'High-Conf Errors')
          : track === 'guess'
          ? bi('蒙对题重测', 'Lucky Guess Review')
          : track === 'starred'
          ? bi('收藏专练', 'Starred Practice')
          : bi('重点错题专练', 'Mistakes & Guesses'),
      settings: data.settings,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 anim-fade-in">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-soft text-accent inline-flex items-center justify-center transition-transform duration-200 hover:scale-105">
            <AlertTriangle className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink">
              {bi('重点错题本', 'Mistakes & Guesses')}
            </h1>
            <p className="text-xs text-ink-muted">
              {bi(
                '记录本模式下的做错与蒙对题目，与经典版互不影响',
                'Tracks mistakes and lucky guesses independently from Classic Mode',
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {stats.hiddenMistakeIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void getLabSyncEngine()?.restoreHiddenMistakes();
                pushToast(bi('已恢复全部已移出错题', 'Restored hidden items'), 'info');
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {bi(`恢复隐藏 (${stats.hiddenMistakeIds.size})`, `Restore (${stats.hiddenMistakeIds.size})`)}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowAnswers((v) => !v)}>
            {showAnswers ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showAnswers ? bi('隐藏答案', 'Hide Answers') : bi('显示答案', 'Show Answers')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={filtered.length === 0}
            onClick={practiceFiltered}
            data-testid="lab-mistakes-drill-btn"
          >
            <Play className="w-3.5 h-3.5" />
            {bi(`重练当前 (${filtered.length})`, `Practice (${filtered.length})`)}
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card padding="sm" className="space-y-3 anim-stagger" style={{ '--stagger-i': 0 } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex flex-wrap p-0.5 rounded-xl bg-surface-muted border border-line text-xs gap-0.5">
            {(
              [
                { k: 'all', label: bi(`全部错题 (${stats.visibleMistakeIds.size})`, `All (${stats.visibleMistakeIds.size})`) },
                { k: 'hyper', label: bi(`易混错题 (${stats.hyperRiskIds.size})`, `High-Conf (${stats.hyperRiskIds.size})`) },
                { k: 'guess', label: bi(`蒙对题目 (${stats.luckyGuessIds.size})`, `Guesses (${stats.luckyGuessIds.size})`) },
                { k: 'starred', label: bi(`收藏夹 (${stats.starredIds.size})`, `Starred (${stats.starredIds.size})`) },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                type="button"
                data-testid={`lab-track-${t.k}`}
                onClick={() => setTrack(t.k)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all duration-150 ${
                  track === t.k ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-1 sm:flex-initial">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={bi('搜索题干或解析…', 'Search…')}
                className="w-full h-9 pl-8 pr-3 rounded-xl bg-canvas border border-line text-xs text-ink outline-none focus:border-accent transition-colors"
              />
            </div>
            <select
              value={subFilter}
              onChange={(e) => setSubFilter(e.target.value)}
              className="h-9 px-2.5 rounded-xl bg-canvas border border-line text-xs text-ink outline-none focus:border-accent"
            >
              <option value="all">{bi('全部科目', 'All Subjects')}</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="w-5 h-5" />}
          title={bi('当前分类暂无题目', 'No Questions Here')}
          description={bi('完成练习后，做错和蒙对的题目会自动整理到这里。', 'Missed and lucky-guess questions will appear here after practice.')}
        />
      ) : (
        <div className="space-y-3">
          {visibleItems.map((q, idx) => {
            const card = stats.cardMap.get(q.id);
            const flag = data.flagsMap.get(q.id);
            const starred = Boolean(flag?.starred);
            const rPct = card ? Math.round(card.retrievability * 100) : 100;
            return (
              <Card
                key={q.id}
                style={{ '--stagger-i': Math.min(idx, 10) } as React.CSSProperties}
                className="space-y-3 anim-stagger card-hover"
                data-testid={`lab-mistake-card-${q.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge tone="accent">{q.sub} / {q.chap}</Badge>
                    {card?.isHyperRisk && (
                      <Badge tone="danger">
                        <ShieldAlert className="w-3 h-3" />
                        {bi('易混错题', 'High-Conf Error')}
                      </Badge>
                    )}
                    {card?.isLuckyGuess && (
                      <Badge tone="warning">
                        <AlertTriangle className="w-3 h-3" />
                        {bi('蒙对题目', 'Lucky Guess')}
                      </Badge>
                    )}
                    {card && card.attempts > 0 && (
                      <span className="text-[11px] font-mono text-ink-muted tabular-nums">
                        {bi(`记忆度 ${rPct}%`, `R ${rPct}%`)} | {bi(`错 ${card.wrongCount}/${card.attempts}`, `${card.wrongCount}/${card.attempts} err`)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void getLabSyncEngine()?.setFlag(q.id, { starred: !starred })}
                      title={bi('收藏本题', 'Star')}
                      className={`p-1.5 rounded-lg transition-all duration-150 active:scale-90 ${
                        starred ? 'text-amber-500 bg-amber-500/10' : 'text-ink-muted hover:text-ink hover:bg-surface-muted'
                      }`}
                    >
                      <Star className={`w-4 h-4 ${starred ? 'fill-current' : ''}`} />
                    </button>
                    {track !== 'starred' && (
                      <button
                        type="button"
                        onClick={() => {
                          void getLabSyncEngine()?.setFlag(q.id, { mistakeHidden: true });
                          pushToast(bi('已移出当前列表（可随时恢复）', 'Hidden from list'), 'info');
                        }}
                        title={bi('移出列表', 'Hide')}
                        className="p-1.5 rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-500/10 transition-all duration-150 active:scale-90"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {showAnswers ? (
                  <div className="anim-slide-down">
                    <QuestionPreviewBlock question={q} showExplanation />
                  </div>
                ) : (
                  <div className="text-sm font-bold text-ink leading-relaxed">{q.q}</div>
                )}
              </Card>
            );
          })}

          {hasMore && (
            <div ref={loadMoreRef} className="py-4 text-center text-xs text-ink-muted">
              {bi(`继续向下滚动加载（已显示 ${visibleItems.length} / ${filtered.length}）`, `Scroll to load more (${visibleItems.length}/${filtered.length})`)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
