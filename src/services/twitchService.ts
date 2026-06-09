import { Client } from 'tmi.js';
import { TWITCH_CLIENT_ID } from '@/config/security';

type MessageCallback = (username: string, message: string) => void;
type ConnectionCallback = (connected: boolean, error?: string) => void;

const TWITCH_TOKEN_KEY = 'twitchOAuthToken';
const TWITCH_TOKEN_TIMESTAMP_KEY = 'twitchOAuthTokenTimestamp';
const TOKEN_STALE_THRESHOLD_MS = 60 * 60 * 1000;

interface TwitchTokenInfo {
  token: string;
  timestamp: number;
}

export const saveTwitchOAuthToken = (token: string): void => {
  try {
    const tokenInfo: TwitchTokenInfo = { token, timestamp: Date.now() };
    localStorage.setItem(TWITCH_TOKEN_KEY, JSON.stringify(tokenInfo));
  } catch (error) {
    console.error("TwitchService: Error saving token:", error);
  }
};

const getTwitchTokenInfo = (): TwitchTokenInfo | null => {
  try {
    const stored = localStorage.getItem(TWITCH_TOKEN_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (typeof parsed === 'string') return { token: parsed, timestamp: 0 };
    return parsed as TwitchTokenInfo;
  } catch (error) {
    console.error("TwitchService: Error reading token info:", error);
    return null;
  }
};

export const getTwitchOAuthToken = (): string | null => {
  return getTwitchTokenInfo()?.token || null;
};

export const isTwitchTokenStale = (): boolean => {
  const tokenInfo = getTwitchTokenInfo();
  if (!tokenInfo || tokenInfo.timestamp === 0) return true;
  return Date.now() - tokenInfo.timestamp > TOKEN_STALE_THRESHOLD_MS;
};

export const getTokenAgeMinutes = (): number | null => {
  const tokenInfo = getTwitchTokenInfo();
  if (!tokenInfo || tokenInfo.timestamp === 0) return null;
  return Math.floor((Date.now() - tokenInfo.timestamp) / (60 * 1000));
};

export const validateTwitchToken = async (): Promise<{ valid: boolean; username?: string; error?: string }> => {
  try {
    const tokenInfo = getTwitchTokenInfo();
    if (!tokenInfo) return { valid: false, error: 'No token stored' };

    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Authorization': `Bearer ${tokenInfo.token}`, 'Client-Id': TWITCH_CLIENT_ID }
    });

    if (response.status === 401) return { valid: false, error: 'Token expired or revoked' };
    if (!response.ok) return { valid: false, error: `Validation failed: ${response.status}` };

    const data = await response.json();
    if (data?.data?.length > 0) return { valid: true, username: data.data[0].login };

    return { valid: false, error: 'Unexpected response from Twitch' };
  } catch (error) {
    console.error("TwitchService: Error validating token:", error);
    return { valid: false, error: 'Network error during validation' };
  }
};

export const hasTwitchOAuthToken = (): boolean => {
  try {
    return !!getTwitchTokenInfo()?.token;
  } catch {
    return false;
  }
};

export const clearTwitchOAuthToken = (): void => {
  try {
    localStorage.removeItem(TWITCH_TOKEN_KEY);
    localStorage.removeItem(TWITCH_TOKEN_TIMESTAMP_KEY);
  } catch (error) {
    console.error("TwitchService: Error clearing token:", error);
  }
};

export const getTwitchUsername = async (): Promise<string | null> => {
  try {
    const token = getTwitchOAuthToken();
    if (!token) return null;

    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Authorization': `Bearer ${token}`, 'Client-Id': TWITCH_CLIENT_ID }
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data?.data?.[0]?.login || null;
  } catch (error) {
    console.error("TwitchService: Error getting username:", error);
    return null;
  }
};

const isValidChannelName = (name: string): boolean => {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z0-9_]{2,25}$/.test(name);
};

