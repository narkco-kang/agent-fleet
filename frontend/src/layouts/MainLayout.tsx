import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import HubIcon from '@mui/icons-material/Hub';
import DevicesIcon from '@mui/icons-material/Devices';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SettingsIcon from '@mui/icons-material/Settings';
import AddIcon from '@mui/icons-material/Add';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ExtensionIcon from '@mui/icons-material/Extension';
import RouteIcon from '@mui/icons-material/Route';
import FolderIcon from '@mui/icons-material/Folder';
import PsychologyIcon from '@mui/icons-material/Psychology';
import GroupsIcon from '@mui/icons-material/Groups';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useLiveData } from '../hooks/useLiveData';
import { http } from '../api/http';
import { useDeviceStore } from '../store/deviceStore';
import { useTaskStore } from '../store/taskStore';
import { useWsStore } from '../store/wsStore';
import { MobileTabBar } from './MobileTabBar';
import { NewTaskDialog } from '../components/drawer/NewTaskDialog';
import { OnboardingGuide, useOnboardingState } from '../components/common/OnboardingGuide';
import { useT, useLanguageStore } from '../i18n';

const NAV = [
  { to: '/', labelKey: 'nav.graph', icon: <HubIcon /> },
  { to: '/devices', labelKey: 'nav.devices', icon: <DevicesIcon /> },
  { to: '/tasks', labelKey: 'nav.tasks', icon: <AssignmentIcon /> },
  { to: '/deploy', labelKey: 'nav.deploy', icon: <CloudUploadIcon /> },
  { to: '/platform-models', labelKey: 'nav.platformModels', icon: <ExtensionIcon /> },
  { to: '/assets', labelKey: 'nav.assets', icon: <FolderIcon /> },
  { to: '/memory', labelKey: 'nav.memory', icon: <PsychologyIcon /> },
  { to: '/routing', labelKey: 'nav.routing', icon: <RouteIcon /> },
  { to: '/swarm', labelKey: 'nav.swarm', icon: <GroupsIcon /> },
  { to: '/settings', labelKey: 'nav.settings', icon: <SettingsIcon /> },
];

/**
 * 主布局：桌面侧边栏(220px) / 平板折叠(64px) / 手机底部 Tab。
 */
export default function MainLayout(): JSX.Element {
  const { isMobile, isTablet } = useBreakpoint();
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const onboarding = useOnboardingState();
  const navigate = useNavigate();
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const toggleLanguage = useLanguageStore((s) => s.toggle);

  useLiveData();

  const devices = useDeviceStore((s) => s.devices);
  const tasks = useTaskStore((s) => s.tasks);
  const connState = useWsStore((s) => s.connState);
  const backendOnline = useWsStore((s) => s.backendOnline);
  const relayOnline = useWsStore((s) => s.relayOnline);

  const [attention, setAttention] = useState<{ needsLogin: number; pendingActions: number; alerts: number } | null>(null);

  useEffect(() => {
    const load = (): void => {
      http.getAttention().then((r) => setAttention(r.data)).catch(() => setAttention(null));
    };
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

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
            {!isTablet && <span className="font-semibold text-[#0F172A]">AgentFleet</span>}
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
                title={t(item.labelKey)}
              >
                {item.icon}
                {!isTablet && <span>{t(item.labelKey)}</span>}
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
              {t('layout.connection')}：
              {backendOnline
                ? relayOnline
                  ? `🟢 ${t('layout.relay')}`
                  : `🟢 ${t('layout.lan')}`
                : connState === 'open'
                  ? `🟡 ${t('layout.demo')}`
                  : `🔴 ${t('layout.disconnected')}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleLanguage}
              title="中文 / English"
              className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm font-medium text-[#334155] hover:bg-[#F8FAFC]"
            >
              <span>{language === 'zh' ? 'EN' : '中文'}</span>
            </button>
            <button
              onClick={onboarding.show}
              className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm font-medium text-[#334155] hover:bg-[#F8FAFC]"
            >
              <HelpOutlineIcon fontSize="small" />
              {!isTablet && <span>{t('layout.onboarding')}</span>}
            </button>
            <button
              onClick={() => setNewTaskOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-[#4F46E5] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4338CA]"
            >
              <AddIcon fontSize="small" />
              {!isTablet && <span>{t('layout.newTask')}</span>}
            </button>
          </div>
        </header>

        {/* 待处理摘要条（有非零项才显示，健康态折叠） */}
        {attention &&
          (attention.needsLogin > 0 || attention.pendingActions > 0 || attention.alerts > 0) && (
            <div className="flex shrink-0 items-center gap-3 border-b border-[#E2E8F0] bg-[#FFFBEB] px-4 py-1.5 text-xs text-[#334155]">
              <span className="font-medium text-[#0F172A]">{t('layout.pending')}</span>
              {attention.needsLogin > 0 && (
                <button
                  onClick={() => navigate('/devices')}
                  className="rounded bg-[#FEF3C7] px-2 py-0.5 text-[#B45309] hover:bg-[#FDE68A]"
                >
                  {t('layout.activatePlatforms')} {attention.needsLogin}
                </button>
              )}
              {attention.pendingActions > 0 && (
                <span className="rounded bg-[#FEF3C7] px-2 py-0.5 text-[#B45309]">
                  {t('layout.confirmActions')} {attention.pendingActions}
                </span>
              )}
              {attention.alerts > 0 && (
                <button
                  onClick={() => navigate('/tasks')}
                  className="rounded bg-[#FEE2E2] px-2 py-0.5 text-[#B91C1C] hover:bg-[#FECACA]"
                >
                  {t('layout.alerts')} {attention.alerts}
                </button>
              )}
            </div>
          )}

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
              {t('layout.onlineDevices')} {online} · {t('layout.runningTasks')} {running} · {t('layout.alerts')} {alerts}
            </span>
            <span>AgentFleet v0.1.0</span>
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
