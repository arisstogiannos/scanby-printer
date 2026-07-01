import AutoLaunch from "auto-launch";
import { app } from "electron";
import log from "electron-log";

const AUTO_LAUNCH_APP_NAME = "Scanby Print Service";

let autoLauncher: AutoLaunch | null = null;

function getAutoLauncher(): AutoLaunch {
  if (!autoLauncher) {
    autoLauncher = new AutoLaunch({
      name: AUTO_LAUNCH_APP_NAME,
      path: app.getPath("exe"),
      isHidden: false,
    });
  }
  return autoLauncher;
}

export function initAutoLaunch(): void {
  getAutoLauncher();
}

export async function enableAutoLaunch(): Promise<void> {
  if (!app.isPackaged) {
    log.info("Auto-launch skipped — app is not packaged");
    return;
  }

  try {
    const launcher = getAutoLauncher();
    if (await launcher.isEnabled()) {
      await launcher.disable();
    }
    await launcher.enable();
    log.info("Auto-launch enabled", { exe: app.getPath("exe") });
  } catch (error) {
    log.error("Failed to enable auto-launch", error);
  }
}

export async function disableAutoLaunch(): Promise<void> {
  try {
    const enabled = await getAutoLauncher().isEnabled();
    if (enabled) {
      await getAutoLauncher().disable();
      log.info("Auto-launch disabled");
    }
  } catch (error) {
    log.error("Failed to disable auto-launch", error);
  }
}

export async function syncAutoLaunch(configured: boolean): Promise<void> {
  if (!app.isPackaged) {
    await disableAutoLaunch();
    return;
  }

  if (configured) {
    await enableAutoLaunch();
  }
}
