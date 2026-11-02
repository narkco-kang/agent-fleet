import { create } from 'zustand';

/**
 * 主题模式：localStorage 持久化，默认浅色，不跟随系统。
 * 通过 <html data-theme="light|dark"> 驱动 globals.css 的 CSS 变量。
 */
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'agentfleet.theme';

function readInitial(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function apply(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readInitial(),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage 不可用时忽略（隐私模式）
    }
    apply(mode);
    set({ mode });
  },
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
}));

// 模块加载即应用一次，避免刷新后闪烁
apply(useThemeStore.getState().mode);
