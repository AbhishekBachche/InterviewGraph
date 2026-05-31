import { useCallback, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { apiDelete, apiJson, formatUserError } from "../api";
import { InlineStatus, PageHeader } from "../components/PagePrimitives";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageAlerts,
  SelectField,
  useToast,
  WorkflowCard,
} from "../components/ui";
import { useClipboard } from "../lib/hooks/useClipboard";

function envCandidateBase(): string {
  const a = (import.meta.env as { VITE_JD_TEST_PUBLIC_BASE_URL?: string }).VITE_JD_TEST_PUBLIC_BASE_URL?.trim();
  const b = (import.meta.env as { VITE_PUBLIC_API_URL?: string }).VITE_PUBLIC_API_URL?.trim();
  return (a || b || "").replace(/\/+$/, "");
}

function resolveAssessmentLinkBase(serverBase?: string | null): string {
  const fromServer = (serverBase || "").trim().replace(/\/+$/, "");
  if (fromServer) return fromServer;
  const fromVite = envCandidateBase();
  if (fromVite) return fromVite;
  if (typeof window !== "undefined" && window.location?.origin)
    return window.location.origin.replace(/\/+$/, "");
  return "http://127.0.0.1:8003";
}

type GenerateResponse = {
  success?: boolean;
  test_id: string;
  jd_name?: string;
  message?: string;
  candidate_link_base?: string | null;
  candidate_url?: string | null;
};

export default function JdTestLinks() {
  const toast = useToast();
  const { copy } = useClipboard();
  const [items, setItems] = useState<{ stem: string; jd_name: string }[]>([]);
  const [stem, setStem] = useState("");
  const [tests, setTests] = useState<{ test_id: string; jd_name: string; created_at: string }[]>([]);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [candidateBase, setCandidateBase] = useState(() => resolveAssessmentLinkBase(null));
  const [deleteTestId, setDeleteTestId] = useState<string | null>(null);

  async function copyLink(link: string) {
    setErr("");
    const success = await copy(link);
    if (success) {
      setOk("Link copied.");
      toast.success("Assessment link copied.");
    } else {
      setErr("Could not copy automatically. Please copy manually.");
    }
  }

  const refresh = useCallback(async () => {
    const r = await apiJson<{ items: { stem: string; jd_name: string }[] }>("/api/jd-store");
    setItems(r.items);
    const t = await apiJson<{
      tests: typeof tests;
      candidate_link_base?: string | null;
    }>("/api/jd-tests/list");
    setTests(t.tests);
    setCandidateBase(resolveAssessmentLinkBase(t.candidate_link_base));
    return r.items;
  }, []);

  const generateForStem = useCallback(
    async (s: string) => {
      if (!s) return;
      setErr("");
      setOk("");
      setBusy(true);
      try {
        const j = await apiJson<GenerateResponse>(`/api/jd-tests/generate/${encodeURIComponent(s)}`, {
          method: "POST",
          body: "{}",
        });
        const base = resolveAssessmentLinkBase(j.candidate_link_base);
        setCandidateBase(base);
        const link =
          j.candidate_url && /^https?:\/\//i.test(j.candidate_url.trim())
            ? j.candidate_url.trim()
            : `${base}/t/${j.test_id}`;
        setLastLink(link);
        setOk(j.message || "Assessment link ready.");
        toast.success("Assessment link generated.");
        await copy(link);
        await refresh();
      } catch (e) {
        setErr(formatUserError(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh, copy, toast]
  );

  useEffect(() => {
    refresh()
      .then((loaded) => {
        if (loaded?.length) {
          setStem((prev) => (prev ? prev : loaded[0].stem));
        }
      })
      .catch((e) => setErr(formatUserError(e)));
  }, [refresh]);

  async function removeTest(testId: string) {
    setErr("");
    setOk("");
    try {
      const res = await apiDelete<{ message?: string }>(`/api/jd-tests/${encodeURIComponent(testId)}`);
      setLastLink(null);
      setOk(res.message || "Assessment deleted.");
      toast.success("Assessment deleted.");
      setDeleteTestId(null);
      await refresh();
    } catch (e) {
      setErr(formatUserError(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Candidate Assessments"
        description="Generate and manage candidate assessment links from your saved job descriptions."
      />
      <PageAlerts error={err} success={ok || undefined} />

      <WorkflowCard
        step="Step 1"
        title="Generate assessment link"
        footer={
          <Button type="button" disabled={busy || !stem} loading={busy} onClick={() => void generateForStem(stem)}>
            Generate assessment link
          </Button>
        }
      >
        {items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No saved job descriptions"
            description="Save a JD in Interview Intelligence before generating assessments."
            actionLink={{ label: "Interview Intelligence", to: "/interview" }}
          />
        ) : (
          <SelectField
            label="Saved job description"
            value={stem}
            onChange={setStem}
            options={items.map((i) => ({ value: i.stem, label: i.jd_name }))}
          />
        )}
        {busy && <InlineStatus tone="loading">Generating assessment…</InlineStatus>}
        {lastLink && !busy && (
          <div className="assessment-latest-link">
            <span className="assessment-latest-link__label">Latest generated link</span>
            <div className="assessment-latest-link__row">
              <a href={lastLink} target="_blank" rel="noreferrer" className="he-breadcrumbs__link">
                {lastLink}
              </a>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyLink(lastLink)}>
                Copy link
              </Button>
            </div>
          </div>
        )}
      </WorkflowCard>

      <WorkflowCard step="Step 2" title="Active assessments">
        {tests.length === 0 ? (
          <EmptyState compact title="No assessments yet" description="Generate a link above to share with candidates." />
        ) : (
          <ul className="assessment-list">
            {tests.map((t) => (
              <li key={t.test_id}>
                <div className="assessment-list__left">
                  <strong className="assessment-list__title">{t.jd_name}</strong>
                  <span className="assessment-list__meta">{t.created_at}</span>
                </div>
                <div className="assessment-list__actions">
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                  >
                    <a href={`${candidateBase}/t/${t.test_id}`} target="_blank" rel="noreferrer">
                      Open link
                    </a>
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyLink(`${candidateBase}/t/${t.test_id}`)}>
                    Copy
                  </Button>
                  <Button type="button" variant="danger" size="sm" onClick={() => setDeleteTestId(t.test_id)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </WorkflowCard>

      <ConfirmDialog
        open={!!deleteTestId}
        onClose={() => setDeleteTestId(null)}
        onConfirm={() => deleteTestId && void removeTest(deleteTestId)}
        title="Delete assessment?"
        description="Removes this assessment and all candidate submissions."
        confirmLabel="Delete"
        variant="danger"
      />
    </>
  );
}
