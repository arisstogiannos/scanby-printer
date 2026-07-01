import { useMemo } from "react";
import { type Locale, localeTag } from "@/shared/i18n";

export function useFormatDate(locale: Locale) {
  const tag = localeTag(locale);

  return useMemo(
    () => ({
      formatTime(iso: string): string {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
          return "—";
        }

        const now = new Date();
        const isToday =
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth() &&
          date.getDate() === now.getDate();

        if (isToday) {
          return date.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
        }

        return date.toLocaleString(tag, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      },
      formatDateTime(iso: string): string {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
          return iso;
        }
        return date.toLocaleString(tag);
      },
      formatTimeOnly(iso: string): string {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
          return "—";
        }
        return date.toLocaleTimeString(tag);
      },
      formatLastChecked(iso: string | null, neverLabel: string): string {
        if (!iso) {
          return neverLabel;
        }

        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
          return neverLabel;
        }

        return date.toLocaleString(tag, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      },
    }),
    [tag],
  );
}
