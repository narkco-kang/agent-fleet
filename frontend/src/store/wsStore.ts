import { create } from 'zustand';

/**
 * 连接状态全局态：局域网/中继指示 + 后端可用性。
 */
export type WsConnState = 'connecting' | 'open' | 'closed';

interface WsState {
  connState: WsConnState;
  backendOnline: boolean;
  relayOnline: boolean;
  setConnState: (state: WsConnState) => void;
  setBackendOnline: (online: boolean) => void;
  setRelayOnline: (online: boolean) => void;
}

export const useWsStore = create<WsState>((set) => ({
  connState: 'closed',
  backendOnline: false,
  relayOnline: false,
  setConnState: (connState) => set({ connState }),
  setBackendOnline: (backendOnline) => set({ backendOnline }),
  setRelayOnline: (relayOnline) => set({ relayOnline }),
}));
