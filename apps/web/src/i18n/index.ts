import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

export const LANG_STORAGE_KEY = 'qs_lang';

export function getInitialLang(): 'zh' | 'en' {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // ignore
  }
  return 'zh';
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: getInitialLang(),
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});

export default i18n;
