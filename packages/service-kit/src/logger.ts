/**
 * Minimal structured logger. `pretty` for terminals, `json` for log shippers.
 * Deliberately dependency-free; replace with pino when the services grow.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogMeta = Record<string, unknown>;

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  child(bindings: LogMeta): Logger;
}

export interface LoggerOptions {
  service: string;
  format?: "pretty" | "json";
  level?: LogLevel;
  bindings?: LogMeta;
  /** Where lines go. Defaults to stdout for info/debug and stderr for warn/error. */
  write?: (level: LogLevel, line: string) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(options: LoggerOptions): Logger {
  const { service, format = "pretty", level = "info", bindings = {} } = options;
  const write =
    options.write ??
    ((lvl: LogLevel, line: string) => {
      if (lvl === "warn" || lvl === "error") {
        process.stderr.write(`${line}\n`);
      } else {
        process.stdout.write(`${line}\n`);
      }
    });

  const emit = (lvl: LogLevel, message: string, meta?: LogMeta) => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) {
      return;
    }
    const merged = { ...bindings, ...serializeMeta(meta) };
    if (format === "json") {
      write(
        lvl,
        JSON.stringify({ time: new Date().toISOString(), level: lvl, service, message, ...merged }),
      );
      return;
    }
    const time = new Date().toISOString().slice(11, 19);
    const metaText = Object.keys(merged).length > 0 ? ` ${JSON.stringify(merged)}` : "";
    write(lvl, `${time} ${service.padEnd(14)} ${lvl.padEnd(5)} ${message}${metaText}`);
  };

  return {
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    child: (extra) =>
      createLogger({ ...options, bindings: { ...bindings, ...extra }, write: options.write }),
  };
}

function serializeMeta(meta?: LogMeta): LogMeta {
  if (!meta) {
    return {};
  }
  const out: LogMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message } : value;
  }
  return out;
}
