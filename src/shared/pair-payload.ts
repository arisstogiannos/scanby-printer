import type { PairPayload } from "@/shared/types";

function deriveSupabaseUrlFromKey(key: string): string | null {
  try {
    const parts = key.split(".");
    if (parts.length < 2) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
      ref?: string;
    };
    if (!payload.ref) {
      return null;
    }
    return `https://${payload.ref}.supabase.co`;
  } catch {
    return null;
  }
}

export function normalizePairPayload(body: unknown): PairPayload | null {
  if (body === null || typeof body !== "object") {
    return null;
  }

  const o = body as Record<string, unknown>;
  const businessId = o.businessId ?? o.venueId;
  const businessName = o.businessName ?? o.venueName;
  const supabasePublishableKey = o.supabasePublishableKey ?? o.supabaseAnonKey;
  const supabaseUrl =
    typeof o.supabaseUrl === "string" && o.supabaseUrl.length > 0
      ? o.supabaseUrl
      : typeof supabasePublishableKey === "string"
        ? deriveSupabaseUrlFromKey(supabasePublishableKey)
        : null;

  if (
    typeof businessId !== "string" ||
    typeof businessName !== "string" ||
    typeof supabasePublishableKey !== "string" ||
    typeof supabaseUrl !== "string" ||
    businessId.length === 0 ||
    businessName.length === 0 ||
    supabasePublishableKey.length === 0 ||
    supabaseUrl.length === 0
  ) {
    return null;
  }

  return {
    businessId,
    businessName,
    supabaseUrl,
    supabasePublishableKey,
  };
}
