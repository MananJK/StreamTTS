
export interface Message {
  id: string;
  content: string;
  timestamp: number;
  username?: string;
  status: 'pending' | 'playing' | 'completed' | 'error';
  timings?: {
    received?: number;
    queued?: number;
    playbackStarted?: number;
    playbackCompleted?: number;
  };
}
