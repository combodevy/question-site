import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

const SIZE_CLS = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
};

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true,
  footer,
  children,
}) => {
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/45 backdrop-blur-[2px] anim-fade-in"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${SIZE_CLS[size]} max-h-[90vh] flex flex-col bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden anim-modal-in`}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink truncate">{title}</h3>
            {subtitle && <div className="text-xs text-ink-muted mt-0.5">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scroll px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-line bg-surface-muted/40 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
