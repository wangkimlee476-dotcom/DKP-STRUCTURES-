import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";

let appReady;

async function serveAsset(request, env) {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;
  const fallbackUrl = new URL("/index.html", request.url);
  return env.ASSETS.fetch(new Request(fallbackUrl, request));
}

async function checkDatabase(connectionString) {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } finally {
    await client.end().catch(error => {
      console.error("DKP health-check PostgreSQL cleanup failed:", error?.message || error);
    });
  }
}

async function ensureApplication(env) {
  if (!appReady) {
    globalThis.__DKP_ENV = {
      NODE_ENV: "production",
      CF_WORKER: "true",
      DATABASE_URL: env.HYPERDRIVE.connectionString,
      SESSION_SECRET: env.SESSION_SECRET,
      SUPPORT_EMAIL: env.SUPPORT_EMAIL || "dkpstructures@gmail.com",
      SMARTSUPP_KEY: env.SMARTSUPP_KEY || "",
      RESEND_API_KEY: env.RESEND_API_KEY || "",
      EMAIL_FROM: env.EMAIL_FROM || "",
      TERMS_VERSION: env.TERMS_VERSION || "2026-11-10",
      PGPOOL_MAX: "5"
    };

    appReady = (async () => {
      const { app, withWorkerDatabase } = await import("./server.mjs");
      const server = createServer(app);
      // httpServerHandler returns the Fetch-compatible handler function itself.
      // It accepts (request, env, ctx); it is not an object with a .fetch method.
      const nodeHandler = httpServerHandler(server);
      if (typeof nodeHandler !== "function") {
        throw new Error("Cloudflare did not create the Express request handler.");
      }
      return { withWorkerDatabase, nodeHandler };
    })().catch((error) => {
      appReady = undefined;
      console.error("DKP Structures application startup failed:", error);
      throw error;
    });
  }
  return await appReady;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");

    if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
      try {
        return await serveAsset(request, env);
      } catch (error) {
        console.error("DKP Structures asset serving failed:", error);
        return Response.json({ error: "Website assets could not be served." }, { status: 500 });
      }
    }
    if (!isApi) return new Response("Not found", { status: 404 });

    if (!env.HYPERDRIVE?.connectionString) {
      return Response.json({ error: "The database connection is not configured yet." }, { status: 503 });
    }
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      return Response.json({ error: "The session secret is not configured correctly." }, { status: 503 });
    }

    // Keep health diagnostics independent from Express startup so a failed
    // Node HTTP bridge cannot hide whether Hyperdrive/PostgreSQL is reachable.
    if (url.pathname === "/api/health" && request.method === "GET") {
      try {
        await checkDatabase(env.HYPERDRIVE.connectionString);
        return Response.json({
          ok: true,
          service: "DKP Structures API",
          database: "PostgreSQL",
          runtime: "Cloudflare Workers"
        });
      } catch (error) {
        console.error("DKP Structures database health check failed:", {
          name: error?.name || "Error",
          message: error?.message || String(error),
          code: error?.code || null,
          stack: error?.stack || "No stack trace available"
        });
        return Response.json(
          { ok: false, stage: "database_connection", error: "PostgreSQL health check failed." },
          { status: 503 }
        );
      }
    }

    let stage = "application_startup";
    try {
      const { withWorkerDatabase, nodeHandler } = await ensureApplication(env);
      stage = "database_connection";
      return await withWorkerDatabase(env.HYPERDRIVE.connectionString, async () => {
        stage = "express_http_adapter";
        return await nodeHandler(request, env, ctx);
      });
    } catch (error) {
      console.error("DKP Structures Worker request failed:", {
        stage,
        name: error?.name || "Error",
        message: error?.message || String(error),
        code: error?.code || null,
        stack: error?.stack || "No stack trace available"
      });
      return Response.json(
        { error: "The application could not complete this request.", stage },
        { status: 500 }
      );
    }
  }
};
