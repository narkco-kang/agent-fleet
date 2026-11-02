import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import HubIcon from '@mui/icons-material/Hub';
import DevicesIcon from '@mui/icons-material/Devices';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SettingsIcon from '@mui/icons-material/Settings';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ExtensionIcon from '@mui/icons-material/Extension';
import RouteIcon from '@mui/icons-material/Route';
import FolderIcon from '@mui/icons-material/Folder';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';

const TABS = [
  { to: '/', label: '神经图', icon: <HubIcon /> },
  { to: '/devices', label: '设备', icon: <DevicesIcon /> },
  { to: '/tasks', label: '任务', icon: <AssignmentIcon /> },
  { to: '/settings', label: '设置', icon: <SettingsIcon /> },
  { to: '/deploy', label: '部署', icon: <CloudUploadIcon /> },
  { to: '/platform-models', label: '平台模型', icon: <ExtensionIcon /> },
  { to: '/assets', label: '资产', icon: <FolderIcon /> },
  { to: '/routing', label: '路由网关', icon: <RouteIcon /> },
];

/** 手机屏固定显示前 4 项，其余折叠进「更多」 */
const PRIMARY_COUNT = 4;

/**
 * 手机底部 Tab：直接追加 3 项 + 文字缩小 + 溢出折叠「更多」。
 */
export function MobileTabBar(): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = TABS.slice(0, PRIMARY_COUNT);
  const overflow = TABS.slice(PRIMARY_COUNT);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex h-14 border-t border-[#E2E8F0] bg-white">
      {primary.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${
              isActive ? 'text-[#4F46E5]' : 'text-[#64748B]'
            }`
          }
        >
          {tab.icon}
          <span>{tab.label}</span>
        </NavLink>
      ))}

      {/* 更多 */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-[#64748B]">
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] text-[#64748B]"
        >
          <MoreHorizIcon />
          <span>更多</span>
        </button>
        {moreOpen && (
          <div className="absolute bottom-14 right-0 z-30 flex w-36 flex-col rounded-lg border border-[#E2E8F0] bg-white p-1 shadow-card">
            {overflow.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                    isActive ? 'bg-[#EEF2FF] text-[#4F46E5]' : 'text-[#334155]'
                  }`
                }
              >
                {tab.icon}
                <span>{tab.label}</span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
