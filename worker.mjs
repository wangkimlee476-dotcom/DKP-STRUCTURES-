import { handleAsNodeRequest } from "cloudflare:node";

let appReady;
let lastStartupDiagnostic = null;

async function serveAsset(request, env) {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;

  const fallbackUrl = new URL("/index.html", request.url);
  return env.ASSETS.fetch(new Request(fallbackUrl, request));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");

    if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
      try {
        return await serveAsset(request, env);
      } catch (error) {
        console.error("DKP asset serving failed:", error);
        return Response.json({ error: "Website assets could not be served." }, { status: 500 });
      }
    }
    if (!isApi) return new Response("Not found", { status: 404 });

    if (!env.HYPERDRIVE?.connectionString) {
      return Response.json(
        { error: "The database connection is not configured yet." },
        { status: 503 }
      );
    }
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      return Response.json(
        { error: "The session secret is not configured correctly." },
        { status: 503 }
      );
    }

    if (!appReady) {
      globalThis.__DKP_ENV = {
        NODE_ENV: "production",
        CF_WORKER: "true",
        DATABASE_URL: env.HYPERDRIVE.connectionString,
        SESSION_SECRET: env.SESSION_SECRET,
        SUPPORT_EMAIL: env.SUPPORT_EMAIL || "dkpstructures@gmail.com",
        SMARTSUPP_KEY: env.SMARTSUPP_KEY || "",
        TERMS_VERSION: env.TERMS_VERSION || "2026-11-10",
        PGPOOL_MAX: "5"
      };

      let startupStage = "import";
      appReady = (async () => {
        const { app } = await import("./server.mjs");
        // Production tables are provisioned by the Neon migration, not by the
        // restricted Hyperdrive runtime role. Avoid running CREATE statements here.
        startupStage = "http_adapter_start";
        app.listen(8787);
        startupStage = "http_adapter_ready";
        return true;
      })().catch((error) => {
        appReady = undefined;
        lastStartupDiagnostic = {
          name: String(error?.name || "Error"),
          message: String(error?.message || error),
          stack: String(error?.stack || "").slice(0, 1200)
        };
        console.error("DKP Structures Worker startup failed at " + startupStage + ":", error);
        const diagnostic = new Error("DKP Worker startup failed at " + startupStage);
        diagnostic.cause = error;
        throw diagnostic;
      });
    }

    try {
      await appReady;
      // Route this Worker request directly to the Node HTTP server.
      // Preview secrets are read from the active deployment environment.
      return await handleAsNodeRequest(8787, request);
    } catch (error) {
      const serialize = (value) => ({
        type: typeof value,
        name: value && typeof value === "object" ? String(value.name || value.constructor?.name || "Error") : undefined,
        message: value && typeof value === "object" ? String(value.message || "") : String(value),
        stack: value && typeof value === "object" ? String(value.stack || "").slice(0, 1800) : undefined,
        cause: value && typeof value === "object" && value.cause ? String(value.cause.message || value.cause) : undefined
      });
      const detail = serialize(error);
      console.error("DKP Structures Worker request failed:", detail, error);
      const stageMatch = detail.message.match(/DKP Worker startup failed at ([a-z_]+)/);
      return Response.json({
        error: "The application could not complete this request.",
        stage: stageMatch?.[1] || "request_handling",
        diagnostic: detail.message || detail.name || "Unknown request error",
        diagnosticStack: detail.stack || undefined,
        diagnosticCause: detail.cause || undefined
      }, { status: 500 });
    }
  }
};
