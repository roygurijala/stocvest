"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Speech API hook for voice-to-text in the STOCVEST Assistant.
 *
 * Language is locked to English (en-US). Voice input works in Chrome and
 * Chromium-based Edge. Firefox and Safari do not support the Web Speech API
 * as of 2026 — the `isSupported` flag surfaces this so the UI can show a
 * tooltip rather than a broken button.
 *
 * Usage:
 *   const { isRecording, isSupported, toggle } = useVoiceInput({
 *     onTranscript: (text) => setComposerValue(prev => prev + text),
 *   });
 */

// Web Speech API types — not yet part of the standard TS lib.dom.d.ts in all
// versions. Declared here so we don't need an extra @types/* package.
interface SpeechRecognitionResultItem {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResult {
  readonly [index: number]: SpeechRecognitionResultItem;
  readonly length: number;
  readonly isFinal: boolean;
}
interface SpeechRecognitionResultList {
  readonly [index: number]: SpeechRecognitionResult;
  readonly length: number;
}
interface SpeechRecognitionEventData extends Event {
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventData extends Event {
  readonly error: string;
  readonly message: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventData) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventData) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

// Extend the window type for browsers that prefix SpeechRecognition.
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface UseVoiceInputOptions {
  /** Called with the final transcript when recognition ends successfully. */
  onTranscript: (text: string) => void;
  /** Called when a non-fatal error occurs (e.g. mic denied, network error). */
  onError?: (message: string) => void;
}

export interface UseVoiceInputResult {
  isRecording: boolean;
  /** False when the browser does not support the Web Speech API (Firefox, Safari). */
  isSupported: boolean;
  /** Toggle recording on/off. Safe to call repeatedly. */
  toggle: () => void;
  stop: () => void;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access denied. Allow microphone access in browser settings.",
  "no-speech": "No speech detected. Try speaking clearly and try again.",
  "network": "Network error during voice recognition. Check your connection.",
  "audio-capture": "No microphone found. Connect a microphone and try again.",
  "aborted": "",  // user-initiated, no message needed
};

export function useVoiceInput({
  onTranscript,
  onError,
}: UseVoiceInputOptions): UseVoiceInputResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    setIsSupported(typeof SR !== "undefined");
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsRecording(false);
  }, []);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      onError?.("Voice input requires Chrome or Edge. Not supported in this browser.");
      return;
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEventData) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) {
        onTranscript(transcript.trim());
      }
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventData) => {
      const message = FRIENDLY_ERRORS[event.error] ?? `Voice input error: ${event.error}`;
      if (message) onError?.(message);
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [onTranscript, onError]);

  const toggle = useCallback(() => {
    if (isRecording) {
      stop();
    } else {
      start();
    }
  }, [isRecording, start, stop]);

  return { isRecording, isSupported, toggle, stop };
}
