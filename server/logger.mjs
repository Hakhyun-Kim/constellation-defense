/* Use human-readable local logs or JSON for deployment collectors. Attach structured fields to payment/refund events for investigation; ordinary messages can remain strings. */
export function createLogger({ format = 'text', service = 'store' } = {}, out = console) {
  const emit = (level, message, fields) => {
    if (format === 'json') {
      out.log(JSON.stringify({
        severity: level.toUpperCase(),
        service,
        message,
        time: new Date().toISOString(),
        ...(fields || {}),
      }));
      return;
    }
    const tail = fields && Object.keys(fields).length
      ? ' ' + Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(' ')
      : '';
    const write = level === 'error' ? out.error : level === 'warn' ? out.warn : out.log;
    write.call(out, `[${service}] ${message}${tail}`);
  };

  return {
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => {
      /* Preserve Error stacks to diagnose server failures. */
      if (message instanceof Error) return emit('error', message.message, { ...(fields || {}), stack: message.stack });
      return emit('error', message, fields);
    },
  };
}
