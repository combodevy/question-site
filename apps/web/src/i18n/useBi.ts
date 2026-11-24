import { useTranslation } from 'react-i18next';

export function useBi() {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';
  const bi = (zh: string, en: string) => (isEn ? en : zh);
  return { isEn, bi, lang: (isEn ? 'en' : 'zh') as 'zh' | 'en' };
}
