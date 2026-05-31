export function formatDuration(totalSeconds: number): string {
  const raw = Math.max(0, Number(totalSeconds || 0));
  const h = Math.floor(raw / 3600);
  const m = Math.floor((raw % 3600) / 60);
  const s = raw % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function computeAdminStats(
  users: Array<{ is_active?: boolean; is_online?: boolean; role?: string }>
): { total: number; active: number; online: number; admins: number } {
  const list = Array.isArray(users) ? users : [];
  return {
    total: list.length,
    active: list.filter((u) => u.is_active).length,
    online: list.filter((u) => u.is_online).length,
    admins: list.filter((u) => u.role === "admin").length,
  };
}

export function countPendingRequests(requests: Array<{ status?: string }>): number {
  const list = Array.isArray(requests) ? requests : [];
  return list.filter((r) => r.status === "pending").length;
}
