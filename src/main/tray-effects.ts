import { nativeImage } from "electron";
import { getTrayIcon } from "@/main/app-icon";
import { getTrayInstance } from "@/main/tray";

const RED_FLASH_ICON = nativeImage.createFromDataURL(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVQ4T2NkYGD4z0ABYBw1gGE0DBhGQ8NQNQ0YRsPQNA0YRkPD0DQNGD4AAP//AwB5XQJ0Q8x0YQAAAABJRU5ErkJggg==",
);

let activeEffect: ReturnType<typeof setInterval> | null = null;

function clearActiveEffect(): void {
  if (activeEffect) {
    clearInterval(activeEffect);
    activeEffect = null;
  }
}

function runIconAlternation(
  durationMs: number,
  intervalMs: number,
  alternateIcon: Electron.NativeImage,
): void {
  const tray = getTrayInstance();
  if (!tray) {
    return;
  }

  clearActiveEffect();

  const normalIcon = getTrayIcon();
  const highlightIcon = normalIcon.resize({ width: 20, height: 20 });
  let toggled = false;
  const startedAt = Date.now();

  activeEffect = setInterval(() => {
    if (Date.now() - startedAt >= durationMs) {
      clearActiveEffect();
      tray.setImage(normalIcon);
      return;
    }

    toggled = !toggled;
    tray.setImage(toggled ? alternateIcon : highlightIcon);
  }, intervalMs);
}

export function pulseTrayIcon(durationMs = 3_000): void {
  if (process.platform !== "win32") {
    return;
  }

  runIconAlternation(durationMs, 400, getTrayIcon());
}

export function flashTrayIconRed(durationMs = 2_000): void {
  runIconAlternation(durationMs, 300, RED_FLASH_ICON);
}
