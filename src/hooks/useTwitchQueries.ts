import { useQuery } from '@tanstack/react-query';
import {
  getTwitchUsername,
  validateTwitchToken,
} from '@/services/twitchService';
import { useAuthStore } from '@/stores/authStore';

export function useTwitchUserInfo() {
  const isAuthed = useAuthStore(s => s.isTwitchAuthed);
  return useQuery({
    queryKey: ['twitch', 'user-info'],
    queryFn: getTwitchUsername,
    enabled: isAuthed,
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });
}

export function useTwitchTokenValidation() {
  const isAuthed = useAuthStore(s => s.isTwitchAuthed);
  return useQuery({
    queryKey: ['twitch', 'token-validation'],
    queryFn: validateTwitchToken,
    enabled: isAuthed,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
