import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson, downloadPost, formatUserError, triggerDownload } from "../api";
import { randomClientId } from "../utils/clientId";
import { CheckCircle2, ChevronDown, ChevronUp, FileDown, FileText, Plus, Sparkles } from "lucide-react";
import { InterviewPackMessage } from "../components/InterviewPackMessage";
import {
  INTERVIEW_PACK_EMPTY_STEPS,
  INTERVIEW_PACK_INTRO,
  JD_REQUEST_TEMPLATES,
} from "../content/interviewPack";
import {
  ActionRow,
  Button,
  FileDropzone,
  FormField,
  PageAlerts,
  TextAreaField,
  SelectField,
  useToast,
} from "../components/ui";

type ChatMsg = { id: string; role: "user" | "assistant"; content: string; ts: number };
type JdItem = { stem: string; jd_name: string; saved_at?: string };
type JdPayload = { jd_name: string; jd_text: string };

const CONTEXT_ACCEPT = ".txt,.md,.json,.jsonl,.html,.htm,.csv,text/plain,application/json,text/html,text/csv";

const JD_TEMPLATE_CUSTOM = "custom";

function groupTurns(messages: ChatMsg[]): { user: ChatMsg; assistant?: ChatMsg }[] {
  const turns: { user: ChatMsg; assistant?: ChatMsg }[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      turns.push({ user: m });
    } else if (turns.length > 0 && !turns[turns.length - 1].assistant) {
      turns[turns.length - 1].assistant = m;
    } else {
      turns.push({
        user: { id: `sys-${m.id}`, role: "user", content: "—", ts: m.ts },
        assistant: m,
      });
    }
  }
  return turns;
}

