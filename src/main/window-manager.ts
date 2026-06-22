import { existsSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, shell } from "electron";
import { getAppIcon } from "@/main/app-icon";
import { isConfigured } from "@/services/config-store";

function getPreloadPath(): string {
  const candidates = [
    join(__dirname, "../preload/index.js"),
    join(__dirname, "../preload/index.mjs"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Preload script not found");
  }
  return found;
}

let setupWindow: BrowserWindow | null = null;

export function getSetupWindow(): BrowserWindow | null {
  return setupWindow;
}

export function createSetupWindow(): BrowserWindow {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return setupWindow;
  }

  setupWindow = new BrowserWindow({
    width: 480,
    height: 680,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    title: "Scanby Print Service",
    icon: getAppIcon(256),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  setupWindow.on("ready-to-show", () => {
    setupWindow?.show();
  });

  setupWindow.on("closed", () => {
    setupWindow = null;
  });

  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void setupWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void setupWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return setupWindow;
}

export function showSetupWindow(): void {
  const win = createSetupWindow();
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
}

export function hideSetupWindow(): void {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.hide();
  }
}

export function showWindowForStartup(): void {
  if (!isConfigured()) {
    showSetupWindow();
  }
}
