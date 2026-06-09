import { create } from 'zustand';
import { hasTwitchOAuthToken } from '@/services/twitchService';
import { hasYoutubeOAuthToken } from '@/services/youtubeService';

interface AuthState {
  isTwitchAuthed: boolean;
  isYoutubeAuthed: boolean;
  setTwitchAuth: (authed: boolean) => void;
  setYoutubeAuth: (authed: boolean) => void;
  logoutTwitch: () => void;
  logoutYoutube: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isTwitchAuthed: hasTwitchOAuthToken(),
  isYoutubeAuthed: hasYoutubeOAuthToken(),

  setTwitchAuth: (authed) => set({ isTwitchAuthed: authed }),
  setYoutubeAuth: (authed) => set({ isYoutubeAuthed: authed }),
  logoutTwitch: () => set({ isTwitchAuthed: false }),
  logoutYoutube: () => set({ isYoutubeAuthed: false }),
}));
