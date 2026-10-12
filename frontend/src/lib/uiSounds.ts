import { cachedCurrentUser } from "@/lib/currentUser";

export type UiSound = "notification" | "scanSuccess" | "scanFailure" | "saleComplete" | "printSubmissionFailure";

let context: AudioContext | null = null;

const notes: Record<UiSound, { tones: number[]; duration: number; volume: number }> = {
  notification: { tones: [660, 880], duration: 0.13, volume: 0.07 },
  scanSuccess: { tones: [784, 1047], duration: 0.07, volume: 0.06 },
  scanFailure: { tones: [360, 280], duration: 0.11, volume: 0.07 },
  saleComplete: { tones: [523, 659, 784], duration: 0.12, volume: 0.08 },
  printSubmissionFailure: { tones: [440, 330, 220], duration: 0.12, volume: 0.075 },
};

export function notificationSoundEnabled(userId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  const id = userId || cachedCurrentUser()?.id;
  return !id || localStorage.getItem(`books2-notification-sound:${id}`) !== "off";
}

// Call during a user gesture; browsers may block audio created by a later network response.
export function armUiSound(): void {
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    context ??= new window.AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch { /* The application remains usable without audio. */ }
}

export function playUiSound(kind: UiSound): void {
  if (!context || context.state !== "running" || !notificationSoundEnabled()) return;
  const sound = notes[kind];
  const start = context.currentTime;
  sound.tones.forEach((frequency, index) => {
    const at = start + index * (sound.duration + 0.025);
    const oscillator = context!.createOscillator();
    const gain = context!.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(sound.volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + sound.duration);
    oscillator.connect(gain).connect(context!.destination);
    oscillator.start(at);
    oscillator.stop(at + sound.duration + 0.005);
  });
}
