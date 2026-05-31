export function UserSelectBar({
  label,
  users,
  value,
  onChange,
  busy,
}: {
  label: string;
  users: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  busy?: boolean;
}) {
  const selected = users.find((u) => u.id === value);
  return (
    <div className="he-user-bar card">
      <div className="he-user-bar__field">
        <label htmlFor="he-user-select" className="he-user-bar__label">
          {label}
        </label>
        <select
          id="he-user-select"
          className="he-input he-select he-user-bar__select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      {busy ? (
        <span className="he-user-bar__status">Loading files…</span>
      ) : selected ? (
        <div className="he-user-bar__profile">
          <span className="he-user-bar__avatar" aria-hidden>
            {(selected.label[0] || "?").toUpperCase()}
          </span>
          <div>
            <span className="he-user-bar__name">{selected.label}</span>
            <span className="he-user-bar__meta">Workspace artifacts</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
