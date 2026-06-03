import { useState, useEffect, useCallback } from 'react';
import { ttsQueueService } from '@/services/ttsQueueService';
import { Message } from '@/types/message';
import { useChatStore } from '@/stores/chatStore';

export function useTtsQueue() {
  const [state, setState] = useState(() => ({
    isProcessing: ttsQueueService.isProcessing(),
    queueLength: ttsQueueService.getQueueLength(),
  }));

  useEffect(() => {
    const unsub = ttsQueueService.subscribe(() => {
      setState({
        isProcessing: ttsQueueService.isProcessing(),
        queueLength: ttsQueueService.getQueueLength(),
      });
    });
    return unsub;
  }, []);

  const isProcessing = useChatStore(s => s.isProcessing);

  const enqueue = useCallback((message: Message) => {
    ttsQueueService.enqueue(message);
  }, []);

  const clear = useCallback(() => {
    ttsQueueService.clear();
  }, []);

  return {
    enqueue,
    clear,
    isProcessing: isProcessing || state.isProcessing,
    queueLength: state.queueLength,
  };
}
