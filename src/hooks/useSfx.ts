'use client';

import { useCallback, useEffect, useState } from 'react';

export type SoundName = 'letter' | 'reveal' | 'score' | 'stop' | 'vote';

/**
 * Petits sons de retour, synthetises a la volee (WebAudio) : aucun fichier a
 * charger, et la structure reste prete a recevoir de vrais samples en
 * remplacant l'oscillateur par un decodage de buffer.
 *
 * L'etat est volontairement global : le bouton de reglage et la couche temps
 * reel qui declenche les sons vivent dans deux composants differents.
 */
const TONES: Record<SoundName, { frequency: number; duration: number; type: OscillatorType }> = {
  letter: { frequency: 660, duration: 0.18, type: 'triangle' },
  reveal: { frequency: 520, duration: 0.09, type: 'sine' },
  score: { frequency: 780, duration: 0.16, type: 'sine' },
  stop: { frequency: 200, duration: 0.28, type: 'sawtooth' },
  vote: { frequency: 440, duration: 0.07, type: 'square' },
};

const STORAGE_KEY = 'bacc:sound';

let soundEnabled = false;
let initialized = false;
let audioContext: AudioContext | null = null;
const listeners = new Set<(value: boolean) => void>();

function readStoredPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function setSoundEnabled(value: boolean): void {
  soundEnabled = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Stockage indisponible : le reglage ne vaut que pour la session en cours.
  }
  for (const listener of listeners) listener(value);
}

/** Joue un son court. Silencieux si le son est coupe ou si WebAudio est indisponible. */
export function playSound(name: SoundName): void {
  if (!soundEnabled || typeof window === 'undefined') return;
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    audioContext ??= new AudioContextCtor();
    // Sur mobile, le contexte demarre suspendu tant qu'il n'y a pas eu de geste.
    void audioContext.resume();

    const tone = TONES[name];
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = tone.type;
    oscillator.frequency.value = tone.frequency;
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, audioContext.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + tone.duration);

    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + tone.duration);
  } catch {
    // Le son est un bonus : une erreur audio ne doit jamais gener le jeu.
  }
}

export interface Sfx {
  enabled: boolean;
  toggle: () => void;
  play: (name: SoundName) => void;
}

export function useSfx(): Sfx {
  const [enabled, setEnabled] = useState(soundEnabled);

  useEffect(() => {
    if (!initialized) {
      initialized = true;
      soundEnabled = readStoredPreference();
    }
    setEnabled(soundEnabled);

    listeners.add(setEnabled);
    return () => {
      listeners.delete(setEnabled);
    };
  }, []);

  const toggle = useCallback(() => setSoundEnabled(!soundEnabled), []);

  return { enabled, toggle, play: playSound };
}
