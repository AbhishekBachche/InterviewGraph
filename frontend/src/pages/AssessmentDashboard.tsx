import { useCallback, useEffect, useState } from "react";
import { ApiError, apiJson, apiJsonFromOrigin, formatUserError } from "../api";
import { InlineStatus, PageHeader } from "../components/PagePrimitives";
import { ClipboardList } from "lucide-react";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  FilterToolbar,
  MetricGrid,
  MetricSkeleton,
  Modal,
  PageAlerts,
  PageStack,
  StatusBadge,
  statusToneFromLabel,
  TextAreaField,
  TextField,
  useToast,
} from "../components/ui";

type AttemptSummary = {
  result_id: string;
  test_id: string;
  jd_name: string;
  submitted_at: string;
  mcq_score: number;
  mcq_total: number;
  subjective_count: number;
  percent: number | null;
  overall_status?: string | null;
  overall_pass?: boolean | null;
  subjective_avg_percent?: number | null;
};

type CandidateGroup = {
  candidate_key: string;
  candidate_name: string;
  attempt_count: number;
  latest_submitted_at: string;
  best_mcq_percent: number | null;
  attempts: AttemptSummary[];
};

type DashboardPayload = {
  total_candidates: number;
  total_attempts: number;
  candidates: CandidateGroup[];
};

type BreakdownLine = {
  question_id?: string;
  question_type?: string;
  question?: string;
  is_correct?: boolean | null;
  selected_index?: number | null;
  correct_index?: number | null;
  response_text?: string;
  grading_notes?: string;
  subjective_score?: number | null;
  subjective_pass?: boolean | null;
  eval_comment?: string;
  evaluation_source?: string;
  reviewer_note?: string;
  manually_reviewed?: boolean;
};

type ResultDetail = {
  result_id: string;
  candidate_name: string;
  jd_name: string;
  submitted_at: string;
  mcq_score: number;
  mcq_total: number;
  subjective_count: number;
  percent: number;
  breakdown: BreakdownLine[];
  overall_status?: string | null;
  overall_pass?: boolean | null;
  subjective_avg_percent?: number | null;
  mcq_pass?: boolean;
  subjective_evaluation_source?: string;
};

/** Prefer `/t/api/...` (same proxy rule as candidate tests); `/api/...` is fallback if the server only exposes that. */
const DASHBOARD_PRIMARY = "/t/api/assessments/dashboard";
const DASHBOARD_FALLBACK = "/api/assessments/dashboard";
const submissionPrimary = (id: string) =>
  `/t/api/assessments/submissions/${encodeURIComponent(id)}`;
const submissionFallback = (id: string) =>
  `/api/assessments/submissions/${encodeURIComponent(id)}`;
const reviewPrimary = (id: string) =>
  `/t/api/assessments/submissions/${encodeURIComponent(id)}/review`;
const reviewFallback = (id: string) =>
  `/api/assessments/submissions/${encodeURIComponent(id)}/review`;
const deletePrimary = (id: string) =>
  `/t/api/assessments/submissions/${encodeURIComponent(id)}`;
const deleteFallback = (id: string) =>
  `/api/assessments/submissions/${encodeURIComponent(id)}`;

