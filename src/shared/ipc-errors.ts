export const IPC_ERROR_CODES = {
  INVALID_IP: "errors.invalidIp",
  INVALID_ENTRY_ID: "errors.invalidEntryId",
  RETRY_DATA_MISSING: "errors.retryDataMissing",
  NOT_PAIRED: "errors.notPaired",
  PRINTER_UNREACHABLE: "errors.printerUnreachable",
} as const;

export type IpcErrorCode = keyof typeof IPC_ERROR_CODES;

export function throwIpcError(code: IpcErrorCode): never {
  throw new Error(code);
}

export function translateIpcError(message: string, translate: (key: string) => string): string {
  const key = IPC_ERROR_CODES[message as IpcErrorCode];
  if (key) {
    return translate(key);
  }
  return message;
}
