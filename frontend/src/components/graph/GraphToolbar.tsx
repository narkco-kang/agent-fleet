import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import { useThemeStore } from '../../store/themeStore';

/**
 * 神经图工具条：透镜（节点 type 维度）+ 路径漫游开关 + 主题切换。
 * 透镜只做节点 type 维度（设备/agent/任务/消息），不做状态维度（已拍板）。
 */
export type NodeLens = 'all' | 'device' | 'agent' | 'task' | 'message';

export const LENS_OPTIONS: Array<{ value: NodeLens; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'device', label: '设备' },
  { value: 'agent', label: 'Agent' },
  { value: 'task', label: '任务' },
  { value: 'message', label: '消息' },
];

export function GraphToolbar({
  lens,
  onLensChange,
  walk,
  onWalkToggle,
}: {
  lens: NodeLens;
  onLensChange: (lens: NodeLens) => void;
  walk: boolean;
  onWalkToggle: () => void;
}): JSX.Element {
  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);

  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white/90 px-2 py-1.5 shadow-card">
      <div className="flex items-center gap-0.5">
        {LENS_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => onLensChange(o.value)}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              lens === o.value
                ? 'bg-[#4F46E5] text-white'
                : 'text-[#334155] hover:bg-[#F1F5F9]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="h-4 w-px bg-[#E2E8F0]" />
      <button
        onClick={onWalkToggle}
        title="路径漫游：点击任务节点沿 call/stream 连线逐跳漫游"
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
          walk ? 'bg-[#EEF2FF] text-[#4F46E5]' : 'text-[#334155] hover:bg-[#F1F5F9]'
        }`}
      >
        <AltRouteIcon fontSize="small" /> 漫游
      </button>
      <span className="h-4 w-px bg-[#E2E8F0]" />
      <button
        onClick={toggleTheme}
        title={mode === 'dark' ? '切换浅色' : '切换暗色'}
        className="rounded-md p-1 text-[#334155] hover:bg-[#F1F5F9]"
      >
        {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
      </button>
    </div>
  );
}
