import { useEffect, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { apiJson, downloadPost, formatUserError, triggerDownload, type DownloadFile } from "../api";
import { PageHeader } from "../components/PagePrimitives";
import {
  ActionRow,
  Button,
  EmptyState,
  ExcelNameInput,
  FormField,
  MetricGrid,
  PageAlerts,
  SelectField,
  TextAreaField,
  useToast,
  WorkflowCard,
} from "../components/ui";

type JdIn = { name: string; text: string; is_primary: boolean };
type SkillMatchRow = { skill: string; score: number; match: "YES" | "NO" };
type JdEntry = {
  name: string;
  mandatory: string[];
  optional: string[];
  certifications: string[];
  is_primary: boolean;
  mandatory_matches: SkillMatchRow[] | null;
  optional_matches: SkillMatchRow[] | null;
  certification_matches: SkillMatchRow[] | null;
};

type ExtractResponse = {
  jd_entries: JdEntry[];
  skill_match_status: string;
  skill_match_message: string | null;
  pool_summary: { file: string; candidates: number; pool_skill_tokens: number } | null;
};

export default function JdMatcher() {
  const toast = useToast();
  const [files, setFiles] = useState<string[]>([]);
  const [primaryText, setPrimaryText] = useState("");
  const [additional, setAdditional] = useState<JdIn[]>([]);
  const [jdEntries, setJdEntries] = useState<JdEntry[] | null>(null);
  const [extractMeta, setExtractMeta] = useState<{
    skill_match_status: string;
    skill_match_message: string | null;
    pool_summary: ExtractResponse["pool_summary"];
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [outName, setOutName] = useState("comparison_result");
  const [expType, setExpType] = useState<"Minimum" | "Range">("Minimum");
  const [minExp, setMinExp] = useState(0);
  const [minY, setMinY] = useState(3);
  const [maxY, setMaxY] = useState(5);
  const [includeExp, setIncludeExp] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastComparison, setLastComparison] = useState<DownloadFile | null>(null);

  useEffect(() => {
    apiJson<{ files: string[] }>("/api/parsed-resume-files")
      .then((d) => {
        setFiles(d.files);
        if (d.files.length) setSelectedFile(d.files[0]);
      })
      .catch((e) => {
        setFiles([]);
        setErr(formatUserError(e));
      });
  }, []);

  function addAdditional() {
    setAdditional((a) => [
      ...a,
      { name: `JD ${a.length + 2}`, text: "", is_primary: false },
    ]);
  }

  async function extractSkills() {
    setErr("");
    setOk("");
    const jds: JdIn[] = [];
    if (primaryText.trim()) {
      jds.push({ name: "JD 1", text: primaryText.trim(), is_primary: true });
    }
    additional.forEach((j) => {
      if (j.text.trim()) jds.push({ ...j, text: j.text.trim() });
    });
    if (!jds.length) {
      setErr("Provide at least one JD with text.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiJson<ExtractResponse>("/api/jd-matcher/extract", {
        method: "POST",
        body: JSON.stringify({
          jds,
          selected_file: selectedFile.trim() || null,
        }),
      });
      setJdEntries(res.jd_entries);
      setExtractMeta({
        skill_match_status: res.skill_match_status,
        skill_match_message: res.skill_match_message,
        pool_summary: res.pool_summary,
      });
      setOk(`Extracted skills for ${res.jd_entries.length} job description(s).`);
      toast.success(`Extracted skills for ${res.jd_entries.length} JD(s).`);
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runCompare() {
    setErr("");
    setOk("");
    if (!jdEntries?.length) {
      setErr("Extract JD skills first.");
      return;
    }
    const effectiveFile = selectedFile || files[0] || "";
    if (!effectiveFile) {
      setErr("No resume Excel available. Parse resumes first.");
      return;
    }
    if (!selectedFile && effectiveFile) {
      setSelectedFile(effectiveFile);
    }
    setOk("Comparison is running. Please wait...");
    setBusy(true);
    const reportBase = outName.trim() || "comparison_result";
    try {
      const file = await downloadPost(
        "/api/jd-matcher/compare",
        {
          jd_entries: jdEntries,
          selected_file: effectiveFile,
          custom_output: reportBase,
          exp_type: expType,
          min_exp: minExp,
          min_years: minY,
          max_years: maxY,
          include_exp_score: includeExp,
          compare_mode: "hybrid",
        },
        `${reportBase}.xlsx`
      );
      setLastComparison(file);
      triggerDownload(file);
      setOk("Comparison complete. Download is ready.");
      toast.success("Comparison Excel ready.");
    } catch (e) {
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="JD Matcher"
        description="Extract skills from job descriptions and compare parsed resume pools with highlighted Excel reports."
      />
      <PageAlerts error={err} success={ok || undefined} />

      {files.length === 0 && (
        <EmptyState
          icon={FileSpreadsheet}
          title="No parsed resume pool yet"
          description="Run Resume Parser first to create an Excel candidate pool, then return here to match against job descriptions."
          actionLink={{ label: "Open Resume Parser", to: "/" }}
        />
      )}

      <WorkflowCard
        step="Step 1"
        title="Select resume pool and add JD text"
        footer={
          <ActionRow>
            <Button type="button" variant="secondary" onClick={addAdditional}>
              + Add JD
            </Button>
            <Button type="button" disabled={busy} loading={busy} onClick={() => void extractSkills()}>
              Extract skills from JDs
            </Button>
          </ActionRow>
        }
      >
        <SelectField
          label="Parsed resume file"
          hint="Required for comparison Excel. Extract lists skills only; YES/NO scores appear in the comparison report after Step 3."
          value={selectedFile}
          onChange={setSelectedFile}
          placeholder={files.length === 0 ? "No files — parse resumes first" : undefined}
          options={files.map((f) => ({ value: f, label: f }))}
        />
        <TextAreaField label="Job description 1" value={primaryText} onChange={setPrimaryText} rows={8} />
        {additional.map((j, i) => (
          <div key={i} className="he-jd-additional card">
            <FormField label={`Additional JD ${i + 1} name`}>
              <input
                className="he-input"
                value={j.name}
                onChange={(e) => {
                  const n = [...additional];
                  n[i] = { ...n[i], name: e.target.value };
                  setAdditional(n);
                }}
              />
            </FormField>
            <TextAreaField
              label="JD text"
              value={j.text}
              onChange={(v) => {
                const n = [...additional];
                n[i] = { ...n[i], text: v };
                setAdditional(n);
              }}
              rows={5}
            />
          </div>
        ))}
      </WorkflowCard>

      {jdEntries && (
        <WorkflowCard step="Step 2" title="Review extracted skills">
          {extractMeta?.skill_match_status === "disabled" ? (
            <p className="page-sub jd-match-hint u-mt-0">
              Per-skill YES/NO preview against the resume pool is not available during extract. Run{" "}
              <strong>Generate comparison Excel</strong> in Step 3 for scored mandatory, optional, and certification columns.
            </p>
          ) : null}
          {extractMeta?.pool_summary ? (
            <MetricGrid
              items={[
                { label: "Resume pool file", value: extractMeta.pool_summary.file },
                { label: "Candidates", value: extractMeta.pool_summary.candidates },
                { label: "Pool skill tokens", value: extractMeta.pool_summary.pool_skill_tokens },
              ]}
            />
          ) : null}
          {(() => {
            const raw = extractMeta?.skill_match_message;
            const text = typeof raw === "string" ? raw.trim() : "";
            if (!text || extractMeta?.skill_match_status === "disabled") return null;
            return (
              <p
                className={
                  extractMeta.skill_match_status === "ok"
                    ? "page-sub jd-match-hint jd-match-hint--ok u-mt-0"
                    : "page-sub jd-match-hint u-mt-0"
                }
              >
                {text}
              </p>
            );
          })()}
          {jdEntries.map((j) => (
            <section key={j.name} className="jd-extract-block">
              <h4 className="jd-extract-block__title">
                {j.name}
                {j.is_primary ? <span className="he-score-pill">Primary</span> : null}
              </h4>
              <p className="page-sub u-mt-0">
                {j.mandatory.length} mandatory · {j.optional.length} optional skills ·{" "}
                {j.certifications.length} certifications
              </p>

              <div className="jd-skill-section">
                <h5 className="jd-skill-section__label">Mandatory skills</h5>
                {j.mandatory.length === 0 ? (
                  <p className="page-sub">None extracted.</p>
                ) : (
                  <p className="jd-skill-inline">
                    {(j.mandatory_matches?.map((row) => row.skill) ?? j.mandatory).join(", ")}
                  </p>
                )}
              </div>

              <div className="jd-skill-section">
                <h5 className="jd-skill-section__label">Optional skills</h5>
                {j.optional.length === 0 ? (
                  <p className="page-sub">None extracted.</p>
                ) : (
                  <p className="jd-skill-inline">
                    {(j.optional_matches?.map((row) => row.skill) ?? j.optional).join(", ")}
                  </p>
                )}
              </div>

              <div className="jd-skill-section">
                <h5 className="jd-skill-section__label">Certifications</h5>
                {j.certifications.length === 0 ? (
                  <p className="page-sub">None extracted.</p>
                ) : (
                  <p className="jd-skill-inline">
                    {(j.certification_matches?.map((row) => row.skill) ?? j.certifications).join(", ")}
                  </p>
                )}
              </div>
            </section>
          ))}

          <WorkflowCard
            step="Step 3"
            title="Run full comparison and download report"
            footer={
              <ActionRow>
                <Button type="button" disabled={busy} loading={busy} onClick={() => void runCompare()}>
                  Run comparison
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!lastComparison}
                  onClick={() => lastComparison && triggerDownload(lastComparison)}
                >
                  Download latest Excel
                </Button>
              </ActionRow>
            }
          >
            <div className="jd-filter-grid">
              <SelectField
                label="Experience filter"
                value={expType}
                onChange={(v) => setExpType(v as typeof expType)}
                options={[
                  { value: "Minimum", label: "Minimum years" },
                  { value: "Range", label: "Range" },
                ]}
              />
              {expType === "Minimum" ? (
                <FormField label="Min years">
                  <input
                    type="number"
                    className="he-input"
                    min={0}
                    max={50}
                    value={minExp}
                    onChange={(e) => setMinExp(Number(e.target.value))}
                  />
                </FormField>
              ) : (
                <>
                  <FormField label="Min years">
                    <input
                      type="number"
                      className="he-input"
                      min={0}
                      max={50}
                      value={minY}
                      onChange={(e) => setMinY(+e.target.value)}
                    />
                  </FormField>
                  <FormField label="Max years">
                    <input
                      type="number"
                      className="he-input"
                      min={0}
                      max={50}
                      value={maxY}
                      onChange={(e) => setMaxY(+e.target.value)}
                    />
                  </FormField>
                </>
              )}
            </div>
            <label className="jd-checkbox-row he-field">
              <input type="checkbox" checked={includeExp} onChange={(e) => setIncludeExp(e.target.checked)} />
              Include experience in scoring
            </label>
            <ExcelNameInput
              label="Excel report name"
              hint={
                <>
                  Saves as <strong>{(outName.trim() || "comparison_result") + ".xlsx"}</strong>
                </>
              }
              value={outName}
              onChange={setOutName}
              placeholder="comparison_result"
            />
          </WorkflowCard>
        </WorkflowCard>
      )}
    </>
  );
}
