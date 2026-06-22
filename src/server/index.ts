import type { Server } from "node:http";
import log from "electron-log";
import express from "express";
import { corsMiddleware, originGuard } from "@/server/origin-guard";
import { pairHandler } from "@/server/routes/pair";
import { printHandler } from "@/server/routes/print";
import { statusHandler } from "@/server/routes/status";
import { unpairHandler } from "@/server/routes/unpair";
import { LOCAL_SERVER_HOST, LOCAL_SERVER_PORT } from "@/shared/constants";

let server: Server | null = null;

export function createLocalServer(): express.Express {
  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: "1mb" }));
  app.use(originGuard);

  app.get("/status", statusHandler);
  app.post("/pair", (req, res) => {
    void pairHandler(req, res);
  });
  app.post("/print", printHandler);
  app.post("/unpair", (req, res) => {
    void unpairHandler(req, res);
  });

  return app;
}

export function startLocalServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve();
      return;
    }

    const app = createLocalServer();
    server = app.listen(LOCAL_SERVER_PORT, LOCAL_SERVER_HOST, () => {
      log.info(`Local server listening on http://${LOCAL_SERVER_HOST}:${LOCAL_SERVER_PORT}`);
      resolve();
    });

    server.on("error", (error) => {
      log.error("Local server error", error);
      reject(error);
    });
  });
}

export async function stopLocalServer(): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  server = null;
}
