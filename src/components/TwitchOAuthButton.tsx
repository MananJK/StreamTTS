import React from 'react';
import { Button } from '@/components/ui/button';
import { Twitch, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { saveTwitchOAuthToken, hasTwitchOAuthToken, clearTwitchOAuthToken, validateTwitchToken, isTwitchTokenStale, getTokenAgeMinutes } from '@/services/twitchService';
import { openExternalAuth, onAuthCallback, type AuthCallbackData, isTauriAvailable } from '@/lib/tauri-api';
import { TWITCH_CLIENT_ID, OAUTH_REDIRECT_URI, generateOAuthState, validateOAuthState } from '@/config/security';

interface TwitchOAuthButtonProps {
  onAuthChange: (isAuthed: boolean) => void;
}

const TwitchOAuthButton: React.FC<TwitchOAuthButtonProps> = ({ onAuthChange }) => {
  const { toast } = useToast();
  const [isAuthorized, setIsAuthorized] = React.useState<boolean>(hasTwitchOAuthToken());
  const [isAuthenticating, setIsAuthenticating] = React.useState<boolean>(false);
  const [tokenStatus, setTokenStatus] = React.useState<'valid' | 'stale' | 'invalid' | 'checking'>('valid');
  const pendingStateRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!hasTwitchOAuthToken()) {
      return;
    }

    const validateToken = async () => {
      setTokenStatus('checking');
      
      if (isTwitchTokenStale()) {
        const ageMinutes = getTokenAgeMinutes();
        console.log("TwitchService: Token is stale (age:", ageMinutes, "minutes), validating...");
      }
      
      const result = await validateTwitchToken();
      
      if (result.valid) {
        setTokenStatus('valid');
      } else {
        console.log("TwitchService: Token validation failed:", result.error);
        setTokenStatus('invalid');
        clearTwitchOAuthToken();
        setIsAuthorized(false);
        onAuthChange(false);
        
        toast({
          title: "Twitch Session Expired",
          description: "Your Twitch authentication has expired. Please reconnect.",
          variant: "destructive"
        });
      }
    };

    validateToken();
    
    const intervalId = setInterval(validateToken, 5 * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, [onAuthChange, toast]);

  React.useEffect(() => {
    const syncTokenState = () => {
      const hasToken = hasTwitchOAuthToken();
      if (hasToken !== isAuthorized) {
        setIsAuthorized(hasToken);
        onAuthChange(hasToken);
      }
      if (hasToken && isTwitchTokenStale()) {
        setTokenStatus('stale');
      }
    };

    syncTokenState();

    window.addEventListener('storage', syncTokenState);
    return () => window.removeEventListener('storage', syncTokenState);
  }, [isAuthorized, onAuthChange]);

  React.useEffect(() => {
    // Check if we're returning from auth redirect
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      
      if (accessToken) {
        saveTwitchOAuthToken(accessToken);
        setIsAuthorized(true);
        onAuthChange(true);
        
        // Clear the URL fragment
        window.history.pushState("", document.title, window.location.pathname + window.location.search);
        
        toast({
          title: "Twitch Authentication Successful",
          description: "You can now connect to your Twitch channels"
        });
      }
    }

    // Handle Electron/Tauri IPC events
    const handleAuthCallback = (event: MessageEvent) => {
      if (event.data && event.data.state && pendingStateRef.current) {
        if (!validateOAuthState(event.data.state)) {
          console.error('TwitchOAuthButton: CSRF state validation failed');
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

      if (event.data && event.data.type === 'twitch-oauth-callback' && event.data.token) {
        saveTwitchOAuthToken(event.data.token);
        setIsAuthorized(true);
        onAuthChange(true);
        setIsAuthenticating(false);
        
        toast({
          title: "Twitch Authentication Successful",
          description: "You can now connect to your Twitch channels"
        });
      } else if (event.data && event.data.error) {
        console.error("Auth error from IPC:", event.data.error);
        setIsAuthenticating(false);
        
        toast({
          title: "Authentication Failed",
          description: `Twitch error: ${event.data.error}`,
          variant: "destructive"
        });
      }
    };

    // Add event listener for Electron/Tauri auth callbacks
    window.addEventListener('message', handleAuthCallback);
    
    // Setup listener for Tauri auth callbacks
    const unlistenAuth = onAuthCallback((data) => {
      if (data.type === 'twitch-oauth-callback') {
        if (data.token) {
          saveTwitchOAuthToken(data.token);
          setIsAuthorized(true);
          onAuthChange(true);
          setIsAuthenticating(false);
          
          toast({
            title: "Twitch Authentication Successful",
            description: "You can now connect to your Twitch channels"
          });
        } else if (data.error) {
          console.error("Auth error from Tauri:", data.error);
          setIsAuthenticating(false);
          
          toast({
            title: "Authentication Failed",
            description: `Twitch error: ${data.error}`,
            variant: "destructive"
          });
        }
      }
    });
    
    return () => {
      window.removeEventListener('message', handleAuthCallback);
      unlistenAuth();
    };
  }, [onAuthChange, toast]);
 
  const handleConnect = async () => {
    setIsAuthenticating(true);
    
    // Twitch OAuth implicit flow
    const scopes = ['chat:read', 'chat:edit'];
    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.append('client_id', TWITCH_CLIENT_ID);
    
    authUrl.searchParams.append('redirect_uri', OAUTH_REDIRECT_URI);

    authUrl.searchParams.append('response_type', 'token');
    authUrl.searchParams.append('scope', scopes.join(' '));
    authUrl.searchParams.append('force_verify', 'true');
    const state = generateOAuthState('twitch');
    pendingStateRef.current = state;
    authUrl.searchParams.append('state', state);
    
    const fullAuthUrl = authUrl.toString();
    
    // Check if we're running in Electron/Tauri
    if (isTauriAvailable()) {
      try {
        await openExternalAuth(fullAuthUrl, OAUTH_REDIRECT_URI);
      } catch (error) {
        console.error("Twitch Auth: Error opening auth URL:", error);
        setIsAuthenticating(false);
        
        toast({
          title: "Authentication Error",
          description: "Failed to open Twitch authentication page",
          variant: "destructive"
        });
      }
    } else {
      // Fallback to web flow
      window.location.href = fullAuthUrl;
    }
  };

  const handleDisconnect = () => {
    clearTwitchOAuthToken();
    setIsAuthorized(false);
    onAuthChange(false);
    
    toast({
      title: "Twitch Disconnected",
      description: "You've been logged out of Twitch"
    });
  };

  return (
    <div className="flex flex-col space-y-2">
      {isAuthorized ? (
        <>
          <Button 
            variant="outline" 
            className={`text-white w-full ${
              tokenStatus === 'invalid' ? 'bg-red-500 hover:bg-red-600' :
              tokenStatus === 'stale' ? 'bg-yellow-500 hover:bg-yellow-600' :
              'bg-green-500 hover:bg-purple-600'
            }`}
            onClick={handleDisconnect}
          >
            {tokenStatus === 'invalid' || tokenStatus === 'stale' ? (
              <AlertCircle className="mr-2 h-4 w-4" />
            ) : (
              <CheckCircle className="mr-2 h-4 w-4" />
            )}
            {tokenStatus === 'checking' ? 'Verifying...' :
             tokenStatus === 'invalid' ? 'Session Expired' :
             tokenStatus === 'stale' ? 'Reconnect Recommended' :
             'Connected to Twitch'}
          </Button>
          {(tokenStatus === 'stale' || tokenStatus === 'invalid') && (
            <Button 
              variant="outline" 
              className="bg-purple-500 text-white hover:bg-purple-600 w-full"
              onClick={handleConnect}
              disabled={isAuthenticating}
            >
              <Twitch className="mr-2 h-4 w-4" />
              {isAuthenticating ? 'Reconnecting...' : 'Reconnect Twitch'}
            </Button>
          )}
        </>
      ) : (
        <Button 
          variant="outline" 
          className={`${isAuthenticating ? 'bg-yellow-500' : 'bg-purple-500'} text-white hover:bg-purple-600 w-full`}
          onClick={handleConnect}
          disabled={isAuthenticating}
        >
          <Twitch className="mr-2 h-4 w-4" />
          {isAuthenticating ? 'Authenticating...' : 'Log in with Twitch'}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {isAuthorized 
          ? tokenStatus === 'stale' 
            ? "Token may be stale. Consider reconnecting for best reliability." 
            : tokenStatus === 'invalid'
              ? "Your session has expired. Please reconnect."
              : "Authorized with Twitch. You can now connect to channels."
          : "Authorize with Twitch to connect to chat channels."}
      </p>
    </div>
  );
};

export default TwitchOAuthButton;
