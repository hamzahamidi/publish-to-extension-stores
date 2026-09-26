import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 'self-test-token-port';
const REQUESTS = 'self-test-token-requests.json';
const LOG = 'self-test-token.log';

const command = process.argv[2];

if (command === 'start') {
  rmSync(PORT, { force: true });
  const log = openSync(LOG, 'w');
  spawn(process.execPath, [import.meta.filename, 'serve'], { detached: true, stdio: ['ignore', log, log] }).unref();
  for (let i = 0; i < 50 && !existsSync(PORT); i++) await sleep(100);
  if (!existsSync(PORT)) {
    console.error(readFileSync(LOG, 'utf8'));
    console.error('The token mock did not start within 5 s.');
    process.exit(1);
  }
  const endpoint = `http://127.0.0.1:${readFileSync(PORT, 'utf8')}/token`;
  appendFileSync(process.env.GITHUB_ENV ?? '/dev/stdout', `CWS_TOKEN_ENDPOINT=${endpoint}\n`);
  console.log(`Token mock listening on ${endpoint}.`);
} else if (command === 'serve') {
  const requests: Array<{ key: string; form: Record<string, string> }> = [];
  writeFileSync(REQUESTS, '[]');
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const key = `${req.method} ${req.url}`;
      requests.push({ key, form: Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString())) });
      writeFileSync(REQUESTS, JSON.stringify(requests, null, 2));
      const found = key === 'POST /token' && req.headers['content-type'] === 'application/x-www-form-urlencoded';
      res.writeHead(found ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(found ? { access_token: 'self-test-token', expires_in: 3599, token_type: 'Bearer' } : { error: 'not_found' }));
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  writeFileSync(`${PORT}.tmp`, String((server.address() as AddressInfo).port));
  renameSync(`${PORT}.tmp`, PORT);
} else {
  console.error('Usage: node test/token-mock.ts start|serve');
  process.exit(2);
}
