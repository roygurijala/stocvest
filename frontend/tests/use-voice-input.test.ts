/**
 * Tests for useVoiceInput hook.
 *
 * The Web Speech API is not available in jsdom, so we mock it at the window level
 * and verify the hook's integration with it.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "../lib/hooks/use-voice-input";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeMockRecognition() {
  return {
    continuous: false,
    interimResults: false,
    lang: "",
    maxAlternatives: 1,
    onresult: null as ((e: unknown) => void) | null,
    onerror: null as ((e: unknown) => void) | null,
    onend: null as (() => void) | null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  };
}

// ─── isSupported ────────────────────────────────────────────────────────────

describe("useVoiceInput — isSupported", () => {
  it("is false when SpeechRecognition is absent from window", () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn() })
    );
    expect(result.current.isSupported).toBe(false);
  });

  it("is true when window.SpeechRecognition is defined", () => {
    const MockSR = vi.fn(() => makeMockRecognition());
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSR;

    const { result, unmount } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn() })
    );
    expect(result.current.isSupported).toBe(true);
    unmount();
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  });

  it("is true when window.webkitSpeechRecognition is defined", () => {
    const MockSR = vi.fn(() => makeMockRecognition());
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = MockSR;

    const { result, unmount } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn() })
    );
    expect(result.current.isSupported).toBe(true);
    unmount();
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });
});

// ─── toggle ─────────────────────────────────────────────────────────────────

describe("useVoiceInput — toggle", () => {
  let recognition: ReturnType<typeof makeMockRecognition>;

  beforeEach(() => {
    recognition = makeMockRecognition();
    const MockSR = vi.fn(() => recognition);
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSR;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  });

  it("starts recording on first toggle", () => {
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn() })
    );
    expect(result.current.isRecording).toBe(false);

    act(() => result.current.toggle());

    expect(recognition.start).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(true);
  });

  it("stops recording on second toggle", () => {
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn() })
    );

    act(() => result.current.toggle()); // start
    act(() => result.current.toggle()); // stop

    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
  });

  it("sets lang to en-US", () => {
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn() })
    );
    act(() => result.current.toggle());
    expect(recognition.lang).toBe("en-US");
  });
});

// ─── onTranscript ────────────────────────────────────────────────────────────

describe("useVoiceInput — onTranscript", () => {
  let recognition: ReturnType<typeof makeMockRecognition>;

  beforeEach(() => {
    recognition = makeMockRecognition();
    const MockSR = vi.fn(() => recognition);
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSR;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  });

  it("calls onTranscript with the final transcript text", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => result.current.toggle());

    const fakeEvent = {
      results: [
        [{ transcript: "why is MRVL up today" }],
      ],
    };

    act(() => recognition.onresult?.(fakeEvent));

    expect(onTranscript).toHaveBeenCalledWith("why is MRVL up today");
    expect(result.current.isRecording).toBe(false);
  });

  it("does not call onTranscript for empty transcript", () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscript }));

    act(() => result.current.toggle());

    act(() => recognition.onresult?.({ results: [[{ transcript: "   " }]] }));

    expect(onTranscript).not.toHaveBeenCalled();
  });
});

// ─── FRIENDLY_ERRORS ─────────────────────────────────────────────────────────

describe("useVoiceInput — error handling", () => {
  let recognition: ReturnType<typeof makeMockRecognition>;

  beforeEach(() => {
    recognition = makeMockRecognition();
    const MockSR = vi.fn(() => recognition);
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSR;
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  });

  it("calls onError with a friendly message for not-allowed", () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn(), onError })
    );

    act(() => result.current.toggle());
    act(() => recognition.onerror?.({ error: "not-allowed" }));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Microphone access denied"));
    expect(result.current.isRecording).toBe(false);
  });

  it("calls onError with a friendly message for no-speech", () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn(), onError })
    );

    act(() => result.current.toggle());
    act(() => recognition.onerror?.({ error: "no-speech" }));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("No speech detected"));
  });

  it("does not call onError for aborted (user-initiated)", () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn(), onError })
    );

    act(() => result.current.toggle());
    act(() => recognition.onerror?.({ error: "aborted" }));

    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError with generic message for unknown error", () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn(), onError })
    );

    act(() => result.current.toggle());
    act(() => recognition.onerror?.({ error: "some-unknown-error" }));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("some-unknown-error"));
  });
});

// ─── unsupported browser ─────────────────────────────────────────────────────

describe("useVoiceInput — unsupported browser", () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  it("calls onError when toggle is called in unsupported browser", () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn(), onError })
    );

    act(() => result.current.toggle());

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Chrome or Edge"));
    expect(result.current.isRecording).toBe(false);
  });
});
