import type { Config } from 'tailwindcss';

/**
 * Tailwind 语义色 Token（与 04-UI设计文档 §2 一致）。
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4F46E5',
          soft: '#EEF2FF',
        },
        accent: {
          DEFAULT: '#0891B2',
          soft: '#ECFEFF',
        },
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        offline: '#94A3B8',
        agent: '#7C3AED',
        surface: '#FFFFFF',
        'bg-subtle': '#F8FAFC',
        border: '#E2E8F0',
        'text-strong': '#0F172A',
        text: '#334155',
        'text-muted': '#64748B',
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
