import { Message } from '@/types/message';
import { playMessageAudio } from '@/services/ttsService';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';

const MAX_QUEUE_LENGTH = 50;

type Listener = () => void;

class TtsQueueService {
  private queue: Message[] = [];
  private processing = false;
  private aborted = false;
  private listeners: Set<Listener> = new Set();

  enqueue(message: Message): void {
    if (this.queue.length >= MAX_QUEUE_LENGTH) {
      const dropped = this.queue.shift()!;
      useChatStore.getState().updateMessageStatus(dropped.id, 'error');
    }
    this.aborted = false;
    message.timings = { ...message.timings, received: message.timings?.received || Date.now(), queued: Date.now() };
    this.queue.push(message);
    this.notify();
    this.process();
  }

  clear(): void {
    this.queue = [];
    this.aborted = true;
    this.processing = false;
    this.notify();
  }

  cancel(): void {
    this.aborted = true;
    this.notify();
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  private async process(): Promise<void> {
    if (this.processing || this.aborted) return;
    this.processing = true;
    useChatStore.getState().setIsProcessing(true);
    this.notify();

    while (this.queue.length > 0) {
      if (this.aborted) break;

      const msg = this.queue[0];
      const { apiKey, volume, ttsProvider, selectedVoice } = useSettingsStore.getState();

      if (ttsProvider === 'elevenlabs' && !apiKey) {
        useChatStore.getState().updateMessageStatus(msg.id, 'error');
        this.queue.shift();
        this.notify();
        continue;
      }

      try {
        useChatStore.getState().updateMessageStatus(msg.id, 'playing');
        msg.timings = { ...msg.timings, playbackStarted: Date.now() };

        await playMessageAudio(
          msg,
          apiKey,
          () => {},
          () => {
            msg.timings = { ...msg.timings, playbackCompleted: Date.now() };
            useChatStore.getState().updateMessageStatus(msg.id, 'completed');
          },
          volume,
          ttsProvider,
          selectedVoice,
        );
      } catch (error) {
        console.error('Error processing message:', error);
        useChatStore.getState().updateMessageStatus(msg.id, 'error');
      }

      this.queue.shift();
      this.notify();
    }

    this.processing = false;
    this.aborted = false;
    useChatStore.getState().setIsProcessing(false);
    this.notify();
  }
}

export const ttsQueueService = new TtsQueueService();
