import { create } from 'zustand';
import type { TaskEvent, TaskSnapshot, TaskStatus } from '@agentfleet/shared';

/**
 * 任务全局态：任务列表 + 详情消息流（按 taskId 归组）。
 */
interface TaskState {
  tasks: TaskSnapshot[];
  events: Record<string, TaskEvent[]>;
  loading: boolean;
  setTasks: (tasks: TaskSnapshot[]) => void;
  upsertTask: (task: Partial<TaskSnapshot> & { taskId: string }) => void;
  appendEvent: (event: TaskEvent) => void;
  setEvents: (taskId: string, events: TaskEvent[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  events: {},
  loading: true,
  setTasks: (tasks) => set({ tasks, loading: false }),
  upsertTask: (task) =>
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.taskId === task.taskId);
      if (idx >= 0) {
        const next = [...state.tasks];
        next[idx] = { ...next[idx], ...task } as TaskSnapshot;
        return { tasks: next };
      }
      // 新增：补全关键字段默认值，避免部分 patch（缺 prompt）插入「幽灵任务」
      // 导致详情页 task.prompt.slice 崩溃（DEFECT-TASK-PATCH）。
      const full = {
        sessionId: '',
        origin: 'dashboard',
        prompt: '',
        status: 'queued',
        targetMode: 'auto',
        createdAt: Date.now(),
        ...task,
      } as TaskSnapshot;
      return { tasks: [full, ...state.tasks] };
    }),
  appendEvent: (event) =>
    set((state) => ({
      events: {
        ...state.events,
        [event.taskId]: [...(state.events[event.taskId] ?? []), event],
      },
    })),
  setEvents: (taskId, events) =>
    set((state) => ({ events: { ...state.events, [taskId]: events } })),
  setLoading: (loading) => set({ loading }),
}));

/** 便捷：按 ID 取任务 */
export function useTask(taskId: string | undefined): TaskSnapshot | undefined {
  return useTaskStore((s) => s.tasks.find((t) => t.taskId === taskId));
}

export type { TaskStatus };
