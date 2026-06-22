import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, nativeImage } from "electron";

const ICON_FILE = "icon.png";

export function getIconPath(): string {
  const candidates = [
    join(app.getAppPath(), "resources", ICON_FILE),
    join(process.resourcesPath, ICON_FILE),
    join(process.resourcesPath, "resources", ICON_FILE),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`App icon not found: ${ICON_FILE}`);
  }

  return found;
}

export function getAppIcon(size = 32): Electron.NativeImage {
  const image = nativeImage.createFromPath(getIconPath());
  if (image.isEmpty()) {
    throw new Error("App icon failed to load");
  }

  if (size <= 0) {
    return image;
  }

  return image.resize({ width: size, height: size });
}

export function getTrayIcon(): Electron.NativeImage {
  return getAppIcon(16);
}
