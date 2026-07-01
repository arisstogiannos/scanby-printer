import log from "electron-log";
import { isConfigured, isPaired } from "@/services/config-store";
import { reconnectPrinter } from "@/services/printer-connection";
import { isSupabaseSubscribed } from "@/services/supabase-listener";
import { showTrayNotification } from "@/services/tray-notifications";
import { HEALTH_MONITOR_INTERVAL_MS, HEALTH_UNHEALTHY_THRESHOLD } from "@/shared/constants";
import { t } from "@/shared/i18n";

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let printerUnhealthyStreak = 0;
let supabaseUnhealthyStreak = 0;
let stopped = true;

async function runHealthCheck(): Promise<void> {
  if (!isPaired() || !isConfigured()) {
    printerUnhealthyStreak = 0;
    supabaseUnhealthyStreak = 0;
    return;
  }

  const printerResult = await reconnectPrinter();
  const printerHealthy = printerResult.online;
  const supabaseHealthy = isSupabaseSubscribed();

  if (printerHealthy) {
    printerUnhealthyStreak = 0;
  } else {
    printerUnhealthyStreak += 1;
    log.warn(
      `Health check: printer unhealthy (${printerUnhealthyStreak}/${HEALTH_UNHEALTHY_THRESHOLD})`,
    );
    if (printerUnhealthyStreak >= HEALTH_UNHEALTHY_THRESHOLD) {
      showTrayNotification(
        t("notifications.printerOffline"),
        t("notifications.printerOfflineBody", {
          ip: printerResult.ip ?? t("notifications.unknownIp"),
        }),
      );
      printerUnhealthyStreak = 0;
    }
  }

  if (supabaseHealthy) {
    supabaseUnhealthyStreak = 0;
  } else {
    supabaseUnhealthyStreak += 1;
    log.warn(
      `Health check: Supabase channel unhealthy (${supabaseUnhealthyStreak}/${HEALTH_UNHEALTHY_THRESHOLD})`,
    );
    if (supabaseUnhealthyStreak >= HEALTH_UNHEALTHY_THRESHOLD) {
      showTrayNotification(
        t("notifications.channelDisconnected"),
        t("notifications.channelDisconnectedBody"),
      );
      supabaseUnhealthyStreak = 0;
    }
  }
}

export function startHealthMonitor(): void {
  if (!stopped) {
    return;
  }

  stopped = false;
  monitorTimer = setInterval(() => {
    void runHealthCheck();
  }, HEALTH_MONITOR_INTERVAL_MS);

  log.info(`Health monitor started (every ${HEALTH_MONITOR_INTERVAL_MS / 60_000} min)`);
}

export function shutdownHealthMonitor(): void {
  stopped = true;
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  printerUnhealthyStreak = 0;
  supabaseUnhealthyStreak = 0;
}
