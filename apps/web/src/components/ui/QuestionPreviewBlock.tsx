import React from 'react';
import { CheckCircle2 } from 'lucide-react';
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
      <div className={`${compact ? 'text-xs sm:text-sm' : 'text-sm'} font-medium text-ink leading-relaxed`}>
        <MediaContent text={question.q} media={question.media} />
      </div>

      {(question.type === 'mcq' || question.type === 'multi') && question.o.length > 0 && (
        <div className={`grid grid-cols-1 ${compact ? 'sm:grid-cols-2' : ''} gap-1.5 text-xs`}>
          {question.o.map((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const isCorrect = ansUpper.includes(letter);
            return (
              <div
                key={letter}
                className={`px-2.5 py-1.5 rounded-lg border flex items-start gap-1.5 ${
                  isCorrect
                    ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium'
                    : 'border-line bg-canvas/60 text-ink-muted'
                }`}
              >
                <span className="font-mono font-semibold flex-shrink-0">{letter}.</span>
                <span className="flex-1 break-words">{opt}</span>
                {isCorrect && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />}
              </div>
            );
          })}
        </div>
      )}

      <div className="p-2.5 rounded-xl bg-surface-muted/65 border border-line/70 text-xs space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-ink-muted">{bi('正确答案：', 'Answer: ')}</span>
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">
            {question.type === 'tf'
              ? ansUpper === 'T'
                ? bi('√ 正确', 'True')
                : bi('× 错误', 'False')
              : question.type === 'fill'
              ? question.a.split('|').join(' / ')
              : question.a}
          </span>
        </div>
        {showExplanation && question.d && (
          <div className="text-ink-muted leading-relaxed whitespace-pre-wrap">{question.d}</div>
        )}
      </div>
    </div>
  );
};
