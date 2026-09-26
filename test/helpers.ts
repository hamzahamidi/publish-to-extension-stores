import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Reply {
  status?: number;
  body?: unknown;
}

export interface RecordedRequest {
  key: string;
  auth: string | undefined;
  body: string;
}

export interface MockStore {
  base: string;
  requests: RecordedRequest[];
  on(key: string, ...replies: Reply[]): void;
  reset(): void;
  close(): Promise<void>;
}

export async function startMockStore(): Promise<MockStore> {
  const routes = new Map<string, Reply[]>();
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const key = `${req.method} ${req.url}`;
      requests.push({ key, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
      const queue = routes.get(key);
      const reply: Reply = (queue && (queue.length > 1 ? queue.shift() : queue[0])) ?? { status: 404, body: { message: `no mock route for ${key}` } };
      res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    on(key, ...replies) {
      routes.set(key, replies);
    },
    reset() {
      routes.clear();
      requests.length = 0;
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
