import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import log from "electron-log";
import { getConfig } from "@/services/config-store";
import { printQueue } from "@/services/print-queue";
import {
  CHANNEL_PREFIX,
  SUPABASE_RECONNECT_BASE_MS,
  SUPABASE_RECONNECT_MAX_MS,
} from "@/shared/constants";
import { normalizePrintOrder } from "@/shared/print-payload";
import type { OrderPrintEvent } from "@/shared/types";

type OrderPayload = {
  order?: unknown;
};

type CancelPayload = {
  orderId?: string;
};

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

function handleOrderEvent(event: OrderPrintEvent, payload: OrderPayload): void {
  log.info(`handleOrderEvent: ${event}`, payload);
  const order = normalizePrintOrder(payload.order ?? payload);
  if (!order) {
    log.warn(`Received invalid ${event} payload`);
    return;
  }
  printQueue.enqueue(order, { event });
}

function handleOrderCancelled(payload: CancelPayload): void {
  log.info("handleOrderCancelled", payload);
  const orderId = payload.orderId;
  if (typeof orderId !== "string" || !orderId.trim()) {
    log.warn("Received invalid order_cancelled payload");
    return;
  }
  printQueue.enqueueCancel(orderId.trim());
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
    supabaseClient = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const channelName = `${CHANNEL_PREFIX}:${config.businessId}`;
    channel = supabaseClient
      .channel(channelName)
      .on("broadcast", { event: "order_created" }, ({ payload }) => {
        handleOrderEvent("order_created", payload as OrderPayload);
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
      .subscribe((status) => {
        if (tearingDown) {
          return;
        }

        if (status === "SUBSCRIBED") {
          reconnectAttempt = 0;
          log.info(`Supabase channel ${channelName}: subscribed`);
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
  await teardownChannel();
  supabaseClient = null;
}

export async function restartSupabaseListener(): Promise<void> {
  stopped = false;
  reconnectAttempt = 0;
  await startSupabaseListener();
}

export async function shutdownSupabaseListener(): Promise<void> {
  stopped = true;
  clearReconnectTimer();
  await teardownChannel();
  supabaseClient = null;
}
