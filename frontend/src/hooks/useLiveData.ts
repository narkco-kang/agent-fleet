import { useEffect, useRef } from 'react';
import { http } from '../api/http';
import { connectWs, onSnapshot, onPatch, onWsState } from '../api/ws';
import { useDeviceStore, type DeviceRecord } from '../store/deviceStore';
import { useTaskStore } from '../store/taskStore';
import { useWsStore } from '../store/wsStore';
import { mockDevices, mockAgents } from '../api/mockData';
import { MockEngine } from '../api/mockEngine';
import type { DashboardSnapshot, DashboardPatch } from '@agentfleet/shared';

/**
 * 实时数据集成：
 * - 后端有真实设备 → 真实模式（REST + WS snapshot/patch）
 * - 后端离线、或在线但无设备 → 演示模式（MockEngine 驱动动态神经图）
 * 演示模式下忽略后端 WS snapshot/patch，避免空数据覆盖 mock。
 */
export function useLiveData(): void {
  const setDevices = useDeviceStore((s) => s.setDevices);
  const upsertDevice = useDeviceStore((s) => s.upsertDevice);
  const setTasks = useTaskStore((s) => s.setTasks);
  const upsertTask = useTaskStore((s) => s.upsertTask);
  const appendEvent = useTaskStore((s) => s.appendEvent);
  const setBackendOnline = useWsStore((s) => s.setBackendOnline);
  const setConnState = useWsStore((s) => s.setConnState);
  const setRelayOnline = useWsStore((s) => s.setRelayOnline);

  const inited = useRef(false);
  const mockMode = useRef(false);
  const engine = useRef<MockEngine | null>(null);

  // 进入演示模式：注入 mock 设备/agent，由引擎驱动动态演示
  const loadMock = (): void => {
    mockMode.current = true;
    const devices: DeviceRecord[] = mockDevices.map((d) => ({
      ...d,
      agents: mockAgents.filter((a) => a.deviceId === d.deviceId),
    }));
    setDevices(devices);
    setTasks([]);
    setBackendOnline(false);
    setRelayOnline(false);

    engine.current = new MockEngine({ upsertTask, appendEvent, upsertDevice });
    engine.current.start();
  };

  useEffect(() => {
    if (inited.current) return;
    inited.current = true;

    // 初始拉取
    (async () => {
      try {
        const [devsRes, tasksRes] = await Promise.all([http.getDevices(), http.getTasks()]);
        // 后端在线但没有任何设备 → 也进演示模式，让看板一打开就有内容
        if (!devsRes.data || devsRes.data.length === 0) {
          loadMock();
          return;
        }
        const devices: DeviceRecord[] = devsRes.data.map((d) => ({
          ...d,
          agents: d.agents ?? [],
        }));
        setDevices(devices);
        setTasks(tasksRes.data);
        setBackendOnline(true);
      } catch {
        loadMock();
      }
    })();

    // WS 订阅
    onSnapshot((snap: DashboardSnapshot) => {
      if (mockMode.current) return;
      const devices: DeviceRecord[] = snap.devices.map((d) => ({
        ...d,
        agents: snap.agents.filter((a) => a.deviceId === d.deviceId),
      }));
      setDevices(devices);
      setTasks(snap.tasks);
      setBackendOnline(true);
      setRelayOnline(snap.relayOnline);
    });

    onPatch((patch: DashboardPatch) => {
      if (mockMode.current) return;
      if (patch.devices) {
        for (const d of patch.devices) upsertDevice(d);
      }
      if (patch.tasks) {
        for (const t of patch.tasks) upsertTask(t);
      }
      if (patch.events) {
        for (const e of patch.events) appendEvent(e);
      }
      if (typeof patch.relayOnline === 'boolean') setRelayOnline(patch.relayOnline);
    });

    onWsState((state) => setConnState(state));

    connectWs();

    return () => {
      engine.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
