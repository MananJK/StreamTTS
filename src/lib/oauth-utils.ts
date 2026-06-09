import { TWITCH_CLIENT_ID, YOUTUBE_CLIENT_ID, OAUTH_REDIRECT_URI, generateOAuthState, hasTwitchClientId, hasYoutubeClientId, TTS_COMMAND_PREFIX } from '@/config/security';

export function buildTwitchAuthUrl(): string {
  const scopes = ['chat:read', 'chat:edit'];
  const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  authUrl.searchParams.append('client_id', TWITCH_CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', OAUTH_REDIRECT_URI);
  authUrl.searchParams.append('response_type', 'token');
  authUrl.searchParams.append('scope', scopes.join(' '));
  authUrl.searchParams.append('force_verify', 'true');
  authUrl.searchParams.append('state', generateOAuthState('twitch'));
  return authUrl.toString();
}

export function buildYouTubeAuthUrl(): string {
  const scopes = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.upload',
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
  return authUrl.toString();
}

export function openAuthPopup(url: string, name: string): Window | null {
  return window.open(url, name, 'width=500,height=700,scrollbars=yes,resizable=yes');
}
