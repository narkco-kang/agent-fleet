import type { ReactNode } from 'react';

/**
 * 通用卡片（04 §3.3）：白底、1px 边框、圆角 12px、轻阴影。
 */
export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}): ReactNode {
  return (
    <div
      onClick={onClick}
      className={`rounded-card border border-border bg-surface shadow-card ${className}`}
      style={{ borderRadius: 12, borderColor: '#E2E8F0' }}
    >
      {children}
    </div>
  );
}
