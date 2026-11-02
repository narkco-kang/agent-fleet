import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';

const GraphPage = lazy(() => import('./pages/GraphPage'));
const DevicesPage = lazy(() => import('./pages/DevicesPage'));
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DeployPage = lazy(() => import('./pages/DeployPage'));
const PlatformModelsPage = lazy(() => import('./pages/PlatformModelsPage'));
const RoutingGatewayPage = lazy(() => import('./pages/RoutingGatewayPage'));
const AssetsPage = lazy(() => import('./pages/AssetsPage'));
const MemoryPage = lazy(() => import('./pages/MemoryPage'));

/**
 * 应用根组件：路由挂载。页面按路由懒加载（code-split），减小首屏主包体积。
 */
export default function App(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center text-sm text-[#64748B]">
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
          <Route path="/deploy" element={<DeployPage />} />
          <Route path="/platform-models" element={<PlatformModelsPage />} />
          <Route path="/routing" element={<RoutingGatewayPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
