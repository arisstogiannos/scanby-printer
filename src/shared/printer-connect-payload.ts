export type PrinterConnectPayload = {
  ip: string;
};

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isValidIpv4(value: string): boolean {
  if (!IPV4_PATTERN.test(value)) {
    return false;
  }

  return value.split(".").every((part) => {
    const octet = Number(part);
    return Number.isInteger(octet) && octet >= 0 && octet <= 255;
  });
}

export function normalizePrinterConnectPayload(body: unknown): PrinterConnectPayload | null {
  if (body === null || typeof body !== "object") {
    return null;
  }

  const o = body as Record<string, unknown>;
  const ip = o.ip ?? o.printerIp;

  if (typeof ip !== "string" || !ip.trim()) {
    return null;
  }

  const trimmed = ip.trim();
  if (!isValidIpv4(trimmed)) {
    return null;
  }

  return { ip: trimmed };
}
