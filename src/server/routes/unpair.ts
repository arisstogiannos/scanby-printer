import type { Request, Response } from "express";
import { unpairApp } from "@/services/unpair";

export async function unpairHandler(_req: Request, res: Response): Promise<void> {
  await unpairApp();
  res.json({ ok: true });
}
