import { httpServerHandler } from "cloudflare:node";

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
        const { app, init } = await import("./server.mjs");
        startupStage = "database_initialization";
        await init();
        startupStage = "http_adapter_start";
        app.listen(8787);
        startupStage = "http_adapter_ready";
        return httpServerHandler({ port: 8787 });
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
      const handler = await appReady;
      return await handler(request, env, ctx);
    } catch (error) {
      console.error("DKP Structures Worker request failed:", error);
      const message = String(error?.message || "");
      const causeMessage = String(error?.cause?.message || "");
      const stageMatch = message.match(/DKP Worker startup failed at ([a-z_]+)/);
      return Response.json(
        {
          error: "The application could not complete this request.",
          stage: stageMatch?.[1] || "request_handling",
          diagnostic: causeMessage.slice(0, 240) || lastStartupDiagnostic?.name + ": " + lastStartupDiagnostic?.message,
          diagnosticStack: lastStartupDiagnostic?.stack || undefined
        },
        { status: 500 }
      );
    }
  }
};
