import { create } from 'zustand';
import i18n, { LANG_STORAGE_KEY } from '@/i18n';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export interface DialogState {
  mode: 'confirm' | 'prompt';
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  inputType?: 'text' | 'password';
  defaultValue?: string;
  placeholder?: string;
  resolve: (val: unknown) => void;
}

const THEME_KEY = 'qs_theme';

export function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    const legacy = localStorage.getItem('dark');
    if (legacy === '1') return 'dark';
    if (legacy === '0') return 'light';
  } catch {
    // ignore
  }
  return 'system';
}

export function resolveIsDark(mode: ThemeMode): boolean {
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return mode === 'dark' || (mode === 'system' && prefersDark);
}

export function applyThemeToDom(mode: ThemeMode): void {
  const isDark = resolveIsDark(mode);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', isDark);
  }
}

interface UiState {
  theme: ThemeMode;
  lang: 'zh' | 'en';
  toasts: ToastItem[];
  dialog: DialogState | null;
  setTheme: (mode: ThemeMode) => void;
  setLang: (lang: 'zh' | 'en') => void;
  pushToast: (message: string, tone?: ToastItem['tone']) => void;
  dismissToast: (id: string) => void;
  confirm: (opts: {
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  prompt: (opts: {
    title?: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    inputType?: 'text' | 'password';
    confirmText?: string;
    cancelText?: string;
  }) => Promise<string | null>;
  closeDialog: (value: unknown) => void;
}

const initTheme = getInitialTheme();
applyThemeToDom(initTheme);

export const useUiStore = create<UiState>((set, get) => ({
  theme: initTheme,
  lang: (i18n.language === 'en' ? 'en' : 'zh') as 'zh' | 'en',
  toasts: [],
  dialog: null,

  setTheme: (mode) => {
    try {
      localStorage.setItem(THEME_KEY, mode);
      if (mode === 'dark') localStorage.setItem('dark', '1');
      else if (mode === 'light') localStorage.setItem('dark', '0');
      else localStorage.removeItem('dark');
    } catch {
      // ignore
    }
    applyThemeToDom(mode);
    set({ theme: mode });
  },

  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // ignore
    }
    void i18n.changeLanguage(lang);
    set({ lang });
  },

  pushToast: (message, tone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, message, tone }] }));
    setTimeout(() => {
      get().dismissToast(id);
    }, 3800);
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      const prev = get().dialog;
      if (prev) prev.resolve(prev.mode === 'prompt' ? null : false);
      set({
        dialog: {
          mode: 'confirm',
          title: opts.title || (get().lang === 'en' ? 'Confirm Action' : '操作确认'),
          message: opts.message,
          confirmText: opts.confirmText,
          cancelText: opts.cancelText,
          danger: opts.danger,
          resolve: (v) => resolve(Boolean(v)),
        },
      });
    }),

  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      const prev = get().dialog;
      if (prev) prev.resolve(prev.mode === 'prompt' ? null : false);
      set({
        dialog: {
          mode: 'prompt',
          title: opts.title || (get().lang === 'en' ? 'Input Required' : '请输入'),
          message: opts.message,
          defaultValue: opts.defaultValue ?? '',
          placeholder: opts.placeholder,
          inputType: opts.inputType || 'text',
          confirmText: opts.confirmText,
          cancelText: opts.cancelText,
          resolve: (v) => resolve(typeof v === 'string' ? v : null),
        },
      });
    }),

  closeDialog: (value) => {
    const d = get().dialog;
    if (!d) return;
    set({ dialog: null });
    d.resolve(value);
  },
}));

if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useUiStore.getState();
    if (theme === 'system') applyThemeToDom('system');
  });
}
