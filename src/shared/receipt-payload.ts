import type {
  PrintReceipt,
  PrintReceiptLine,
  PrintReceiptSignature,
  PrintReceiptVatRow,
} from "@/shared/types";

function parseCents(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round(numeric);
}

/**
 * A wire string that only counts when it carries something. Absent, null and
 * "" all mean the same thing to a renderer: skip the row.
 */
function optionalText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function mapLine(raw: unknown): PrintReceiptLine | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }

  const line = raw as Record<string, unknown>;
  if (
    typeof line.name !== "string" ||
    typeof line.quantity !== "number" ||
    !Number.isFinite(line.quantity) ||
    line.quantity <= 0 ||
    typeof line.rateBps !== "number"
  ) {
    return null;
  }

  const totalInCents = parseCents(line.totalInCents);
  if (totalInCents === null) {
    return null;
  }

  return {
    name: line.name,
    quantity: line.quantity,
    totalInCents,
    rateBps: line.rateBps,
    quantityLabel: optionalText(line.quantityLabel),
    discountInCents: Math.max(0, parseCents(line.discountInCents) ?? 0),
  };
}

function mapVatRow(raw: unknown): PrintReceiptVatRow | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }

  const row = raw as Record<string, unknown>;
  if (typeof row.rateBps !== "number") {
    return null;
  }

  const netInCents = parseCents(row.netInCents);
  const vatInCents = parseCents(row.vatInCents);
  const grossInCents = parseCents(row.grossInCents);
  if (netInCents === null || vatInCents === null || grossInCents === null) {
    return null;
  }

  return {
    rateBps: row.rateBps,
    netInCents,
    vatInCents,
    grossInCents,
  };
}

function mapSignature(raw: unknown): PrintReceiptSignature | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }

  const signature = raw as Record<string, unknown>;
  if (typeof signature.data !== "string" || typeof signature.format !== "number") {
    return null;
  }

  return {
    caption: typeof signature.caption === "string" ? signature.caption : "",
    data: signature.data,
    format: signature.format,
  };
}

function mapCustomer(
  raw: unknown,
): { name: string; vatId: string; street?: string; zip?: string; city?: string } | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }

  const customer = raw as Record<string, unknown>;
  if (typeof customer.name !== "string" || typeof customer.vatId !== "string") {
    return null;
  }

  return {
    name: customer.name,
    vatId: customer.vatId,
    street: typeof customer.street === "string" ? customer.street : undefined,
    zip: typeof customer.zip === "string" ? customer.zip : undefined,
    city: typeof customer.city === "string" ? customer.city : undefined,
  };
}

export function normalizePrintReceipt(body: unknown): PrintReceipt | null {
  if (body === null || typeof body !== "object") {
    return null;
  }

  const root = body as Record<string, unknown>;
  const candidate = root.receipt ?? root;

  if (candidate === null || typeof candidate !== "object") {
    return null;
  }

  const receipt = candidate as Record<string, unknown>;
  if (
    typeof receipt.id !== "string" ||
    typeof receipt.businessName !== "string" ||
    typeof receipt.legalName !== "string" ||
    typeof receipt.vatId !== "string" ||
    typeof receipt.title !== "string" ||
    typeof receipt.series !== "string" ||
    typeof receipt.aa !== "number" ||
    typeof receipt.momentIso !== "string" ||
    typeof receipt.payMethodLabel !== "string" ||
    !Array.isArray(receipt.lines) ||
    !Array.isArray(receipt.vatRows) ||
    !Array.isArray(receipt.signatures)
  ) {
    return null;
  }

  const totalInCents = parseCents(receipt.totalInCents);
  if (totalInCents === null) {
    return null;
  }

  const lines = receipt.lines
    .map(mapLine)
    .filter((line): line is PrintReceiptLine => line !== null);
  const vatRows = receipt.vatRows
    .map(mapVatRow)
    .filter((row): row is PrintReceiptVatRow => row !== null);
  const signatures = receipt.signatures
    .map(mapSignature)
    .filter((signature): signature is PrintReceiptSignature => signature !== null);

  const transmissionFailure =
    receipt.transmissionFailure === 1 || receipt.transmissionFailure === 2
      ? receipt.transmissionFailure
      : null;

  return {
    id: receipt.id,
    businessName: receipt.businessName,
    legalName: receipt.legalName,
    vatId: receipt.vatId,
    address: typeof receipt.address === "string" ? receipt.address : null,
    title: receipt.title,
    series: receipt.series,
    aa: receipt.aa,
    momentIso: receipt.momentIso,
    cashierName: typeof receipt.cashierName === "string" ? receipt.cashierName : null,
    customer: mapCustomer(receipt.customer),
    comments: optionalText(receipt.comments),
    lines,
    vatRows,
    discountInCents: Math.max(0, parseCents(receipt.discountInCents) ?? 0),
    totalInCents,
    payMethodLabel: receipt.payMethodLabel,
    area: optionalText(receipt.area),
    footnote: optionalText(receipt.footnote),
    transmissionFailure,
    signatures,
    qrUrl: typeof receipt.qrUrl === "string" ? receipt.qrUrl : null,
  };
}
