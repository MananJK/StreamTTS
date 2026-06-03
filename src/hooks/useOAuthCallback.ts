import { useEffect } from 'react';
import { validateOAuthState } from '@/config/security';
import { saveTwitchOAuthToken } from '@/services/twitchService';
import { saveYoutubeTokens, getValidYoutubeToken, YouTubeTokens } from '@/services/youtubeService';

interface UseOAuthCallbackOptions {
  onTwitchAuth: () => void;
  onYoutubeAuth: () => void;
  onYoutubeBroadcastsCheck: () => Promise<void>;
  toast: (opts: { id?: string; title: string; description?: string; variant?: 'default' | 'destructive'; duration?: number }) => void;
}

export const useOAuthCallback = ({
  onTwitchAuth,
  onYoutubeAuth,
  onYoutubeBroadcastsCheck,
  toast,
}: UseOAuthCallbackOptions): void => {
  useEffect(() => {
    const handleAuthCallback = async (event: MessageEvent) => {
      const validOrigins = [
        window.location.origin,
        'http://localhost:3000',
        'http://localhost:8080'
      ];
      if (!validOrigins.includes(event.origin)) return;

      if (event.data && event.data.state && !validateOAuthState(event.data.state)) {
        console.error('OAuth state validation failed - possible CSRF attack');
        toast({
          id: 'oauth-csrf-error',
          title: "Security Error",
          description: "OAuth state validation failed. Please try authenticating again.",
          variant: "destructive"
        });
        return;
      }

      if (event.data && event.data.type === 'twitch-oauth-callback' && event.data.token) {
        saveTwitchOAuthToken(event.data.token);
        onTwitchAuth();
        toast({
          id: 'twitch-auth-success',
          title: "Twitch Authentication Successful",
          description: "You can now connect to your Twitch channel"
        });
      }

      if (event.data && event.data.type === 'youtube-oauth-callback' && event.data.token) {
        try {
          if (event.data.refresh_token && event.data.expires_in) {
            const tokens: YouTubeTokens = {
              access_token: event.data.token,
              refresh_token: event.data.refresh_token,
              expires_at: Date.now() + (event.data.expires_in * 1000),
            };
            saveYoutubeTokens(tokens);
          }

          const token = await getValidYoutubeToken();

          if (token) {
            onYoutubeAuth();
            toast({
              id: 'youtube-auth-success',
              title: "YouTube Authentication Successful",
              description: "You can now connect to your YouTube live stream"
            });

            try {
              await onYoutubeBroadcastsCheck();
            } catch (error) {
              console.error("Error checking for broadcasts:", error);
              toast({
                id: 'youtube-broadcast-error',
                title: "YouTube Error",
                description: "Error checking for live streams. Please try again.",
                variant: "destructive",
                duration: 5000
              });
            }
          } else {
            toast({
              id: 'youtube-permission-issue',
              title: "YouTube Permission Issue",
              description: "Authentication succeeded but lacks required permissions for live chat. Please log out and log in again to grant full YouTube access.",
              variant: "destructive",
              duration: 8000
            });
          }
        } catch (error) {
          console.error("Error in YouTube auth callback:", error);
          toast({
            id: 'youtube-auth-error',
            title: "YouTube Authentication Error",
            description: "There was a problem authenticating with YouTube. Please try again.",
            variant: "destructive"
          });
        }
      }
    };

    window.addEventListener('message', handleAuthCallback);

    if (typeof window.electron !== 'undefined') {
      (window.electron as any).onAuthCallback((data: any) => {
        handleAuthCallback(new MessageEvent('message', { data }));
      });
    }

    return () => {
      window.removeEventListener('message', handleAuthCallback);
    };
  }, [onTwitchAuth, onYoutubeAuth, onYoutubeBroadcastsCheck, toast]);
};
