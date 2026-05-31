import { useEffect, useMemo, useState } from "react";
import { Database } from "lucide-react";
import { apiDelete, apiJson, apiUrl, formatUserError, getAccessToken } from "../api";
import { PageHeader } from "../components/PagePrimitives";
import {
  Button,
  ConfirmDialog,
  DataGrid,
  EmptyState,
  FilterToolbar,
  PageAlerts,
  PageStack,
  TablePagination,
  UserSelectBar,
  useToast,
} from "../components/ui";
import { useAsyncAction } from "../lib/hooks/useAsyncAction";

type PageUsage = {
  path: string;
  duration_seconds: number;
  visible_seconds: number;
  sessions: number;
};

type UserUsage = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  total_seconds: number;
  visible_seconds: number;
  pages: PageUsage[];
};

type Artifact = {
  category: string;
  path: string;
  relative_path: string;
  filename: string;
  extension: string;
  size_bytes: number;
  updated_at: string;
  expires_at?: string | null;
};

type DataHubResponse = {
  users: UserUsage[];
  artifacts: Record<string, Artifact[]>;
  retention_policy: { auto_delete_after_days: number; file_types: string[] };
};

type UserFeedResponse = {
  user: UserUsage;
  pages: PageUsage[];
  artifacts: Record<string, Artifact[]>;
};

const CATEGORY_LABELS: Record<string, string> = {
  parsed_resume_outputs: "Parsed resume outputs",
  parsed_resume_outputs_pdf_pipeline: "Parsed resume outputs (PDF pipeline)",
  jd_matcher_reports: "JD matcher reports",
  jd_qa_exports: "Interview QA exports",
  interview_reports: "Interview reports",
  interview_transcripts: "Interview transcripts",
  legacy_shared_parsed_resume_outputs: "Legacy shared · parsed resume outputs",
  legacy_shared_parsed_resume_outputs_pdf_pipeline: "Legacy shared · parsed (PDF pipeline)",
  legacy_shared_jd_matcher_reports: "Legacy shared · JD matcher reports",
  legacy_shared_jd_qa_exports: "Legacy shared · Interview QA exports",
  legacy_shared_interview_reports: "Legacy shared · interview reports",
  legacy_shared_interview_transcripts: "Legacy shared · interview transcripts",
};

