import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
  children: React.ReactNode;
}

const TONE_CLS: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-surface-muted text-ink-muted border-line',
  accent: 'bg-accent-soft text-accent border-accent/20',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  danger: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20',
};

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', className = '', children, ...rest }) => (
  <span
    {...rest}
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium leading-tight ${TONE_CLS[tone]} ${className}`}
  >
    {children}
  </span>
);
