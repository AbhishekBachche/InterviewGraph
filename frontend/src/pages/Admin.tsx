import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiJson, formatUserError } from "../api";
import { useAuth } from "../contexts/AuthContext";
import { computeAdminStats, countPendingRequests } from "../lib/admin";
import { PageHeader } from "../components/PagePrimitives";
import {
  ActionRow,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataGrid,
  FormField,
  MetricGrid,
  MetricSkeleton,
  NativeSelect,
  PageAlerts,
  PageStack,
  StatusBadge,
  TextField,
  useToast,
} from "../components/ui";

type WorkspaceCounts = Record<string, number>;

type AdminUserRow = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_online?: boolean;
  last_seen_at?: string | null;
  activity_total_seconds?: number;
  workspace: WorkspaceCounts;
};

type AccessRequestRow = {
  id: number;
  full_name: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string;
  created_at: string | null;
};

export default function Admin() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<AccessRequestRow[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [requestActionId, setRequestActionId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newActive, setNewActive] = useState(true);
  const [createBusy, setCreateBusy] = useState(false);

  function errorText(e: unknown): string {
    if (e instanceof ApiError) return e.detail || `Request failed (${e.status})`;
    return formatUserError(e);
  }

  const load = useCallback(async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await apiJson<{ users: AdminUserRow[] }>("/api/admin/users");
      setRows(r.users);
      const q = await apiJson<{ requests: AccessRequestRow[] }>("/api/admin/access-requests");
      setRequests(q.requests);
    } catch (e) {
      setRows([]);
      setRequests([]);
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setAccess(userId: string, active: boolean) {
    setErr("");
    setActingId(userId);
    try {
      await apiJson(`/api/admin/users/${encodeURIComponent(userId)}/access`, {
        method: "POST",
        body: JSON.stringify({ active }),
      });
      await load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setActingId(null);
    }
  }

  function openUserActivity(userId: string) {
    window.open(`/admin/users/${encodeURIComponent(userId)}`, "_blank", "noopener,noreferrer");
  }

  async function reviewRequest(requestId: number, status: "approved" | "rejected") {
    setErr("");
    setRequestActionId(requestId);
    try {
      await apiJson(`/api/admin/access-requests/${requestId}/action`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setRequestActionId(null);
    }
  }

  async function setRole(userId: string, role: string) {
    if (role !== "user" && role !== "admin") return;
    setErr("");
    setActingId(userId);
    try {
      await apiJson(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        method: "POST",
        body: JSON.stringify({ role }),
      });
      await load();
      toast.success(`Role updated to ${role}.`);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setActingId(null);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const hasMinLen = newPassword.length >= 8;
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasDigit = /\d/.test(newPassword);
    const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
    if (!newName.trim() || !newEmail.trim()) {
      setErr("Name and email are required.");
      return;
    }
    if (!hasMinLen || !hasUpper || !hasLower || !hasDigit || !hasSpecial) {
      setErr("Password must be 8+ chars with uppercase, lowercase, number, and special character.");
      return;
    }
    setCreateBusy(true);
    try {
      await apiJson("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          full_name: newName.trim(),
          email: newEmail.trim(),
          password: newPassword,
          is_active: newActive,
        }),
      });
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setShowNewPassword(false);
      setNewActive(true);
      await load();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setCreateBusy(false);
    }
  }

  async function deleteUser(userId: string) {
    setErr("");
    setActingId(userId);
    try {
      await apiJson(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      await load();
      toast.success("User account deleted.");
      setConfirmDeleteUserId(null);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setActingId(null);
    }
  }

  const stats = useMemo(() => computeAdminStats(rows), [rows]);
  const pendingRequests = useMemo(() => countPendingRequests(requests), [requests]);

  return (
    <>
      <PageHeader
        eyebrow="Dataeaze · Hireeaze AIOS"
        title="Admin"
        description={
          user?.email ? (
            <>
              Manage workspace access. Signed in as <strong>{user.email}</strong>. Server admins are listed in{" "}
              <code className="inline-code">HIREEAZE_ADMIN_NAMES</code>.
            </>
          ) : (
            "Manage workspace access and pending registration requests."
          )
        }
        actions={
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={busy}>
            Refresh
          </Button>
        }
      />

      <Breadcrumbs items={[{ label: "Admin" }]} />
      <PageAlerts error={err} />

      <PageStack>
        {busy && <MetricSkeleton count={4} />}

        {!busy && (
          <MetricGrid
            columns={4}
            items={[
              { label: "Total users", value: stats.total },
              { label: "Active users", value: stats.active },
              { label: "Online now", value: stats.online },
              { label: "Admins", value: stats.admins },
            ]}
          />
        )}

        {!busy && pendingRequests > 0 && (
          <p className="he-admin-pending-banner" role="status">
            <strong>{pendingRequests}</strong> access request{pendingRequests === 1 ? "" : "s"} awaiting review
          </p>
        )}

        {!busy && (
          <Card>
            <CardHeader>
              <CardTitle>Add user</CardTitle>
            </CardHeader>
            <form className="he-form-stack" onSubmit={createUser}>
              <CardContent>
                <div className="he-form-grid he-form-grid--3">
                  <TextField label="Full name" value={newName} onChange={setNewName} placeholder="Full name" />
                  <TextField
                    label="Email"
                    type="email"
                    value={newEmail}
                    onChange={setNewEmail}
                    placeholder="name@company.com"
                  />
                  <FormField label="Temporary password">
                    <input
                      className="he-input"
                      type={showNewPassword ? "text" : "password"}
                      minLength={8}
                      placeholder="Temporary password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </FormField>
                </div>
              </CardContent>
              <CardFooter>
                <ActionRow align="between">
                  <div className="he-form-checks">
                    <label className="he-form-check">
                      <input
                        type="checkbox"
                        checked={showNewPassword}
                        onChange={(e) => setShowNewPassword(e.target.checked)}
                      />
                      Show password
                    </label>
                    <label className="he-form-check">
                      <input type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} />
                      Active
                    </label>
                  </div>
                  <Button type="submit" variant="primary" loading={createBusy}>
                    Create user
                  </Button>
                </ActionRow>
              </CardFooter>
            </form>
          </Card>
        )}

        {!busy && (
          <DataGrid
            title="Users"
          rows={rows}
          rowKey={(u) => u.id}
          emptyTitle="No registered users"
          emptyDescription="Create a user above or wait for access requests to be approved."
          columns={[
            { key: "name", header: "Name", render: (u) => u.full_name || "—" },
            { key: "email", header: "Email", render: (u) => u.email },
            {
              key: "role",
              header: "Role",
              render: (u) => (
                <NativeSelect
                  className="he-select he-select--inline"
                  value={u.role}
                  disabled={actingId === u.id || u.id === user?.id}
                  onChange={(e) => void setRole(u.id, e.target.value)}
                  aria-label={`Role for ${u.email}`}
                >
                  <option value="user">Recruiter</option>
                  <option value="admin">Admin</option>
                </NativeSelect>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (u) => (
                <div className="he-admin-status-cell">
                  <StatusBadge tone={u.is_active ? "success" : "danger"}>
                    {u.is_active ? "Active" : "Revoked"}
                  </StatusBadge>
                  {u.is_online ? (
                    <StatusBadge tone="primary">Online</StatusBadge>
                  ) : null}
                </div>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              render: (u) => (
                <div className="admin-actions-inline">
                  <Button type="button" variant="outline" size="sm" onClick={() => openUserActivity(u.id)}>
                    View usage
                  </Button>
                  {u.is_active ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={actingId === u.id || u.id === user?.id}
                      onClick={() => void setAccess(u.id, false)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={actingId === u.id}
                      onClick={() => void setAccess(u.id, true)}
                    >
                      Activate
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={actingId === u.id || u.id === user?.id}
                    onClick={() => setConfirmDeleteUserId(u.id)}
                  >
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          />
        )}

        {!busy && user && (
          <p className="page-sub admin-table-note u-mb-0">
            You cannot revoke or delete your own account from this panel.
          </p>
        )}

        {!busy && pendingRequests > 0 && (
          <DataGrid
            title="Access requests"
            rows={requests.filter((r) => r.status === "pending")}
          rowKey={(r) => String(r.id)}
          emptyTitle="No pending requests"
          emptyDescription="New registration requests from the sign-in page appear here."
          columns={[
            { key: "name", header: "Name", render: (r) => r.full_name },
            { key: "email", header: "Email", render: (r) => r.email },
            {
              key: "submitted",
              header: "Submitted",
              render: (r) => (r.created_at ? new Date(r.created_at).toLocaleString() : "—"),
            },
            {
              key: "actions",
              header: "Actions",
              render: (r) => (
                <div className="admin-actions-inline">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={requestActionId === r.id}
                    onClick={() => void reviewRequest(r.id, "approved")}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={requestActionId === r.id}
                    onClick={() => void reviewRequest(r.id, "rejected")}
                  >
                    Reject
                  </Button>
                </div>
              ),
            },
          ]}
          />
        )}
      </PageStack>

      <ConfirmDialog
        open={!!confirmDeleteUserId}
        onClose={() => setConfirmDeleteUserId(null)}
        onConfirm={() => confirmDeleteUserId && void deleteUser(confirmDeleteUserId)}
        title="Delete user permanently?"
        description="This removes the account and cannot be undone."
        confirmLabel="Delete user"
        variant="danger"
        loading={!!confirmDeleteUserId && actingId === confirmDeleteUserId}
      />
    </>
  );
}
