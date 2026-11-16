// Claude Code PermissionRequest hook. Claude Code runs this as its own process (Electron in node
// mode) for every permission question in a folder the app set up. It forwards the question to the
// app on 127.0.0.1 and prints the app's answer.
//
// Any problem (no endpoint file, app not running, no answer within 2 s, bad status, Claude Code
// gone): exit 0 with no output. Claude Code then keeps its own terminal prompt.
//
// Usage: hook.js <endpoint file>   (the file holds {"port": n, "token": "..."}, owner-only)
import * as fs from 'fs';
import * as http from 'http';

const REACH_MS = 2000; // the app must accept the request within this time
const MAX_MS = 595_000; // never outlive Claude Code's 600 s hook timeout
const LIMIT = 1_000_000;

let finished = false;
function done(out = ''): void {
  if (finished) return;
  finished = true;
  if (out) process.stdout.write(out, () => process.exit(0));
  else process.exit(0);
}

setTimeout(() => done(), MAX_MS);

// Claude Code was closed (or killed by the app): stop waiting.
const parent = process.ppid;
setInterval(() => {
  try {
    process.kill(parent, 0);
  } catch {
    done();
  }
}, 1000).unref();

function endpoint(): { port: number; token: string } | null {
  try {
    const e = JSON.parse(fs.readFileSync(process.argv[2] ?? '', 'utf8'));
    if (Number.isInteger(e?.port) && e.port > 0 && e.port < 65536 && typeof e.token === 'string' && /^[0-9a-f]{64}$/.test(e.token)) return e;
  } catch {
    // no app running for this folder
  }
  return null;
}

const chunks: Buffer[] = [];
let size = 0;
process.stdin.on('data', (c: Buffer) => {
  size += c.length;
  if (size > LIMIT) return done();
  chunks.push(c);
});
process.stdin.on('error', () => done());
process.stdin.on('end', () => {
  const e = endpoint();
  if (!e) return done();
  const body = Buffer.concat(chunks);
  const req = http.request({
    host: '127.0.0.1',
    port: e.port,
    method: 'POST',
    path: '/permission',
    headers: { authorization: `Bearer ${e.token}`, 'content-type': 'application/json', 'content-length': body.length },
  });
  const reach = setTimeout(() => {
    req.destroy();
    done();
  }, REACH_MS);
  req.on('error', () => done());
  req.on('response', (res) => {
    clearTimeout(reach); // the app has the question; now wait for the click
    if (res.statusCode !== 200) return done();
    const out: Buffer[] = [];
    let got = 0;
    res.on('data', (c: Buffer) => {
      got += c.length;
      if (got > LIMIT) return done();
      out.push(c);
    });
    res.on('end', () => done(Buffer.concat(out).toString('utf8')));
    res.on('error', () => done());
    res.on('aborted', () => done());
  });
  req.end(body);
});
