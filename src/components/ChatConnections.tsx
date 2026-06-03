import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Twitch, Youtube, X, LogIn, CheckCircle, LogOut, PlugIcon, Power } from 'lucide-react';
import { ChatConnection, ChatSource } from '@/types/chatSource';
import { useToast } from '@/hooks/use-toast';
import { TWITCH_CLIENT_ID, YOUTUBE_CLIENT_ID, OAUTH_REDIRECT_URI, generateOAuthState, TTS_COMMAND_PREFIX, hasTwitchClientId, hasYoutubeClientId } from '@/config/security';
import { Message } from '@/types/message';
import { useTtsQueue } from '@/hooks/useTtsQueue';
import { 
  connectToTwitchChat, 
  disconnectFromTwitchChat,
  getTwitchUsername,
  clearTwitchOAuthToken,
} from '@/services/twitchService';
import { 
  connectToYouTubeLiveChat,
  clearYoutubeOAuthToken,
} from '@/services/youtubeService';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useYoutubeBroadcasts, useYoutubeValidToken } from '@/hooks/useYoutubeQueries';
import { useOAuthCallback } from '@/hooks/useOAuthCallback';
import DiagnoseYouTube from '@/components/DiagnoseYouTube';

const ChatConnections: React.FC = () => {
  const { toast } = useToast();

  const connections = useChatStore(s => s.connections);
  const addConnection = useChatStore(s => s.addConnection);
  const removeConnection = useChatStore(s => s.removeConnection);
  const updateConnectionStatus = useChatStore(s => s.updateConnectionStatus);
  const setConnections = useChatStore(s => s.setConnections);
  const addMessage = useChatStore(s => s.addMessage);

  const { isTwitchAuthed, isYoutubeAuthed, setTwitchAuth, setYoutubeAuth, logoutTwitch, logoutYoutube } =
    useAuthStore(useShallow(s => ({
      isTwitchAuthed: s.isTwitchAuthed,
      isYoutubeAuthed: s.isYoutubeAuthed,
      setTwitchAuth: s.setTwitchAuth,
      setYoutubeAuth: s.setYoutubeAuth,
      logoutTwitch: s.logoutTwitch,
      logoutYoutube: s.logoutYoutube,
    })));

  const [isConnectingTwitch, setIsConnectingTwitch] = useState(false);
  const [isConnectingYoutube, setIsConnectingYoutube] = useState(false);
  const [isTwitchStreamConnected, setIsTwitchStreamConnected] = useState(false);
  const [isYoutubeStreamConnected, setIsYoutubeStreamConnected] = useState(false);

  const { enqueue } = useTtsQueue();

  const youtubeDisconnectFns = useRef<Record<string, () => void>>({});
  const lastConnectionAttempt = useRef<Record<string, number>>({});

  const { data: youtubeToken } = useYoutubeValidToken();
  const { data: broadcasts, refetch: refetchBroadcasts } = useYoutubeBroadcasts();

  useEffect(() => {
    return () => {
      Object.values(youtubeDisconnectFns.current).forEach(disconnect => {
        try { disconnect(); } catch (e) { console.error('Error cleaning up YouTube connection:', e); }
      });
      youtubeDisconnectFns.current = {};
    };
  }, []);

  useEffect(() => {
    const hasTwitchConnection = connections.some(conn => conn.type === 'twitch' && conn.isConnected);
    const hasYoutubeConnection = connections.some(conn => conn.type === 'youtube' && conn.isConnected);
    setIsTwitchStreamConnected(hasTwitchConnection);
    setIsYoutubeStreamConnected(hasYoutubeConnection);
  }, [connections]);

  const handleYoutubeBroadcastsCheck = useCallback(async () => {
    const result = await refetchBroadcasts();
    const activeBroadcasts = result.data;
    if (!activeBroadcasts || activeBroadcasts.length === 0) {
      toast({
        id: 'youtube-no-streams',
        title: "No Active YouTube Streams",
        description: "No active streams found. Start a live stream on YouTube first.",
        duration: 5000
      });
    } else {
      toast({
        id: 'youtube-streams-found',
        title: "YouTube Live Stream Found",
        description: `Found ${activeBroadcasts.length} active stream(s). Click 'Connect Stream' to monitor chat.`
      });
    }
  }, [refetchBroadcasts, toast]);

  useOAuthCallback({
    onTwitchAuth: useCallback(() => setTwitchAuth(true), [setTwitchAuth]),
    onYoutubeAuth: useCallback(() => setYoutubeAuth(true), [setYoutubeAuth]),
    onYoutubeBroadcastsCheck: handleYoutubeBroadcastsCheck,
    toast,
  });

  const handleConnectToTwitch = async () => {
    if (!isTwitchAuthed) {
      toast({
        title: "Twitch Connection",
        description: "Please login with Twitch first",
        variant: "destructive"
      });
      return;
    }

    if (isConnectingTwitch) return;

    setIsConnectingTwitch(true);

    try {
      const username = await getTwitchUsername();
      if (username) {
        const lastAttempt = lastConnectionAttempt.current[username] || 0;
        if (Date.now() - lastAttempt < 5000) {
          toast({
            title: "Please Wait",
            description: "Please wait a moment before reconnecting",
            variant: "default"
          });
          setIsConnectingTwitch(false);
          return;
        }

        lastConnectionAttempt.current[username] = Date.now();

        const existingConnection = connections.find(
          conn => conn.type === 'twitch' && conn.channelName.toLowerCase() === username.toLowerCase()
        );

        if (!existingConnection) {
          const connectionId = `twitch-${Date.now()}`;
          const newConnection: ChatConnection = {
            id: connectionId,
            type: 'twitch',
            channelName: username,
            isConnected: false,
            status: 'connecting',
          };

          addConnection(newConnection);

          connectToTwitchChat(
            username,
            (twitchUser, message) => {
              const newMessage: Message = {
                id: `twitch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                content: message,
                timestamp: Date.now(),
                username: twitchUser,
                status: 'pending',
              };
              addMessage(newMessage);
              if (message.startsWith(TTS_COMMAND_PREFIX)) {
                enqueue(newMessage);
              }
            },
            (connected, error) => {
              updateConnectionStatus(connectionId, connected, error, connected ? 'connected' : 'error');

              if (connected) {
                toast({
                  title: "Connected to Twitch",
                  description: `Now listening to ${username}'s chat`
                });
              } else if (error && !error.includes('RECONNECT')) {
                toast({
                  title: "Twitch Connection Error",
                  description: error,
                  variant: "destructive"
                });
              }
            }
          );
        } else {
          toast({
            title: "Already Connected",
            description: `You're already connected to ${username}'s chat`
          });
        }
      } else {
        toast({
          title: "Twitch Connection",
          description: "Could not determine your Twitch username",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error connecting to Twitch:", error);
      toast({
        title: "Twitch Connection Error",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    } finally {
      setIsConnectingTwitch(false);
    }
  };

  const handleDisconnectFromTwitch = async () => {
    const twitchConnections = connections.filter(conn => conn.type === 'twitch');

    if (twitchConnections.length === 0) {
      toast({
        title: "Twitch",
        description: "No active Twitch connections to disconnect"
      });
      return;
    }

    try {
      const disconnectPromises = twitchConnections.map(async (conn) => {
        try {
          await disconnectFromTwitchChat(conn.channelName);
          removeConnection(conn.id);
          return { success: true, channel: conn.channelName };
        } catch (error) {
          console.error(`Error disconnecting from ${conn.channelName}:`, error);
          removeConnection(conn.id);
          return { success: false, channel: conn.channelName, error };
        }
      });

      const results = await Promise.allSettled(disconnectPromises);
      setIsTwitchStreamConnected(false);

      const failed = results.filter(r => r.status === 'rejected').length;
      const successful = results.filter(r => r.status === 'fulfilled').length;

      if (failed === 0) {
        toast({
          title: "Twitch Disconnected",
          description: `Successfully disconnected from all ${successful} Twitch channel(s)`
        });
      } else {
        toast({
          title: "Twitch Disconnection",
          description: `Disconnected from ${successful} channel(s), ${failed} had issues but were removed from the list`,
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error("Error in handleDisconnectFromTwitch:", error);
      setIsTwitchStreamConnected(false);
      const updatedConnections = connections.filter(conn => conn.type !== 'twitch');
      setConnections(updatedConnections);
      toast({
        title: "Twitch Disconnection",
        description: "Disconnection completed with some issues, but all channels have been removed",
        variant: "destructive"
      });
    }
  };

  const handleConnectToYoutube = async () => {
    if (!isYoutubeAuthed) {
      toast({
        title: "YouTube Connection",
        description: "Please login with YouTube first",
        variant: "destructive"
      });
      return;
    }

    if (isConnectingYoutube) return;

    setIsConnectingYoutube(true);

    try {
      let activeBroadcasts: any[] = [];
      try {
        activeBroadcasts = await refetchBroadcasts().then(r => r.data ?? []);
      } catch (broadcastFetchError) {
        console.error("Failed to fetch YouTube broadcasts:", broadcastFetchError);
        if (broadcastFetchError instanceof Error) {
          toast({
            title: "Connection Error",
            description: broadcastFetchError.message,
            variant: "destructive",
            duration: 5000
          });
        }
        setIsConnectingYoutube(false);
        return;
      }

      if (activeBroadcasts.length > 0) {
        const broadcastId = activeBroadcasts[0].id;
        const broadcastTitle = activeBroadcasts[0].snippet?.title || 'Unknown';

        const existingConnection = connections.find(
          conn => conn.type === 'youtube' && conn.channelName === broadcastTitle
        );

        if (!existingConnection) {
          const connectionId = `youtube-${Date.now()}`;
          const newConnection: ChatConnection = {
            id: connectionId,
            type: 'youtube',
            channelName: broadcastTitle || broadcastId,
            isConnected: false,
            status: 'connecting',
          };

          addConnection(newConnection);

          try {
            const { disconnect } = await connectToYouTubeLiveChat(
              broadcastId,
              (ytMessage) => {
                const text = ytMessage.snippet?.displayMessage || '';
                const newMessage: Message = {
                  id: `youtube-${ytMessage.id || Date.now()}`,
                  content: text,
                  timestamp: ytMessage.snippet?.publishedAt
                    ? new Date(ytMessage.snippet.publishedAt).getTime()
                    : Date.now(),
                  username: ytMessage.authorDetails?.displayName || 'Anonymous',
                  status: 'pending',
                };
                addMessage(newMessage);
                if (text.startsWith(TTS_COMMAND_PREFIX)) {
                  enqueue(newMessage);
                }
              },
              (error) => {
                updateConnectionStatus(connectionId, false, error.message, 'error');
                setIsYoutubeStreamConnected(false);
                toast({
                  title: "Connection Error",
                  description: error.message || "Could not connect to YouTube chat.",
                  variant: "destructive",
                  duration: 5000
                });
              }
            );

            youtubeDisconnectFns.current[connectionId] = disconnect;
            updateConnectionStatus(connectionId, true, undefined, 'connected');
            setIsYoutubeStreamConnected(true);

            toast({
              title: "Connected to YouTube",
              description: `Now listening to live chat for: ${broadcastTitle}`
            });
          } catch (connectionError) {
            console.error("Error establishing YouTube chat connection:", connectionError);
            removeConnection(connectionId);
            if (connectionError instanceof Error) {
              toast({
                title: "Connection Error",
                description: connectionError.message,
                variant: "destructive",
                duration: 5000
              });
            }
          }
        } else {
          toast({
            title: "Already Connected",
            description: "You're already connected to this YouTube live stream"
          });
        }
      } else {
        toast({
          title: "No Active Streams",
          description: "Start a live stream on YouTube, then try again.",
          variant: "destructive",
          duration: 5000
        });
      }
    } catch (error) {
      console.error("Unexpected error in handleConnectToYoutube:", error);
      toast({
        title: "Connection Error",
        description: error instanceof Error ? error.message : "Something went wrong. Please try again.",
        variant: "destructive",
        duration: 5000
      });
    } finally {
      setIsConnectingYoutube(false);
    }
  };

  const handleDisconnectFromYoutube = () => {
    const youtubeConnections = connections.filter(conn => conn.type === 'youtube');

    if (youtubeConnections.length === 0) {
      toast({
        title: "YouTube",
        description: "No active YouTube connections to disconnect"
      });
      return;
    }

    youtubeConnections.forEach(conn => {
      disconnectChat(conn);
    });

    setIsYoutubeStreamConnected(false);

    toast({
      title: "YouTube Disconnected",
      description: "Successfully disconnected from all YouTube live streams"
    });
  };

  const disconnectChat = useCallback((connection: ChatConnection) => {
    removeConnection(connection.id);

    try {
      if (connection.type === 'twitch') {
        disconnectFromTwitchChat(connection.channelName).catch(error => {
          console.error(`Error disconnecting from ${connection.channelName}:`, error);
        });
      } else if (connection.type === 'youtube') {
        const disconnect = youtubeDisconnectFns.current[connection.id];
        if (disconnect) {
          disconnect();
          delete youtubeDisconnectFns.current[connection.id];
        }
      }

      toast({
        title: `Disconnected from ${connection.type === 'twitch' ? 'Twitch' : 'YouTube'}`,
        description: `No longer listening to ${connection.channelName}'s chat`
      });
    } catch (error) {
      console.error(`Error disconnecting from ${connection.channelName}:`, error);
      toast({
        title: "Warning",
        description: `Had trouble disconnecting from ${connection.channelName}, but it's been removed from the list`,
        variant: "destructive"
      });
    }
  }, [removeConnection, toast]);

  const handleTwitchLogout = async () => {
    const twitchConnections = connections.filter(conn => conn.type === 'twitch');

    for (const conn of twitchConnections) {
      try {
        await disconnectFromTwitchChat(conn.channelName);
        removeConnection(conn.id);
      } catch (error) {
        console.error("Error during Twitch logout:", error);
        removeConnection(conn.id);
      }
    }

    clearTwitchOAuthToken();
    logoutTwitch();
    setIsTwitchStreamConnected(false);

    toast({
      title: "Twitch Disconnected",
      description: "You've been logged out of Twitch"
    });
  };

  const handleYoutubeLogout = () => {
    connections
      .filter(conn => conn.type === 'youtube')
      .forEach(conn => disconnectChat(conn));

    clearYoutubeOAuthToken();
    logoutYoutube();
    setIsYoutubeStreamConnected(false);

    toast({
      title: "YouTube Disconnected",
      description: "You've been logged out of YouTube"
    });
  };

  const getSourceIcon = (source: ChatSource) => {
    switch (source) {
      case 'twitch':
        return <Twitch size={16} className="text-purple-400" />;
      case 'youtube':
        return <Youtube size={16} className="text-red-400" />;
      default:
        return null;
    }
  };

  const handleTwitchAuth = () => {
    if (!hasTwitchClientId) {
      toast({
        title: "Twitch Not Configured",
        description: "Set VITE_TWITCH_CLIENT_ID in your .env file to enable Twitch login.",
        variant: "destructive",
        duration: 8000,
      });
      return;
    }
    const scopes = ['chat:read', 'chat:edit'];
    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.append('client_id', TWITCH_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', OAUTH_REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'token');
    authUrl.searchParams.append('scope', scopes.join(' '));
    authUrl.searchParams.append('force_verify', 'true');
    authUrl.searchParams.append('state', generateOAuthState('twitch'));

    const fullAuthUrl = authUrl.toString();

    toast({
      title: "Twitch Authentication",
      description: "Opening Twitch login in your browser..."
    });

    if (typeof window !== 'undefined' && (window as any).electron) {
      try {
        (window as any).electron.openExternalAuth(fullAuthUrl, OAUTH_REDIRECT_URI);
      } catch (error) {
        console.error("Error opening Twitch auth URL:", error);
        toast({
          title: "Authentication Error",
          description: "Failed to open Twitch authentication page",
          variant: "destructive"
        });
      }
    } else {
      const authWindow = window.open(
        fullAuthUrl,
        'twitch_auth',
        'width=500,height=700,scrollbars=yes,resizable=yes'
      );

      if (!authWindow) {
        toast({
          title: "Popup Blocked",
          description: "Please allow popups and try again.",
          variant: "destructive"
        });
        return;
      }

      toast({
        title: "Web Authentication",
        description: "Complete the authentication in the popup window. The popup should close automatically when done.",
        duration: 10000
      });
    }
  };

  const handleYouTubeAuth = async () => {
    if (!hasYoutubeClientId) {
      toast({
        title: "YouTube Not Configured",
        description: "Set VITE_YOUTUBE_CLIENT_ID in your .env file to enable YouTube login.",
        variant: "destructive",
        duration: 8000,
      });
      return;
    }
    const scopes = [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload'
    ];

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('client_id', YOUTUBE_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', OAUTH_REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('access_type', 'offline');
    authUrl.searchParams.append('scope', scopes.join(' '));
    authUrl.searchParams.append('prompt', 'consent');
    authUrl.searchParams.append('include_granted_scopes', 'true');
    authUrl.searchParams.append('state', generateOAuthState('youtube'));

    const fullAuthUrl = authUrl.toString();

    toast({
      title: "YouTube Authentication",
      description: "Opening YouTube login in your browser..."
    });

    if (typeof window !== 'undefined' && (window as any).electron) {
      try {
        (window as any).electron.openExternalAuth(fullAuthUrl, OAUTH_REDIRECT_URI);
      } catch (error) {
        console.error("Error opening YouTube auth URL:", error);
        toast({
          title: "Authentication Error",
          description: "Failed to open YouTube authentication page",
          variant: "destructive"
        });
      }
    } else {
      const authWindow = window.open(
        fullAuthUrl,
        'youtube_auth',
        'width=500,height=700,scrollbars=yes,resizable=yes'
      );

      if (!authWindow) {
        toast({
          title: "Popup Blocked",
          description: "Please allow popups and try again.",
          variant: "destructive"
        });
        return;
      }

      toast({
        title: "Web Authentication",
        description: "Complete the authentication in the popup window. The popup should close automatically when done.",
        duration: 10000
      });
    }
  };

  const resetYouTubeAuth = () => {
    clearYoutubeOAuthToken();
    logoutYoutube();
    toast({
      title: "YouTube Authentication Reset",
      description: "Please log in again to reconnect YouTube.",
    });
  };

  const handleDisconnect = (connectionId: string) => {
    const connection = connections.find(conn => conn.id === connectionId);
    if (!connection) {
      console.warn(`Connection with ID ${connectionId} not found`);
      return;
    }

    removeConnection(connection.id);

    try {
      if (connection.type === 'twitch') {
        disconnectFromTwitchChat(connection.channelName).catch(error => {
          console.error(`Error disconnecting from ${connection.channelName}:`, error);
        });
      } else if (connection.type === 'youtube') {
        const disconnect = youtubeDisconnectFns.current[connection.id];
        if (disconnect) {
          disconnect();
          delete youtubeDisconnectFns.current[connection.id];
        } else {
          console.warn(`No disconnect function found for YouTube connection: ${connection.id}`);
        }
      }

      toast({
        title: `Disconnected from ${connection.type === 'twitch' ? 'Twitch' : 'YouTube'}`,
        description: `No longer listening to ${connection.channelName}'s chat`
      });
    } catch (error) {
      console.error(`Error disconnecting from ${connection.channelName}:`, error);
      toast({
        title: "Warning",
        description: `Had trouble disconnecting from ${connection.channelName}, but it's been removed from the list`,
        variant: "destructive"
      });
    }
  };



  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Chat Connections</h2>
        <Badge variant="outline" className="text-xs">
          {connections.length} connected
        </Badge>
      </div>

      {/* Twitch Section */}
      <Card className="border-purple-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Twitch className="h-5 w-5 text-purple-500" />
            Twitch
            {isTwitchAuthed && (
              <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50">
                <CheckCircle className="h-3 w-3 mr-1" />
                Authenticated
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {!isTwitchAuthed ? (
              <Button
                onClick={handleTwitchAuth}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <LogIn className="h-4 w-4 mr-2" />
                Login with Twitch
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  onClick={handleConnectToTwitch}
                  disabled={isConnectingTwitch || isTwitchStreamConnected}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <PlugIcon className="h-4 w-4 mr-2" />
                  {isConnectingTwitch ? 'Connecting...' : isTwitchStreamConnected ? 'Connected to Stream' : 'Connect to Stream'}
                </Button>
                {isTwitchStreamConnected && (
                  <Button
                    onClick={handleDisconnectFromTwitch}
                    variant="outline"
                    className="border-red-500/50 text-red-400 hover:bg-red-500/20"
                  >
                    <Power className="h-4 w-4 mr-2" />
                    Disconnect
                  </Button>
                )}
                <Button
                  onClick={handleTwitchLogout}
                  variant="outline"
                  className="border-gray-500/50 text-gray-400 hover:bg-gray-500/20"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
              </div>
            )}
          </div>

          {connections.filter(c => c.type === 'twitch').map(connection => (
              <div key={connection.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Twitch className="h-4 w-4 text-purple-500" />
                  <span className="font-medium">{connection.channelName}</span>
                  <Badge variant={connection.isConnected ? 'default' : 'secondary'}>
                    {connection.status === 'connecting' ? 'Connecting...' :
                     connection.status === 'connected' ? 'Connected' :
                     connection.status === 'error' ? 'Error' :
                     connection.status === 'reconnecting' ? 'Reconnecting...' :
                     'Disconnected'}
                  </Badge>
                </div>
                <Button
                  onClick={() => handleDisconnect(connection.id)}
                  variant="ghost"
                  size="sm"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
        </CardContent>
      </Card>

      {/* YouTube Section */}
      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Youtube className="h-5 w-5 text-red-500" />
            YouTube
            {isYoutubeAuthed && (
              <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/50">
                <CheckCircle className="h-3 w-3 mr-1" />
                Authenticated
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {!isYoutubeAuthed ? (
              <Button
                onClick={handleYouTubeAuth}
                className="bg-red-600 hover:bg-red-700"
              >
                <LogIn className="h-4 w-4 mr-2" />
                Login with YouTube
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  onClick={handleConnectToYoutube}
                  disabled={isConnectingYoutube || isYoutubeStreamConnected}
                  className="bg-red-600 hover:bg-red-700"
                >
                  <PlugIcon className="h-4 w-4 mr-2" />
                  {isConnectingYoutube ? 'Connecting...' : isYoutubeStreamConnected ? 'Connected to Live Chat' : 'Connect to Live Chat'}
                </Button>
                {isYoutubeStreamConnected && (
                  <Button
                    onClick={handleDisconnectFromYoutube}
                    variant="outline"
                    className="border-red-500/50 text-red-400 hover:bg-red-500/20"
                  >
                    <Power className="h-4 w-4 mr-2" />
                    Disconnect
                  </Button>
                )}
                <Button
                  onClick={handleYoutubeLogout}
                  variant="outline"
                  className="border-gray-500/50 text-gray-400 hover:bg-gray-500/20"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
                <DiagnoseYouTube />
                <Button
                  onClick={resetYouTubeAuth}
                  variant="outline"
                  className="border-gray-500/50 text-gray-400 hover:bg-gray-500/20"
                >
                  Reset Auth
                </Button>
              </div>
            )}
          </div>

          {connections.filter(c => c.type === 'youtube').map(connection => (
              <div key={connection.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-2">
                  <Youtube className="h-4 w-4 text-red-500" />
                  <span className="font-medium">{connection.channelName}</span>
                  <Badge variant={connection.isConnected ? 'default' : 'secondary'}>
                    {connection.status === 'connecting' ? 'Connecting...' :
                     connection.status === 'connected' ? 'Connected' :
                     connection.status === 'error' ? 'Error' :
                     connection.status === 'reconnecting' ? 'Reconnecting...' :
                     'Disconnected'}
                  </Badge>
                </div>
                <Button
                  onClick={() => handleDisconnect(connection.id)}
                  variant="ghost"
                  size="sm"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChatConnections;
