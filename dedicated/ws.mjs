/* Minimal RFC 6455 WebSocket server over node:http upgrade events.
 * Text frames only — the dedicated protocol is JSON. No runtime dependency
 * so the game server installs and audits exactly like the payment service.
 * Scope: masked client frames, fragmentation, ping/pong, close handshake.
 * Rejected: binary frames (1003), oversized messages (1009), extensions. */
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 1024 * 1024;
const PING_INTERVAL_MS = 30_000;

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/* Build one unmasked server-to-client frame. */
export function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/* Wrap one upgraded socket. handlers: onMessage(text), onClose(code). */
export function createConnection(socket, handlers) {
  let buffer = Buffer.alloc(0);
  let fragments = null;
  let closed = false;
  let alive = true;

  const conn = {
    socket,
    send(text) {
      if (closed || socket.destroyed) return false;
      socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')));
      return true;
    },
    close(code = 1000, reason = '') {
      if (closed) return;
      closed = true;
      const body = Buffer.alloc(2 + Buffer.byteLength(reason));
      body.writeUInt16BE(code, 0);
      body.write(reason, 2, 'utf8');
      try { socket.write(encodeFrame(0x8, body)); } catch { /* Already gone. */ }
      /* Give the close frame a moment to flush, then drop the TCP socket. */
      setTimeout(() => socket.destroy(), 250).unref?.();
    },
  };

  const pinger = setInterval(() => {
    if (closed || socket.destroyed) return clearInterval(pinger);
    if (!alive) { conn.close(1001, 'ping timeout'); return; }
    alive = false;
    try { socket.write(encodeFrame(0x9)); } catch { /* Socket raced shut. */ }
  }, PING_INTERVAL_MS);
  pinger.unref?.();

  function fail(code, reason) {
    conn.close(code, reason);
    handlers.onClose?.(code);
  }

  socket.on('data', (chunk) => {
    if (closed) return;
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      if (buffer[0] & 0x70) return fail(1002, 'reserved bits');
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) return fail(1009, 'message too large');
        length = Number(big);
        offset = 10;
      }
      /* Browsers must mask; unmasked client frames are a protocol error. */
      if (!masked) return fail(1002, 'unmasked client frame');
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffer = buffer.subarray(offset + 4 + length);
      alive = true;

      if (opcode === 0x9) { try { socket.write(encodeFrame(0xA, payload)); } catch { /* ignore */ } continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        if (!closed) { closed = true; try { socket.write(encodeFrame(0x8, payload.subarray(0, 2))); } catch { /* ignore */ } socket.end(); }
        clearInterval(pinger);
        handlers.onClose?.(code);
        return;
      }
      if (opcode === 0x2) return fail(1003, 'binary unsupported');
      if (opcode === 0x1 || opcode === 0x0) {
        if (opcode === 0x1) {
          if (fragments) return fail(1002, 'nested fragment start');
          fragments = [payload];
        } else {
          if (!fragments) return fail(1002, 'continuation without start');
          fragments.push(payload);
        }
        const total = fragments.reduce((sum, part) => sum + part.length, 0);
        if (total > MAX_MESSAGE_BYTES) return fail(1009, 'message too large');
        if (fin) {
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = null;
          handlers.onMessage?.(text);
        }
        continue;
      }
      return fail(1002, `unknown opcode ${opcode}`);
    }
  });

  socket.on('error', () => { clearInterval(pinger); if (!closed) { closed = true; handlers.onClose?.(1006); } });
  socket.on('close', () => { clearInterval(pinger); if (!closed) { closed = true; handlers.onClose?.(1006); } });
  return conn;
}

/* Complete the HTTP upgrade handshake and return a connection, or null. */
export function upgrade(req, socket, handlers) {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (req.method !== 'GET' || !key || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    '\r\n',
  ].join('\r\n'));
  socket.setNoDelay(true);
  return createConnection(socket, handlers);
}
