/* 로그 형식을 하나 고르게 한다.
 *
 * 로컬에서는 사람이 읽는 한 줄이 낫고, 배포에서는 로그 수집기가 파싱할 수 있어야
 * 한다. Cloud Logging 은 stdout 의 JSON 을 필드로 인식하므로, 형식만 바꾸면
 * "이 계정의 지급을 전부" 같은 질의가 가능해진다.
 *
 * 메시지 뒤에 필드를 선택적으로 받는다. 결제·환불처럼 나중에 캐물을 일이 있는
 * 사건에만 붙이고, 나머지는 문자열 그대로 둔다 — 전부 구조화하는 것은 이 크기의
 * 서비스에서 얻는 것보다 잃는 게 많다. */
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
      /* Error 를 그대로 받으면 스택까지 남긴다 — 500 의 원인은 스택이 전부다. */
      if (message instanceof Error) return emit('error', message.message, { ...(fields || {}), stack: message.stack });
      return emit('error', message, fields);
    },
  };
}
