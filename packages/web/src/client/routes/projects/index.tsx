export function ProjectsDashboard() {
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
          Projects
        </h1>
        <button
          className="rounded-md px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          Initialize New Project
        </button>
      </div>
      <p style={{ color: "var(--color-text-muted)" }}>
        No projects discovered yet. Configure your root directory in Settings.
      </p>
    </div>
  );
}
