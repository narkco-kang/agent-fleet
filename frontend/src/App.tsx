import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';

const GraphPage = lazy(() => import('./pages/GraphPage'));
const DevicesPage = lazy(() => import('./pages/DevicesPage'));
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SystemHealthPage = lazy(() => import('./pages/SystemHealthPage'));
const DeployPage = lazy(() => import('./pages/DeployPage'));
const PlatformModelsPage = lazy(() => import('./pages/PlatformModelsPage'));
const RoutingGatewayPage = lazy(() => import('./pages/RoutingGatewayPage'));
const AssetsPage = lazy(() => import('./pages/AssetsPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const SwarmTeamsPage = lazy(() => import('./pages/SwarmTeamsPage'));
const LoopPage = lazy(() => import('./pages/LoopPage'));
const McpPage = lazy(() => import('./pages/McpPage'));

/**
 * 应用根组件：路由挂载。页面按路由懒加载（code-split），减小首屏主包体积。
 */
export default function App(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center text-sm text-[var(--text-muted)]">
          加载中…
        </div>
      }
    >
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<GraphPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/system-health" element={<SystemHealthPage />} />
          <Route path="/deploy" element={<DeployPage />} />
          <Route path="/platform-models" element={<PlatformModelsPage />} />
          <Route path="/routing" element={<RoutingGatewayPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/swarm" element={<SwarmTeamsPage />} />
          <Route path="/loops" element={<LoopPage />} />
          <Route path="/mcp" element={<McpPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
