import { Link, useRouterState } from "@tanstack/react-router";
import { useTheme } from "./ThemeProvider";

interface NavItem {
  label: string;
  to: string;
  icon: string;
  exact?: boolean;
}

const TOP_NAV: NavItem[] = [
  { label: "Projects", to: "/projects", icon: "⬡", exact: true },
  { label: "Install", to: "/install", icon: "↓", exact: true },
  { label: "Init", to: "/init", icon: "+", exact: true },
];

const BOTTOM_NAV: NavItem[] = [
  { label: "Settings", to: "/settings", icon: "⚙", exact: true },
];

function NavLink({ item }: { item: NavItem }) {
  const { location } = useRouterState();
  const active = item.exact
    ? location.pathname === item.to
    : location.pathname.startsWith(item.to);

  return (
    <Link
      to={item.to}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
      style={{
        color: active ? "#fff" : "var(--color-sidebar-fg)",
        backgroundColor: active ? "var(--color-accent)" : "transparent",
        opacity: active ? 1 : 0.8,
      }}
    >
      <span className="w-5 text-center text-base leading-none">{item.icon}</span>
      <span>{item.label}</span>
    </Link>
  );
}

export function Sidebar() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  function cycleTheme() {
    const next: Record<string, "light" | "dark" | "system"> = {
      light: "dark",
      dark: "system",
      system: "light",
    };
    setTheme(next[theme] ?? "system");
  }

  const themeIcon = theme === "dark" ? "☾" : theme === "light" ? "☀" : "◑";
  const themeLabel = theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System";

  return (
    <aside
      className="flex h-screen w-56 flex-col border-r"
      style={{
        backgroundColor: "var(--color-sidebar)",
        borderColor: "var(--color-sidebar-border)",
      }}
    >
      {/* Logo */}
      <div
        className="flex h-14 items-center gap-2 border-b px-4"
        style={{ borderColor: "var(--color-sidebar-border)" }}
      >
        <span className="text-lg font-bold" style={{ color: resolvedTheme === "dark" ? "#a5b4fc" : "#818cf8" }}>
          Ralph
        </span>
        <span className="text-xs font-medium" style={{ color: "var(--color-sidebar-fg)", opacity: 0.5 }}>
          Manager
        </span>
      </div>

      {/* Top nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {TOP_NAV.map((item) => (
          <NavLink key={item.to} item={item} />
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="space-y-0.5 border-t p-3" style={{ borderColor: "var(--color-sidebar-border)" }}>
        {BOTTOM_NAV.map((item) => (
          <NavLink key={item.to} item={item} />
        ))}

        {/* Theme toggle */}
        <button
          onClick={cycleTheme}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
          style={{ color: "var(--color-sidebar-fg)", opacity: 0.7 }}
          title={`Theme: ${themeLabel} (click to cycle)`}
        >
          <span className="w-5 text-center text-base leading-none">{themeIcon}</span>
          <span>{themeLabel}</span>
        </button>
      </div>
    </aside>
  );
}
