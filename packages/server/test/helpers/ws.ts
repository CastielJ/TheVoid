import type { FastifyInstance } from "fastify";

const TEST_ORIGIN = "http://localhost:5173";

interface MessageBuffer {
  queue: unknown[];
  waiters: Array<(value: unknown) => void>;
  closeInfo: { code: number; reason: string } | null;
  closeWaiters: Array<(value: { code: number; reason: string }) => void>;
}

// Keyed by the raw `ws` instance so openWebSocket/waitForMessage/waitForClose
// can share one buffer per connection without changing any call site.
const buffers = new WeakMap<object, MessageBuffer>();

/**
 * Every message (and the close event) is captured from the moment a
 * connection is created, not just from whenever a test happens to call
 * `waitForMessage`/`waitForClose`. This matters because a broadcast is sent
 * synchronously *inside* a mutation's request handler — well before the
 * mutation's HTTP response round-trips back to the calling test — so a
 * test that does `await mutate(...)` and only *then* calls `waitForMessage`
 * can otherwise lose the message entirely: it already fired on a socket
 * with no listener attached yet. Buffering from connection time removes
 * that race regardless of how a test orders its awaits.
 */
function ensureBuffered(ws: {
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: (code: number, reason: Buffer) => void): void;
}): MessageBuffer {
  let buffer = buffers.get(ws);
  if (buffer) return buffer;

  buffer = { queue: [], waiters: [], closeInfo: null, closeWaiters: [] };
  buffers.set(ws, buffer);

  ws.on("message", (data: unknown) => {
    const parsed: unknown = JSON.parse((data as { toString(): string }).toString());
    const waiter = buffer!.waiters.shift();
    if (waiter) waiter(parsed);
    else buffer!.queue.push(parsed);
  });

  ws.on("close", (code: number, reason: Buffer) => {
    buffer!.closeInfo = { code, reason: reason.toString() };
    while (buffer!.closeWaiters.length > 0) {
      buffer!.closeWaiters.shift()!(buffer!.closeInfo);
    }
  });

  return buffer;
}

/**
 * Opens a simulated WebSocket connection through `app.injectWS` (no real
 * port bound, same "exercise the real stack without a network call"
 * philosophy as test/helpers/client.ts's `app.inject()` bridge for tRPC).
 * `cookie` is the raw `name=value` session cookie string from
 * `createTestClient`'s `cookieJar.cookie` — omit it to test unauthenticated
 * connections. Buffering (see `ensureBuffered`) starts immediately, before
 * this resolves.
 */
export async function openWebSocket(app: FastifyInstance, cookie?: string) {
  const headers: Record<string, string> = { origin: TEST_ORIGIN };
  if (cookie) headers.cookie = cookie;
  const ws = await app.injectWS("/ws", { headers });
  ensureBuffered(ws);
  return ws;
}

/**
 * Resolves with the next parsed JSON message — either already buffered, or
 * the next one to arrive — or rejects if none arrives within `timeoutMs`.
 * Untyped by design — this is raw wire data whose shape varies per event
 * type (task.created vs. evicted vs. error, ...); callers assert the
 * specific shape they expect via `toMatchObject`.
 */
export function waitForMessage(
  ws: Parameters<typeof ensureBuffered>[0],
  timeoutMs = 2000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw WS JSON payload, shape varies per event type
): Promise<any> {
  const buffer = ensureBuffered(ws);
  if (buffer.queue.length > 0) return Promise.resolve(buffer.queue.shift());

  return new Promise((resolve, reject) => {
    const onMessage = (value: unknown) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      const index = buffer.waiters.indexOf(onMessage);
      if (index !== -1) buffer.waiters.splice(index, 1);
      reject(new Error("Timed out waiting for a WebSocket message"));
    }, timeoutMs);
    buffer.waiters.push(onMessage);
  });
}

/** Resolves `true` if no message is already buffered/arrives within `timeoutMs`, `false` otherwise — used to assert *silence* (eviction). */
export function noMessageWithin(
  ws: Parameters<typeof ensureBuffered>[0],
  timeoutMs = 500,
): Promise<boolean> {
  const buffer = ensureBuffered(ws);
  if (buffer.queue.length > 0) return Promise.resolve(false);

  return new Promise((resolve) => {
    const onMessage = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      const index = buffer.waiters.indexOf(onMessage);
      if (index !== -1) buffer.waiters.splice(index, 1);
      resolve(true);
    }, timeoutMs);
    buffer.waiters.push(onMessage);
  });
}

export function waitForClose(
  ws: Parameters<typeof ensureBuffered>[0],
): Promise<{ code: number; reason: string }> {
  const buffer = ensureBuffered(ws);
  if (buffer.closeInfo) return Promise.resolve(buffer.closeInfo);
  return new Promise((resolve) => {
    buffer.closeWaiters.push(resolve);
  });
}
