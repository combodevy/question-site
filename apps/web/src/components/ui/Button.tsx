import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const VARIANT_CLS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-accent text-accent-fg border border-transparent hover:bg-accent-hover shadow-sm',
  secondary:
    'bg-surface-muted text-ink border border-line hover:border-ink-muted/50',
  outline:
    'bg-surface text-ink border border-line hover:bg-surface-muted',
  ghost:
    'bg-transparent text-ink-muted border border-transparent hover:bg-surface-muted hover:text-ink',
  danger:
    'bg-red-600 text-white border border-transparent hover:bg-red-700 shadow-sm',
};

const SIZE_CLS: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-9 px-4 text-sm rounded-xl gap-2',
  lg: 'h-11 px-5 text-sm rounded-xl gap-2',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'outline', size = 'md', loading, disabled, className = '', children, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[0.5px] active:scale-[0.96] disabled:opacity-50 disabled:pointer-events-none select-none ${VARIANT_CLS[variant]} ${SIZE_CLS[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