class TwitchConnectionManager {
  private clients = new Map<string, Client>();
  private recentErrors = new Map<string, { message: string; timestamp: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly ERROR_TTL_MS = 30000;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupOldErrors(), 60000);
  }

  private cleanupOldErrors(): void {
    const now = Date.now();
    for (const [key, entry] of this.recentErrors) {
      if (now - entry.timestamp > this.ERROR_TTL_MS) {
        this.recentErrors.delete(key);
      }
    }
  }

  private shouldReportError(channelName: string, errorMessage: string): boolean {
    const now = Date.now();
    const errorKey = `${channelName}:${errorMessage}`;
    const recent = this.recentErrors.get(errorKey);
    if (recent && now - recent.timestamp < 10000) return false;
    this.recentErrors.set(errorKey, { message: errorMessage, timestamp: now });
    return true;
  }

  connect(
    channelName: string,
    onMessageReceived: MessageCallback,
    onConnectionChanged: ConnectionCallback
  ): void {
    if (!isValidChannelName(channelName)) {
      onConnectionChanged(false, 'Invalid channel name. Use 2-25 alphanumeric characters or underscores.');
      return;
    }

    const existing = this.clients.get(channelName);
    if (existing) {
      existing.disconnect();
      this.clients.delete(channelName);
    }

    try {
      const token = getTwitchOAuthToken();
      if (!token) {
        onConnectionChanged(false, 'Not authenticated with Twitch. Please connect using OAuth.');
        return;
      }

      const client = new Client({
        options: { debug: false, clientId: TWITCH_CLIENT_ID },
        connection: { secure: true, reconnect: false, timeout: 30000 },
        identity: { username: channelName, password: `oauth:${token}` },
        channels: [channelName]
      });

      client.on('message', (_channel, tags, message, self) => {
        if (self) return;
        const username = tags['display-name'] || tags.username || 'Anonymous';
        onMessageReceived(username, message);
      });

      client.on('connected', () => onConnectionChanged(true));

      client.on('disconnected', (reason) => {
        if (this.shouldReportError(channelName, `disconnect:${reason}`)) {
          onConnectionChanged(false, reason);
        }
        this.clients.delete(channelName);
      });

      client.on('error', (error) => {
        console.error(`Twitch client error for ${channelName}:`, error);
        if (error.message && !error.message.includes('ping timeout')) {
          if (this.shouldReportError(channelName, `error:${error.message}`)) {
            onConnectionChanged(false, error.message);
          }
        }
        if (!error.message || !error.message.includes('ping timeout')) {
          this.clients.delete(channelName);
        }
      });

      client.on('reconnect', () => {});

      client.connect()
        .then(() => this.clients.set(channelName, client))
        .catch(error => {
          console.error('Failed to connect to Twitch:', error);
          if (this.shouldReportError(channelName, `connect:${error.message}`)) {
            onConnectionChanged(false, error.message);
          }
          this.clients.delete(channelName);
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (this.shouldReportError(channelName, `setup:${message}`)) {
        onConnectionChanged(false, message);
        console.error('Error setting up Twitch client:', error);
      }
    }
  }

  disconnect(channelName?: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (channelName) {
          const client = this.clients.get(channelName);
          if (!client) { resolve(); return; }

          const timeout = setTimeout(() => {
            console.warn(`Twitch disconnect timeout for ${channelName}, forcing cleanup`);
            this.clients.delete(channelName);
            resolve();
          }, 3000);

          const cleanup = () => {
            clearTimeout(timeout);
            this.clients.delete(channelName);
            resolve();
          };

          client.removeAllListeners('disconnected');
          client.removeAllListeners('error');
          client.once('disconnected', cleanup);
          client.once('error', (err: unknown) => {
            console.error(`Error during Twitch disconnect for ${channelName}:`, err);
            cleanup();
          });

          if (typeof client.disconnect === 'function') {
            client.disconnect().catch((err) => {
              clearTimeout(timeout);
              this.clients.delete(channelName);
              console.error(`Disconnect promise rejected for ${channelName}:`, err);
              resolve();
            });
          } else {
            clearTimeout(timeout);
            this.clients.delete(channelName);
            resolve();
          }
        } else {
          const channels = Array.from(this.clients.keys());
          if (channels.length === 0) { resolve(); return; }
          Promise.allSettled(channels.map(ch => this.disconnect(ch).catch(() => {})))
            .then(() => resolve());
        }
      } catch (error) {
        console.error('Error in disconnect:', error);
        if (channelName) this.clients.delete(channelName);
        resolve();
      }
    });
  }

  disconnectAll(): Promise<void> {
    return this.disconnect();
  }

  isConnected(channelName?: string): boolean {
    if (channelName) return this.clients.has(channelName);
    return this.clients.size > 0;
  }

  getConnectedChannels(): string[] {
    return Array.from(this.clients.keys());
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clients.clear();
    this.recentErrors.clear();
  }
}

const connectionManager = new TwitchConnectionManager();

export { connectionManager as TwitchConnectionManager };

export const connectToTwitchChat = (
  channelName: string,
  onMessageReceived: MessageCallback,
  onConnectionChanged: ConnectionCallback
): void => {
  connectionManager.connect(channelName, onMessageReceived, onConnectionChanged);
};

export const disconnectFromTwitchChat = (channelName?: string): Promise<void> => {
  return connectionManager.disconnect(channelName);
};

export const isTwitchConnected = (channelName?: string): boolean => {
  return connectionManager.isConnected(channelName);
};

export const disconnectAllTwitchClients = async (): Promise<void> => {
  return connectionManager.disconnectAll();
};