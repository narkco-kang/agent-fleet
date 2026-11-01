import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import HubIcon from '@mui/icons-material/Hub';
import DevicesIcon from '@mui/icons-material/Devices';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SettingsIcon from '@mui/icons-material/Settings';
import AddIcon from '@mui/icons-material/Add';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ExtensionIcon from '@mui/icons-material/Extension';
import RouteIcon from '@mui/icons-material/Route';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useLiveData } from '../hooks/useLiveData';
import { useDeviceStore } from '../store/deviceStore';
import { useTaskStore } from '../store/taskStore';
import { useWsStore } from '../store/wsStore';
import { MobileTabBar } from './MobileTabBar';
import { NewTaskDialog } from '../components/drawer/NewTaskDialog';
import { OnboardingGuide, useOnboardingState } from '../components/common/OnboardingGuide';

const NAV = [
  { to: '/', label: '神经图', icon: <HubIcon /> },
  { to: '/devices', label: '设备', icon: <DevicesIcon /> },
  { to: '/tasks', label: '任务', icon: <AssignmentIcon /> },
  { to: '/deploy', label: '部署', icon: <CloudUploadIcon /> },
  { to: '/platform-models', label: '平台模型', icon: <ExtensionIcon /> },
  { to: '/routing', label: '路由网关', icon: <RouteIcon /> },
  { to: '/settings', label: '设置', icon: <SettingsIcon /> },
];

/**
 * 主布局：桌面侧边栏(220px) / 平板折叠(64px) / 手机底部 Tab。
 */
export default function MainLayout(): JSX.Element {
  const { isMobile, isTablet } = useBreakpoint();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const onboarding = useOnboardingState();
  const navigate = useNavigate();

  useLiveData();

  const devices = useDeviceStore((s) => s.devices);
  const tasks = useTaskStore((s) => s.tasks);
  const connState = useWsStore((s) => s.connState);
  const backendOnline = useWsStore((s) => s.backendOnline);
  const relayOnline = useWsStore((s) => s.relayOnline);

  const online = devices.filter((d) => d.status === 'online').length;
  const running = tasks.filter((t) => t.status === 'running').length;
  const alerts = tasks.filter((t) => t.status === 'failed' || t.status === 'interrupted').length;

  const sidebarW = isTablet ? 64 : 220;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* 桌面/平板侧边栏 */}
      {!isMobile && (
        <aside
          className="shrink-0 border-r border-[#E2E8F0] bg-[#F8FAFC]"
          style={{ width: sidebarW }}
        >
          <div className="flex h-14 items-center gap-2 px-4">
            <HubIcon className="text-[#4F46E5]" />
            {!isTablet && <span className="font-semibold text-[#0F172A]">AgentMesh</span>}
          </div>
          <nav className="flex flex-col gap-1 px-2">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-[#EEF2FF] text-[#4F46E5]'
                      : 'text-[#334155] hover:bg-[#EEF2FF]'
                  }`
                }
                title={item.label}
              >
                {item.icon}
                {!isTablet && <span>{item.label}</span>}
              </NavLink>
            ))}
          </nav>
        </aside>
      )}

      {/* 主内容 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 */}
        <header
          className="flex h-14 shrink-0 items-center justify-between border-b border-[#E2E8F0] bg-white px-4"
          style={{ height: 56 }}
        >
          <div className="flex items-center gap-2">
            {isMobile && <HubIcon className="text-[#4F46E5]" />}
            <span className="text-sm font-medium text-[#0F172A]">
              连接：
              {backendOnline
                ? relayOnline
                  ? '🟢 中继'
                  : '🟢 局域网'
                : connState === 'open'
                  ? '🟡 演示模式'
                  : '🔴 未连接'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onboarding.show}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm font-medium text-[#334155] hover:bg-[#F8FAFC]"
            >
              <HelpOutlineIcon fontSize="small" />
              {!isTablet && <span>新手引导</span>}
            </button>
            <button
              onClick={() => setNewTaskOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4338CA]"
            >
              <AddIcon fontSize="small" />
              {!isTablet && <span>新建任务</span>}
            </button>
          </div>
        </header>

        {/* 页面主体 */}
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>

        {/* 底部状态条 */}
        {!isMobile && (
          <footer
            className="flex h-8 shrink-0 items-center justify-between border-t border-[#E2E8F0] bg-white px-4 text-xs text-[#64748B]"
            style={{ height: 32 }}
          >
            <span>
              在线设备 {online} · 运行中任务 {running} · 告警 {alerts}
            </span>
            <span>AgentMesh v0.1.0</span>
          </footer>
        )}
      </div>

      {/* 手机底部 Tab */}
      {isMobile && <MobileTabBar />}

      <NewTaskDialog
        open={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        onCreated={(taskId) => {
          setNewTaskOpen(false);
          navigate(`/tasks/${taskId}`);
        }}
      />
      <OnboardingGuide open={onboarding.open} onClose={onboarding.close} />
    </div>
  );
}
