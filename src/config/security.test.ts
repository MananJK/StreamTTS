import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sanitizeForDisplay, isValidUsername, TTS_COMMAND_PREFIX, generateOAuthState, validateOAuthState } from './security';

const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock });

describe('TTS_COMMAND_PREFIX', () => {
  it('should be the Russian g prefix', () => {
    expect(TTS_COMMAND_PREFIX).toBe('!г');
  });
});

describe('sanitizeForDisplay', () => {
  it('strips HTML tags', () => {
    expect(sanitizeForDisplay('<script>alert("xss")</script>')).toBe('scriptalert(xss)/script');
  });

  it('strips HTML-significant characters', () => {
    expect(sanitizeForDisplay('<b>bold</b>')).toBe('bbold/b');
  });

  it('strips null bytes', () => {
    expect(sanitizeForDisplay('hello\0world')).toBe('helloworld');
  });

  it('truncates to maxLength', () => {
    expect(sanitizeForDisplay('a'.repeat(200), 10)).toBe('a'.repeat(10));
  });

  it('trims whitespace', () => {
    expect(sanitizeForDisplay('  hello  ')).toBe('hello');
  });

  it('returns empty string for null/undefined input', () => {
    expect(sanitizeForDisplay('' as string)).toBe('');
    expect(sanitizeForDisplay(null as unknown as string)).toBe('');
    expect(sanitizeForDisplay(undefined as unknown as string)).toBe('');
  });

  it('defaults to 100 character max length', () => {
    const long = 'x'.repeat(150);
    expect(sanitizeForDisplay(long).length).toBe(100);
  });
});

describe('isValidUsername', () => {
  it('accepts valid alphanumeric usernames', () => {
    expect(isValidUsername('Streamer123')).toBe(true);
    expect(isValidUsername('abc')).toBe(true);
    expect(isValidUsername('a')).toBe(true);
    expect(isValidUsername('hello_world')).toBe(true);
  });

  it('rejects usernames with special characters', () => {
    expect(isValidUsername('hello!')).toBe(false);
    expect(isValidUsername('<script>')).toBe(false);
    expect(isValidUsername('user name')).toBe(false);
    expect(isValidUsername('test@twitch')).toBe(false);
  });

  it('rejects empty or null input', () => {
    expect(isValidUsername('')).toBe(false);
    expect(isValidUsername(null as unknown as string)).toBe(false);
    expect(isValidUsername(undefined as unknown as string)).toBe(false);
  });

  it('rejects overly long usernames', () => {
    expect(isValidUsername('a'.repeat(31))).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidUsername(123 as unknown as string)).toBe(false);
    expect(isValidUsername({} as unknown as string)).toBe(false);
  });
});

describe('generateOAuthState / validateOAuthState', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    vi.clearAllMocks();
  });

  it('round-trips a valid state', () => {
    const state = generateOAuthState('twitch');
    expect(validateOAuthState(state)).toBe(true);
  });

  it('rejects null state', () => {
    expect(validateOAuthState(null)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateOAuthState('')).toBe(false);
  });

  it('rejects malformed state (wrong format)', () => {
    expect(validateOAuthState('not-a-valid-state')).toBe(false);
  });

  it('rejects state with tampered nonce', () => {
    const state = generateOAuthState('twitch');
    const tampered = state.replace(/^[^_]+_auth_([^_]+)/, (_m, nonce) =>
      `twitch_auth_${nonce.replace(/./g, 'x')}`
    );
    expect(validateOAuthState(tampered)).toBe(false);
  });

  it('rejects state with no nonce part', () => {
    expect(validateOAuthState('twitch_auth')).toBe(false);
  });

  it('generates different nonces on each call', () => {
    const a = generateOAuthState('twitch');
    const b = generateOAuthState('twitch');
    expect(a).not.toBe(b);
  });

  it('rejects already-validated state (single-use)', () => {
    const state = generateOAuthState('twitch');
    expect(validateOAuthState(state)).toBe(true);
    expect(validateOAuthState(state)).toBe(false);
  });
});
