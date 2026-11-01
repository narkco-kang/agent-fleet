import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import GraphPage from './pages/GraphPage';
import DevicesPage from './pages/DevicesPage';
import DeviceDetailPage from './pages/DeviceDetailPage';
import TasksPage from './pages/TasksPage';
import TaskDetailPage from './pages/TaskDetailPage';
import SettingsPage from './pages/SettingsPage';
import DeployPage from './pages/DeployPage';
import PlatformModelsPage from './pages/PlatformModelsPage';
import RoutingGatewayPage from './pages/RoutingGatewayPage';

/**
 * 应用根组件：路由挂载。
 */
export default function App(): JSX.Element {
  return (
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
