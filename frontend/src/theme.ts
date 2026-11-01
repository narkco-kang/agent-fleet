import { createTheme, type Theme } from '@mui/material/styles';

/**
 * MUI 主题（浅色 + 暗色）+ 语义色映射（CSS 变量同步定义在 globals.css）。
 */
const shape = { borderRadius: 8 } as const;

const typography = {
  fontFamily: [
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'PingFang SC',
    'Hiragino Sans GB',
    'Microsoft YaHei',
    'sans-serif',
  ].join(','),
} as const;

const components = {
  MuiButton: {
    styleOverrides: {
      root: { textTransform: 'none' as const, minHeight: 36 },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: { borderRadius: 12, boxShadow: '0 1px 3px rgba(15,23,42,.08)' },
    },
  },
};

export const lightTheme: Theme = createTheme({
  palette: {
    primary: { main: '#4F46E5' },
    secondary: { main: '#0891B2' },
    success: { main: '#10B981' },
    warning: { main: '#F59E0B' },
    error: { main: '#EF4444' },
    text: {
      primary: '#0F172A',
      secondary: '#334155',
      disabled: '#94A3B8',
    },
    background: {
      default: '#FFFFFF',
      paper: '#FFFFFF',
    },
    divider: '#E2E8F0',
  },
  shape,
  typography,
  components,
});

export const darkTheme: Theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#818CF8' },
    secondary: { main: '#22D3EE' },
    success: { main: '#34D399' },
    warning: { main: '#FBBF24' },
    error: { main: '#F87171' },
    text: {
      primary: '#F1F5F9',
      secondary: '#CBD5E1',
      disabled: '#64748B',
    },
    background: {
      default: '#0F172A',
      paper: '#1E293B',
    },
    divider: '#334155',
  },
  shape,
  typography,
  components,
});

/** 默认导出保留（兼容既有 import 处） */
export const theme: Theme = lightTheme;
