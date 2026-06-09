// @rauf/web — Hono server entry point
//
// Delegates to startServer() which handles both API routes and
// embedded frontend asset serving. Binds to 127.0.0.1 ONLY.

import { startServer } from "./start.js";

startServer();
