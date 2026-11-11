import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";

const NODE_SERVER_PORT = 8787;
let expressApp;
let appReady;

// Cloudflare's Node HTTP server must be registered at module scope. Starting it
// inside fetch() causes Workers error 10021 ("Disallowed operation ... global scope").
const nodeServer = createServer((request, response) => {
  if (!expressApp) {
    response.writeHead(503, { "content-type": "application/json; charset=utf-8", "retry-after": "1" });
    response.end(JSON.stringify({ error: "Application is starting. Please retry shortly." }));
    return;
  }
  expressApp(request, response);
});
nodeServer.listen(NODE_SERVER_PORT);
const nodeHandler = httpServerHandler(nodeServer);

async function ensureApp(env) {
  if (!appReady) {
    appReady = (async () => {
      const connectionString = env.HYPERDRIVE?.connectionString;
      if (!connectionString) throw new Error("HYPERDRIVE connectionString is not configured.");
      if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
        throw new Error("SESSION_SECRET must contain at least 32 characters.");
      }

      globalThis.__DKP_ENV = {
        NODE_ENV: "production",
        CF_WORKER: "true",
        DATABASE_URL: connectionString,
        SESSION_SECRET: env.SESSION_SECRET,
        SUPPORT_EMAIL: env.SUPPORT_EMAIL || "dkpstructures@gmail.com",
        SMARTSUPP_KEY: env.SMARTSUPP_KEY || "",
        RESEND_API_KEY: env.RESEND_API_KEY || "",
        EMAIL_FROM: env.EMAIL_FROM || "",
        TERMS_VERSION: env.TERMS_VERSION || "2026-11-10",
        PGPOOL_MAX: "5"
      };

      const { app } = await import("./server.mjs");
      expressApp = app;
    })().catch((error) => {
      appReady = undefined;
      expressApp = undefined;
      throw error;
    });
  }
  await appReady;
}

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

    try {
      if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
        return await serveAsset(request, env);
      }
      if (!isApi) return new Response("Not found", { status: 404 });

      await ensureApp(env);
      return await nodeHandler(request, env, ctx);
    } catch (error) {
      console.error("DKP Structures Worker request failed:", {
        name: error?.name || "UnknownError",
        message: error?.message || String(error),
        stack: error?.stack || "No stack trace available"
      });
      return Response.json(
        { error: "The application could not complete this request." },
        { status: 500 }
      );
    }
  }
};
