
export type ChatSource = 'youtube' | 'twitch' | 'manual';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnecting' | 'error';

export interface ChatConnection {
  id: string;
  type: ChatSource;
  channelName: string;
  isConnected: boolean;
  status: ConnectionStatus;
  error?: string;
}
