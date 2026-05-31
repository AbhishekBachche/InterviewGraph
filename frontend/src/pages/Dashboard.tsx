import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  Database,
  FileText,
  LayoutDashboard,
  MessageSquareText,
  Mic2,
} from "lucide-react";
import { apiJson } from "../api";
import { InlineStatus, PageHeader } from "../components/PagePrimitives";
import {
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardFooter,
  EmptyState,
  MetricGrid,
  MetricSkeleton,
  PageAlerts,
  PageStack,
  StatusBadge,
  useToast,
  WorkflowCard,
} from "../components/ui";
import { useAsyncAction } from "../lib/hooks/useAsyncAction";
import { ASSESSMENTS_ENABLED } from "../featureFlags";

type SummaryCounts = {
  parsed_html_excels: number;
  parsed_pdf_excels: number;
  comparison_excels: number;
  jd_qa_pdfs: number;
  saved_jds: number;
  assessment_tests: number;
  assessment_submissions: number;
  interview_reports_pdf: number;
  interview_raw_json: number;
};

type AssessmentsBlock = {
  total_candidates: number;
  total_attempts: number;
  candidates: unknown[];
};

type DashboardPayload = {
  user: { email: string; full_name: string; role: string };
  counts: SummaryCounts;
  assessments: AssessmentsBlock;
};

type StatItem = {
  key: keyof SummaryCounts;
  label: string;
};

const statItems: StatItem[] = [
  { key: "parsed_html_excels", label: "HTML resume workbooks" },
  { key: "parsed_pdf_excels", label: "PDF resume workbooks" },
  { key: "comparison_excels", label: "JD comparison exports" },
  { key: "jd_qa_pdfs", label: "Interview QA PDFs" },
  { key: "saved_jds", label: "Saved job descriptions" },
  ...(ASSESSMENTS_ENABLED
    ? ([
        { key: "assessment_tests", label: "Active assessments" },
        { key: "assessment_submissions", label: "Assessment submissions" },
      ] as StatItem[])
    : []),
];

const quickActions: { to: string; label: string; hint: string; icon: LucideIcon }[] = [
  { to: "/", label: "Resume Parser", hint: "Parse HTML & PDF resumes", icon: FileText },
  { to: "/jd-matcher", label: "JD Matcher", hint: "Compare candidates to JDs", icon: ClipboardList },
  { to: "/jd-qa", label: "Interview QA", hint: "Build Q&A from JD or free-form ask", icon: MessageSquareText },
  { to: "/interview", label: "Interview Intelligence", hint: "Analyze interview recordings", icon: Mic2 },
  { to: "/data-hub", label: "Data Hub", hint: "Browse workspace exports", icon: Database },
];

function displayName(payload: DashboardPayload): string {
  const name = payload.user.full_name?.trim();
  if (name) return name;
  const email = payload.user.email || "";
  return email.includes("@") ? email.split("@")[0] : email || "there";
}

function allCountsZero(counts: SummaryCounts): boolean {
  return (
    counts.parsed_html_excels === 0 &&
    counts.parsed_pdf_excels === 0 &&
    counts.comparison_excels === 0 &&
    counts.jd_qa_pdfs === 0 &&
    counts.saved_jds === 0
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const toast = useToast();
  const { busy, error, run } = useAsyncAction({
    onSuccess: (msg) => {
      if (msg) toast.success(msg);
    },
  });

  const load = useCallback(async () => {
    const d = await run(() => apiJson<DashboardPayload>("/api/dashboard/summary"));
    if (d) setData(d);
    else setData(null);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
    if (!error) toast.info("Dashboard updated.");
  }, [load, error, toast]);

  return (
    <>
      <PageHeader
        eyebrow="Dataeaze · Hireeaze AIOS"
        title="Dashboard"
        description="Your recruiting workspace at a glance — open a tool below or review activity counts."
        actions={
          <Button type="button" variant="secondary" onClick={() => void refresh()} disabled={busy} loading={busy && !!data}>
            Refresh
          </Button>
        }
      />

      <PageAlerts error={error} />

      <PageStack>
        {busy && !data && <MetricSkeleton count={statItems.length} />}
        {busy && data && <InlineStatus tone="loading">Updating summary…</InlineStatus>}

        {!busy && !data && error && (
          <EmptyState
            className="he-empty-state--panel"
            title="Could not load dashboard"
            description={error}
            action={{ label: "Try again", onClick: () => void load() }}
          />
        )}

        {data && (
          <>
            {allCountsZero(data.counts) ? (
              <EmptyState
                className="he-empty-state--panel"
                title="No workspace activity yet"
                description="Start by parsing resumes or saving a job description — counts will appear here as you work."
                actionLink={{ label: "Open Resume Parser", to: "/" }}
                secondaryAction={{ label: "Browse Data Hub", onClick: () => window.location.assign("/data-hub") }}
              />
            ) : (
              <MetricGrid
                items={statItems.map(({ key, label }) => ({
                  label,
                  value: data.counts[key],
                }))}
              />
            )}

            <WorkflowCard step="Quick actions" title="Open a tool" description="Jump to the most used recruiting workflows.">
              <div className="he-dashboard-quick-grid">
                {quickActions.map(({ to, label, hint, icon: Icon }) => (
                  <Link key={to} to={to} className="he-dashboard-quick-card">
                    <span className="he-dashboard-quick-card__icon" aria-hidden>
                      <Icon size={22} strokeWidth={1.75} />
                    </span>
                    <span>
                      <span className="he-dashboard-quick-card__label">{label}</span>
                      <span className="he-dashboard-quick-card__hint">{hint}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </WorkflowCard>

            {ASSESSMENTS_ENABLED && (
              <Card>
                <CardContent>
                  <h3 className="section-title">Assessments overview</h3>
                  <p className="page-sub u-mt-0">
                    <strong>{data.assessments.total_attempts}</strong> completed attempt
                    {data.assessments.total_attempts === 1 ? "" : "s"} across{" "}
                    <strong>{data.assessments.total_candidates}</strong> unique candidate name
                    {data.assessments.total_candidates === 1 ? "" : "s"}.
                  </p>
                </CardContent>
                <CardFooter>
                  <ButtonLink to="/assessment-dashboard" variant="secondary" size="sm">
                    Open full assessment dashboard
                  </ButtonLink>
                </CardFooter>
              </Card>
            )}
          </>
        )}
      </PageStack>
    </>
  );
}
