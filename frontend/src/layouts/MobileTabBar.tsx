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
import PsychologyIcon from '@mui/icons-material/Psychology';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useT } from '../i18n';

const TABS = [
  { to: '/', labelKey: 'nav.graph', icon: <HubIcon /> },
  { to: '/devices', labelKey: 'nav.devices', icon: <DevicesIcon /> },
  { to: '/tasks', labelKey: 'nav.tasks', icon: <AssignmentIcon /> },
  { to: '/settings', labelKey: 'nav.settings', icon: <SettingsIcon /> },
  { to: '/deploy', labelKey: 'nav.deploy', icon: <CloudUploadIcon /> },
  { to: '/platform-models', labelKey: 'nav.platformModels', icon: <ExtensionIcon /> },
  { to: '/assets', labelKey: 'nav.assets', icon: <FolderIcon /> },
  { to: '/memory', labelKey: 'nav.memory', icon: <PsychologyIcon /> },
  { to: '/routing', labelKey: 'nav.routing', icon: <RouteIcon /> },
];

/** 手机屏固定显示前 4 项，其余折叠进「更多」 */
const PRIMARY_COUNT = 4;

/**
 * 手机底部 Tab：直接追加 3 项 + 文字缩小 + 溢出折叠「更多」。
 */
export function MobileTabBar(): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const t = useT();

  const primary = TABS.slice(0, PRIMARY_COUNT);
  const overflow = TABS.slice(PRIMARY_COUNT);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex h-14 border-t border-[var(--border)] bg-[var(--surface)]">
      {primary.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${
              isActive ? 'text-[#4F46E5]' : 'text-[var(--text-muted)]'
            }`
          }
        >
          {tab.icon}
          <span>{t(tab.labelKey)}</span>
        </NavLink>
      ))}

      {/* 更多 */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-[var(--text-muted)]">
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className="flex flex-col items-center justify-center gap-0.5 text-[10px] text-[var(--text-muted)]"
        >
          <MoreHorizIcon />
          <span>{t('nav.more')}</span>
        </button>
        {moreOpen && (
          <div className="absolute bottom-14 right-0 z-30 flex w-36 flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-card">
            {overflow.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                    isActive ? 'bg-[var(--brand-soft)] text-[#4F46E5]' : 'text-[var(--text)]'
                  }`
                }
              >
                {tab.icon}
                <span>{t(tab.labelKey)}</span>
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
