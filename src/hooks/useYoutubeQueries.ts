import { useQuery } from '@tanstack/react-query';
import {
  fetchYouTubeLiveBroadcasts,
  validateToken,
  getValidYoutubeToken,
  getYoutubeChannelId,
  checkLiveStreamingEnabled,
} from '@/services/youtubeService';
import { useAuthStore } from '@/stores/authStore';

export function useYoutubeBroadcasts() {
  const isAuthed = useAuthStore(s => s.isYoutubeAuthed);
  return useQuery({
    queryKey: ['youtube', 'broadcasts'],
    queryFn: fetchYouTubeLiveBroadcasts,
    enabled: isAuthed,
    staleTime: 15 * 1000,
    retry: 2,
    refetchInterval: isAuthed ? 60 * 1000 : false,
  });
}

export function useYoutubeTokenValidation(token: string | null) {
  return useQuery({
    queryKey: ['youtube', 'token-validation', token],
    queryFn: () => validateToken(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useYoutubeChannelInfo() {
  const isAuthed = useAuthStore(s => s.isYoutubeAuthed);
  return useQuery({
    queryKey: ['youtube', 'channel-info'],
    queryFn: getYoutubeChannelId,
    enabled: isAuthed,
    staleTime: 30 * 60 * 1000,
  });
}

export function useYoutubeLiveStreamingStatus() {
  const isAuthed = useAuthStore(s => s.isYoutubeAuthed);
  return useQuery({
    queryKey: ['youtube', 'live-streaming-status'],
    queryFn: checkLiveStreamingEnabled,
    enabled: isAuthed,
    staleTime: 5 * 60 * 1000,
  });
}

export function useYoutubeValidToken() {
  const isAuthed = useAuthStore(s => s.isYoutubeAuthed);
  return useQuery({
    queryKey: ['youtube', 'valid-token'],
    queryFn: getValidYoutubeToken,
    enabled: isAuthed,
    staleTime: 30 * 1000,
    refetchInterval: isAuthed ? 5 * 60 * 1000 : false,
  });
}
