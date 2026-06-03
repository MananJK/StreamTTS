
import { Message } from '@/types/message';
import { TTS_COMMAND_PREFIX } from '@/config/security';

interface TTSRequestOptions {
  text: string;
  apiKey: string;
  voice_id?: string;
  model_id?: string;
}

// Default values for the Russian voice
const DEFAULT_VOICE_ID = 'IKne3meq5aSn9XLyUdCD'; // Charlie, but can be changed
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2'; // Good for Russian language

// New type for TTS providers
export type TTSProvider = 'browser' | 'elevenlabs';

export async function generateSpeechFromText(options: TTSRequestOptions): Promise<ArrayBuffer> {
  const { text, apiKey, voice_id = DEFAULT_VOICE_ID, model_id = DEFAULT_MODEL_ID } = options;
  
  // ElevenLabs API for text-to-speech
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5,
      },
    }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate speech: ${response.status} ${errorText}`);
  }
  
  return await response.arrayBuffer();
}

// Cross-platform TTS service
export class CrossPlatformTTS {
  private static isSpeechSynthesisSupported(): boolean {
    return 'speechSynthesis' in window;
  }

  // Play text using browser's built-in speech synthesis
  static useBrowserTTS(
    text: string, 
    onPlaybackStart: () => void,
    onPlaybackEnd: () => void,
    volume: number = 1.0,
    voiceName?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isSpeechSynthesisSupported()) {
        reject(new Error('Your browser does not support speech synthesis'));
        return;
      }

      onPlaybackStart();
      
      // Cancel any ongoing speech to prevent overlapping
      window.speechSynthesis.cancel();
      
      // Create a new SpeechSynthesisUtterance
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Set the volume
      utterance.volume = volume;
      
      // Get available voices and try to find a Russian one if no specific voice is specified
      const voices = window.speechSynthesis.getVoices();
      
      if (voiceName) {
        // Try to find the specified voice
        const voice = voices.find(v => v.name === voiceName);
        if (voice) {
          utterance.voice = voice;
        }
      } else {
        // First, try to find Microsoft Pavel specifically (Windows)
        const pavelVoice = voices.find(v => 
          v.name.includes('Pavel') || 
          v.name.includes('Microsoft Pavel')
        );
        
        // If Pavel is found, use it
        if (pavelVoice) {
          utterance.voice = pavelVoice;
        } else {
          // Otherwise, fall back to any Russian voice
          const russianVoice = voices.find(v => 
            v.lang.startsWith('ru') || 
            v.name.includes('Russian') || 
            v.name.includes('русский')
          );
          
          if (russianVoice) {
            utterance.voice = russianVoice;
          }
        }
      }
      
      // Handle playback end
      utterance.onend = () => {
        onPlaybackEnd();
        resolve();
      };
      
      // Handle errors
      utterance.onerror = (event) => {
        onPlaybackEnd();
        reject(new Error(`Speech synthesis error: ${event.error}`));
      };
      
      // Start speaking
      window.speechSynthesis.speak(utterance);
    });
  }

  // Get available browser voices
  static getAvailableBrowserVoices(): SpeechSynthesisVoice[] {
    if (!this.isSpeechSynthesisSupported()) {
      return [];
    }
    
    return window.speechSynthesis.getVoices();
  }

  // Get recommended Russian voices
  static getRecommendedVoices(): SpeechSynthesisVoice[] {
    const voices = this.getAvailableBrowserVoices();
    
    // Priority: Russian voices, then voices with Russian in name
    const recommended = voices.filter(v => 
      v.lang.startsWith('ru') || 
      v.name.includes('Russian') || 
      v.name.includes('русский') ||
      v.name.includes('Pavel')
    );
    
    // If no Russian voices, return empty array
    return recommended.length > 0 ? recommended : [];
  }
}

// New function to use browser's built-in speech synthesis (legacy compatibility)
export function useBrowserTTS(
  text: string, 
  onPlaybackStart: () => void,
  onPlaybackEnd: () => void,
  volume: number = 1.0,
  voiceName?: string
): Promise<void> {
  return CrossPlatformTTS.useBrowserTTS(text, onPlaybackStart, onPlaybackEnd, volume, voiceName);
}

export async function playMessageAudio(
  message: Message, 
  apiKey: string, 
  onPlaybackStart: () => void,
  onPlaybackEnd: () => void,
  volume: number = 1.0,
  provider: TTSProvider = 'browser',
  voiceName?: string
): Promise<void> {
  try {
    // Extract the actual text without the !г (Russian r) command
    const textToSpeak = message.content.replace(new RegExp(`^${TTS_COMMAND_PREFIX}\\s*`, 'i'), '');
    
    if (provider === 'browser') {
      // Use browser's built-in speech synthesis (no token limits)
      await useBrowserTTS(textToSpeak, onPlaybackStart, onPlaybackEnd, volume, voiceName);
    } else {
      // Use ElevenLabs (original implementation)
      onPlaybackStart();
      
      // Generate speech from the text
      const audioData = await generateSpeechFromText({
        text: textToSpeak,
        apiKey
      });
      
      // Create and play the audio
      const audioBlob = new Blob([audioData], { type: 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      // Set volume
      audio.volume = volume;
      
      // Return a promise that resolves when audio playback ends
      return new Promise((resolve) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          onPlaybackEnd();
          resolve();
        };
        
        audio.play().catch(error => {
          console.error('Error playing audio:', error);
          onPlaybackEnd();
          resolve();
        });
      });
    }
  } catch (error) {
    console.error('Error in playMessageAudio:', error);
    onPlaybackEnd();
  }
}

// Helper function to get available browser voices (legacy compatibility)
export function getAvailableBrowserVoices(): SpeechSynthesisVoice[] {
  return CrossPlatformTTS.getAvailableBrowserVoices();
}

// Helper function to get recommended Russian voices
export function getRecommendedVoices(): SpeechSynthesisVoice[] {
  return CrossPlatformTTS.getRecommendedVoices();
}
