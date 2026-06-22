import type { NextFunction, Request, Response } from "express";
import { ALLOWED_ORIGINS } from "@/shared/constants";

function isAllowedOrigin(origin: string): boolean {
  return (ALLOWED_ORIGINS as readonly string[]).includes(origin);
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin ?? "";

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Origin");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}

function isLocalRequest(req: Request): boolean {
  const host = req.headers.host ?? "";
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:");
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" && req.path === "/status") {
    next();
    return;
  }

  const origin = req.headers.origin ?? "";
  if (origin && isAllowedOrigin(origin)) {
    next();
    return;
  }

  if (!origin && isLocalRequest(req)) {
    next();
    return;
  }

  res.status(403).json({ error: "Forbidden" });
}
