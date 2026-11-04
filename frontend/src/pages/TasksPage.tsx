import { TaskTable } from '../components/task/TaskTable';

/**
 * 任务中心页（04 §C）。
 */
export default function TasksPage(): JSX.Element {
  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-[var(--text-strong)]">任务中心</h1>
      </div>
      <TaskTable />
    </div>
  );
}
