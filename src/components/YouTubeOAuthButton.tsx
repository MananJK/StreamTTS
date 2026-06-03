import React from 'react';
import { Button } from '@/components/ui/button';
import { Youtube, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveYoutubeTokens, hasYoutubeOAuthToken, clearYoutubeOAuthToken, YouTubeTokens } from '@/services/youtubeService';
import { openExternalAuth, onAuthCallback, isTauriAvailable, AuthCallbackData } from '@/lib/tauri-api';
import { YOUTUBE_CLIENT_ID, OAUTH_REDIRECT_URI, generateOAuthState, validateOAuthState } from '@/config/security';



interface YouTubeOAuthButtonProps {
  onAuthChange: (isAuthed: boolean) => void;
}

const YouTubeOAuthButton: React.FC<YouTubeOAuthButtonProps> = ({ onAuthChange }) => {
  const { toast } = useToast();
  const [isAuthorized, setIsAuthorized] = React.useState<boolean>(hasYoutubeOAuthToken());
  const [isAuthenticating, setIsAuthenticating] = React.useState<boolean>(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const pendingStateRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const syncTokenState = () => {
      const hasToken = hasYoutubeOAuthToken();
      if (hasToken !== isAuthorized) {
        setIsAuthorized(hasToken);
        onAuthChange(hasToken);
      }
    };

    syncTokenState();

    window.addEventListener('storage', syncTokenState);
    return () => window.removeEventListener('storage', syncTokenState);
  }, [isAuthorized, onAuthChange]);

  React.useEffect(() => {
    let mounted = true;
    
    const handleAuthCallback = (data: AuthCallbackData) => {
      if (!mounted) return;
      if (data.type === 'youtube-oauth-callback') {
        if (data.token && data.refresh_token && data.expires_in) {
          const tokens: YouTubeTokens = {
            access_token: data.token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + (data.expires_in * 1000),
          };
          saveYoutubeTokens(tokens);
          setIsAuthorized(true);
          onAuthChange(true);
          setIsAuthenticating(false);
          setAuthError(null);
          
          toast({
            title: "YouTube Authentication Successful",
            description: "You can now connect to your YouTube live streams"
          });
        } else if (data.error) {
          console.error("Auth error:", data.error);
          setIsAuthenticating(false);
          setAuthError(data.error);
          
          toast({
            title: "Authentication Failed",
            description: `YouTube error: ${data.error}`,
            variant: "destructive"
          });
        }
      }
    };

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.data && typeof event.data === 'object') {
        if (event.data.state && pendingStateRef.current) {
          if (!validateOAuthState(event.data.state)) {
            console.error('YouTubeOAuthButton: CSRF state validation failed');
            setIsAuthenticating(false);
            toast({
              title: "Security Error",
              description: "OAuth state validation failed. Please try again.",
              variant: "destructive"
            });
            return;
          }
          pendingStateRef.current = null;
        }
        handleAuthCallback(event.data as AuthCallbackData);
      }
    });

    let unlistenAuth = () => {};
    try {
      unlistenAuth = onAuthCallback(handleAuthCallback);
    } catch (e) {
      console.warn("Could not set up Tauri auth callback:", e);
    }
    
    return () => {
      mounted = false;
      window.removeEventListener('message', () => {});
      try {
        unlistenAuth();
      } catch (e) {
        console.warn("Error cleaning up auth listener:", e);
      }
    };
  }, [onAuthChange, toast]);
 
  const handleConnect = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    
    const scopes = [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtubepartner'
    ];
    
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.append('client_id', YOUTUBE_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', OAUTH_REDIRECT_URI);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', scopes.join(' '));
    authUrl.searchParams.append('access_type', 'offline');
    authUrl.searchParams.append('prompt', 'consent');
    authUrl.searchParams.append('include_granted_scopes', 'true');
    const state = generateOAuthState('youtube');
    pendingStateRef.current = state;
    authUrl.searchParams.append('state', state);
    
    if (isTauriAvailable()) {
      try {
        await openExternalAuth(authUrl.toString(), OAUTH_REDIRECT_URI);
      } catch (error) {
        console.error("Error opening auth URL:", error);
        setIsAuthenticating(false);
        setAuthError("Failed to open browser");
        
        toast({
          title: "Authentication Error",
          description: "Failed to open YouTube authentication page",
          variant: "destructive"
        });
      }
    } else {
      window.location.href = authUrl.toString();
    }
  };

  const handleDisconnect = () => {
    clearYoutubeOAuthToken();
    setIsAuthorized(false);
    onAuthChange(false);
    setAuthError(null);
    
    toast({
      title: "YouTube Disconnected",
      description: "You've been logged out of YouTube"
    });
  };

  return (
    <div className="flex flex-col space-y-2">
      {isAuthorized ? (
        <Button 
          variant="outline" 
          className="bg-green-500 text-white hover:bg-red-600 w-full"
          onClick={handleDisconnect}
        >
          <CheckCircle className="mr-2 h-4 w-4" />
          Connected to YouTube
        </Button>
      ) : (
        <>
          <Button 
            variant="outline" 
            className={`${isAuthenticating ? 'bg-yellow-500' : 'bg-red-500'} text-white hover:bg-red-600 w-full`}
            onClick={handleConnect}
            disabled={isAuthenticating}
          >
            <Youtube className="mr-2 h-4 w-4" />
            {isAuthenticating ? 'Authenticating...' : 'Log in with YouTube'}
          </Button>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {isAuthorized 
          ? "Authorized with YouTube. You can now connect to live streams." 
          : authError 
            ? `Auth error: ${authError}. Try again.`
            : "Authorize with YouTube to connect to your live streams."}
      </p>
    </div>
  );
};

export default YouTubeOAuthButton;
