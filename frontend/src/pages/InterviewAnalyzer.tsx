import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiFormPostJson,
  apiFormPostStream,
  apiJson,
  downloadPost,
  formatUserError,
  triggerDownload,
  type StreamEvent,
} from "../api";
import AgentActivityPanel from "../components/AgentActivityPanel";
import type { AgentStatus } from "../components/AgentActivityPanel.types";
import { AGENTS_FULL, AGENTS_SUMMARY } from "../components/AgentActivityPanel.types";
import InterviewAudioRecorder from "../components/InterviewAudioRecorder";
import {
  SingleFileDropzone,
  useToast,
} from "../components/ui";

type OutputMode = "summary" | "full";

type JdItem = { stem: string; jd_name: string; saved_at?: string };
type JdPayload = { jd_name: string; jd_text: string; jd_keywords: Record<string, unknown>; saved_at?: string };

type FeedbackSection = {
  title: string;
  lines: string[];
};

function parseFeedbackSections(raw: string): FeedbackSection[] {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x !== "---");
  const sections: FeedbackSection[] = [];
  let current: FeedbackSection | null = null;
  for (const line of lines) {
    const isHeader = line.endsWith(":") && line.length < 80;
    if (isHeader) {
      current = { title: line.replace(/:$/, ""), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { title: "Summary", lines: [] };
      sections.push(current);
    }
    current.lines.push(line.replace(/^[-•]\s*/, ""));
  }
  return sections;
}

type FollowupQuestion = {
  number: number;
  question: string;
  source: "interview" | "jd";
  related_skill: string;
};

type FollowupResult = {
  questions: FollowupQuestion[];
  interview_skills: string[];
  uncovered_mandatory_skills: string[];
  uncovered_optional_skills: string[];
};

type RecordPipelineStep = "idle" | "uploading" | "transcribing" | "ready";

type RecordProcessResult = {
  transcript: string;
  summary: string;
  source_name?: string;
  jd_name?: string;
};

const PIPELINE_LABELS: { key: RecordPipelineStep; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "transcribing", label: "Transcribing" },
  { key: "ready", label: "Summary ready" },
];

function pipelineStepClass(current: RecordPipelineStep, step: RecordPipelineStep): string {
  if (current === "ready") return "ia-pipeline-step ia-pipeline-step--done";
  if (current === step) return "ia-pipeline-step ia-pipeline-step--active";
  const order: RecordPipelineStep[] = ["idle", "uploading", "transcribing", "ready"];
  if (order.indexOf(current) > order.indexOf(step)) return "ia-pipeline-step ia-pipeline-step--done";
  return "ia-pipeline-step";
}

function initAgentStatus(mode: "full" | "summary"): Record<string, AgentStatus> {
  const agents = mode === "full" ? AGENTS_FULL : AGENTS_SUMMARY;
  return Object.fromEntries(agents.map((a) => [a.id, "pending" as AgentStatus]));
}

function applyAgentEvent(
  prev: Record<string, AgentStatus>,
  event: StreamEvent
): Record<string, AgentStatus> {
  if (event.type !== "agent" || !event.id) return prev;
  const next = { ...prev };
  if (event.phase === "start") next[event.id] = "running";
  if (event.phase === "complete") next[event.id] = "complete";
  if (event.phase === "error") next[event.id] = "error";
  return next;
}

