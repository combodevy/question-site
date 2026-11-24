import React from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useUiStore, type ToastItem } from '@/store/useUiStore';

const STYLE_MAP: Record<ToastItem['tone'], string> = {
  info: 'border-line bg-surface text-ink',
  success: 'border-emerald-500/30 bg-surface text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/30 bg-surface text-amber-700 dark:text-amber-300',
  error: 'border-red-500/30 bg-surface text-red-700 dark:text-red-300',
};

const ICON_MAP: Record<ToastItem['tone'], React.ReactNode> = {
  info: <Info className="w-4 h-4 text-accent flex-shrink-0" />,
  success: <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />,
  error: <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />,
};

export const ToastHost: React.FC = () => {
  const { toasts, dismissToast } = useUiStore();
  if (!toasts.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[80] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-lg text-xs font-medium leading-relaxed ${STYLE_MAP[t.tone]}`}
        >
          <span className="mt-0.5">{ICON_MAP[t.tone]}</span>
          <span className="flex-1 text-ink">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="text-ink-muted hover:text-ink p-0.5"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
