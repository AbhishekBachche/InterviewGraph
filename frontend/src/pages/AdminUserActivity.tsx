import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, apiJson, formatUserError } from "../api";
import { PageHeader } from "../components/PagePrimitives";
import {
  Breadcrumbs,
  ButtonLink,
  DataGrid,
  Card,
  CardContent,
  MetricGrid,
  PageStack,
  MetricSkeleton,
  PageAlerts,
  StatusBadge,
} from "../components/ui";

type ActivityPageRow = {
  path: string;
  duration_seconds: number;
  visible_seconds: number;
  sessions: number;
};

type ActivitySession = {
  path: string;
  duration_seconds: number;
  visible_seconds: number;
  started_at?: string | null;
  ended_at?: string | null;
  recorded_at?: string | null;
  updated_at?: string | null;
};

type NormalizedPageRow = {
  path: string;
  duration_seconds: number;
  sessions: number;
};

type ActivityResponse = {
  user: {
    id: string;
    email: string;
    full_name: string;
    role: string;
    is_active: boolean;
  };
  summary: {
    total_seconds: number;
    total_visible_seconds: number;
    pages_tracked: number;
    sessions_tracked: number;
  };
  pages: ActivityPageRow[];
  sessions: ActivitySession[];
};

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
}

function toTitleCase(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

function getDisplayName(fullName: string, email: string): string {
  const cleanFullName = (fullName || "").trim();
  if (cleanFullName) return toTitleCase(cleanFullName);

  const emailName = (email || "").split("@")[0] || "";
  const normalized = emailName.replace(/[._-]+/g, " ").replace(/\d+/g, " ").trim();
  return normalized ? toTitleCase(normalized) : "Unknown user";
}

const VALID_PAGE_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/dashboard$/,
  /^\/jd-matcher$/,
  /^\/jd-qa$/,
  /^\/interview$/,
  /^\/jd-tests$/,
  /^\/assessment-dashboard$/,
  /^\/about$/,
  /^\/data-hub$/,
  /^\/admin$/,
  /^\/admin\/users\/[^/]+$/,
];

function normalizePagePath(path: string): string | null {
  const cleanPath = (path || "").trim().split("?")[0] || "";
  if (!cleanPath) return null;
  if (!VALID_PAGE_PATTERNS.some((pattern) => pattern.test(cleanPath))) return null;
  if (/^\/admin\/users\/[^/]+$/.test(cleanPath)) return "/admin/users/:userId";
  return cleanPath;
}

function normalizePageRows(rows: ActivityPageRow[]): NormalizedPageRow[] {
  const merged = new Map<string, NormalizedPageRow>();
  for (const row of rows) {
    const key = normalizePagePath(row.path);
    if (!key) continue;
    const prev = merged.get(key);
    if (prev) {
      prev.duration_seconds += Number(row.duration_seconds || 0);
      prev.sessions += Number(row.sessions || 0);
    } else {
      merged.set(key, {
        path: key,
        duration_seconds: Number(row.duration_seconds || 0),
        sessions: Number(row.sessions || 0),
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.duration_seconds - a.duration_seconds);
}

export default function AdminUserActivity() {
  const { userId = "" } = useParams();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setBusy(true);
      setErr("");
      try {
        const out = await apiJson<ActivityResponse>(`/api/admin/users/${encodeURIComponent(userId)}/activity`);
        if (!cancelled) setData(out);
      } catch (e) {
        const msg = e instanceof ApiError ? e.detail || String(e.status) : formatUserError(e);
        if (!cancelled) setErr(msg);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    if (userId) void run();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const topPages = useMemo(() => normalizePageRows(data?.pages || []).slice(0, 50), [data?.pages]);
  const recentSessions = useMemo(() => (data?.sessions || []).slice(0, 100), [data?.sessions]);
  const displayName = useMemo(
    () => getDisplayName(data?.user.full_name || "", data?.user.email || ""),
    [data?.user.full_name, data?.user.email]
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Admin", to: "/admin" },
          { label: displayName || "User activity" },
        ]}
      />
      <PageHeader
        eyebrow="Dataeaze · Hireeaze AIOS"
        title="User activity details"
        description="Page-wise usage and total time spent for this user."
        actions={
          <ButtonLink to="/admin" variant="secondary">
            Back to Admin
          </ButtonLink>
        }
      />
      <PageAlerts error={err} />
      {busy && <MetricSkeleton count={3} />}
      {!busy && data && (
        <PageStack>
          <MetricGrid
            columns={3}
            items={[
              { label: "Total time", value: fmtDuration(data.summary.total_seconds) },
              { label: "Pages tracked", value: data.summary.pages_tracked },
              { label: "Sessions", value: data.summary.sessions_tracked },
            ]}
          />

          <Card className="he-user-activity-summary">
            <CardContent>
              <h3 className="section-title">Summary</h3>
              <p className="page-sub u-mt-0 u-mb-0">
                <strong>{displayName}</strong> ({data.user.email}) ·{" "}
                <StatusBadge tone={data.user.role === "admin" ? "primary" : "neutral"}>
                  {data.user.role === "admin" ? "Administrator" : "Recruiter"}
                </StatusBadge>{" "}
                ·{" "}
                <StatusBadge tone={data.user.is_active ? "success" : "danger"}>
                  {data.user.is_active ? "Active" : "Revoked"}
                </StatusBadge>
              </p>
              <p className="page-sub u-mb-0">
                <Link to="/data-hub" className="he-breadcrumbs__link">
                  View artifacts in Data Hub
                </Link>
              </p>
            </CardContent>
          </Card>

          <DataGrid
            title="Page-wise time spent"
            rows={topPages}
            rowKey={(p) => p.path}
            emptyTitle="No activity tracked yet"
            emptyDescription="Usage appears after the user navigates app pages while signed in."
            columns={[
              { key: "page", header: "Page", render: (p) => p.path },
              { key: "time", header: "Total time", render: (p) => fmtDuration(p.duration_seconds) },
              { key: "sessions", header: "Sessions", render: (p) => p.sessions },
            ]}
          />

          <DataGrid
            title="Recent sessions"
            rows={recentSessions}
            rowKey={(s, idx) => `${s.path}-${s.recorded_at || s.updated_at || idx}`}
            emptyTitle="No session records"
            emptyDescription="Session telemetry is recorded when users spend time on each page."
            columns={[
              { key: "page", header: "Page", render: (s) => s.path },
              { key: "duration", header: "Duration", render: (s) => fmtDuration(s.duration_seconds) },
              {
                key: "ended",
                header: "Ended at",
                render: (s) => (s.ended_at ? new Date(s.ended_at).toLocaleString() : "—"),
              },
            ]}
          />
        </PageStack>
      )}
    </>
  );
}
