import AutoLaunch from "auto-launch";
import log from "electron-log";

let autoLauncher: AutoLaunch | null = null;

export function initAutoLaunch(appName: string): void {
  autoLauncher = new AutoLaunch({
    name: appName,
    isHidden: true,
  });
}

export async function enableAutoLaunch(): Promise<void> {
  if (!autoLauncher) {
    return;
  }
  try {
    const enabled = await autoLauncher.isEnabled();
    if (!enabled) {
      await autoLauncher.enable();
      log.info("Auto-launch enabled");
    }
  } catch (error) {
    log.error("Failed to enable auto-launch", error);
  }
}

export async function disableAutoLaunch(): Promise<void> {
  if (!autoLauncher) {
    return;
  }
  try {
    const enabled = await autoLauncher.isEnabled();
    if (enabled) {
      await autoLauncher.disable();
      log.info("Auto-launch disabled");
    }
  } catch (error) {
    log.error("Failed to disable auto-launch", error);
  }
}
