import React, { useEffect } from 'react';
import { CheckCircle2, Clock, FileText, X, XCircle } from 'lucide-react';
import type { HistoryEntry } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import { useBi } from '@/i18n/useBi';
import { Badge } from '@/components/ui/Badge';
import { QuestionPreviewBlock } from '@/components/ui/QuestionPreviewBlock';
import { useAnimatedPresence, useLastValue } from '@/hooks/useAnimatedPresence';

interface QuestionInsightDrawerProps {
  question: LocalQuestion | null;
  history: HistoryEntry[];
  onClose: () => void;
}

export const QuestionInsightDrawer: React.FC<QuestionInsightDrawerProps> = ({
  question,
  history,
  onClose,
}) => {
  const { bi } = useBi();
  const { mounted, phase } = useAnimatedPresence(Boolean(question), 220);
  const displayQ = useLastValue(question);

  useEffect(() => {
    if (!question) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [question, onClose]);

  if (!mounted || !displayQ) return null;
  const exiting = phase === 'exit';

  const records = history
    .filter((h) => h.id === displayQ.id)
    .sort((a, b) => a.t - b.t);
  const recent = [...records].reverse().slice(0, 10);
  const correct = records.filter((r) => r.r).length;
  const errRate = records.length ? Math.round(((records.length - correct) / records.length) * 100) : 0;
  const durRecs = records.filter((r) => typeof r.d === 'number' && r.d > 0);
  const avgSec = durRecs.length
    ? Math.round((durRecs.reduce((acc, r) => acc + (r.d || 0), 0) / durRecs.length / 1000) * 10) / 10
    : null;
  const hasOlderEdits =
    typeof displayQ._editedAt === 'number' &&
    recent.some((r) => r.t < (displayQ._editedAt as number));

  const fmtDuration = (ms?: number, capped?: boolean) => {
    if (!ms || ms <= 0) return '—';
    if (capped) return bi('≥5分', '≥5m');
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
  };

  return (
    <div
      className={`fixed inset-0 z-[60] flex justify-end ${exiting ? 'pointer-events-none' : ''}`}
      data-testid="question-insight-drawer"
    >
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-[1px] ${
          exiting ? 'anim-fade-out' : 'anim-fade-in'
        }`}
        onClick={() => {
          if (!exiting) onClose();
        }}
      />
      <aside
        className={`relative w-full max-w-lg bg-surface border-l border-line h-full flex flex-col shadow-2xl z-10 ${
          exiting ? 'anim-drawer-out' : 'anim-drawer-in'
        }`}
      >
        <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-ink-muted truncate">
              {displayQ.sub} / {displayQ.chap}
            </div>
            <h3 className="text-sm font-semibold text-ink mt-0.5">{bi('题目洞察与作答历史', 'Question History & Insights')}</h3>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!exiting) onClose();
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-all duration-200 hover:rotate-90 active:scale-90"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scroll p-5 space-y-5">
          {displayQ.psg && (
            <details className="p-3 rounded-xl bg-canvas border border-line text-xs">
              <summary className="cursor-pointer font-medium text-ink-muted inline-flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-accent" />
                {bi('查看关联短文材料', 'View Reading Passage')}
              </summary>
              <div className="mt-2 pt-2 border-t border-line font-serif leading-relaxed text-ink whitespace-pre-wrap max-h-48 overflow-y-auto custom-scroll">
                {displayQ.psg}
              </div>
            </details>
          )}

          <div className="p-4 rounded-xl bg-canvas border border-line">
            <QuestionPreviewBlock question={displayQ} />
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-surface-muted/60">
              <div className="text-ink-muted">{bi('作答 / 正确', 'Attempts / Ok')}</div>
              <div className="text-base font-semibold text-ink tabular-nums mt-1">
                {records.length} / {correct}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-surface-muted/60">
              <div className="text-ink-muted">{bi('错误率 / 均时', 'Error Rate / Avg')}</div>
              <div className="text-base font-semibold text-ink tabular-nums mt-1">
                {errRate}% / {avgSec !== null ? `${avgSec}s` : '—'}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-ink-muted">{bi('最近作答记录', 'Recent Attempts')}</span>
              {records.length > 10 && (
                <Badge tone="neutral">{bi(`共 ${records.length} 次`, `${records.length} total`)}</Badge>
              )}
            </div>

            {recent.length === 0 ? (
              <div className="text-xs text-ink-muted py-6 text-center rounded-xl border border-dashed border-line">
                {bi('还没有作答记录', 'No attempts recorded yet')}
              </div>
            ) : (
              <div className="space-y-1.5">
                {recent.map((r) => {
                  const dt = new Date(r.t);
                  const ts = `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(
                    dt.getDate(),
                  ).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(
                    dt.getMinutes(),
                  ).padStart(2, '0')}`;
                  return (
                    <div
                      key={r.rid}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-canvas border border-line text-xs"
                    >
                      <span className="font-mono text-ink-muted tabular-nums">{ts}</span>
                      <span className="flex items-center gap-1 font-medium">
                        {r.r ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            <span className="text-emerald-600 dark:text-emerald-400">{bi('正确', 'Correct')}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-red-500" />
                            <span className="text-red-600 dark:text-red-400">{bi('错误', 'Wrong')}</span>
                          </>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-ink-muted tabular-nums">
                        <Clock className="w-3 h-3" />
                        {fmtDuration(r.d, r.capped)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {hasOlderEdits && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2.5 leading-relaxed">
                {bi(
                  '提示：此题曾被修改过，早于修改时间的作答记录可能对应旧版本内容。',
                  'Note: This question was edited; older records may reflect an earlier version.',
                )}
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};
