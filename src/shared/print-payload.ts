import type { PrintOrder, PrintOrderItem } from "@/shared/types";

function isPrintOrderItem(value: unknown): value is PrintOrderItem {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  return typeof item.quantity === "number" && typeof item.name === "string";
}

function mapItems(items: unknown[]): PrintOrderItem[] {
  return items.filter(isPrintOrderItem).map((item) => ({
    quantity: item.quantity,
    name: item.name,
    notes: item.notes,
  }));
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
    const items = mapItems(o.items);
    return {
      id: o.id,
      number: o.number,
      table: o.table,
      createdAt: o.createdAt,
      items,
    };
  }

  if (typeof o.table_number === "string" && Array.isArray(o.items)) {
    const items = mapItems(o.items);
    return {
      id: typeof o.id === "string" ? o.id : `manual-${Date.now()}`,
      number: typeof o.order_number === "number" ? o.order_number : 0,
      table: o.table_number,
      createdAt: typeof o.created_at === "string" ? o.created_at : new Date().toISOString(),
      items,
    };
  }

  return null;
}
