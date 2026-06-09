import { describe, it, expect, beforeEach, vi } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

import {
  hasYoutubeOAuthToken,
  getStoredTokens,
  saveYoutubeTokens,
  clearYoutubeOAuthToken,
  getYoutubeOAuthToken,
  getValidYoutubeToken,
  generateColorFromChannelId,
} from './youtubeService';

const makeTokens = (overrides = {}) => ({
  access_token: 'ya29.abc',
  refresh_token: '1//def',
  expires_at: Date.now() + 3600 * 1000,
  ...overrides,
});

describe('youtubeService token storage', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('round-trips tokens', () => {
    const t = makeTokens();
    saveYoutubeTokens(t);
    expect(hasYoutubeOAuthToken()).toBe(true);
    expect(getYoutubeOAuthToken()).toBe('ya29.abc');
    expect(getStoredTokens()).toEqual(t);
  });

  it('clear removes tokens', () => {
    saveYoutubeTokens(makeTokens());
    clearYoutubeOAuthToken();
    expect(hasYoutubeOAuthToken()).toBe(false);
    expect(getStoredTokens()).toBeNull();
  });

  it('returns null when nothing stored', () => {
    expect(getStoredTokens()).toBeNull();
    expect(hasYoutubeOAuthToken()).toBe(false);
    expect(getYoutubeOAuthToken()).toBeNull();
  });

  it('getValidYoutubeToken returns token when fresh', async () => {
    saveYoutubeTokens(makeTokens({ expires_at: Date.now() + 3600 * 1000 }));
    const t = await getValidYoutubeToken();
    expect(t).toBe('ya29.abc');
  });

  it('getValidYoutubeToken returns null when no tokens stored', async () => {
    expect(await getValidYoutubeToken()).toBeNull();
  });

  it('survives corrupted localStorage', () => {
    localStorageMock.setItem('youtube_oauth_tokens', '{bad');
    expect(getStoredTokens()).toBeNull();
    expect(hasYoutubeOAuthToken()).toBe(false);
    expect(getYoutubeOAuthToken()).toBeNull();
  });

  it('survives token with empty access_token', () => {
    saveYoutubeTokens(makeTokens({ access_token: '' }));
    expect(hasYoutubeOAuthToken()).toBe(false);
  });
});

describe('generateColorFromChannelId', () => {
  it('returns hsl string', () => {
    const color = generateColorFromChannelId('UCabc123');
    expect(color).toMatch(/^hsl\(\d+, 70%, 50%\)$/);
  });

  it('is deterministic for same channelId', () => {
    const a = generateColorFromChannelId('UCsame');
    const b = generateColorFromChannelId('UCsame');
    expect(a).toBe(b);
  });

  it('handles empty string', () => {
    const color = generateColorFromChannelId('');
    expect(color).toMatch(/^hsl\(\d+, 70%, 50%\)$/);
  });

  it('produces value in 0-359 range for hue', () => {
    const color = generateColorFromChannelId('UCanything');
    const hue = parseInt(color.match(/\d+/)?.[0] ?? '0', 10);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});
