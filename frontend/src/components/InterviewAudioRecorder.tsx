import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Square } from "lucide-react";
import { ActionRow, Alert, Button, StatusBadge } from "./ui";
import { cn } from "@/lib/utils";

const DEFAULT_MAX_MINUTES = 120;
const WARN_BEFORE_MAX_MS = 5 * 60 * 1000;
const MIC_GAIN = 1;
const TAB_GAIN = 2;
const TAB_UNMUTE_WAIT_MS = 6000;

export type RecorderErrorKind = "permission" | "unsupported" | "device" | "tab_audio" | "unknown";

export type InterviewAudioRecorderProps = {
  onAudioReady: (file: File | null) => void;
  disabled?: boolean;
  maxDurationMinutes?: number;
};

type ChromeDisplayMediaOptions = DisplayMediaStreamOptions & {
  monitorTypeSurfaces?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
  selfBrowserSurface?: "include" | "exclude";
};

function formatTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function domExceptionName(e: unknown): string {
  return e instanceof DOMException ? e.name : "";
}

function logTracks(label: string, stream: MediaStream) {
  console.log(
    `${label} tracks:`,
    stream.getAudioTracks().map((t) => ({
      id: t.id,
      label: t.label,
      enabled: t.enabled,
      muted: t.muted,
      readyState: t.readyState,
      settings: t.getSettings(),
    }))
  );
  const v = stream.getVideoTracks()[0];
  if (v) console.log(`${label} displaySurface:`, v.getSettings().displaySurface);
}

/** Wait until Chrome delivers tab audio (track often starts muted). */
function waitForTabAudioTrack(track: MediaStreamTrack, timeoutMs: number): Promise<boolean> {
  if (track.readyState === "ended") return Promise.resolve(false);
  if (!track.muted) return Promise.resolve(true);

  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      window.clearTimeout(timer);
      track.onunmute = null;
      track.onended = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(!track.muted), timeoutMs);
    track.onunmute = () => {
      if (!track.muted) finish(true);
    };
    track.onended = () => finish(false);
  });
}

