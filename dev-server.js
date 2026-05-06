const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = __dirname;
const preferredPort = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function resolveRequestPath(url) {
  const parsed = new URL(url, `http://${host}`);
  const pathname = decodeURIComponent(parsed.pathname);
  const relative = pathname === '/' ? 'ddgi.html' : pathname.slice(1);
  const resolved = path.resolve(root, relative);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }

  return resolved;
}

const server = http.createServer((req, res) => {
  const filePath = resolveRequestPath(req.url);
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      send(res, 404, 'Not found');
      return;
    }

    const type = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

function openBrowser(url) {
  if (process.env.NO_OPEN) return;

  const command = process.platform === 'win32'
    ? 'cmd'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const args = process.platform === 'win32'
    ? ['/c', 'start', '', url]
    : [url];

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function listen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < preferredPort + 20) {
      listen(port + 1);
      return;
    }

    console.error(err.message);
    process.exit(1);
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}/ddgi.html`;
    console.log(`DDGI dev server running at ${url}`);
    console.log('Press Ctrl+C to stop.');
    openBrowser(url);
  });
}

listen(preferredPort);
