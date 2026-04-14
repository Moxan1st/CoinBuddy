export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  level: LogLevel
  module: string
  message: string
  data?: Record<string, unknown>
}

function emit(level: LogLevel, module: string, message: string, data?: Record<string, unknown>) {
  const prefix = `[${module}][${level}] ${message}`
  const payload = typeof data === "undefined" ? undefined : data

  if (level === "debug") {
    console.debug(prefix, payload)
    return
  }
  if (level === "info") {
    console.info(prefix, payload)
    return
  }
  if (level === "warn") {
    console.warn(prefix, payload)
    return
  }
  console.error(prefix, payload)
}

export function createLogger(module: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => emit("debug", module, message, data),
    info: (message: string, data?: Record<string, unknown>) => emit("info", module, message, data),
    warn: (message: string, data?: Record<string, unknown>) => emit("warn", module, message, data),
    error: (message: string, data?: Record<string, unknown>) => emit("error", module, message, data),
  }
}
