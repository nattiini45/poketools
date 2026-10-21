type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>) {
  const entry = { timestamp: new Date().toISOString(), level, tag, message, ...meta };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.info(JSON.stringify(entry));
  }
}

export const logger = {
  info: (tag: string, message: string, meta?: Record<string, unknown>) => log('info', tag, message, meta),
  warn: (tag: string, message: string, meta?: Record<string, unknown>) => log('warn', tag, message, meta),
  error: (tag: string, message: string, meta?: Record<string, unknown>) => log('error', tag, message, meta),
};
