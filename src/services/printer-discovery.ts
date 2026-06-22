import { connect, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { PRINTER_PORT, SCAN_CONCURRENCY, SCAN_TIMEOUT_MS } from "@/shared/constants";

export function getLocalSubnet(): string | null {
  const interfaces = networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) {
      continue;
    }
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        const parts = addr.address.split(".");
        if (parts.length === 4) {
          return parts.slice(0, 3).join(".");
        }
      }
    }
  }
  return null;
}

function probeHost(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = connect({ host: ip, port });
    let settled = false;

    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
    socket.on("timeout", () => finish(false));
  });
}

export async function probePrinter(ip: string): Promise<boolean> {
  return probeHost(ip, PRINTER_PORT, SCAN_TIMEOUT_MS);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function runWorker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      await worker(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
}

export async function scanForPrinters(subnet?: string | null): Promise<string[]> {
  const base = subnet ?? getLocalSubnet();
  if (!base) {
    return [];
  }

  const hosts = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
  const found: string[] = [];

  await runWithConcurrency(hosts, SCAN_CONCURRENCY, async (ip) => {
    const reachable = await probeHost(ip, PRINTER_PORT, SCAN_TIMEOUT_MS);
    if (reachable) {
      found.push(ip);
    }
  });

  return found.sort((a, b) => {
    const aParts = a.split(".").map(Number);
    const bParts = b.split(".").map(Number);
    for (let i = 0; i < 4; i += 1) {
      if (aParts[i] !== bParts[i]) {
        return aParts[i] - bParts[i];
      }
    }
    return 0;
  });
}
