import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ttsQueueService } from './ttsQueueService';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import type { Message } from '@/types/message';

vi.mock('@/services/ttsService', () => ({
  playMessageAudio: vi.fn(),
}));

import { playMessageAudio } from '@/services/ttsService';

const makeMsg = (id: string): Message => ({
  id,
  content: '!г test',
  timestamp: Date.now(),
  username: 'user',
  status: 'pending',
});

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function mockPlaybackResolve(): void {
  vi.mocked(playMessageAudio).mockImplementation(
    (_msg: Message, _key: string, _start: () => void, end: () => void) => {
      end();
      return Promise.resolve();
    },
  );
}

function mockPlaybackRejectOnce(): void {
  vi.mocked(playMessageAudio)
    .mockImplementationOnce(
      (_msg: Message, _key: string, _start: () => void, _end: () => void) =>
        Promise.reject(new Error('TTS failed')),
    )
    .mockImplementation(
      (_msg: Message, _key: string, _start: () => void, end: () => void) => {
        end();
        return Promise.resolve();
      },
    );
}

describe('ttsQueueService', () => {
  beforeEach(() => {
    ttsQueueService.clear();
    vi.mocked(playMessageAudio).mockReset();
    useChatStore.setState({
      messages: [],
      connections: [],
      activeTab: 'chat',
      isProcessing: false,
    });
    useSettingsStore.setState({
      apiKey: '',
      volume: 0.7,
      ttsProvider: 'browser',
      selectedVoice: '',
    });
  });

  it('starts empty', () => {
    expect(ttsQueueService.getQueueLength()).toBe(0);
    expect(ttsQueueService.isProcessing()).toBe(false);
  });

  it('enqueue increases queue length', () => {
    ttsQueueService.enqueue(makeMsg('1'));
    expect(ttsQueueService.getQueueLength()).toBe(1);
  });

  it('clear empties the queue', () => {
    ttsQueueService.enqueue(makeMsg('1'));
    ttsQueueService.enqueue(makeMsg('2'));
    ttsQueueService.clear();
    expect(ttsQueueService.getQueueLength()).toBe(0);
    expect(ttsQueueService.isProcessing()).toBe(false);
  });

  it('does not exceed MAX_QUEUE_LENGTH', () => {
    for (let i = 0; i < 55; i++) {
      ttsQueueService.enqueue(makeMsg(`msg-${i}`));
    }
    expect(ttsQueueService.getQueueLength()).toBeLessThanOrEqual(50);
  });

  it('notifies subscribers on state change', () => {
    const listener = vi.fn();
    const unsub = ttsQueueService.subscribe(listener);

    ttsQueueService.enqueue(makeMsg('1'));
    expect(listener).toHaveBeenCalled();

    unsub();
    ttsQueueService.enqueue(makeMsg('2'));
    const callCount = listener.mock.calls.length;
    ttsQueueService.enqueue(makeMsg('3'));
    expect(listener.mock.calls.length).toBe(callCount);
  });

  it('sets queued timestamp on enqueue', () => {
    const msg = makeMsg('1');
    ttsQueueService.enqueue(msg);
    expect(msg.timings?.queued).toBeDefined();
    expect(msg.timings?.received).toBeDefined();
  });

  it('processes messages in FIFO order', async () => {
    mockPlaybackResolve();

    const msgs = [makeMsg('a'), makeMsg('b'), makeMsg('c')];
    msgs.forEach(m => { useChatStore.getState().addMessage(m); ttsQueueService.enqueue(m); });

    await flush();

    expect(playMessageAudio).toHaveBeenCalledTimes(3);
    const calledIds = vi.mocked(playMessageAudio).mock.calls.map(c => (c[0] as Message).id);
    expect(calledIds).toEqual(['a', 'b', 'c']);
    expect(useChatStore.getState().messages.map(m => m.status))
      .toEqual(['completed', 'completed', 'completed']);
  });

  it('marks errored message and continues to next', async () => {
    mockPlaybackRejectOnce();

    const m1 = makeMsg('err-1');
    const m2 = makeMsg('ok-2');
    useChatStore.getState().addMessage(m1);
    useChatStore.getState().addMessage(m2);
    ttsQueueService.enqueue(m1);
    ttsQueueService.enqueue(m2);

    await flush();

    const msgs = useChatStore.getState().messages;
    expect(msgs.find(m => m.id === 'err-1')?.status).toBe('error');
    expect(msgs.find(m => m.id === 'ok-2')?.status).toBe('completed');
    expect(playMessageAudio).toHaveBeenCalledTimes(2);
  });

  it('resumes after cancel when new message is enqueued', async () => {
    mockPlaybackResolve();

    const m1 = makeMsg('before');
    useChatStore.getState().addMessage(m1);
    ttsQueueService.enqueue(m1);
    await flush();

    ttsQueueService.cancel();

    const m2 = makeMsg('after');
    useChatStore.getState().addMessage(m2);
    ttsQueueService.enqueue(m2);
    await flush();

    expect(playMessageAudio).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().messages.find(m => m.id === 'after')?.status)
      .toBe('completed');
  });

  it('reads settings at processing time from the store', async () => {
    mockPlaybackResolve();
    const getStateSpy = vi.spyOn(useSettingsStore, 'getState');

    const m = makeMsg('settings');
    useChatStore.getState().addMessage(m);
    ttsQueueService.enqueue(m);
    await flush();

    expect(getStateSpy).toHaveBeenCalled();
    const call = vi.mocked(playMessageAudio).mock.calls[0];
    // args: message, apiKey, onStart, onEnd, volume(4), provider(5), voiceName(6)
    expect(call[4]).toBe(0.7);
    expect(call[5]).toBe('browser');
  });
});
