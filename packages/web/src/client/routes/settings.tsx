import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ToolConfig } from "@rauf/core";
import { useTheme } from "../components/ThemeProvider";
import { raufFetchJson } from "../lib/fetch";

// ─── Theme option config ─────────────────────────────────────────

type ThemeOption = "light" | "dark" | "system";

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "\u2600" },
  { value: "dark", label: "Dark", icon: "\u263E" },
  { value: "system", label: "System", icon: "\u25D1" },
];

// ─── GlobalSettings ──────────────────────────────────────────────

export function GlobalSettings() {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();

  const {
    data: config,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["config"],
    queryFn: () => raufFetchJson<ToolConfig>("/api/config"),
  });

  const [rootDir, setRootDir] = useState("");
  const [port, setPort] = useState(5173);

  // Sync local state when config loads
  useEffect(() => {
    if (config) {
      setRootDir(config.rootDirectory);
      setPort(config.port);
    }
  }, [config]);

  const configMutation = useMutation({
    mutationFn: (updated: ToolConfig) =>
      raufFetchJson<ToolConfig>("/api/config", {
        method: "PUT",
        body: JSON.stringify(updated),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["config"], saved);
      // When rootDirectory changes, re-discover projects
      if (saved.rootDirectory !== config?.rootDirectory) {
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
      }
    },
  });

  function handleSaveRootDir() {
    if (!config || rootDir === config.rootDirectory) return;
    configMutation.mutate({ ...config, rootDirectory: rootDir, theme });
  }

  function handleSavePort() {
    if (!config || port === config.port) return;
    configMutation.mutate({ ...config, port, theme });
  }

  function handleThemeChange(next: ThemeOption) {
    setTheme(next);
    if (config) {
      configMutation.mutate({ ...config, theme: next });
    }
  }

  // ── Loading / Error ──────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6">
        <div
          className="mb-6 h-10 w-48 animate-pulse rounded-lg"
          style={{ backgroundColor: "var(--color-surface-raised)" }}
        />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg"
              style={{ backgroundColor: "var(--color-surface-raised)" }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !config) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
          Settings
        </h1>
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: "rgba(220, 38, 38, 0.3)",
            backgroundColor: "rgba(220, 38, 38, 0.05)",
            color: "#dc2626",
          }}
        >
          <p className="text-sm font-medium">Failed to load settings</p>
        </div>
      </div>
    );
  }

  const rootDirChanged = rootDir !== config.rootDirectory;
  const portChanged = port !== config.port;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-semibold" style={{ color: "var(--color-text)" }}>
        Settings
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Global configuration stored in ~/.rauf/config.json
      </p>

      {/* Mutation feedback */}
      {configMutation.isError && (
        <div
          className="mb-4 rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: "rgba(220, 38, 38, 0.3)",
            backgroundColor: "rgba(220, 38, 38, 0.05)",
            color: "#dc2626",
          }}
        >
          {configMutation.error instanceof Error
            ? configMutation.error.message
            : "Failed to save settings"}
        </div>
      )}
      {configMutation.isSuccess && (
        <div
          className="mb-4 rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: "rgba(22, 163, 74, 0.3)",
            backgroundColor: "rgba(22, 163, 74, 0.05)",
            color: "#16a34a",
          }}
        >
          Settings saved
        </div>
      )}

      <div className="space-y-6">
        {/* ── ROOT_DIRECTORY ──────────────────────────────────── */}
        <SettingsSection
          title="Root Directory"
          description="Base directory for project discovery. Changing this triggers a re-scan of projects."
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={rootDir}
              onChange={(e) => setRootDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveRootDir();
              }}
              className="flex-1 rounded-md border px-3 py-2 font-mono text-sm"
              style={{
                borderColor: rootDirChanged ? "var(--color-accent)" : "var(--color-border)",
                backgroundColor: "var(--color-surface)",
                color: "var(--color-text)",
                outline: "none",
              }}
              placeholder="/path/to/projects"
            />
            <button
              onClick={handleSaveRootDir}
              disabled={!rootDirChanged || configMutation.isPending}
              className="rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                backgroundColor: rootDirChanged ? "var(--color-accent)" : "transparent",
                color: rootDirChanged ? "#fff" : "var(--color-text-muted)",
                border: rootDirChanged ? "none" : "1px solid var(--color-border)",
              }}
            >
              {configMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </SettingsSection>

        {/* ── Theme ──────────────────────────────────────────── */}
        <SettingsSection
          title="Theme"
          description="Choose your preferred color scheme. System follows your OS setting."
        >
          <div className="flex gap-2">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleThemeChange(opt.value)}
                className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
                style={{
                  borderColor: theme === opt.value ? "var(--color-accent)" : "var(--color-border)",
                  backgroundColor:
                    theme === opt.value ? "rgba(99, 102, 241, 0.08)" : "var(--color-surface)",
                  color: theme === opt.value ? "var(--color-accent)" : "var(--color-text)",
                }}
              >
                <span className="text-base">{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </SettingsSection>

        {/* ── Server Port ────────────────────────────────────── */}
        <SettingsSection
          title="Server Port"
          description="The port the Rauf web server listens on. Changes take effect after server restart."
        >
          <div className="flex gap-2">
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePort();
              }}
              min={1}
              max={65535}
              className="w-32 rounded-md border px-3 py-2 font-mono text-sm"
              style={{
                borderColor: portChanged ? "var(--color-accent)" : "var(--color-border)",
                backgroundColor: "var(--color-surface)",
                color: "var(--color-text)",
                outline: "none",
              }}
            />
            <button
              onClick={handleSavePort}
              disabled={!portChanged || configMutation.isPending}
              className="rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                backgroundColor: portChanged ? "var(--color-accent)" : "transparent",
                color: portChanged ? "#fff" : "var(--color-text-muted)",
                border: portChanged ? "none" : "1px solid var(--color-border)",
              }}
            >
              Save
            </button>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

// ─── Shared layout component ─────────────────────────────────────

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border p-5"
      style={{
        backgroundColor: "var(--color-surface-raised)",
        borderColor: "var(--color-border)",
      }}
    >
      <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        {title}
      </h2>
      <p className="mb-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
        {description}
      </p>
      {children}
    </div>
  );
}