export default function JdQa() {
  const toast = useToast();
  const [chatInput, setChatInput] = useState("");
  const [interviewFocus, setInterviewFocus] = useState("");
  const [jdContextText, setJdContextText] = useState("");
  const [jdContextName, setJdContextName] = useState("");
  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [pasteJd, setPasteJd] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [jdItems, setJdItems] = useState<JdItem[]>([]);
  const [selectedJdStem, setSelectedJdStem] = useState("");
  const [jdTemplateId, setJdTemplateId] = useState(JD_TEMPLATE_CUSTOM);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [lastReply, setLastReply] = useState("");
  const [exportFileBase, setExportFileBase] = useState("interview_qa");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    []
  );

  const turns = useMemo(() => groupTurns(messages), [messages]);

  const jdSelectOptions = useMemo(
    () => [
      { value: "", label: "— Select a saved job description —" },
      ...jdItems.map((item) => ({
        value: item.stem,
        label: item.jd_name || item.stem,
      })),
    ],
    [jdItems]
  );

  const jdTemplateOptions = useMemo(
    () => [
      { value: JD_TEMPLATE_CUSTOM, label: "Custom request (type below)" },
      ...JD_REQUEST_TEMPLATES.map((t) => ({ value: t.id, label: t.label })),
    ],
    []
  );

  const refreshJdList = useCallback(async () => {
    try {
      const r = await apiJson<{ items: JdItem[] }>("/api/jd-store");
      setJdItems(r.items);
    } catch {
      setJdItems([]);
    }
  }, []);

  useEffect(() => {
    void refreshJdList();
  }, [refreshJdList]);

  useEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  function applyContext(text: string, name: string, stem = "") {
    setJdContextText(text);
    setJdContextName(name);
    if (stem) setSelectedJdStem(stem);
    setJdTemplateId(JD_REQUEST_TEMPLATES[0]?.id ?? JD_TEMPLATE_CUSTOM);
    applyJdTemplate(JD_REQUEST_TEMPLATES[0]?.id ?? JD_TEMPLATE_CUSTOM);
    setOk("Job description attached.");
  }

  function applyJdTemplate(templateId: string) {
    setJdTemplateId(templateId);
    if (templateId === JD_TEMPLATE_CUSTOM) return;
    const t = JD_REQUEST_TEMPLATES.find((x) => x.id === templateId);
    if (!t) return;
    setChatInput(t.message);
    if (t.focus) setInterviewFocus(t.focus);
  }

  async function loadContextFile(file: File) {
    setErr("");
    const name = (file.name || "").toLowerCase();
    const allowed = [".txt", ".md", ".json", ".jsonl", ".html", ".htm", ".csv"];
    if (!allowed.some((ext) => name.endsWith(ext))) {
      setErr("Unsupported file type. Use .txt, .md, .json, .jsonl, .html, .htm, or .csv.");
      setContextFiles([]);
      return;
    }
    try {
      const text = (await file.text()).trim();
      if (!text) {
        setErr("Uploaded file is empty.");
        setContextFiles([]);
        return;
      }
      applyContext(text, file.name || "uploaded-context");
      setContextFiles([file]);
      setSelectedJdStem("");
    } catch (e) {
      setErr(formatUserError(e));
      setContextFiles([]);
    }
  }

  async function loadSavedJd(stem: string) {
    if (!stem) {
      clearContext();
      return;
    }
    setErr("");
    try {
      const p = await apiJson<JdPayload>(`/api/jd-store/${stem}`);
      applyContext(p.jd_text, p.jd_name || stem, stem);
      setContextFiles([]);
    } catch (e) {
      setErr(formatUserError(e));
    }
  }

  function applyPasteJd() {
    const text = pasteJd.trim();
    if (!text) {
      setErr("Paste JD text first.");
      return;
    }
    applyContext(text, "Pasted JD");
    setContextFiles([]);
    setSelectedJdStem("");
  }

  function clearContext() {
    setJdContextText("");
    setJdContextName("");
    setContextFiles([]);
    setPasteJd("");
    setSelectedJdStem("");
    setJdTemplateId(JD_TEMPLATE_CUSTOM);
  }

  async function sendChat() {
    setErr("");
    setOk("");
    if (!chatInput.trim()) return;
    if (!jdContextText && jdTemplateId !== JD_TEMPLATE_CUSTOM) {
      setErr("Attach a job description first, or choose a custom request.");
      return;
    }
    setBusy(true);
    const userMsg = chatInput.trim();
    const chatHistory = messages.slice(-12).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    setChatInput("");
    setJdTemplateId(JD_TEMPLATE_CUSTOM);
    setMessages((m) => [...m, { id: randomClientId(), role: "user", content: userMsg, ts: Date.now() }]);
    try {
      const res = await apiJson<{ reply: string }>("/api/jd-qa/chat", {
        method: "POST",
        body: JSON.stringify({
          message: userMsg,
          jd_text: jdContextText || null,
          user_requirements: interviewFocus.trim() || null,
          chat_history: chatHistory,
        }),
      });
      setLastReply(res.reply);
      setMessages((m) => [...m, { id: randomClientId(), role: "assistant", content: res.reply, ts: Date.now() }]);
      setOk("Interview Q&A ready.");
      toast.success("Interview Q&A ready.");
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportChatPdf() {
    setErr("");
    setOk("");
    if (!lastReply) {
      setErr("Generate interview Q&A first.");
      return;
    }
    const safeBase =
      (exportFileBase || "interview_qa")
        .trim()
        .replace(/[^a-zA-Z0-9._ -]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 80) || "interview_qa";
    setBusy(true);
    try {
      const file = await downloadPost(
        "/api/jd-qa/export-chat-pdf",
        { content: lastReply, filename_base: safeBase },
        `${safeBase}.pdf`
      );
      triggerDownload(file);
      setOk("PDF downloaded.");
      toast.success("Interview Q&A exported to PDF.");
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    setMessages([]);
    setLastReply("");
    setChatInput("");
    setJdTemplateId(jdContextText ? JD_REQUEST_TEMPLATES[0]?.id ?? JD_TEMPLATE_CUSTOM : JD_TEMPLATE_CUSTOM);
    if (jdContextText && JD_REQUEST_TEMPLATES[0]) {
      applyJdTemplate(JD_REQUEST_TEMPLATES[0].id);
    }
  }

  const chatPlaceholder = jdContextText
    ? "Example: Generate 8 technical questions from the attached JD."
    : "Example: Generate 10 interview questions for a Java backend engineer with Spring Boot and AWS.";

  return (
    <div className="he-jdqa-page">
      <h1 className="he-sr-only">Interview QA</h1>
      <p className="he-jdqa-intro">{INTERVIEW_PACK_INTRO}</p>

      <PageAlerts error={err} success={ok || undefined} />

      <div className="he-jdqa-shell">
        <aside className="he-jdqa-sidebar he-jdqa-zone--context" aria-label="Job description context">
          <h2 className="he-jdqa-sidebar__title">
            <FileText size={18} aria-hidden />
            Job description <span className="he-jdqa-sidebar__optional">(optional)</span>
          </h2>

          <SelectField
            label="Saved job description"
            value={selectedJdStem}
            onChange={(stem) => {
              setSelectedJdStem(stem);
              void loadSavedJd(stem);
            }}
            options={jdSelectOptions}
          />

          <div className="he-jdqa-paste-block">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPasteOpen(!pasteOpen)}
              aria-expanded={pasteOpen}
            >
              {pasteOpen ? (
                <>
                  <ChevronUp size={16} aria-hidden /> Hide paste
                </>
              ) : (
                <>
                  <ChevronDown size={16} aria-hidden /> Paste JD text
                </>
              )}
            </Button>
            {pasteOpen ? (
              <>
                <TextAreaField
                  label="Paste job description"
                  value={pasteJd}
                  onChange={setPasteJd}
                  rows={6}
                  placeholder="Paste full JD here…"
                />
                <ActionRow>
                  <Button type="button" size="sm" disabled={!pasteJd.trim()} onClick={applyPasteJd}>
                    Attach pasted JD
                  </Button>
                </ActionRow>
              </>
            ) : null}
          </div>

          <FileDropzone
            label="Upload file"
            hint=".txt, .md, .json, .jsonl, .html, .htm, .csv"
            accept={CONTEXT_ACCEPT}
            files={contextFiles}
            onFilesChange={(files) => {
              if (!files.length) {
                if (!selectedJdStem) clearContext();
                return;
              }
              void loadContextFile(files[files.length - 1]);
            }}
          />

          {jdContextText ? (
            <div className="he-jdqa-context-active">
              <CheckCircle2 size={18} className="he-jdqa-context-active__icon" aria-hidden />
              <div className="he-jdqa-context-active__copy">
                <span className="he-jdqa-context-active__label">Attached</span>
                <strong>{jdContextName}</strong>
                <span className="he-jdqa-context-active__meta">
                  {jdContextText.length.toLocaleString()} characters
                </span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={clearContext}>
                Remove
              </Button>
            </div>
          ) : (
            <p className="he-jdqa-sidebar__hint">Skip this if you only want to describe the role in the form below.</p>
          )}
        </aside>

        <div className="he-jdqa-main">
          <section className="he-jdqa-workspace he-jdqa-zone--build" aria-label="Interview QA workspace">
            <header className="he-jdqa-workspace__toolbar">
              <div className="he-jdqa-workspace__toolbar-left">
                <h2 className="he-jdqa-workspace__heading">Your interview Q&A</h2>
              </div>
              <div className="he-jdqa-workspace__toolbar-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || messages.length === 0}
                  onClick={newChat}
                >
                  <Plus size={16} aria-hidden />
                  New session
                </Button>
                <div className="he-jdqa-export-group">
                  <label className="he-jdqa-export-group__label" htmlFor="jdqa-export-name">
                    PDF name
                  </label>
                  <input
                    id="jdqa-export-name"
                    type="text"
                    className="he-input he-jdqa-export-name"
                    value={exportFileBase}
                    onChange={(e) => setExportFileBase(e.target.value)}
                    placeholder="interview_qa"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="he-jdqa-btn-export"
                    disabled={busy || !lastReply}
                    onClick={() => void exportChatPdf()}
                  >
                    <FileDown size={16} aria-hidden />
                    Export PDF
                  </Button>
                </div>
              </div>
            </header>

            {jdContextText ? (
              <div className="he-jdqa-status-bar he-jdqa-status-bar--active">
                <CheckCircle2 size={16} aria-hidden />
                <span>
                  Using JD: <strong>{jdContextName}</strong>
                </span>
              </div>
            ) : null}

          <div ref={workspaceRef} className="he-jdqa-workspace__body">
            {messages.length === 0 && !busy ? (
              <ol className="he-jdqa-simple-steps">
                {INTERVIEW_PACK_EMPTY_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <div className="he-jdqa-turns">
                {turns.map((turn, idx) => (
                  <div key={turn.user.id} className="he-jdqa-turn">
                    <div className="he-jdqa-prompt">
                      <div className="he-jdqa-prompt__meta">
                        <span className="he-jdqa-prompt__label">Your request</span>
                        <time className="he-jdqa-prompt__time" dateTime={new Date(turn.user.ts).toISOString()}>
                          {timeFmt.format(new Date(turn.user.ts))}
                        </time>
                      </div>
                      <p className="he-jdqa-prompt__text">{turn.user.content}</p>
                    </div>
                    {turn.assistant ? (
                      <InterviewPackMessage content={turn.assistant.content} variant="document" />
                    ) : idx === turns.length - 1 && busy ? (
                      <div className="he-jdqa-generating" aria-live="polite" aria-busy="true">
                        <Sparkles size={20} className="he-jdqa-generating__icon" aria-hidden />
                        <div>
                          <p className="he-jdqa-generating__title">Building interview Q&A…</p>
                          <p className="he-jdqa-generating__hint">Generating questions and expected answers</p>
                        </div>
                        <div className="he-jdqa-generating__bars">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer className="he-jdqa-composer">
            {jdContextText ? (
              <SelectField
                label="Preset (uses your attached JD)"
                value={jdTemplateId}
                onChange={applyJdTemplate}
                options={jdTemplateOptions}
              />
            ) : null}

            <FormField
              label="What should we generate?"
              htmlFor="jdqa-chat-input"
              hint="Press Enter to generate. Shift+Enter for a new line."
            >
              <textarea
                id="jdqa-chat-input"
                className="he-input he-textarea he-jdqa-composer__textarea"
                value={chatInput}
                onChange={(e) => {
                  setChatInput(e.target.value);
                  if (jdTemplateId !== JD_TEMPLATE_CUSTOM) setJdTemplateId(JD_TEMPLATE_CUSTOM);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy && chatInput.trim()) void sendChat();
                  }
                }}
                rows={4}
                placeholder={chatPlaceholder}
                disabled={busy}
              />
            </FormField>

            <input
              id="interview-focus"
              type="text"
              className="he-input he-jdqa-composer__focus-input"
              value={interviewFocus}
              onChange={(e) => setInterviewFocus(e.target.value)}
              placeholder="Optional: e.g. 8 questions, mid-level, system design"
              disabled={busy}
              aria-label="Optional focus: question count and topics"
            />

            <div className="he-jdqa-composer__footer">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !chatInput.trim()}
                onClick={() => {
                  setChatInput("");
                  setInterviewFocus("");
                  setJdTemplateId(jdContextText ? JD_REQUEST_TEMPLATES[0]?.id ?? JD_TEMPLATE_CUSTOM : JD_TEMPLATE_CUSTOM);
                }}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                className="he-jdqa-btn-generate"
                disabled={busy || !chatInput.trim()}
                loading={busy}
                onClick={() => void sendChat()}
              >
                Generate Q&A
              </Button>
            </div>
          </footer>
          </section>
        </div>
      </div>
    </div>
  );
}
