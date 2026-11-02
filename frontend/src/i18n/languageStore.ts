import { create } from 'zustand';

/**
 * 界面语言：localStorage 持久化，默认中文。切换后所有 t() 文案即时更新。
 */
export type Language = 'zh' | 'en';

const STORAGE_KEY = 'agentfleet.language';

function readInitial(): Language {
  if (typeof window === 'undefined') return 'zh';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
  toggle: () => void;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  language: readInitial(),
  setLanguage: (language) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // localStorage 不可用时忽略（隐私模式）
    }
    set({ language });
  },
  toggle: () => get().setLanguage(get().language === 'zh' ? 'en' : 'zh'),
}));
