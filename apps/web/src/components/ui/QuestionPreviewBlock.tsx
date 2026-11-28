import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { formatFillAnswerDisplay } from '@qs/shared';
import type { LocalQuestion } from '@/db';
import { useBi } from '@/i18n/useBi';
import { MediaContent } from '@/components/ui/MediaContent';

interface QuestionPreviewBlockProps {
  question: LocalQuestion;
  compact?: boolean;
  showExplanation?: boolean;
}

export const QuestionPreviewBlock: React.FC<QuestionPreviewBlockProps> = ({
  question,
  compact = false,
  showExplanation = true,
}) => {
  const { bi } = useBi();
  const ansUpper = (question.a || '').toUpperCase();

  return (
    <div className="space-y-2.5">
      <div className={`${compact ? 'text-xs sm:text-sm' : 'text-sm'} font-bold text-ink leading-relaxed`}>
        <MediaContent text={question.q} media={question.media} />
      </div>

      {(question.type === 'mcq' || question.type === 'multi') && question.o.length > 0 && (
        <div className={`grid grid-cols-1 ${compact ? 'sm:grid-cols-2' : ''} gap-1.5 text-[13px]`}>
          {question.o.map((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const isCorrect = ansUpper.includes(letter);
            return (
              <div
                key={letter}
                className={`px-2.5 py-2 rounded-lg border flex items-start gap-1.5 ${
                  isCorrect
                    ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-semibold'
                    : 'border-line bg-canvas/70 text-ink font-medium'
                }`}
              >
                <span className="font-mono font-bold flex-shrink-0">{letter}.</span>
                <span className="flex-1 break-words">{opt}</span>
                {isCorrect && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />}
              </div>
            );
          })}
        </div>
      )}

      <div className="p-3 rounded-xl bg-surface-muted/65 border border-line/70 space-y-1.5">
        {question.type === 'qa' ? (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-accent">{bi('参考答案', 'Reference Answer')}</div>
            <div className="text-sm font-medium text-ink leading-relaxed whitespace-pre-wrap">{question.a}</div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-ink-muted font-medium">{bi('正确答案：', 'Answer: ')}</span>
            <span className="text-[15px] font-bold text-emerald-700 dark:text-emerald-300">
              {question.type === 'tf'
                ? ansUpper === 'T'
                  ? bi('√ 正确', 'True')
                  : bi('× 错误', 'False')
                : question.type === 'fill'
                ? formatFillAnswerDisplay(question.a)
                : question.a}
            </span>
          </div>
        )}
        {showExplanation && question.d && (
          <div className="text-xs text-ink-muted leading-relaxed whitespace-pre-wrap">{question.d}</div>
        )}
      </div>
    </div>
  );
};
