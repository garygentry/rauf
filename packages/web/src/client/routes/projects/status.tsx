import { useParams } from "@tanstack/react-router";

export function StatusView() {
  const { id } = useParams({ strict: false });
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
        Status
      </h1>
      <p style={{ color: "var(--color-text-muted)" }}>Project: {id}</p>
    </div>
  );
}
