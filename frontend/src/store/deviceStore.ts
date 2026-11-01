import { create } from 'zustand';
import type { AgentSnapshot, DeviceSnapshot, DeviceStatus } from '@agentmesh/shared';

/**
 * 设备全局态：设备列表 + 在线态 + 每设备 agent 能力。
 */
export interface DeviceRecord extends DeviceSnapshot {
  agents: AgentSnapshot[];
}

interface DeviceState {
  devices: DeviceRecord[];
  loading: boolean;
  setDevices: (devices: DeviceRecord[]) => void;
  upsertDevice: (device: DeviceSnapshot, agents?: AgentSnapshot[]) => void;
  removeDevice: (deviceId: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [],
  loading: true,
  setDevices: (devices) => set({ devices, loading: false }),
  upsertDevice: (device, agents) =>
    set((state) => {
      const idx = state.devices.findIndex((d) => d.deviceId === device.deviceId);
      if (idx >= 0) {
        const next = [...state.devices];
        next[idx] = {
          ...next[idx],
          ...device,
          agents: agents ?? next[idx].agents,
        };
        return { devices: next };
      }
      return {
        devices: [
          ...state.devices,
          { ...device, agents: agents ?? [] },
        ],
      };
    }),
  removeDevice: (deviceId) =>
    set((state) => ({ devices: state.devices.filter((d) => d.deviceId !== deviceId) })),
  setLoading: (loading) => set({ loading }),
}));

/** 便捷：按 ID 取设备 */
export function useDevice(deviceId: string | undefined): DeviceRecord | undefined {
  return useDeviceStore((s) => s.devices.find((d) => d.deviceId === deviceId));
}

export type { DeviceStatus };