export default function InterviewAnalyzer() {
  const [items, setItems] = useState<JdItem[]>([]);
  const [sel, setSel] = useState("");
  const [payload, setPayload] = useState<JdPayload | null>(null);
  const [newText, setNewText] = useState("");
  const [saveName, setSaveName] = useState("");
  const [keywords, setKeywords] = useState<Record<string, unknown> | null>(null);
  const [activeName, setActiveName] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [driveLink, setDriveLink] = useState("");
  const [sourceMode, setSourceMode] = useState<"upload" | "drive" | "record">("upload");
  const [recordedAudio, setRecordedAudio] = useState<File | null>(null);
  const [recordResult, setRecordResult] = useState<RecordProcessResult | null>(null);
  const [recordPipeline, setRecordPipeline] = useState<RecordPipelineStep>("idle");
  const [manualSourceName, setManualSourceName] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [createJdOpen, setCreateJdOpen] = useState(false);
  const [assessmentLink, setAssessmentLink] = useState<string | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>("summary");
  const [resultTab, setResultTab] = useState<"feedback" | "evaluation" | "transcript">("feedback");
  const [agentStatus, setAgentStatus] = useState<Record<string, AgentStatus>>({});
  const toast = useToast();

  // Step 4: Follow-up assessment state
  const [followupResult, setFollowupResult] = useState<FollowupResult | null>(null);
  const [followupBusy, setFollowupBusy] = useState(false);
  const [customPromptFile, setCustomPromptFile] = useState<File | null>(null);
  const [customPromptText, setCustomPromptText] = useState("");
  const [fuRecording, setFuRecording] = useState(false);
  const [fuAudioBlob, setFuAudioBlob] = useState<Blob | null>(null);
  const [fuAudioUrl, setFuAudioUrl] = useState<string | null>(null);
  const [fuElapsed, setFuElapsed] = useState(0);
  const [fuSaved, setFuSaved] = useState(false);
  const fuRecorderRef = useRef<MediaRecorder | null>(null);
  const fuStreamRef = useRef<MediaStream | null>(null);
  const fuTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fuChunksRef = useRef<Blob[]>([]);

  const driveLooksValid = (() => {
    const v = driveLink.trim();
    if (!v) return true;
    return /^https?:\/\/(drive|docs)\.google\.com\/.+/i.test(v);
  })();

  async function refreshList() {
    const r = await apiJson<{ items: JdItem[] }>("/api/jd-store");
    setItems(r.items);
  }

  useEffect(() => {
    refreshList().catch((e) => {
      setItems([]);
      setErr(formatUserError(e));
    });
  }, []);

  async function loadOne(stem: string) {
    if (!stem) {
      setPayload(null);
      setKeywords(null);
      setActiveName("");
      return;
    }
    const p = await apiJson<JdPayload>(`/api/jd-store/${stem}`);
    setPayload(p);
    setKeywords(p.jd_keywords || null);
    setActiveName(p.jd_name);
  }

  useEffect(() => {
    if (sel) loadOne(sel).catch((e) => setErr(formatUserError(e)));
  }, [sel]);

  async function extractNew() {
    setErr("");
    setOk("");
    const t = newText.trim();
    if (!t) {
      setErr("Paste JD text first.");
      return;
    }
    setBusy(true);
    try {
      const r = await apiJson<{ jd_keywords: Record<string, unknown> }>("/api/jd-store/extract-keywords", {
        method: "POST",
        body: JSON.stringify({ jd_text: t }),
      });
      setKeywords(r.jd_keywords);
      setActiveName("New JD (unsaved)");
      setSel("");
      setPayload(null);
      setOk("Keywords extracted from JD text.");
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveNew() {
    setErr("");
    setOk("");
    if (!newText.trim() || !keywords || !saveName.trim()) {
      setErr("Extract keywords and enter a save name.");
      return;
    }
    setBusy(true);
    try {
      await apiJson("/api/jd-store", {
        method: "POST",
        body: JSON.stringify({
          jd_name: saveName.trim(),
          jd_text: newText.trim(),
          jd_keywords: keywords,
        }),
      });
      setSaveName("");
      await refreshList();
      setOk("JD saved to library.");
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  function onSourceModeChange(mode: "upload" | "drive" | "record") {
    setSourceMode(mode);
    setErr("");
    setOk("");
    setRecordResult(null);
    setRecordPipeline("idle");
    setResult(null);
    setAssessmentLink(null);
    if (mode === "drive") setOutputMode("full");
    if (mode === "upload" || mode === "record") setOutputMode("summary");
  }

  const usesSummaryPipeline = outputMode === "summary" && sourceMode !== "drive";

  /** Saved JD library stem: Step 1 dropdown, or match by jd_name from the API. */
  function resolveJdStem(jdName?: string): string {
    if (sel) return sel;
    const name = (jdName || activeName || "").trim();
    if (!name || name.includes("unsaved")) return "";
    return items.find((i) => i.jd_name === name)?.stem ?? "";
  }

  /** Saved JD stem + interview text → candidate assessment link. */
  async function tryGenerateAssessmentFromSummary(
    interviewSummary: string,
    jdNameHint?: string
  ): Promise<string | null> {
    const stem = resolveJdStem(jdNameHint);
    if (!stem) return null;
    const text = interviewSummary.trim();
    if (!text) return null;
    const generated = await apiJson<{ test_id: string; message?: string }>(
      "/api/jd-tests/generate-from-interview",
      {
        method: "POST",
        body: JSON.stringify({ stem, interview_summary: text }),
      }
    );
    return `${window.location.origin}/t/${generated.test_id}`;
  }

  async function generateAssessmentLinkNow() {
    if (!recordResult?.summary?.trim()) {
      setErr("Interview summary is required to generate an assessment.");
      return;
    }
    const stem = resolveJdStem(recordResult.jd_name);
    if (!stem) {
      setErr("Select a saved JD in Step 1, or save your JD in Step 2 (Save JD to library), then try again.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const link = await tryGenerateAssessmentFromSummary(recordResult.summary, recordResult.jd_name);
      if (link) {
        setAssessmentLink(link);
        const msg = "Follow-up interview link generated (open-ended questions from JD + summary).";
        setOk(msg);
        toast.success(msg);
      }
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runSummaryPipeline(file: File) {
    setErr("");
    setOk("");
    if (!keywords && !activeName) {
      setErr("Select a saved JD or extract keywords from a new JD.");
      return;
    }
    setBusy(true);
    setAnalyzeBusy(true);
    setRecordResult(null);
    setResult(null);
    setAssessmentLink(null);
    setAgentStatus(initAgentStatus("summary"));
    setRecordPipeline("transcribing");
    try {
      const fd = new FormData();
      fd.append("audio", file);
      if (activeName && !activeName.includes("unsaved")) fd.append("active_jd_name", activeName);
      if (keywords) fd.append("jd_keywords_json", JSON.stringify(keywords));
      if (manualSourceName.trim()) fd.append("source_name", manualSourceName.trim());

      const data = await apiFormPostStream<RecordProcessResult>(
        "/api/interview/process-recording-stream",
        fd,
        (event) => setAgentStatus((prev) => applyAgentEvent(prev, event))
      );
      setRecordResult(data);
      setRecordPipeline("ready");
      const okMsg = "Transcript and interview summary are ready.";
      setOk(okMsg);
      toast.success(okMsg);
    } catch (e) {
      setRecordPipeline("idle");
      setErr(formatUserError(e));
    } finally {
      setAnalyzeBusy(false);
      setBusy(false);
    }
  }

  async function runSubmit() {
    if (usesSummaryPipeline) {
      const file = sourceMode === "record" ? recordedAudio : audio;
      if (!file) {
        setErr(
          sourceMode === "record"
            ? "Record the interview first (mic + meeting tab in Chrome), or switch to Upload file for a Zoom/Meet recording."
            : "Choose an audio or video file from your meeting recording."
        );
        return;
      }
      await runSummaryPipeline(file);
      return;
    }
    await runAnalyze();
  }

  async function runAnalyze() {
    setErr("");
    setOk("");
    if (sourceMode === "upload" && !audio) {
      setErr("Upload an audio/video file.");
      return;
    }
    if (sourceMode === "drive" && !driveLink.trim()) {
      setErr("Provide a Google Drive file link.");
      return;
    }
    if (sourceMode === "drive" && !driveLooksValid) {
      setErr("Enter a valid Google Drive URL.");
      return;
    }
    if (!keywords && !activeName) {
      setErr("Select a saved JD or extract keywords from a new JD.");
      return;
    }
    setBusy(true);
    setAnalyzeBusy(true);
    setResult(null);
    setRecordResult(null);
    setRecordPipeline("idle");
    setAssessmentLink(null);
    setAgentStatus(initAgentStatus("full"));
    try {
      const fd = new FormData();
      if (sourceMode === "upload" && audio) fd.append("audio", audio);
      if (sourceMode === "record" && recordedAudio) fd.append("audio", recordedAudio);
      if (sourceMode === "drive" && driveLink.trim()) fd.append("drive_link", driveLink.trim());
      if (sel) fd.append("active_jd_stem", sel);
      if (activeName && !activeName.includes("unsaved")) fd.append("active_jd_name", activeName);
      if (keywords) fd.append("jd_keywords_json", JSON.stringify(keywords));
      if (manualSourceName.trim()) fd.append("source_name", manualSourceName.trim());

      const useStream = sourceMode === "upload" || sourceMode === "record";
      let data: Record<string, unknown>;
      if (useStream) {
        data = await apiFormPostStream<Record<string, unknown>>(
          "/api/interview/analyze-stream",
          fd,
          (event) => setAgentStatus((prev) => applyAgentEvent(prev, event))
        );
      } else {
        data = await apiFormPostJson<Record<string, unknown>>("/api/interview/analyze", fd);
      }
      setResult(data);
      const okMsg = "Interview analysis complete — all agents finished.";
      setOk(okMsg);
      toast.success(okMsg);
      setResultTab("feedback");
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setAnalyzeBusy(false);
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!result?.parsed_data) return;
    setErr("");
    setOk("");
    const sourceBase = String(result?.source_name || manualSourceName || "InterviewGraph").trim() || "InterviewGraph";
    try {
      const file = await downloadPost(
        "/api/interview/build-pdf",
        {
          parsed_data: result.parsed_data,
          feedback_text: result.feedback_text || "",
          filename: `${sourceBase}_Interview_Report.pdf`,
          transcript: String(result.transcript || ""),
          assessment_link: assessmentLink || "",
        },
        `${sourceBase}_Interview_Report.pdf`
      );
      triggerDownload(file);
      setOk("PDF report downloaded.");
      toast.success("PDF report downloaded.");
    } catch (e) {
      setErr(formatUserError(e));
    }
  }

  // --- Step 4: Follow-up question generation ---

  const interviewSummaryText = (() => {
    if (recordResult?.summary) return recordResult.summary;
    if (result?.feedback_text) {
      const fb = String(result.feedback_text).trim();
      const parsed = result.parsed_data;
      if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).summary) {
        try {
          return [fb, JSON.stringify((parsed as Record<string, unknown>).summary, null, 2)]
            .filter(Boolean)
            .join("\n\n");
        } catch { /* fall through */ }
      }
      return fb;
    }
    return "";
  })();

  const hasAnalysisResult = !!(recordResult || result);
  const followupStem = resolveJdStem(recordResult?.jd_name || String(result?.jd_name || ""));

  useEffect(() => {
    if (!customPromptFile) {
      setCustomPromptText("");
      return;
    }
    customPromptFile.text().then(setCustomPromptText).catch(() => setCustomPromptText(""));
  }, [customPromptFile]);

  async function generateFollowupQuestions() {
    if (!followupStem) {
      setErr("Select a saved JD in Step 1 to generate follow-up questions.");
      return;
    }
    if (!interviewSummaryText.trim()) {
      setErr("Interview summary is required to generate follow-up questions.");
      return;
    }
    setErr("");
    setOk("");
    setFollowupBusy(true);
    setFollowupResult(null);
    setFuAudioBlob(null);
    setFuAudioUrl(null);
    setFuSaved(false);
    try {
      const data = await apiJson<FollowupResult>("/api/interview/generate-summary-questions", {
        method: "POST",
        body: JSON.stringify({
          stem: followupStem,
          interview_summary: interviewSummaryText,
          custom_prompt: customPromptText,
        }),
      });
      setFollowupResult(data);
      const msg = `${data.questions.length} follow-up questions generated.`;
      setOk(msg);
      toast.success(msg);
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setFollowupBusy(false);
    }
  }

  const startFollowupRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      fuStreamRef.current = stream;
      fuChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) fuChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(fuChunksRef.current, { type: mimeType });
        setFuAudioBlob(blob);
        setFuAudioUrl(URL.createObjectURL(blob));
        fuStreamRef.current?.getTracks().forEach((t) => t.stop());
        fuStreamRef.current = null;
        if (fuTimerRef.current) clearInterval(fuTimerRef.current);
        fuTimerRef.current = null;
      };
      fuRecorderRef.current = recorder;
      recorder.start(1000);
      setFuRecording(true);
      setFuElapsed(0);
      setFuAudioBlob(null);
      setFuAudioUrl(null);
      setFuSaved(false);
      fuTimerRef.current = setInterval(() => setFuElapsed((p) => p + 1), 1000);
    } catch (e) {
      setErr("Microphone access denied. Allow mic permission to record answers.");
    }
  }, []);

  const stopFollowupRecording = useCallback(() => {
    if (fuRecorderRef.current && fuRecorderRef.current.state !== "inactive") {
      fuRecorderRef.current.stop();
    }
    setFuRecording(false);
  }, []);

  async function saveFollowupRecording() {
    if (!fuAudioBlob) {
      setErr("No recording to save.");
      return;
    }
    setErr("");
    setFollowupBusy(true);
    try {
      const fd = new FormData();
      fd.append("audio", fuAudioBlob, "followup_answers.webm");
      const label = (manualSourceName || "").trim() || "followup";
      fd.append("session_label", label);
      if (followupResult?.questions) {
        fd.append("questions_json", JSON.stringify(followupResult.questions));
      }
      const res = await apiFormPostJson<{ success: boolean; filename: string }>(
        "/api/interview/save-followup-recording",
        fd
      );
      if (res.success) {
        setFuSaved(true);
        const msg = `Recording saved: ${res.filename}`;
        setOk(msg);
        toast.success(msg);
      }
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setFollowupBusy(false);
    }
  }

  function formatElapsed(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  const evalHtml = (result?.evaluation_html as string) || "";
  const feedbackSections = parseFeedbackSections(String(result?.feedback_text || ""));

  return (
    <div className="ig-studio">
      <header className="ig-hero">
        <span className="ig-hero__badge">InterviewGraph</span>
        <h1 className="ig-hero__title">
          Agentic <span>Interview Analysis</span>
        </h1>
        <p className="ig-hero__sub">
          Upload a recording, pick a job description, and let specialized agents transcribe, evaluate, and summarize.
        </p>
      </header>

      {err ? <div className="ig-alert ig-alert--error">{err}</div> : null}
      {ok ? <div className="ig-alert ig-alert--ok">{ok}</div> : null}

      {(analyzeBusy || Object.keys(agentStatus).length > 0) && (
        <AgentActivityPanel
          active={analyzeBusy}
          mode={usesSummaryPipeline && sourceMode !== "drive" ? "summary" : "full"}
          agentStatus={agentStatus}
        />
      )}

      <div className="ig-steps">
        {/* Step 1 — JD */}
        <section className="ig-step">
          <div className="ig-step__head">
            <span className="ig-step__num">1</span>
            <div>
              <h2 className="ig-step__title">Job description</h2>
              <p className="ig-step__desc">Select a saved JD to provide skill context for analysis.</p>
            </div>
          </div>
          <div className="ig-step__body">
            {items.length === 0 ? (
              <div className="ig-empty">
                No saved JDs yet. Create one below or paste text and extract keywords.
              </div>
            ) : (
              <div className="ig-field">
                <label className="ig-label" htmlFor="jd-select">
                  Saved job description
                </label>
                <select
                  id="jd-select"
                  className="ig-select"
                  value={sel}
                  onChange={(e) => setSel(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {items.map((i) => (
                    <option key={i.stem} value={i.stem}>
                      {i.jd_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {payload ? (
              <pre className="ig-kbd-preview">{JSON.stringify(payload.jd_keywords, null, 2)}</pre>
            ) : null}
          </div>
        </section>

        {/* Step 2 — Create JD (collapsible) */}
        <details className="ig-step ig-collapsible" open={createJdOpen} onToggle={(e) => setCreateJdOpen(e.currentTarget.open)}>
          <summary>Create or update JD from text (optional)</summary>
          <div className="ig-step__body">
            <div className="ig-field">
              <label className="ig-label" htmlFor="jd-text">
                JD text
              </label>
              <textarea
                id="jd-text"
                className="ig-textarea"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                rows={8}
              />
            </div>
            <div className="ig-row">
              <button type="button" className="ig-btn-secondary" disabled={busy} onClick={() => void extractNew()}>
                {busy ? "Extracting…" : "Extract keywords"}
              </button>
            </div>
            <div className="ig-field">
              <label className="ig-label" htmlFor="jd-save-name">
                Save as name
              </label>
              <input
                id="jd-save-name"
                className="ig-input"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g., Backend_Engineer_2026"
              />
            </div>
            <div className="ig-row">
              <button type="button" className="ig-btn-secondary" disabled={busy} onClick={() => void saveNew()}>
                Save JD to library
              </button>
            </div>
          </div>
        </details>

        {/* Step 3 — Recording */}
        <section className="ig-step">
          <div className="ig-step__head">
            <span className="ig-step__num">2</span>
            <div>
              <h2 className="ig-step__title">Recording & analysis</h2>
              <p className="ig-step__desc">
                Active JD: <strong>{activeName || "—"}</strong>
              </p>
            </div>
          </div>
          <div className="ig-step__body">
            <div className="ig-tabs" role="tablist" aria-label="Recording source">
              {(
                [
                  { value: "upload", label: "Upload" },
                  { value: "drive", label: "Drive link" },
                  { value: "record", label: "Record" },
                ] as const
              ).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={sourceMode === value}
                  className={`ig-tab${sourceMode === value ? " ig-tab--active" : ""}`}
                  onClick={() => onSourceModeChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {sourceMode === "upload" ? (
              <>
                <SingleFileDropzone
                  label="Meeting recording"
                  hint="MP4, M4A, MP3, WAV, WEBM from Zoom, Meet, or Teams."
                  accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.aac,.webm,.mov,.mkv"
                  file={audio}
                  onFileChange={setAudio}
                />
                <div className="ig-field">
                  <span className="ig-label">Analysis output</span>
                  <div className="ig-mode-toggle">
                    {(
                      [
                        { value: "summary", label: "Transcript + summary" },
                        { value: "full", label: "Full analysis (PDF)" },
                      ] as const
                    ).map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className={`ig-tab${outputMode === value ? " ig-tab--active" : ""}`}
                        onClick={() => setOutputMode(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="ig-hint">
                    {outputMode === "summary"
                      ? "Fast path: AssemblyAI transcript + Azure summary."
                      : "Full Round-1 scores, feedback, evaluation HTML, and PDF report."}
                  </p>
                </div>
                <div className="ig-field">
                  <label className="ig-label" htmlFor="session-label-upload">
                    Session label (optional)
                  </label>
                  <input
                    id="session-label-upload"
                    className="ig-input"
                    value={manualSourceName}
                    onChange={(e) => setManualSourceName(e.target.value)}
                    placeholder="e.g., candidate_name_round1"
                  />
                </div>
              </>
            ) : sourceMode === "record" ? (
              <>
                <InterviewAudioRecorder onAudioReady={setRecordedAudio} disabled={busy || analyzeBusy} />
                <div className="ig-field">
                  <label className="ig-label" htmlFor="session-label-record">
                    Session label (optional)
                  </label>
                  <input
                    id="session-label-record"
                    className="ig-input"
                    value={manualSourceName}
                    onChange={(e) => setManualSourceName(e.target.value)}
                    placeholder="e.g., candidate_name_round1"
                  />
                  <p className="ig-hint">Used for transcript file naming.</p>
                </div>
              </>
            ) : (
              <>
                <div className="ig-field">
                  <label className="ig-label" htmlFor="drive-url">
                    Google Drive file URL
                  </label>
                  <input
                    id="drive-url"
                    type="url"
                    className="ig-input"
                    value={driveLink}
                    onChange={(e) => setDriveLink(e.target.value)}
                    placeholder="https://drive.google.com/file/d/.../view"
                  />
                </div>
                {!driveLooksValid && driveLink.trim() ? (
                  <div className="ig-alert ig-alert--error">Enter a valid Google Drive link.</div>
                ) : null}
                <p className="ig-hint">
                  Share the file as <strong>Anyone with the link (Viewer)</strong>. Accepted: MP3, WAV, M4A, MP4, WEBM.
                </p>
                <div className="ig-field">
                  <label className="ig-label" htmlFor="session-label-drive">
                    Manual file name (optional)
                  </label>
                  <input
                    id="session-label-drive"
                    className="ig-input"
                    value={manualSourceName}
                    onChange={(e) => setManualSourceName(e.target.value)}
                    placeholder="e.g., candidate_name_round1"
                  />
                </div>
              </>
            )}

            {usesSummaryPipeline && recordPipeline !== "idle" ? (
              <div className="ia-pipeline-steps" aria-label="Processing progress">
                {PIPELINE_LABELS.map(({ key, label }) => (
                  <span key={key} className={pipelineStepClass(recordPipeline, key)}>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}

            {analyzeBusy ? (
              <div className="ig-status">
                {usesSummaryPipeline
                  ? recordPipeline === "uploading"
                    ? "Uploading file…"
                    : "Transcribing and generating summary — this may take a few minutes."
                  : "Running full agent pipeline — this may take a few minutes."}
              </div>
            ) : null}
          </div>
          <div className="ig-step__foot">
            <button
              type="button"
              className={`ig-cta${analyzeBusy ? " ig-cta--loading" : ""}`}
              disabled={
                busy ||
                analyzeBusy ||
                (sourceMode === "upload" && !audio) ||
                (sourceMode === "record" && !recordedAudio) ||
                (sourceMode === "drive" && (!driveLink.trim() || !driveLooksValid))
              }
              onClick={() => void runSubmit()}
            >
              {analyzeBusy
                ? usesSummaryPipeline
                  ? "Agents processing…"
                  : "Running agents…"
                : usesSummaryPipeline
                  ? "Generate transcript & summary"
                  : "Start full agent analysis"}
            </button>
          </div>
        </section>

        {/* Results — summary path */}
        {recordResult && usesSummaryPipeline ? (
          <section className="ig-step ig-results">
            <div className="ig-step__head">
              <span className="ig-step__num">✓</span>
              <div>
                <h2 className="ig-step__title">Transcript & summary</h2>
                <p className="ig-step__desc">Analysis complete.</p>
              </div>
            </div>
            <div className="ig-step__body">
              {assessmentLink ? (
                <p className="ig-hint">
                  Follow-up link:{" "}
                  <a className="ig-link" href={assessmentLink} target="_blank" rel="noreferrer">
                    {assessmentLink}
                  </a>
                </p>
              ) : (
                <div className="ig-row">
                  <button
                    type="button"
                    className="ig-btn-secondary"
                    disabled={busy || !resolveJdStem(recordResult.jd_name)}
                    onClick={() => void generateAssessmentLinkNow()}
                  >
                    {busy ? "Generating…" : "Generate assessment link"}
                  </button>
                </div>
              )}
              <div className="ig-row">
                <button
                  type="button"
                  className="ig-btn-secondary"
                  onClick={() => {
                    const t = String(recordResult.transcript || "");
                    const blob = new Blob([t], { type: "text/plain" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    const sourceBase =
                      String(recordResult.source_name || manualSourceName || "InterviewGraph").trim() ||
                      "InterviewGraph";
                    a.download = `${sourceBase}_Transcript.txt`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                >
                  Download transcript
                </button>
              </div>
              <div className="ig-field">
                <span className="ig-label">Transcript</span>
                <pre className="ig-results__panel">{String(recordResult.transcript || "")}</pre>
              </div>
              <div className="ig-field">
                <span className="ig-label">Interview summary</span>
                <pre className="ig-results__panel">{String(recordResult.summary || "")}</pre>
              </div>
            </div>
          </section>
        ) : null}

        {/* Results — full analysis */}
        {result && !usesSummaryPipeline ? (
          <section className="ig-step ig-results">
            <div className="ig-step__head">
              <span className="ig-step__num">✓</span>
              <div>
                <h2 className="ig-step__title">Analysis output</h2>
                <p className="ig-step__desc">Full Round-1 evaluation ready.</p>
              </div>
            </div>
            <div className="ig-step__body">
              {assessmentLink ? (
                <p className="ig-hint">
                  Follow-up link:{" "}
                  <a className="ig-link" href={assessmentLink} target="_blank" rel="noreferrer">
                    {assessmentLink}
                  </a>
                </p>
              ) : null}
              <div className="ig-row">
                <button type="button" className="ig-btn-secondary" onClick={() => void downloadPdf()}>
                  Download PDF report
                </button>
                <button
                  type="button"
                  className="ig-btn-secondary"
                  onClick={() => {
                    const t = String(result.transcript || "");
                    const blob = new Blob([t], { type: "text/plain" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    const sourceBase =
                      String(result?.source_name || manualSourceName || "InterviewGraph").trim() || "InterviewGraph";
                    a.download = `${sourceBase}_Transcript.txt`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                >
                  Download transcript
                </button>
              </div>
              <div className="ig-results__tabs">
                {(
                  [
                    { value: "feedback", label: "Feedback" },
                    { value: "evaluation", label: "Evaluation" },
                    { value: "transcript", label: "Transcript" },
                  ] as const
                ).map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={`ig-tab${resultTab === value ? " ig-tab--active" : ""}`}
                    onClick={() => setResultTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {resultTab === "feedback" &&
                (feedbackSections.length ? (
                  <div className="ia-feedback-board">
                    {feedbackSections.map((section, idx) => (
                      <div key={`${section.title}-${idx}`} className="ia-feedback-section">
                        <h5>{section.title}</h5>
                        {section.lines.length ? (
                          <ul>
                            {section.lines.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="ig-hint">No details provided.</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="ig-hint">No feedback text available.</p>
                ))}
              {resultTab === "evaluation" && (
                <div className="eval-html ig-results__panel" dangerouslySetInnerHTML={{ __html: evalHtml }} />
              )}
              {resultTab === "transcript" && (
                <pre className="ig-results__panel">{String(result.transcript || "No transcript available.")}</pre>
              )}
            </div>
          </section>
        ) : null}

        {/* Follow-up assessment */}
        {hasAnalysisResult ? (
          <details className="ig-step ig-collapsible" open={!!followupResult}>
            <summary>Follow-up assessment (optional)</summary>
            <div className="ig-step__body">
              <div className="ia-fu-section">
                <p className="ig-label">Custom prompt (optional)</p>
                <p className="ig-hint">Upload a .md file with extra instructions for question generation.</p>
                <SingleFileDropzone
                  label="Custom prompt file"
                  hint="Markdown (.md)"
                  accept=".md"
                  file={customPromptFile}
                  onFileChange={setCustomPromptFile}
                />
                {customPromptText ? (
                  <details className="ia-fu-prompt-preview">
                    <summary className="ig-hint">Preview custom prompt</summary>
                    <pre className="ig-kbd-preview">{customPromptText}</pre>
                  </details>
                ) : null}
              </div>

              <div className="ig-row">
                <button
                  type="button"
                  className="ig-btn-secondary"
                  disabled={followupBusy || !followupStem || !interviewSummaryText.trim()}
                  onClick={() => void generateFollowupQuestions()}
                >
                  {followupBusy && !followupResult ? "Generating…" : "Generate follow-up questions"}
                </button>
              </div>
              {!followupStem && hasAnalysisResult ? (
                <p className="ig-hint">A saved JD (Step 1) is required to generate follow-up questions.</p>
              ) : null}

              {followupResult ? (
                <>
                  <div className="ia-fu-skills">
                    <h4 className="ig-label">Skills coverage</h4>
                    {followupResult.interview_skills.length > 0 && (
                      <div className="ia-fu-skill-group">
                        <p className="ig-hint">Skills from interview</p>
                        <div className="ia-fu-skill-tags">
                          {followupResult.interview_skills.map((s) => (
                            <span key={s} className="ia-fu-tag ia-fu-tag--covered">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {followupResult.uncovered_mandatory_skills.length > 0 && (
                      <div className="ia-fu-skill-group">
                        <p className="ig-hint">Uncovered mandatory skills</p>
                        <div className="ia-fu-skill-tags">
                          {followupResult.uncovered_mandatory_skills.map((s) => (
                            <span key={s} className="ia-fu-tag ia-fu-tag--mandatory">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {followupResult.uncovered_optional_skills.length > 0 && (
                      <div className="ia-fu-skill-group">
                        <p className="ig-hint">Uncovered optional skills</p>
                        <div className="ia-fu-skill-tags">
                          {followupResult.uncovered_optional_skills.map((s) => (
                            <span key={s} className="ia-fu-tag ia-fu-tag--optional">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="ia-fu-questions">
                    <h4 className="ig-label">Follow-up questions</h4>
                    {followupResult.questions.map((q) => (
                      <div key={q.number} className="ia-fu-question-card">
                        <div className="ia-fu-question-header">
                          <span className="ia-fu-question-num">Q{q.number}</span>
                          <span className={`ia-fu-tag ia-fu-tag--${q.source === "jd" ? "mandatory" : "covered"}`}>
                            {q.source === "jd" ? "From JD" : "From interview"}
                          </span>
                          {q.related_skill && <span className="ia-fu-tag ia-fu-tag--neutral">{q.related_skill}</span>}
                        </div>
                        <p className="ia-fu-question-text">{q.question}</p>
                      </div>
                    ))}
                  </div>

                  <div className="ia-fu-recording">
                    <h4 className="ig-label">Record candidate answers</h4>
                    <p className="ig-hint">
                      Candidate reads questions silently, then answers verbally by question number.
                    </p>
                    <div className="ig-row">
                      {!fuRecording && !fuAudioBlob && (
                        <button type="button" className="ig-btn-secondary" onClick={() => void startFollowupRecording()}>
                          Start recording answers
                        </button>
                      )}
                      {fuRecording && (
                        <button type="button" className="ig-btn-secondary" onClick={stopFollowupRecording}>
                          Stop recording
                        </button>
                      )}
                    </div>
                    {fuRecording && (
                      <div className="ia-fu-rec-indicator">
                        <span className="ia-fu-rec-dot" />
                        <span>{formatElapsed(fuElapsed)}</span>
                        <span className="ig-hint">Recording…</span>
                      </div>
                    )}
                    {fuAudioUrl && !fuRecording && (
                      <div className="ia-fu-playback">
                        <audio controls src={fuAudioUrl} className="ia-fu-audio" />
                        <div className="ig-row">
                          <button
                            type="button"
                            className="ig-btn-secondary"
                            disabled={followupBusy || fuSaved}
                            onClick={() => void saveFollowupRecording()}
                          >
                            {fuSaved ? "Recording saved" : "Save recording"}
                          </button>
                          <button
                            type="button"
                            className="ig-btn-secondary"
                            disabled={fuRecording}
                            onClick={() => {
                              setFuAudioBlob(null);
                              setFuAudioUrl(null);
                              setFuSaved(false);
                            }}
                          >
                            Discard & re-record
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
