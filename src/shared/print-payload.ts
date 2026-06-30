import type { PrintOrder, PrintOrderItem } from "@/shared/types";

function parsePrice(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  return Math.round(numeric);
}

function mapItem(raw: unknown): PrintOrderItem | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }

  const item = raw as Record<string, unknown>;
  if (
    typeof item.quantity !== "number" ||
    !Number.isFinite(item.quantity) ||
    item.quantity <= 0 ||
    typeof item.name !== "string"
  ) {
    return null;
  }

  const price = parsePrice(item.price) ?? parsePrice(item.unit_price) ?? parsePrice(item.unitPrice);

  return {
    quantity: item.quantity,
    name: item.name,
    notes: typeof item.notes === "string" ? item.notes : undefined,
    ...(price !== undefined ? { price } : {}),
  };
}

function mapItems(items: unknown[]): PrintOrderItem[] {
  return items.map(mapItem).filter((item): item is PrintOrderItem => item !== null);
}

export function normalizePrintOrder(body: unknown): PrintOrder | null {
  if (body === null || typeof body !== "object") {
    return null;
  }

  const root = body as Record<string, unknown>;
  const candidate = root.order ?? root;

  if (candidate === null || typeof candidate !== "object") {
    return null;
  }

  const o = candidate as Record<string, unknown>;

  if (typeof o.table === "string" && Array.isArray(o.items)) {
    if (
      typeof o.id !== "string" ||
      typeof o.number !== "number" ||
      typeof o.createdAt !== "string"
    ) {
      return null;
    }
    return {
      id: o.id,
      number: o.number,
      table: o.table,
      createdAt: o.createdAt,
      items: mapItems(o.items),
    };
  }

  if (typeof o.table_number === "string" && Array.isArray(o.items)) {
    return {
      id: typeof o.id === "string" ? o.id : `manual-${Date.now()}`,
      number: typeof o.order_number === "number" ? o.order_number : 0,
      table: o.table_number,
      createdAt: typeof o.created_at === "string" ? o.created_at : new Date().toISOString(),
      items: mapItems(o.items),
    };
  }

  return null;
}
