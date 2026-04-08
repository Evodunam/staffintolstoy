/** Web Speech API (PostJob dictation); keep loose to avoid depending on full DOM Speech typings. */
interface WebSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((this: WebSpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: WebSpeechRecognition, ev: Event) => void) | null;
  onend: ((this: WebSpeechRecognition, ev: Event) => void) | null;
}

interface Window {
  SpeechRecognition?: { new (): WebSpeechRecognition };
  webkitSpeechRecognition?: { new (): WebSpeechRecognition };
}

/** Optional native deps: web build does not install Capacitor packages. */
declare module "@capacitor/core" {
  export const Capacitor: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  export function registerPlugin<T = unknown>(_name: string, _impl?: T): T;
  export const App: { addListener?: (_evt: string, _cb: () => void) => Promise<{ remove?: () => void }> | { remove?: () => void } };
}

declare module "@capacitor/geolocation" {
  export interface Position {
    coords: { latitude: number; longitude: number; accuracy: number; altitudeAccuracy: number | null; altitude: number | null; heading: number | null; speed: number | null };
    timestamp: number;
  }
  export const Geolocation: { getCurrentPosition?: (opts?: unknown) => Promise<Position> };
}