/** 2. Capture meeting tab — tab FIRST so picker targets the meeting. */
async function captureMeetingTabStream(): Promise<MediaStream> {
  const attempts: ChromeDisplayMediaOptions[] = [
    {
      video: { displaySurface: "browser" },
      audio: { suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      monitorTypeSurfaces: "exclude",
      systemAudio: "exclude",
      selfBrowserSurface: "exclude",
    },
    { video: true, audio: true },
  ];

  let lastErr: unknown;
  for (const options of attempts) {
    try {
      return await navigator.mediaDevices.getDisplayMedia(options);
    } catch (e) {
      lastErr = e;
      if (e instanceof DOMException && e.name === "OverconstrainedError") continue;
      throw e;
    }
  }
  throw lastErr;
}

/** 1. Capture microphone (interviewer). */
async function captureMicStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

function getTabAudioTracks(tabStream: MediaStream): MediaStreamTrack[] {
  const tracks = tabStream.getAudioTracks();
  for (const t of tracks) {
    t.enabled = true;
  }
  // IMPORTANT: never .stop() or disable video tracks — Chrome tab audio depends on them.
  return tracks;
}

type MixedAudioResult = {
  mixedStream: MediaStream;
  audioContext: AudioContext;
};

/** 3. Mix mic + tab → one stream for MediaRecorder (must record mixed only, not mic alone). */
async function mixMicAndTabAudio(
  micStream: MediaStream,
  tabStream: MediaStream,
  tabAudioTracks: MediaStreamTrack[]
): Promise<MixedAudioResult> {
  const audioCtx = new AudioContext();
  await audioCtx.resume();

  const dest = audioCtx.createMediaStreamDestination();

  const micGain = audioCtx.createGain();
  micGain.gain.value = MIC_GAIN;
  audioCtx.createMediaStreamSource(micStream).connect(micGain).connect(dest);

  const tabGain = audioCtx.createGain();
  tabGain.gain.value = TAB_GAIN;
  const tabOnlyStream = new MediaStream(tabAudioTracks);
  audioCtx.createMediaStreamSource(tabOnlyStream).connect(tabGain).connect(dest);

  const mixedStream = dest.stream;

  console.log("Mic tracks:", micStream.getAudioTracks());
  console.log("Tab tracks:", tabAudioTracks);
  console.log("Mixed tracks:", mixedStream.getAudioTracks());

  return { mixedStream, audioContext: audioCtx };
}

/**
 * Browser recording: mic (you) + meeting tab audio (candidate) for Zoom / Meet / Teams in Chrome.
 */
export default function InterviewAudioRecorder({
  onAudioReady,
  disabled = false,
  maxDurationMinutes = DEFAULT_MAX_MINUTES,
}: InterviewAudioRecorderProps) {
  const [status, setStatus] = useState<"idle" | "recording" | "ready">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const [error, setError] = useState<{ kind: RecorderErrorKind; message: string } | null>(null);
  const [nearMaxWarning, setNearMaxWarning] = useState(false);
  const [micConnected, setMicConnected] = useState(false);
  const [tabConnected, setTabConnected] = useState(false);
  const [tabAudioMissing, setTabAudioMissing] = useState(false);
  const [tabAudioLow, setTabAudioLow] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mixedStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const tabStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const mimeTypeRef = useRef("");
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  const maxMs = maxDurationMinutes * 60 * 1000;

  const stopAllStreams = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    tabStreamRef.current?.getTracks().forEach((t) => t.stop());
    mixedStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    tabStreamRef.current = null;
    mixedStreamRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== "closed") {
      void ctx.close();
    }
  }, []);

  const clearPlayback = useCallback(() => {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    setPlaybackUrl(null);
  }, [playbackUrl]);

  const resetConnectionState = useCallback(() => {
    setMicConnected(false);
    setTabConnected(false);
    setTabAudioMissing(false);
    setTabAudioLow(false);
  }, []);

  const resetRecording = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    stopAllStreams();
    clearPlayback();
    setReadyFile(null);
    setElapsedMs(0);
    setNearMaxWarning(false);
    resetConnectionState();
    setStatus("idle");
    onAudioReady(null);
  }, [clearPlayback, onAudioReady, resetConnectionState, stopAllStreams]);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      stopAllStreams();
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
  }, [playbackUrl, stopAllStreams]);

  useEffect(() => {
    if (!playbackUrl || !audioPreviewRef.current) return;
    void audioPreviewRef.current.play().catch(() => {});
  }, [playbackUrl]);

  const finalizeBlob = useCallback(
    (blob: Blob) => {
      const mime = mimeTypeRef.current || blob.type || "audio/webm";
      const ext = extensionForMime(mime);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = new File([blob], `interview_meeting_${stamp}.${ext}`, {
        type: mime.split(";")[0] || mime,
      });
      const url = URL.createObjectURL(file);
      clearPlayback();
      setPlaybackUrl(url);
      setReadyFile(file);
      setStatus("ready");
      onAudioReady(file);
    },
    [clearPlayback, onAudioReady]
  );

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") return;
    if (rec.state === "recording") {
      try {
        rec.requestData();
      } catch {
        /* ignore */
      }
    }
    rec.stop();
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const failTabAudio = useCallback(
    (msg: string, micStream: MediaStream | null) => {
      alert(msg);
      stopAllStreams();
      setMicConnected(Boolean(micStream?.getAudioTracks().length));
      setTabConnected(false);
      setTabAudioMissing(true);
      setError({ kind: "tab_audio", message: msg });
      setStatus("idle");
    },
    [stopAllStreams]
  );

  const startRecording = async () => {
    setError(null);
    setNearMaxWarning(false);
    setTabAudioLow(false);
    stopAllStreams();
    chunksRef.current = [];
    resetConnectionState();
    clearPlayback();
    setReadyFile(null);
    onAudioReady(null);
    setStatus("idle");

    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.getDisplayMedia) {
      setError({
        kind: "unsupported",
        message: "Use Chrome or Edge for mic + tab recording, or Upload file for a meeting recording.",
      });
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError({ kind: "unsupported", message: "MediaRecorder not available. Use Chrome or Edge." });
      return;
    }

    const mimeType = pickMimeType();
    if (!mimeType) {
      setError({ kind: "unsupported", message: "No supported audio format. Try Chrome or Edge." });
      return;
    }
    mimeTypeRef.current = mimeType;

    let micStream: MediaStream | null = null;
    let tabStream: MediaStream | null = null;

    try {
      // Step A: meeting tab FIRST (Chrome Tab + Share tab audio)
      tabStream = await captureMeetingTabStream();
      tabStreamRef.current = tabStream;
      logTracks("Tab", tabStream);

      const tabAudioTracks = getTabAudioTracks(tabStream);
      const hasMeetingAudio = tabAudioTracks.length > 0;

      if (!hasMeetingAudio) {
        failTabAudio(
          "Meeting tab audio not detected. Select Chrome Tab → your meeting tab → enable Share tab audio.",
          null
        );
        return;
      }

      const displaySurface = tabStream.getVideoTracks()[0]?.getSettings().displaySurface;
      if (displaySurface && displaySurface !== "browser") {
        failTabAudio(
          `You shared "${displaySurface}" instead of a Chrome tab. Choose Chrome Tab and enable Share tab audio.`,
          null
        );
        return;
      }

      const tabTrack = tabAudioTracks[0];
      const tabReady = await waitForTabAudioTrack(tabTrack, TAB_UNMUTE_WAIT_MS);
      if (!tabReady || tabTrack.muted) {
        console.warn("Tab audio track still muted — candidate may be missing from recording");
        setTabAudioLow(true);
      }

      // Step B: microphone
      micStream = await captureMicStream();
      micStreamRef.current = micStream;
      setMicConnected(true);
      logTracks("Mic", micStream);

      // Step C: mix both → MediaRecorder on mixed stream ONLY
      const { mixedStream, audioContext } = await mixMicAndTabAudio(micStream, tabStream, tabAudioTracks);
      audioContextRef.current = audioContext;
      mixedStreamRef.current = mixedStream;

      setTabConnected(true);
      setTabAudioMissing(false);

      const recorder = new MediaRecorder(mixedStream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onerror = () => {
        setError({ kind: "device", message: "Recording failed. Check mic and tab audio." });
        resetRecording();
      };
      recorder.onstop = () => {
        stopAllStreams();
        const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0] });
        if (!blob.size) {
          setError({ kind: "unknown", message: "No audio captured. Try again." });
          setStatus("idle");
          resetConnectionState();
          return;
        }
        finalizeBlob(blob);
      };

      recorder.start(1000);
      startedAtRef.current = Date.now();
      setStatus("recording");
      setElapsedMs(0);

      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        const liveTab = tabStreamRef.current?.getAudioTracks()[0];
        if (liveTab?.muted) setTabAudioLow(true);
        if (elapsed >= maxMs - WARN_BEFORE_MAX_MS && elapsed < maxMs) setNearMaxWarning(true);
        if (elapsed >= maxMs) {
          setNearMaxWarning(false);
          stopRecording();
        }
      }, 500);
    } catch (e) {
      console.error("Recording start failed:", e);
      stopAllStreams();
      resetConnectionState();
      setStatus("idle");

      const hadMic = Boolean(micStream);
      const hadTab = Boolean(tabStream);
      const name = domExceptionName(e);

      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError({
          kind: "permission",
          message: !hadTab
            ? "Tab sharing cancelled or denied. Pick Chrome Tab and enable Share tab audio."
            : !hadMic
              ? "Microphone access denied. Allow microphone permission for this site."
              : "Permission denied.",
        });
      } else if (name === "NotFoundError") {
        setError({ kind: "device", message: "No microphone found." });
      } else {
        setError({ kind: "unknown", message: "Could not start recording. Use Chrome with Share tab audio." });
      }
    }
  };

  const showInstructions = status === "idle";
  const statusTone =
    status === "recording" ? "danger" : status === "ready" ? "success" : ("neutral" as const);

  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card/80 p-5 shadow-sm space-y-4",
        disabled && "pointer-events-none opacity-60"
      )}
      data-slot="interview-audio-recorder"
    >
      <Alert tone="info" className="text-sm">
        Records <strong className="font-medium text-foreground">microphone</strong> (you) +{" "}
        <strong className="font-medium text-foreground">meeting tab audio</strong> (candidate) in Chrome. Pick{" "}
        <strong className="font-medium text-foreground">Chrome Tab</strong> and enable{" "}
        <strong className="font-medium text-foreground">Share tab audio</strong>.
      </Alert>

      <ActionRow align="start" className="gap-2 mt-0">
        {status !== "recording" ? (
          <Button
            type="button"
            size="lg"
            disabled={disabled || status === "ready"}
            onClick={() => void startRecording()}
          >
            <Mic className="h-4 w-4" />
            Start recording
          </Button>
        ) : (
          <Button type="button" variant="danger" size="lg" disabled={disabled} onClick={stopRecording}>
            <Square className="h-4 w-4" />
            Stop recording
          </Button>
        )}
        {status === "ready" ? (
          <Button type="button" variant="outline" disabled={disabled} onClick={resetRecording}>
            <RotateCcw className="h-4 w-4" />
            Record again
          </Button>
        ) : null}
      </ActionRow>

      {status === "idle" && !error ? (
        <p className="text-xs text-muted-foreground m-0">
          Click <strong className="text-foreground">Start recording</strong> above, then choose your meeting tab with
          tab audio and allow the microphone.
        </p>
      ) : null}

      {showInstructions ? (
        <div
          className="rounded-lg border border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-900/50 dark:bg-emerald-950/30 p-4 space-y-2"
          role="region"
          aria-label="Tab sharing instructions"
        >
          <p className="text-sm font-semibold text-foreground m-0">Before you start recording</p>
          <ol className="m-0 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground marker:font-semibold marker:text-foreground">
            <li>
              Open Zoom / Google Meet / Teams in a <strong className="text-foreground">Chrome tab</strong> (not desktop
              app).
            </li>
            <li>
              Click <strong className="text-foreground">Start recording</strong> → choose <strong className="text-foreground">Chrome Tab</strong>.
            </li>
            <li>
              Select the <strong className="text-foreground">meeting tab</strong> and check{" "}
              <strong className="text-foreground">Share tab audio</strong>.
            </li>
            <li>Allow <strong className="text-foreground">microphone</strong> when asked.</li>
            <li>
              Confirm you <strong className="text-foreground">hear the candidate</strong> in that tab before speaking.
            </li>
          </ol>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 justify-between rounded-lg border border-border/50 bg-muted/40 px-4 py-3">
        <div className="flex flex-wrap gap-2" aria-live="polite">
          <StatusBadge tone={micConnected ? "success" : "neutral"}>
            Mic {micConnected ? "connected" : "not connected"}
          </StatusBadge>
          <StatusBadge
            tone={tabConnected ? "success" : tabAudioMissing ? "danger" : "neutral"}
          >
            Meeting tab {tabConnected ? "connected" : tabAudioMissing ? "audio missing" : "not connected"}
          </StatusBadge>
          <StatusBadge tone={statusTone}>
            {status === "recording" ? "Recording…" : status === "ready" ? "Ready to submit" : "Not recording"}
          </StatusBadge>
        </div>
        <span
          className={cn(
            "font-mono text-xl font-semibold tabular-nums tracking-tight",
            status === "recording" ? "text-destructive" : "text-foreground"
          )}
          aria-live="polite"
        >
          {formatTimer(elapsedMs)}
        </span>
      </div>

      {tabAudioMissing ? (
        <Alert tone="error">
          Meeting tab audio not detected. Use <strong>Chrome Tab</strong>, select your meeting tab, and enable{" "}
          <strong>Share tab audio</strong>.
        </Alert>
      ) : null}

      {tabAudioLow && status === "recording" ? (
        <Alert tone="info">
          Tab audio is muted or silent — stop and re-share the meeting tab with <strong>Share tab audio</strong> on.
        </Alert>
      ) : null}

      {nearMaxWarning && status === "recording" ? (
        <Alert tone="info">
          Approaching maximum length ({maxDurationMinutes} minutes). Recording will stop automatically.
        </Alert>
      ) : null}

      {error && !tabAudioMissing ? <Alert tone="error">{error.message}</Alert> : null}

      {playbackUrl && readyFile ? (
        <div className="space-y-2 rounded-lg border border-border/50 bg-background/80 p-4">
          <p className="text-sm font-medium text-foreground m-0">Playback preview (mic + meeting tab)</p>
          <audio ref={audioPreviewRef} controls src={playbackUrl} className="w-full" />
          <p className="text-xs text-muted-foreground m-0">
            {readyFile.name} · {(readyFile.size / (1024 * 1024)).toFixed(2)} MB — confirm both voices are audible, then
            click <strong>Generate transcript &amp; summary</strong> below.
          </p>
        </div>
      ) : null}
    </div>
  );
}
