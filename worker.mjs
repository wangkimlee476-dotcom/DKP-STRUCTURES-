import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";

let appReady;
let nodeHandler;

async function serveAsset(request, env) {
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;

  const fallbackUrl = new URL("/index.html", request.url);
  return env.ASSETS.fetch(new Request(fallbackUrl, request));
}

async function ensureApp(env) {
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
      const { app } = await import("./server.mjs");

      // The Node HTTP server adapter owns request translation between the
      // Workers Fetch API and Express. This avoids manually routing by port.
      const server = createServer(app);
      nodeHandler = httpServerHandler(server);
      return true;
    })().catch((error) => {
      appReady = undefined;
      nodeHandler = undefined;
      console.error("DKP Structures Worker startup failed:", error);
      throw error;
    });
  }

  return appReady;
}

export default {
  async fetch(request, env, ctx) {
    let phase = "request-routing";
    try {
      const url = new URL(request.url);
      const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");

      if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
        return await serveAsset(request, env);
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

      phase = "express-startup";
      await ensureApp(env);
      if (!nodeHandler || typeof nodeHandler.fetch !== "function") {
        throw new Error(
          "The Express HTTP adapter did not expose a Fetch handler."
        );
      }

      phase = "express-request";
      return await nodeHandler.fetch(request, env, ctx);
    } catch (error) {
      console.error("DKP Structures Worker request failed:", {
        phase,
        name: error?.name || "UnknownError",
        message: error?.message || String(error),
        stack: error?.stack || "No stack trace available"
      });
      return Response.json(
        {
          error: "The application could not complete this request.",
          diagnostic: {
            phase,
            name: error?.name || "UnknownError",
            message: error?.message || String(error)
          }
        },
        { status: 500 }
      );
    }
  }
};
