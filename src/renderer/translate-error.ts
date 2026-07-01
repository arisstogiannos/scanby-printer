import type { TFunction } from "i18next";
import { translateIpcError } from "@/shared/ipc-errors";

export function translateError(error: unknown, t: TFunction): string {
  if (error instanceof Error) {
    return translateIpcError(error.message, t);
  }
  return t("errors.unknown");
}
