import { Client } from 'tmi.js';
import { TWITCH_CLIENT_ID } from '@/config/security';

type MessageCallback = (username: string, message: string) => void;
type ConnectionCallback = (connected: boolean, error?: string) => void;

const twitchClients: { [channelName: string]: Client } = {};

const recentErrors: { [channelName: string]: { message: string, timestamp: number } } = {};

const TWITCH_TOKEN_KEY = 'twitchOAuthToken';
const TWITCH_TOKEN_TIMESTAMP_KEY = 'twitchOAuthTokenTimestamp';
const TOKEN_STALE_THRESHOLD_MS = 60 * 60 * 1000;

const ERROR_TTL_MS = 30000;

const cleanupOldErrors = (): void => {
  const now = Date.now();
  for (const key of Object.keys(recentErrors)) {
    if (now - recentErrors[key].timestamp > ERROR_TTL_MS) {
      delete recentErrors[key];
    }
  }
};

setInterval(cleanupOldErrors, 60000);

interface TwitchTokenInfo {
  token: string;
  timestamp: number;
}

export const saveTwitchOAuthToken = (token: string): void => {
  try {
    const tokenInfo: TwitchTokenInfo = {
      token,
      timestamp: Date.now()
    };
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
    if (typeof parsed === 'string') {
      return { token: parsed, timestamp: 0 };
    }
    return parsed as TwitchTokenInfo;
  } catch (error) {
    console.error("TwitchService: Error reading token info:", error);
    return null;
  }
};

export const getTwitchOAuthToken = (): string | null => {
  const tokenInfo = getTwitchTokenInfo();
  return tokenInfo?.token || null;
};

export const isTwitchTokenStale = (): boolean => {
  const tokenInfo = getTwitchTokenInfo();
  if (!tokenInfo || tokenInfo.timestamp === 0) return true;
  
  const age = Date.now() - tokenInfo.timestamp;
  return age > TOKEN_STALE_THRESHOLD_MS;
};

export const getTokenAgeMinutes = (): number | null => {
  const tokenInfo = getTwitchTokenInfo();
  if (!tokenInfo || tokenInfo.timestamp === 0) return null;
  return Math.floor((Date.now() - tokenInfo.timestamp) / (60 * 1000));
};

