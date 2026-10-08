'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type RecognitionResult = {
  isFinal: boolean;
  [index: number]: { transcript: string };
};

type RecognitionEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
};

type RecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionCtor = new () => RecognitionInstance;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function friendlyError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied. Allow it in your browser settings.';
    case 'network':
      return 'Voice recognition could not reach its service. It usually does not work in Brave, so try Chrome or Edge.';
    case 'no-speech':
      return "I didn't hear anything. Try again.";
    case 'audio-capture':
      return 'No microphone was found.';
    default:
      return `Voice error: ${code}`;
  }
}

export function useVoiceInput(onFinalText: (text: string) => void) {
  const recRef = useRef<RecognitionInstance | null>(null);
  const callbackRef = useRef(onFinalText);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbackRef.current = onFinalText;
  }, [onFinalText]);

  const start = useCallback(() => {
    setError(null);
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError('Voice input is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.continuous = false;

    let finalText = '';

    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const piece = result[0].transcript;
        if (result.isFinal) finalText += piece;
        else interimText += piece;
      }
      setInterim(interimText);
    };

    rec.onerror = (e) => setError(friendlyError(e.error));

    rec.onend = () => {
      setListening(false);
      setInterim('');
      if (finalText.trim()) callbackRef.current(finalText.trim());
    };

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('Could not start the microphone. Try again.');
    }
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => recRef.current?.abort();
  }, []);

  return { listening, interim, error, start, stop };
}

export function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = 'en-IN';
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
}