function fmtBytes(bytes: number): string {
  const b = Math.max(0, Number(bytes || 0));
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

export default function DataHub() {
  const [data, setData] = useState<DataHubResponse | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [feed, setFeed] = useState<UserFeedResponse | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [extFilter, setExtFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Artifact | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const toast = useToast();
  const overview = useAsyncAction();
  const deleteAction = useAsyncAction();

  async function loadOverview() {
    const raw = await apiJson<DataHubResponse>("/api/data-hub/overview");
    const users = Array.isArray(raw.users) ? raw.users : [];
    const artifacts =
      raw.artifacts && typeof raw.artifacts === "object" && !Array.isArray(raw.artifacts)
        ? raw.artifacts
        : {};
    const rp = raw.retention_policy;
    const retention = {
      auto_delete_after_days:
        rp && typeof rp.auto_delete_after_days === "number" ? rp.auto_delete_after_days : 30,
      file_types: rp && Array.isArray(rp.file_types) ? rp.file_types : [".xlsx", ".pdf", ".txt"],
    };
    const out: DataHubResponse = { users, artifacts, retention_policy: retention };
    setData(out);
    const first = users[0]?.id || "";
    setSelectedUserId((prev) => (prev && users.some((u) => u.id === prev) ? prev : first));
  }

  async function loadFeed(userId: string) {
    if (!userId) {
      setFeed(null);
      return;
    }
    const raw = await apiJson<UserFeedResponse>(`/api/data-hub/user/${encodeURIComponent(userId)}`);
    const user = raw.user;
    const pages = Array.isArray(raw.pages) ? raw.pages : [];
    const artifacts =
      raw.artifacts && typeof raw.artifacts === "object" && !Array.isArray(raw.artifacts)
        ? raw.artifacts
        : {};
    if (!user?.id) {
      setFeed(null);
      return;
    }
    setFeed({ user, pages, artifacts });
  }

  useEffect(() => {
    void overview.run(loadOverview);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedUserId) {
        setFeed(null);
        return;
      }
      setFeedBusy(true);
      try {
        if (!cancelled) await loadFeed(selectedUserId);
      } catch (e) {
        if (!cancelled) overview.setError(formatUserError(e));
      } finally {
        if (!cancelled) setFeedBusy(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedUserId]);

  const allArtifacts = useMemo(
    () =>
      Object.entries(feed?.artifacts || {}).flatMap(([cat, rows]) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({ ...r, category: cat }))
      ),
    [feed?.artifacts]
  );
  const categoryOptions = useMemo(() => Array.from(new Set(allArtifacts.map((a) => a.category))).sort(), [allArtifacts]);
  const extOptions = useMemo(() => Array.from(new Set(allArtifacts.map((a) => a.extension || ""))).sort(), [allArtifacts]);
  const filteredArtifacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allArtifacts.filter((a) => {
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (extFilter !== "all" && (a.extension || "") !== extFilter) return false;
      if (!q) return true;
      return `${a.filename} ${a.relative_path} ${a.category}`.toLowerCase().includes(q);
    });
  }, [allArtifacts, categoryFilter, extFilter, search]);
  const totalPages = Math.max(1, Math.ceil(filteredArtifacts.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedArtifacts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredArtifacts.slice(start, start + pageSize);
  }, [filteredArtifacts, currentPage]);

  useEffect(() => {
    setPage(1);
  }, [selectedUserId, categoryFilter, extFilter, search]);

  const err = overview.error || deleteAction.error;

  function downloadArtifact(a: Artifact) {
    const token = getAccessToken();
    const url = `${apiUrl("/api/data-hub/download")}?path=${encodeURIComponent(a.path)}`;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Download failed (${r.status})`);
        const blob = await r.blob();
        const href = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = href;
        link.download = a.filename;
        link.click();
        URL.revokeObjectURL(href);
        toast.success(`Downloaded ${a.filename}`);
      })
      .catch((e) => overview.setError(formatUserError(e)));
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const a = deleteTarget;
    const ok = await deleteAction.run(async () => {
      await apiDelete(`/api/data-hub/artifact?path=${encodeURIComponent(a.path)}`);
      await loadOverview();
      if (selectedUserId) await loadFeed(selectedUserId);
    });
    if (ok !== null) {
      toast.success(`Deleted ${a.filename}`);
      setDeleteTarget(null);
    }
  }

  const emptyTitle =
    !feedBusy && feed && allArtifacts.length === 0
      ? "No files for this user"
      : !feedBusy && feed && filteredArtifacts.length === 0
        ? "No matching files"
        : "No data";

  const emptyDescription =
    allArtifacts.length === 0
      ? "Exports from Resume Parser, JD Matcher, and other tools appear here after you run workflows."
      : "Try clearing filters or changing the search term.";

  return (
    <>
      <PageHeader
        title="Data Hub"
        description="Structured access to team outputs and retained artifacts. All authenticated users can browse the organization catalog."
      />
      <PageAlerts error={err} />
      {overview.busy && !data && <p className="page-sub">Loading shared data…</p>}
      {!overview.busy && data && (
        <PageStack>
          <UserSelectBar
            label="Select user"
            users={(data.users ?? []).map((u) => ({
              id: u.id,
              label: `${u.full_name || u.email}${u.role === "admin" ? " · Admin" : ""}`,
            }))}
            value={selectedUserId}
            onChange={setSelectedUserId}
            busy={feedBusy}
          />

          <FilterToolbar>
            <select className="he-input he-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c] || c.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <select className="he-input he-select" value={extFilter} onChange={(e) => setExtFilter(e.target.value)}>
              <option value="all">All file types</option>
              {extOptions.map((ext) => (
                <option key={ext || "none"} value={ext}>
                  {ext || "no extension"}
                </option>
              ))}
            </select>
            <input
              type="search"
              className="he-input"
              placeholder="Search by file name or path"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </FilterToolbar>

          <DataGrid
            className="datahub-table-card"
            title="Selected user files and artifacts"
            subtitle={
              <p className="page-sub u-mt-0">
                Auto-delete: {(data.retention_policy?.file_types ?? []).join(", ") || "—"} removed after{" "}
                {data.retention_policy?.auto_delete_after_days ?? 30} days.
              </p>
            }
            loading={feedBusy}
            columns={[
              { key: "file", header: "File", render: (a) => <span title={a.relative_path}>{a.filename}</span> },
              { key: "size", header: "Size", render: (a) => fmtBytes(a.size_bytes) },
              {
                key: "updated",
                header: "Updated",
                render: (a) => (a.updated_at ? new Date(a.updated_at).toLocaleString() : "—"),
              },
              {
                key: "expires",
                header: "Expires",
                render: (a) => (a.expires_at ? new Date(a.expires_at).toLocaleDateString() : "—"),
              },
              {
                key: "actions",
                header: "Actions",
                render: (a) => (
                  <div className="admin-actions-inline">
                    <Button type="button" variant="outline" size="sm" onClick={() => downloadArtifact(a)}>
                      Download
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={deleteAction.busy && deleteTarget?.path === a.path}
                      onClick={() => setDeleteTarget(a)}
                    >
                      Delete
                    </Button>
                  </div>
                ),
              },
            ]}
            rows={pagedArtifacts}
            rowKey={(a) => `${a.category}:${a.path}`}
            emptyTitle={emptyTitle}
            emptyDescription={emptyDescription}
            emptyAction={
              allArtifacts.length === 0
                ? { label: "Open Resume Parser", onClick: () => window.location.assign("/") }
                : undefined
            }
          />

          {filteredArtifacts.length > 0 && (
            <TablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setPage}
              meta={`Page ${currentPage} of ${totalPages} · ${filteredArtifacts.length} file(s)`}
            />
          )}

          {!feedBusy && (data.users ?? []).length === 0 && (
            <EmptyState
              icon={Database}
              className="he-empty-state--panel"
              title="No users in workspace"
              description="User activity will appear once recruiters sign in and use the tools."
            />
          )}
        </PageStack>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        title="Delete artifact?"
        description={
          deleteTarget ? (
            <>
              Permanently remove <strong>{deleteTarget.filename}</strong> from Data Hub? This cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteAction.busy}
      />
    </>
  );
}