export const validateTwitchToken = async (): Promise<{ valid: boolean; username?: string; error?: string }> => {
  try {
    const tokenInfo = getTwitchTokenInfo();
    if (!tokenInfo) {
      return { valid: false, error: 'No token stored' };
    }
    
    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokenInfo.token}`,
        'Client-Id': TWITCH_CLIENT_ID
      }
    });
    
    if (response.status === 401) {
      console.log("TwitchService: Token is invalid (401 response)");
      return { valid: false, error: 'Token expired or revoked' };
    }
    
    if (!response.ok) {
      console.error("TwitchService: Token validation failed", response.status);
      return { valid: false, error: `Validation failed: ${response.status}` };
    }
    
    const data = await response.json();
    if (data && data.data && data.data.length > 0) {
      const username = data.data[0].login;
      console.log("TwitchService: Token validated for user:", username);
      return { valid: true, username };
    }
    
    return { valid: false, error: 'Unexpected response from Twitch' };
  } catch (error) {
    console.error("TwitchService: Error validating token:", error);
    return { valid: false, error: 'Network error during validation' };
  }
};

export const hasTwitchOAuthToken = (): boolean => {
  try {
    const tokenInfo = getTwitchTokenInfo();
    return !!tokenInfo?.token;
  } catch (error) {
    console.error("TwitchService: Error checking token:", error);
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

// Validate channel name to prevent injection attacks
const isValidChannelName = (name: string): boolean => {
  if (!name || typeof name !== 'string') return false;
  const channelNameRegex = /^[a-zA-Z0-9_]{2,25}$/;
  return channelNameRegex.test(name);
};

// Helper function to check if we should report an error
// This prevents duplicate error notifications for the same channel/error
const shouldReportError = (channelName: string, errorMessage: string): boolean => {
  const now = Date.now();
  const errorKey = `${channelName}:${errorMessage}`;
  const recentError = recentErrors[errorKey];
  
  // If we've shown this same error recently (within 10 seconds), don't show it again
  if (recentError && now - recentError.timestamp < 10000) {
    return false;
  }
  
  // Store this error and timestamp
  recentErrors[errorKey] = { message: errorMessage, timestamp: now };
  return true;
};

const getTwitchClient = (channelName: string): Client | undefined => twitchClients[channelName];
const setTwitchClient = (channelName: string, client: Client): void => { twitchClients[channelName] = client; };
const removeTwitchClient = (channelName: string): void => { delete twitchClients[channelName]; };
const getConnectedChannels = (): string[] => Object.keys(twitchClients);

export const connectToTwitchChat = (
  channelName: string,
  onMessageReceived: MessageCallback,
  onConnectionChanged: ConnectionCallback
): void => {
  // Validate channel name to prevent injection attacks
  if (!isValidChannelName(channelName)) {
    onConnectionChanged(false, 'Invalid channel name. Use 2-25 alphanumeric characters or underscores.');
    return;
  }

  // Disconnect existing client for this channel if any
  if (getTwitchClient(channelName)) {
    getTwitchClient(channelName)!.disconnect();
    removeTwitchClient(channelName);
  }

  try {
    // Get token from localStorage
    const token = getTwitchOAuthToken();
    if (!token) {
      onConnectionChanged(false, 'Not authenticated with Twitch. Please connect using OAuth.');
      return;
    }

    const client = new Client({
      options: { 
        debug: false,
        clientId: TWITCH_CLIENT_ID
      },
      connection: {
        secure: true,
        reconnect: false,
        timeout: 30000
      },
      identity: {
        username: channelName,
        password: `oauth:${token}`
      },
      channels: [channelName]
    });

    // Set up event handlers with better error handling
    client.on('message', (channel, tags, message, self) => {
      // Ignore messages from the bot itself
      if (self) return;

      // Extract display name or fallback to username
      const username = tags['display-name'] || tags.username || 'Anonymous';

      // Process the message
      onMessageReceived(username, message);
    });

    client.on('connected', () => {
      onConnectionChanged(true);
    });

    client.on('disconnected', (reason) => {
      // Only report disconnection if we haven't recently reported it
      const shouldReport = shouldReportError(channelName, `disconnect:${reason}`);
      if (shouldReport) {
        onConnectionChanged(false, reason);
      }
      // Clean up the client reference
      removeTwitchClient(channelName);
    });

    // Handle connection errors
    client.on('error', (error) => {
      console.error(`Twitch client error for ${channelName}:`, error);
      // Only report critical errors that require user attention
      if (error.message && !error.message.includes('ping timeout')) {
        const shouldReport = shouldReportError(channelName, `error:${error.message}`);
        if (shouldReport) {
          onConnectionChanged(false, error.message);
        }
      }
      // Don't immediately clean up on ping timeouts - let the connection handler deal with it
      if (!error.message || !error.message.includes('ping timeout')) {
        removeTwitchClient(channelName);
      }
    });

    // Handle reconnection events
    client.on('reconnect', () => {
    });

    // Connect to Twitch with better error handling
    client.connect().then(() => {
      // Store the client for later reference only after successful connection initiation
      setTwitchClient(channelName, client);
    }).catch(error => {
      console.error('Failed to connect to Twitch:', error);
      // Check if we've recently reported this same error to avoid duplicates
      const shouldReport = shouldReportError(channelName, `connect:${error.message}`);
      if (shouldReport) {
        onConnectionChanged(false, error.message);
      }
      // Don't store the client if connection failed
      removeTwitchClient(channelName);
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const shouldReport = shouldReportError(channelName, `setup:${errorMessage}`);
    
    if (shouldReport) {
      onConnectionChanged(false, errorMessage);
      console.error('Error setting up Twitch client:', error);
    }
  }
};

export const disconnectFromTwitchChat = (channelName?: string): Promise<void> => {
  return new Promise((resolve) => {
    try {
      if (channelName && getTwitchClient(channelName)) {
        
        const client = getTwitchClient(channelName)!;
        
        // Set up timeout to prevent hanging
        const timeout = setTimeout(() => {
          console.warn(`Twitch disconnect timeout for ${channelName}, forcing cleanup`);
          removeTwitchClient(channelName);
          resolve();
        }, 3000); // Reduced timeout to 3 seconds
        
        // Handle disconnect events
        const onDisconnect = () => {
          clearTimeout(timeout);
          removeTwitchClient(channelName);
          resolve();
        };
        
        const onError = (error: any) => {
          clearTimeout(timeout);
          removeTwitchClient(channelName);
          console.error(`Error during Twitch disconnect for ${channelName}:`, error);
          resolve(); // Resolve anyway since we cleaned up
        };
        
        // Remove any existing listeners to prevent memory leaks
        client.removeAllListeners('disconnected');
        client.removeAllListeners('error');
        
        // Add event listeners for this disconnect operation
        client.once('disconnected', onDisconnect);
        client.once('error', onError);
        
        // Attempt to disconnect gracefully
        if (typeof client.disconnect === 'function') {
          client.disconnect().catch((error) => {
            clearTimeout(timeout);
            removeTwitchClient(channelName);
            console.error(`Disconnect promise rejected for ${channelName}:`, error);
            resolve(); // Resolve anyway since we cleaned up
          });
        } else {
          // If disconnect method is not available, force cleanup
          clearTimeout(timeout);
          removeTwitchClient(channelName);
          resolve();
        }
        
      } else if (!channelName) {
        // Disconnect all clients if no specific channel is provided
        const channelNames = getConnectedChannels();
        
        if (channelNames.length === 0) {
          resolve();
          return;
        }
        
        const disconnectPromises = channelNames.map(channel => {
          return disconnectFromTwitchChat(channel).catch(error => {
            console.error(`Failed to disconnect from ${channel}:`, error);
            // Continue with other disconnections even if one fails
          });
        });
        
        Promise.allSettled(disconnectPromises).then(() => {
          resolve();
        });
        
      } else {
        resolve();
      }
    } catch (error) {
      console.error('Error in disconnectFromTwitchChat:', error);
      // Clean up the client reference even if there was an error
      if (channelName && getTwitchClient(channelName)) {
        removeTwitchClient(channelName);
      }
      resolve(); // Resolve rather than reject to prevent hanging
    }
  });
};

export const isTwitchConnected = (channelName?: string): boolean => {
  if (channelName) {
    return !!getTwitchClient(channelName);
  }
  return getConnectedChannels().length > 0;
};

export const disconnectAllTwitchClients = async (): Promise<void> => {
  const channelNames = getConnectedChannels();
  
  for (const channelName of channelNames) {
    try {
      await disconnectFromTwitchChat(channelName);
    } catch (error) {
      console.error(`Error disconnecting from ${channelName}:`, error);
      removeTwitchClient(channelName);
    }
  }
};

// Get current user's Twitch username from token
export const getTwitchUsername = async (): Promise<string | null> => {
  try {
    const token = getTwitchOAuthToken();
    if (!token) {
      return null;
    }
    
    // Call Twitch API to get user info
    const response = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Client-Id': TWITCH_CLIENT_ID
      }
    });
    
    if (!response.ok) {
      console.error("TwitchService: Failed to get user info", await response.text());
      return null;
    }
    
    const data = await response.json();
    if (data && data.data && data.data.length > 0) {
      const username = data.data[0].login;
      return username;
    }
    
    return null;
  } catch (error) {
    console.error("TwitchService: Error getting username:", error);
    return null;
  }
};