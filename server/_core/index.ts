import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { randomBytes } from "crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startProofWorker } from "../signalproof/proofWorker";
import { registerBuyerApi } from "../signalproof/buyerApi";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // ---- network probe endpoints ------------------------------------------------
  // Same-origin on purpose: Resource Timing exposes requestStart/responseStart without a
  // Timing-Allow-Origin header only for same-origin requests, and that is the timing the client
  // needs to measure real round-trip time rather than fetch()-to-promise wall clock.

  registerBuyerApi(app);

  app.head("/api/net/ping", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(204).end();
  });

  app.get("/api/net/payload", (req, res) => {
    // Clamped so this cannot be used as a bandwidth amplifier against a third party.
    const requested = Number(req.query.bytes);
    const size = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 3_000_000, 8_000_000);

    res.set({
      "Cache-Control": "no-store, no-transform",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      // no-transform plus incompressible bytes: a proxy that gzipped this would make the measured
      // throughput a fiction. The client also asserts encodedBodySize === decodedBodySize.
      "Content-Encoding": "identity",
    });

    const CHUNK = 64 * 1024;
    let sent = 0;
    const pump = () => {
      while (sent < size) {
        const n = Math.min(CHUNK, size - sent);
        // Random bytes so nothing downstream can compress them.
        if (!res.write(randomBytes(n))) {
          sent += n;
          res.once("drain", pump);
          return;
        }
        sent += n;
      }
      res.end();
    };
    pump();
  });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Starts only when every chain env var is present. Otherwise it logs what is missing and stays
  // off: measurements still persist as SUBMITTED and the UI reports them as unverified, rather
  // than the app silently pretending a proof exists.
  startProofWorker();
}

startServer().catch(console.error);
