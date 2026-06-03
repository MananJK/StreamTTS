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
  saveTwitchOAuthToken,
  getTwitchOAuthToken,
  hasTwitchOAuthToken,
  clearTwitchOAuthToken,
  isTwitchTokenStale,
  getTokenAgeMinutes,
} from './twitchService';

describe('twitchService token management', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('round-trips a token', () => {
    saveTwitchOAuthToken('abc123');
    expect(getTwitchOAuthToken()).toBe('abc123');
    expect(hasTwitchOAuthToken()).toBe(true);
  });

  it('clears a token', () => {
    saveTwitchOAuthToken('abc123');
    clearTwitchOAuthToken();
    expect(getTwitchOAuthToken()).toBeNull();
    expect(hasTwitchOAuthToken()).toBe(false);
  });

  it('returns null when no token stored', () => {
    expect(getTwitchOAuthToken()).toBeNull();
    expect(hasTwitchOAuthToken()).toBe(false);
  });

  it('isTwitchTokenStale returns true when no token', () => {
    expect(isTwitchTokenStale()).toBe(true);
  });

  it('isTwitchTokenStale returns false for fresh token', () => {
    saveTwitchOAuthToken('fresh-token');
    expect(isTwitchTokenStale()).toBe(false);
  });

  it('isTwitchTokenStale returns true for old token', () => {
    const old = { token: 'old', timestamp: Date.now() - 61 * 60 * 1000 };
    localStorageMock.setItem('twitchOAuthToken', JSON.stringify(old));
    expect(isTwitchTokenStale()).toBe(true);
  });

  it('getTokenAgeMinutes returns null when no token', () => {
    expect(getTokenAgeMinutes()).toBeNull();
  });

  it('getTokenAgeMinutes returns a number for fresh token', () => {
    saveTwitchOAuthToken('token');
    const age = getTokenAgeMinutes();
    expect(age).toBeTypeOf('number');
    expect(age).toBeGreaterThanOrEqual(0);
  });

  it('handles legacy string-only token format', () => {
    localStorageMock.setItem('twitchOAuthToken', JSON.stringify('legacy-token'));
    expect(getTwitchOAuthToken()).toBe('legacy-token');
    expect(hasTwitchOAuthToken()).toBe(true);
  });

  it('survives corrupted localStorage gracefully', () => {
    localStorageMock.setItem('twitchOAuthToken', '{bad json');
    expect(getTwitchOAuthToken()).toBeNull();
    expect(hasTwitchOAuthToken()).toBe(false);
  });
});
