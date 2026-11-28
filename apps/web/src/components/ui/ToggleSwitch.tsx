import React from 'react';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  testId,
  ariaLabel,
  disabled = false,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    data-testid={testId}
    onClick={() => onChange(!checked)}
    className={`switch-track relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border p-0.5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 ${
      checked
        ? 'border-accent bg-accent'
        : 'border-line bg-surface-muted hover:border-ink-muted/45'
    }`}
  >
    <span
      className={`switch-thumb inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);
