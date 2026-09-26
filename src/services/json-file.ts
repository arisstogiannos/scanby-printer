import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import log from "electron-log";

/**
 * Writes the whole file or nothing. The queues on disk hold tickets this
 * station has claimed for good — no other station will print them — so a
 * power cut halfway through a plain write must not leave a truncated file
 * that reads back as an empty queue.
 */
export function writeJsonAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(data), "utf-8");
  renameSync(temp, path);
}

/**
 * Null when the file is missing. A file that will not parse is moved aside
 * rather than left to be overwritten, so whatever it held can still be
 * recovered by hand.
 */
export function readJsonFile(path: string): unknown {
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path, "utf-8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const aside = `${path}.corrupt-${Date.now()}`;
    log.error(`${path} is unreadable — kept as ${aside}`, error);
    try {
      renameSync(path, aside);
    } catch {
      // Left in place; the next save replaces it.
    }
    return null;
  }
}
