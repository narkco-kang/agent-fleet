import { useEffect, useState } from 'react';

/**
 * 响应式断点（04 §5）：<768 手机 / 768-1279 平板 / ≥1280 桌面。
 */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function currentBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1280) return 'tablet';
  return 'desktop';
}

export function useBreakpoint(): { bp: Breakpoint; isMobile: boolean; isTablet: boolean; isDesktop: boolean } {
  const [bp, setBp] = useState<Breakpoint>(currentBreakpoint);

  useEffect(() => {
    const onChange = (): void => setBp(currentBreakpoint());
    window.addEventListener('resize', onChange);
    return () => window.removeEventListener('resize', onChange);
  }, []);

  return {
    bp,
    isMobile: bp === 'mobile',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
  };
}
