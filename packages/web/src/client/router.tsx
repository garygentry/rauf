import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { ProjectsDashboard } from "./routes/projects/index";
import { BacklogView } from "./routes/projects/backlog";
import { StatusView } from "./routes/projects/status";
import { ProjectSettings } from "./routes/projects/settings";
import { InstallWizard } from "./routes/install";
import { InitWizard } from "./routes/init";
import { GlobalSettings } from "./routes/settings";

const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/projects" });
  },
  component: () => null,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectsDashboard,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$id",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/projects/$id/backlog", params });
  },
  component: () => null,
});

const backlogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$id/backlog",
  component: BacklogView,
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$id/status",
  component: StatusView,
});

const projectSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$id/settings",
  component: ProjectSettings,
});

const installRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/install",
  component: InstallWizard,
});

const initRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/init",
  component: InitWizard,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: GlobalSettings,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectsRoute,
  projectRoute,
  backlogRoute,
  statusRoute,
  projectSettingsRoute,
  installRoute,
  initRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
