import { useEffect, useState } from "react";
import { apiJson, downloadForm, downloadPost, formatUserError, triggerDownload, type DownloadFile } from "../api";
import { PageHeader } from "../components/PagePrimitives";
import {
  ActionRow,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ExcelNameInput,
  FileDropzone,
  PageAlerts,
  PageStack,
  SelectField,
  SegmentedControl,
  TextAreaField,
  useToast,
  WorkflowCard,
} from "../components/ui";

type JdListItem = { stem: string; jd_name: string };

function JdOptionalPanel({
  jdItems,
  jdStem,
  setJdStem,
  jdPaste,
  setJdPaste,
}: {
  jdItems: JdListItem[];
  jdStem: string;
  setJdStem: (v: string) => void;
  jdPaste: string;
  setJdPaste: (v: string) => void;
}) {
  const jdOptions = jdItems.map((j) => ({
    value: j.stem,
    label: j.jd_name || j.stem,
  }));

  return (
    <Card className="he-jd-optional-panel">
      <CardHeader>
        <span className="he-step-pill he-step-pill--muted">Optional</span>
        <CardTitle>Job description for same-step match</CardTitle>
        <CardDescription>
          Leave both empty for parse-only. Use either a saved JD or pasted text—not both.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="he-jd-split">
          <div className="he-jd-split__col">
            <SelectField
              label="Saved JD"
              value={jdStem}
              onChange={(v) => {
                setJdStem(v);
                if (v) setJdPaste("");
              }}
              placeholder="None — parse only"
              options={jdOptions}
            />
            {jdItems.length === 0 ? (
              <EmptyState
                compact
                title="No saved job descriptions"
                description="Save a JD in Interview Intelligence, or paste text on the right for this run."
                actionLink={{ label: "Interview Intelligence", to: "/interview" }}
              />
            ) : null}
          </div>
          <span className="he-jd-or" aria-hidden>
            or
          </span>
          <div className="he-jd-split__col">
            <TextAreaField
              label="Paste JD text"
              value={jdPaste}
              onChange={(v) => {
                setJdPaste(v);
                if (v.trim()) setJdStem("");
              }}
              rows={5}
              placeholder="Full job description when not using a saved JD."
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ResumeParser() {
  const toast = useToast();
  const [tab, setTab] = useState<"html" | "pdf">("html");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const [htmlName, setHtmlName] = useState("html_candidates");
  const [htmlFiles, setHtmlFiles] = useState<File[]>([]);

  const [pdfName, setPdfName] = useState("parsed_resumes");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [lastFile, setLastFile] = useState<DownloadFile | null>(null);

  const [jdItems, setJdItems] = useState<JdListItem[]>([]);
  const [jdStem, setJdStem] = useState("");
  const [jdPaste, setJdPaste] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiJson<{ items: JdListItem[] }>("/api/jd-store")
      .then((d) => {
        if (!cancelled) setJdItems(Array.isArray(d.items) ? d.items : []);
      })
      .catch(() => {
        if (!cancelled) setJdItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  async function runHtml() {
    setErr("");
    setOk("");
    const stem = jdStem.trim();
    const pasted = jdPaste.trim();
    if (stem && pasted) {
      setErr("Use either a saved JD from the list or pasted JD text, not both.");
      return;
    }
    const html_contents = await Promise.all(htmlFiles.map((f) => f.text()));
    if (!html_contents.length || html_contents.every((t) => !t.trim())) {
      setErr("Upload an HTML file first.");
      return;
    }
    setBusy(true);
    try {
      const reportBase = htmlName.trim() || "html_candidates";
      const withCompare = Boolean(stem || pasted);
      const hintName = withCompare ? `${reportBase}_jd_comparison.xlsx` : `${reportBase}.xlsx`;
      const file = await downloadPost(
        "/api/parse/html-json",
        {
          custom_name: reportBase,
          html_contents,
          jd_stem: stem,
          jd_text_inline: pasted,
          compare_mode: "hybrid",
          include_exp_score: true,
        },
        hintName
      );
      setLastFile(file);
      triggerDownload(file);
      setOk(withCompare ? "Extracted and compared to JD." : "HTML resumes extracted.");
      toast.success(withCompare ? "HTML extract + JD comparison complete." : "HTML resumes extracted.");
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runPdf() {
    setErr("");
    setOk("");
    const stem = jdStem.trim();
    const pasted = jdPaste.trim();
    if (stem && pasted) {
      setErr("Use either a saved JD or pasted text, not both.");
      return;
    }
    if (!pdfFiles.length) {
      setErr("Upload at least one resume file.");
      return;
    }
    setBusy(true);
    try {
      const reportBase = pdfName.trim() || "parsed_resumes";
      const withCompare = Boolean(stem || pasted);
      const hintName = withCompare ? `${reportBase}_jd_comparison.xlsx` : `${reportBase}.xlsx`;
      const fd = new FormData();
      fd.append("custom_name", reportBase);
      pdfFiles.forEach((f) => fd.append("files", f));
      if (stem) {
        fd.append("jd_stem", stem);
      } else if (pasted) {
        fd.append("jd_text_inline", pasted);
      }
      if (stem || pasted) {
        fd.append("compare_mode", "hybrid");
      }
      const file = await downloadForm("/api/parse/pdf", fd, hintName);
      setLastFile(file);
      triggerDownload(file);
      setOk(withCompare ? "PDF resumes extracted and compared." : "PDF resumes extracted.");
      toast.success(withCompare ? "PDF extract + JD comparison complete." : "PDF resumes extracted.");
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  const htmlBase = htmlName.trim() || "html_candidates";
  const pdfBase = pdfName.trim() || "parsed_resumes";
  const hasJdCompare = Boolean(jdStem.trim() || jdPaste.trim());

  const excelHint = (base: string) =>
    hasJdCompare ? (
      <>
        Download: <strong>{base}_jd_comparison.xlsx</strong> (skill match). Server copy: <strong>{base}.xlsx</strong>.
      </>
    ) : (
      <>
        Download saves as <strong>{base}.xlsx</strong>.
      </>
    );

  const step2Fields = tab === "html" ? (
    <>
      <ExcelNameInput
        label="Report file name"
        hint={excelHint(htmlBase)}
        value={htmlName}
        onChange={setHtmlName}
        placeholder="html_candidates"
      />
      <FileDropzone
        label="HTML files"
        hint="Sourcing-export HTML. Multiple files merge into one workbook."
        accept=".html,.htm,text/html"
        multiple
        files={htmlFiles}
        onFilesChange={setHtmlFiles}
      />
    </>
  ) : (
    <>
      <ExcelNameInput
        label="Report file name"
        hint={excelHint(pdfBase)}
        value={pdfName}
        onChange={setPdfName}
        placeholder="parsed_resumes"
      />
      <FileDropzone
        label="Resume files"
        hint="PDF, Word (.docx), or plain text."
        accept=".pdf,.docx,.txt"
        multiple
        files={pdfFiles}
        onFilesChange={setPdfFiles}
      />
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow="Dataeaze · Hireeaze AIOS"
        title="Resume Parser"
        description="Export structured candidate rows for shortlisting. HTML sourcing exports or PDF, DOCX, and TXT files."
      />
      <PageAlerts error={err} success={ok || undefined} />

      <PageStack>
        <WorkflowCard
          step="Step 1"
          title="Select input format"
          description="Choose the source your team uses, then complete Step 2 below."
        >
          <SegmentedControl
            fullWidth
            ariaLabel="Resume parser formats"
            value={tab}
            onChange={setTab}
            options={[
              { value: "html", label: "HTML" },
              { value: "pdf", label: "PDF / DOCX / TXT" },
            ]}
          />
        </WorkflowCard>

        <WorkflowCard
          step="Step 2"
          title={tab === "html" ? "Provide HTML source and run extraction" : "Upload files and run extraction"}
          footer={
            <ActionRow>
              <Button
                type="button"
                disabled={busy}
                loading={busy}
                onClick={() => void (tab === "html" ? runHtml() : runPdf())}
              >
                {hasJdCompare ? "Extract & compare to JD" : "Extract resumes"}
              </Button>
            </ActionRow>
          }
        >
          <div className="he-workflow-stack">
            {step2Fields}
            <JdOptionalPanel
              jdItems={jdItems}
              jdStem={jdStem}
              setJdStem={setJdStem}
              jdPaste={jdPaste}
              setJdPaste={setJdPaste}
            />
          </div>
        </WorkflowCard>

        {lastFile && (
          <Card>
            <CardHeader>
              <CardTitle>Latest output</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="page-sub u-mt-0">
                <strong>{lastFile.name}</strong> — ready to download or find in Data Hub.
              </p>
              <ActionRow>
                <Button type="button" variant="primary" size="sm" onClick={() => triggerDownload(lastFile)}>
                  Download again
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => window.location.assign("/data-hub")}>
                  Open Data Hub
                </Button>
              </ActionRow>
            </CardContent>
          </Card>
        )}
      </PageStack>
    </>
  );
}
