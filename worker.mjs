import { createRequire } from "node:module";
import { httpServerHandler } from "cloudflare:node";

const require = createRequire("/worker.mjs");
let appReady;

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

    // Cloudflare's Assets binding serves the existing public/ website files.
    if (!isApi && (request.method === "GET" || request.method === "HEAD")) return serveAsset(request, env);
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

      appReady = (async () => {
        const { app, init } = require("./server.js");
        await init();
        app.listen(8787);
        return httpServerHandler({ port: 8787 });
      })().catch((error) => {
        appReady = undefined;
        console.error("DKP Structures Worker startup failed:", error);
        throw error;
      });
    }

    const handler = await appReady;
    return handler(request, env, ctx);
  }
};
