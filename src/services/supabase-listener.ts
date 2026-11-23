import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import log from "electron-log";
import {
  printCancelBroadcast,
  printOrderBroadcast,
  printReceiptBroadcast,
} from "@/services/broadcast-verification";
import { getConfig } from "@/services/config-store";
import { printQueue } from "@/services/print-queue";
import { requestPrintSweep } from "@/services/print-sweep";
import { syncPrinterRegistry } from "@/services/printer-registry";
import {
  type ListenPlan,
  resolveListenPlan,
  stopWatchingListenPlan,
  watchListenPlan,
} from "@/services/realtime-access";
import { receiptPrintQueue } from "@/services/receipt-print-queue";
import { flagReconnectNeeded, getStationCredentialState } from "@/services/scanby-auth";
import {
  CHANNEL_PREFIX,
  SUPABASE_RECONNECT_BASE_MS,
  SUPABASE_RECONNECT_MAX_MS,
} from "@/shared/constants";
import { normalizePrintOrder } from "@/shared/print-payload";
import { normalizePrintReceipt } from "@/shared/receipt-payload";
import type { OrderPrintEvent, ReceiptPrintEvent } from "@/shared/types";

type OrderPayload = {
  order?: unknown;
  /** Set on reprints the server stored as relay jobs: claim it, then print. */
  relayJobId?: unknown;
};

type ReceiptPayload = {
  receipt?: unknown;
  relayJobId?: unknown;
};

function relayJobIdOf(payload: { relayJobId?: unknown }): string | undefined {
  return typeof payload.relayJobId === "string" && payload.relayJobId.trim()
    ? payload.relayJobId.trim()
    : undefined;
}

type CancelPayload = {
  orderId?: string;
};

let channelStatus: string = "CLOSED";
/** Whether the channel this station joined (or would join) is private. */
let channelPrivate = false;

export function getSupabaseChannelPrivacy(): boolean {
  return channelPrivate;
}

const subscriptionListeners = new Set<() => void>();

export function getSupabaseChannelStatus(): string {
  return channelStatus;
}

export function isSupabaseSubscribed(): boolean {
  return channelStatus === "SUBSCRIBED";
}

/** Fires only when `isSupabaseSubscribed()` flips, not on every channel status. */
export function onSupabaseSubscriptionChange(listener: () => void): () => void {
  subscriptionListeners.add(listener);
  return () => {
    subscriptionListeners.delete(listener);
  };
}

function setChannelStatus(status: string): void {
  const wasSubscribed = isSupabaseSubscribed();
  channelStatus = status;
  if (wasSubscribed === isSupabaseSubscribed()) {
    return;
  }
  for (const listener of subscriptionListeners) {
    listener();
  }
}

let supabaseClient: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;
let tearingDown = false;
let starting = false;

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (stopped || tearingDown || starting) {
    return;
  }

  clearReconnectTimer();
  const delay = Math.min(
    SUPABASE_RECONNECT_BASE_MS * 2 ** reconnectAttempt,
    SUPABASE_RECONNECT_MAX_MS,
  );
  reconnectAttempt += 1;

  reconnectTimer = setTimeout(() => {
    void startSupabaseListener().catch((error) => {
      console.error("Supabase reconnect failed", error);
    });
  }, delay);
}

async function teardownChannel(): Promise<void> {
  tearingDown = true;
  try {
    if (channel && supabaseClient) {
      await supabaseClient.removeChannel(channel);
    }
  } finally {
    channel = null;
    tearingDown = false;
  }
}

function handleOrderEvent(
  event: Exclude<OrderPrintEvent, "order_cancelled">,
  payload: OrderPayload,
): void {
  log.info(`handleOrderEvent: ${event}`, payload);
  const order = normalizePrintOrder(payload.order ?? payload);
  if (!order) {
    log.warn(`Received invalid ${event} payload`);
    return;
  }

  const relayJobId = relayJobIdOf(payload);
  // A new order is claimed and a relay job is claimed; both claims hand back
  // the server's copy. Everything else is checked with the server first.
  if (event === "order_created" || relayJobId) {
    printQueue.enqueue(order, { event, relayJobId });
    return;
  }
  void printOrderBroadcast(order, event);
}

function handleOrderCancelled(payload: CancelPayload): void {
  log.info("handleOrderCancelled", payload);
  const orderId = payload.orderId;
  if (typeof orderId !== "string" || !orderId.trim()) {
    log.warn("Received invalid order_cancelled payload");
    return;
  }
  void printCancelBroadcast(orderId.trim());
}

function handleReceiptEvent(event: ReceiptPrintEvent, payload: ReceiptPayload): void {
  log.info(`handleReceiptEvent: ${event}`, payload);
  const receipt = normalizePrintReceipt(payload.receipt ?? payload);
  if (!receipt) {
    log.warn(`Received invalid ${event} payload`);
    return;
  }
  const relayJobId = relayJobIdOf(payload);
  if (relayJobId) {
    receiptPrintQueue.enqueue(receipt, { event, relayJobId });
    return;
  }
  void printReceiptBroadcast(receipt, event);
}

