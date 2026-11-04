import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { useThemeStore } from '../../store/themeStore';

/**
 * 神经图工具条：透镜（节点 type 维度）+ 主题切换。
 * 透镜只做节点 type 维度（设备/agent/任务），不做状态维度（已拍板）。
 */
export type NodeLens = 'all' | 'device' | 'agent' | 'task';

export const LENS_OPTIONS: Array<{ value: NodeLens; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'device', label: '设备' },
  { value: 'agent', label: 'Agent' },
  { value: 'task', label: '任务' },
];

export function GraphToolbar({
  lens,
  onLensChange,
}: {
  lens: NodeLens;
  onLensChange: (lens: NodeLens) => void;
}): JSX.Element {
  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);

  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 px-2 py-1.5 shadow-card">
      <div className="flex items-center gap-0.5">
        {LENS_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => onLensChange(o.value)}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              lens === o.value
                ? 'bg-[var(--brand)] text-white'
                : 'text-[var(--text)] hover:bg-[var(--bg-subtle)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="h-4 w-px bg-[var(--border)]" />
      <button
        onClick={toggleTheme}
        title={mode === 'dark' ? '切换浅色' : '切换暗色'}
        className="rounded-md p-1 text-[var(--text)] hover:bg-[var(--bg-subtle)]"
      >
        {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
      </button>
    </div>
  );
}