export default function AssessmentDashboard() {
  const toast = useToast();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResultDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [reviewSavingQid, setReviewSavingQid] = useState<string | null>(null);
  const [deletingResultId, setDeletingResultId] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, { score: string; pass: boolean; note: string }>
  >({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr("");
    setBusy(true);
    try {
      let d: DashboardPayload;
      try {
        d = await apiJsonFromOrigin<DashboardPayload>(DASHBOARD_PRIMARY);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          d = await apiJson<DashboardPayload>(DASHBOARD_FALLBACK);
        } else {
          throw e;
        }
      }
      setData(d);
    } catch (e) {
      setData(null);
      setErr(formatUserError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }
    setDetailErr("");
    setDetailBusy(true);
    void (async () => {
      try {
        try {
          const row = await apiJsonFromOrigin<ResultDetail>(submissionPrimary(detailId));
          setDetail(row);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            setDetail(await apiJson<ResultDetail>(submissionFallback(detailId)));
          } else {
            throw e;
          }
        }
      } catch (e) {
        setDetailErr(formatUserError(e));
      } finally {
        setDetailBusy(false);
      }
    })();
  }, [detailId]);

  useEffect(() => {
    if (!detail) {
      setReviewDrafts({});
      return;
    }
    const d: Record<string, { score: string; pass: boolean; note: string }> = {};
    for (const line of detail.breakdown || []) {
      if (line.question_type !== "subjective" || !line.question_id) continue;
      d[line.question_id] = {
        score:
          line.subjective_score != null && !Number.isNaN(Number(line.subjective_score))
            ? String(line.subjective_score)
            : "",
        pass: Boolean(line.subjective_pass),
        note: line.reviewer_note || "",
      };
    }
    setReviewDrafts(d);
  }, [detail]);

  const filtered =
    data?.candidates.filter((c) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return c.candidate_name.toLowerCase().includes(q);
    }) ?? [];

  const handleDeleteAttempt = useCallback(
    async (resultId: string) => {
      setErr("");
      setDetailErr("");
      setDeletingResultId(resultId);
      try {
        try {
          await apiJsonFromOrigin(deletePrimary(resultId), { method: "DELETE" });
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            await apiJson(deleteFallback(resultId), { method: "DELETE" });
          } else {
            throw e;
          }
        }
        if (detailId === resultId) {
          setDetailId(null);
        }
        await load();
        toast.success("Submission deleted.");
        setConfirmDeleteId(null);
      } catch (e) {
        const msg = formatUserError(e);
        setErr(msg);
        if (detailId === resultId) setDetailErr(msg);
      } finally {
        setDeletingResultId(null);
      }
    },
    [detailId, load, toast]
  );

  return (
    <>
      <PageHeader
        title="Assessment Results"
        description={
          <>
            Only candidates who <strong>submitted</strong> a test appear here (opened-but-not-submitted sessions are
            not listed). MCQ scores are shown; written answers use rubric-based auto-scoring (LLM when Azure is
            configured) and can be overridden in details.
          </>
        }
      />

      <PageAlerts error={err} />

      <PageStack>
        {busy && <MetricSkeleton count={2} />}

        {data && !busy && (
          <MetricGrid
            columns={2}
            items={[
              { label: "Total attempts", value: data.total_attempts },
              { label: "Unique candidates", value: data.total_candidates },
            ]}
          />
        )}

        <FilterToolbar
          label="Filter candidates"
          variant="bar"
          actions={
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void load()}>
              Refresh
            </Button>
          }
        >
          <input
            type="search"
            className="he-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by candidate name…"
            aria-label="Filter by candidate name"
          />
        </FilterToolbar>

        {!busy && data && filtered.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            className="he-empty-state--panel"
            title={data.total_attempts === 0 ? "No submissions yet" : "No matching candidates"}
            description={
              data.total_attempts === 0
                ? "Generate an assessment from Assessments and share the candidate link."
                : "Try a different search term."
            }
            actionLink={data.total_attempts === 0 ? { label: "Assessments", to: "/jd-tests" } : undefined}
          />
        )}

        {filtered.map((c) => (
          <DataGrid
            key={c.candidate_key}
            title={c.candidate_name}
            subtitle={
              <div className="he-candidate-meta">
                <span>
                  {c.attempt_count} attempt{c.attempt_count === 1 ? "" : "s"}
                </span>
                {c.best_mcq_percent != null ? (
                  <span className="he-score-pill">Best MCQ: {c.best_mcq_percent}%</span>
                ) : null}
                <span>Latest: {c.latest_submitted_at || "—"}</span>
              </div>
            }
            rows={c.attempts}
            rowKey={(a) => a.result_id}
            tableClassName="admin-user-table"
            columns={[
              { key: "submitted", header: "Submitted (UTC)", render: (a) => a.submitted_at },
              { key: "jd", header: "Assessment / JD", render: (a) => a.jd_name || "—" },
              {
                key: "mcq",
                header: "MCQ score",
                render: (a) =>
                  a.mcq_total > 0 ? (
                    <>
                      {a.mcq_score} / {a.mcq_total}
                    </>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "percent",
                header: "MCQ %",
                render: (a) => (a.percent != null ? `${a.percent}%` : "—"),
              },
              {
                key: "written",
                header: "Written avg",
                render: (a) => (
                  <>
                    {a.subjective_avg_percent != null && !Number.isNaN(Number(a.subjective_avg_percent))
                      ? `${a.subjective_avg_percent}%`
                      : "—"}{" "}
                    <span className="he-candidate-meta">({a.subjective_count})</span>
                  </>
                ),
              },
              {
                key: "result",
                header: "Result",
                render: (a) => (
                  <StatusBadge tone={statusToneFromLabel(a.overall_status)}>
                    {a.overall_status || "—"}
                  </StatusBadge>
                ),
              },
              {
                key: "actions",
                header: "",
                render: (a) => (
                  <div className="admin-actions-inline">
                    <Button type="button" variant="outline" size="sm" onClick={() => setDetailId(a.result_id)}>
                      Details
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={deletingResultId === a.result_id}
                      onClick={() => setConfirmDeleteId(a.result_id)}
                    >
                      Delete
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        ))}
      </PageStack>

      <Modal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        title="Submission detail"
        size="xl"
        subtitle={
          detail ? `${detail.candidate_name} · ${detail.jd_name} · ${detail.submitted_at}` : undefined
        }
      >
        {detailBusy && <InlineStatus tone="loading">Loading submission…</InlineStatus>}
        {detailErr ? <Alert tone="error">{detailErr}</Alert> : null}
        {detail && !detailBusy && (
          <>
            <p className="page-sub u-mt-0">
              <strong>MCQ:</strong> {detail.mcq_score} / {detail.mcq_total} ({detail.percent}%)
              {detail.mcq_pass === false ? (
                <StatusBadge tone="danger">Below pass threshold</StatusBadge>
              ) : null}{" "}
              · <strong>Written avg:</strong>{" "}
              {detail.subjective_avg_percent != null ? `${detail.subjective_avg_percent}%` : "—"} ·{" "}
              <strong>Overall:</strong>{" "}
              <StatusBadge tone={statusToneFromLabel(detail.overall_status)}>
                {detail.overall_status || "—"}
              </StatusBadge>
              {detail.subjective_evaluation_source ? (
                <span className="he-modal-meta">
                  {" "}
                  (auto: {detail.subjective_evaluation_source}
                  {detail.subjective_evaluation_source === "heuristic" ? " — confirm in review" : ""})
                </span>
              ) : null}
            </p>
            <ol className="he-assessment-breakdown">
              {(detail.breakdown || []).map((line, i) => (
                <li key={i} className="he-breakdown-item">
                  <span className="he-score-pill">
                    {line.question_type === "subjective" ? "Written" : "MCQ"}
                  </span>
                  <p className="breakdown-q">{line.question}</p>
                  {line.question_type === "subjective" ? (
                    <>
                      {line.subjective_score != null ? (
                        <p className="page-sub u-mt-0 u-mb-sm">
                          <strong>Score:</strong> {line.subjective_score}% —{" "}
                          <StatusBadge tone={line.subjective_pass ? "success" : "danger"}>
                            {line.subjective_pass ? "Pass" : "Fail"}
                          </StatusBadge>
                          {line.manually_reviewed ? (
                            <span className="he-modal-meta"> (manually reviewed)</span>
                          ) : null}
                        </p>
                      ) : (line.response_text || "").trim() ? (
                        <Alert tone="info">No automated score on file. Use recruiter review below.</Alert>
                      ) : null}
                      {line.eval_comment ? (
                        <p className="page-sub u-mt-0 u-mb-sm">
                          <strong>Evaluation:</strong> {line.eval_comment}
                        </p>
                      ) : null}
                      <p className="page-sub assessment-label-sm">Response</p>
                      <pre className="he-breakdown-pre">{line.response_text || "—"}</pre>
                      {line.grading_notes ? (
                        <>
                          <p className="page-sub assessment-label-sm u-mt-sm">Grading notes (internal)</p>
                          <p className="page-sub u-mt-0 u-mb-0">{line.grading_notes}</p>
                        </>
                      ) : null}
                      {line.question_id ? (
                        <div className="he-review-box">
                          <p className="page-sub assessment-label-sm u-mt-sm">Recruiter review</p>
                          <div className="he-review-box__row">
                            <div className="he-review-box__score">
                              <TextField
                              label="Score (0–100)"
                              type="number"
                              value={reviewDrafts[line.question_id]?.score ?? ""}
                              onChange={(score) =>
                                setReviewDrafts((prev) => ({
                                  ...prev,
                                  [line.question_id!]: {
                                    ...prev[line.question_id!],
                                    score,
                                    pass: prev[line.question_id!]?.pass ?? false,
                                    note: prev[line.question_id!]?.note ?? "",
                                  },
                                }))
                              }
                            />
                            </div>
                            <label className="he-form-check">
                              <input
                                type="checkbox"
                                checked={reviewDrafts[line.question_id]?.pass ?? false}
                                onChange={(e) =>
                                  setReviewDrafts((prev) => ({
                                    ...prev,
                                    [line.question_id!]: {
                                      ...prev[line.question_id!],
                                      score: prev[line.question_id!]?.score ?? "",
                                      pass: e.target.checked,
                                      note: prev[line.question_id!]?.note ?? "",
                                    },
                                  }))
                                }
                              />
                              Pass
                            </label>
                          </div>
                          <TextAreaField
                            label="Note (optional)"
                            rows={2}
                            value={reviewDrafts[line.question_id]?.note ?? ""}
                            onChange={(note) =>
                              setReviewDrafts((prev) => ({
                                ...prev,
                                [line.question_id!]: {
                                  ...prev[line.question_id!],
                                  score: prev[line.question_id!]?.score ?? "",
                                  pass: prev[line.question_id!]?.pass ?? false,
                                  note,
                                },
                              }))
                            }
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            loading={reviewSavingQid === line.question_id}
                            disabled={reviewSavingQid === line.question_id}
                            onClick={async () => {
                              const qid = line.question_id!;
                              const draft = reviewDrafts[qid];
                              if (!draft || !detailId) return;
                              const scoreNum = parseFloat(draft.score);
                              const body = {
                                question_id: qid,
                                subjective_score: Number.isFinite(scoreNum) ? scoreNum : null,
                                subjective_pass: draft.pass,
                                reviewer_note: draft.note.trim(),
                              };
                              setReviewSavingQid(qid);
                              setDetailErr("");
                              try {
                                let row: ResultDetail;
                                try {
                                  row = await apiJsonFromOrigin<ResultDetail>(reviewPrimary(detailId), {
                                    method: "POST",
                                    body: JSON.stringify(body),
                                  });
                                } catch (e) {
                                  if (e instanceof ApiError && e.status === 404) {
                                    row = await apiJson<ResultDetail>(reviewFallback(detailId), {
                                      method: "POST",
                                      body: JSON.stringify(body),
                                    });
                                  } else {
                                    throw e;
                                  }
                                }
                                setDetail(row);
                                void load();
                                toast.success("Review saved.");
                              } catch (e) {
                                setDetailErr(formatUserError(e));
                              } finally {
                                setReviewSavingQid(null);
                              }
                            }}
                          >
                            Save review
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="page-sub u-mt-0 u-mb-0">
                      <StatusBadge tone={line.is_correct ? "success" : "danger"}>
                        {line.is_correct ? "Correct" : "Incorrect"}
                      </StatusBadge>
                      <span className="he-modal-meta">
                        {" "}
                        — selected {line.selected_index ?? "—"}, answer {line.correct_index ?? "—"}
                      </span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId && void handleDeleteAttempt(confirmDeleteId)}
        title="Delete submission?"
        description="This permanently removes the candidate submission."
        confirmLabel="Delete"
        variant="danger"
        loading={!!confirmDeleteId && deletingResultId === confirmDeleteId}
      />
    </>
  );
}
