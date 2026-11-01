import { createTheme } from '@mui/material/styles';

/**
 * MUI 主题 + 语义色映射（与 04 §2 一致，CSS 变量同步定义在 globals.css）。
 */
export const theme = createTheme({
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
  shape: { borderRadius: 8 },
  typography: {
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
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', minHeight: 36 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 12, boxShadow: '0 1px 3px rgba(15,23,42,.08)' },
      },
    },
  },
});
