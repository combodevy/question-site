import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-2xl border border-dashed border-line bg-surface/50">
    {icon && (
      <div className="w-11 h-11 rounded-2xl bg-surface-muted text-ink-muted flex items-center justify-center mb-3">
        {icon}
      </div>
    )}
    <div className="text-sm font-semibold text-ink">{title}</div>
    {description && (
      <p className="text-xs text-ink-muted max-w-sm mt-1.5 leading-relaxed">{description}</p>
    )}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
