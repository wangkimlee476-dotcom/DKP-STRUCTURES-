import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";

// Populate the runtime configuration before importing the Express application.
// Cloudflare provides bindings through the Workers env module.
globalThis.__DKP_ENV = {
  NODE_ENV: "production",
  CF_WORKER: "true",
  DATABASE_URL: env.HYPERDRIVE?.connectionString,
  SESSION_SECRET: env.SESSION_SECRET,
  SUPPORT_EMAIL: env.SUPPORT_EMAIL || "dkpstructures@gmail.com",
  SMARTSUPP_KEY: env.SMARTSUPP_KEY || "",
  TERMS_VERSION: env.TERMS_VERSION || "2026-11-10",
  PGPOOL_MAX: "5"
};

if (!globalThis.__DKP_ENV.DATABASE_URL) {
  throw new Error("DKP Structures: HYPERDRIVE connectionString is not configured.");
}
if (!globalThis.__DKP_ENV.SESSION_SECRET || globalThis.__DKP_ENV.SESSION_SECRET.length < 32) {
  throw new Error("DKP Structures: SESSION_SECRET must contain at least 32 characters.");
}

// Initialize Express once at module startup and export Cloudflare's native
// Node HTTP adapter directly. Avoid manually invoking a nested handler from
// inside another fetch handler, which can leave requests unresolved.
const { app } = await import("./server.mjs");
const server = createServer(app);

export default httpServerHandler(server);
