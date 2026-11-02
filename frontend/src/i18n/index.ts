import { useCallback } from 'react';
import { useLanguageStore, type Language } from './languageStore';
import { translations } from './translations';

/**
 * 轻量 i18n：按当前语言取翻译文案。
 * 组件内用 `const t = useT()` 得到 t(key) 函数；语言切换后自动重渲染。
 */

export function translate(key: string, language: Language): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[language] ?? entry.zh;
}

export function useT(): (key: string) => string {
  const language = useLanguageStore((s) => s.language);
  return useCallback((key: string) => translate(key, language), [language]);
}

export { useLanguageStore };
export type { Language };
