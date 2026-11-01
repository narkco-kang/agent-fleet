import { NavLink } from 'react-router-dom';
import HubIcon from '@mui/icons-material/Hub';
import DevicesIcon from '@mui/icons-material/Devices';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SettingsIcon from '@mui/icons-material/Settings';

const TABS = [
  { to: '/', label: '神经图', icon: <HubIcon /> },
  { to: '/devices', label: '设备', icon: <DevicesIcon /> },
  { to: '/tasks', label: '任务', icon: <AssignmentIcon /> },
  { to: '/settings', label: '设置', icon: <SettingsIcon /> },
];

/**
 * 手机底部 Tab（04 §6.5）。
 */
export function MobileTabBar(): JSX.Element {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex h-14 border-t border-[#E2E8F0] bg-white">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
              isActive ? 'text-[#4F46E5]' : 'text-[#64748B]'
            }`
          }
        >
          {tab.icon}
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