/**
 * Follows the server's mode: a mode switch rejoins from scratch, a fresh
 * token is handed to the channel already joined.
 */
function watchServerMode(plan: ListenPlan): void {
  watchListenPlan(plan, {
    restart: () => {
      if (!stopped) {
        reconnectAttempt = 0;
        void startSupabaseListener();
      }
    },
    refreshToken: (token) => {
      void supabaseClient?.realtime.setAuth(token).catch((error: unknown) => {
        log.warn("Realtime token refresh failed", error);
      });
    },
  });
}

export async function startSupabaseListener(): Promise<void> {
  const config = getConfig();
  if (!config) {
    return;
  }

  if (stopped) {
    return;
  }

  if (starting) {
    return;
  }

  starting = true;
  clearReconnectTimer();

  try {
    await stopSupabaseListener();
    if (stopped) {
      return;
    }
    const plan = await resolveListenPlan();
    if (stopped) {
      return;
    }
    channelPrivate = plan.mode !== "public";
    if (plan.mode === "private-unauthorized") {
      // Nothing to join with: the sweeps carry the venue, and a credential
      // from the dashboard (or the server signing tokens) rejoins.
      log.warn("Order channel is private and this station has no token — not listening");
      setChannelStatus("UNAUTHORIZED");
      if (getStationCredentialState() !== "ok") {
        // Only a credential from the dashboard on this PC gets it a token.
        flagReconnectNeeded();
      }
      watchServerMode(plan);
      return;
    }
    supabaseClient = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    if (plan.mode === "private") {
      await supabaseClient.realtime.setAuth(plan.token);
    }

    const channelName = `${CHANNEL_PREFIX}:${config.businessId}`;
    channel = supabaseClient
      .channel(channelName, plan.mode === "private" ? { config: { private: true } } : undefined)
      .on("broadcast", { event: "order_created" }, ({ payload }) => {
        handleOrderEvent("order_created", payload as OrderPayload);
      })
      .on("broadcast", { event: "order_reprint" }, ({ payload }) => {
        handleOrderEvent("order_reprint", payload as OrderPayload);
      })
      .on("broadcast", { event: "order_updated" }, ({ payload }) => {
        handleOrderEvent("order_updated", payload as OrderPayload);
      })
      .on("broadcast", { event: "order_cancelled" }, ({ payload }) => {
        handleOrderCancelled(payload as CancelPayload);
      })
      .on("broadcast", { event: "new_order" }, ({ payload }) => {
        handleOrderEvent("order_created", payload as OrderPayload);
      })
      .on("broadcast", { event: "receipt_created" }, ({ payload }) => {
        handleReceiptEvent("receipt_created", payload as ReceiptPayload);
      })
      .on("broadcast", { event: "receipt_reprint" }, ({ payload }) => {
        handleReceiptEvent("receipt_reprint", payload as ReceiptPayload);
      })
      // Carries no printer data: the registry is pulled over this app's own
      // authenticated call, so a spoofed broadcast can cost a fetch and
      // nothing more — it can never add a printer or change a role.
      .on("broadcast", { event: "printers_updated" }, () => {
        log.info("printers_updated — refreshing the printer registry");
        void syncPrinterRegistry().then(() => {
          // A role that was just assigned may be exactly what a held receipt
          // was waiting for.
          receiptPrintQueue.retryHeldJobs();
        });
      })
      .subscribe((status) => {
        if (tearingDown) {
          return;
        }

        setChannelStatus(status);

        if (status === "SUBSCRIBED") {
          reconnectAttempt = 0;
          log.info(`Supabase channel ${channelName}: subscribed (${plan.mode})`);
          // Reconnecting means this station may have missed role changes —
          // and every broadcast sent while it was down, which are gone for
          // good. The sweep asks the server for those instead.
          void syncPrinterRegistry();
          requestPrintSweep();
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          void teardownChannel().then(() => {
            if (!stopped) {
              scheduleReconnect();
            }
          });
        }
      });
    watchServerMode(plan);
  } catch (error) {
    console.error("Failed to start Supabase listener", error);
    if (!stopped) {
      scheduleReconnect();
    }
  } finally {
    starting = false;
  }
}

export async function stopSupabaseListener(): Promise<void> {
  clearReconnectTimer();
  stopWatchingListenPlan();
  await teardownChannel();
  supabaseClient = null;
  setChannelStatus("CLOSED");
}

export async function restartSupabaseListener(): Promise<void> {
  stopped = false;
  reconnectAttempt = 0;
  await startSupabaseListener();
}

export async function shutdownSupabaseListener(): Promise<void> {
  stopped = true;
  clearReconnectTimer();
  stopWatchingListenPlan();
  await teardownChannel();
  supabaseClient = null;
}
