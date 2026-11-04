import { useState } from 'react';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { RoleRouteTab } from '../components/routing/RoleRouteTab';
import { UsageLedgerTab } from '../components/routing/UsageLedgerTab';
import { FreeSourceTab } from '../components/routing/FreeSourceTab';
import { GatewayHealthTab } from '../components/routing/GatewayHealthTab';
import { PaidProviderTab } from '../components/routing/PaidProviderTab';

/**
 * 路由网关页：角色路由 / 台账 / 免费源 / 付费 Provider / 网关健康。
 */
export default function RoutingGatewayPage(): JSX.Element {
  const [tab, setTab] = useState(0);

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-4 text-xl font-semibold text-[var(--text-strong)]">路由网关</h1>
      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label="角色路由" />
        <Tab label="token 台账" />
        <Tab label="免费源" />
        <Tab label="付费 Provider" />
        <Tab label="网关健康" />
      </Tabs>
      {tab === 0 && <RoleRouteTab />}
      {tab === 1 && <UsageLedgerTab />}
      {tab === 2 && <FreeSourceTab />}
      {tab === 3 && <PaidProviderTab />}
      {tab === 4 && <GatewayHealthTab />}
    </div>
  );
}
