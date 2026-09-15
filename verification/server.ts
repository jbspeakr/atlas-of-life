import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json', '.pmtiles': 'application/vnd.pmtiles',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export interface VerificationServer { origin: string; close(): Promise<void> }

export async function startServer(root = 'dist', port = 4178): Promise<VerificationServer> {
  const directory = resolve(root);
  const compressed = new Map<string,Buffer>();
  const respond = (response: ServerResponse, status: number, message: string) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(message);
  };
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      respond(response, 405, 'Method not allowed');
      return;
    }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname); }
    catch { respond(response, 400, 'Invalid URL'); return; }
    if (pathname === '/atlas') {
      response.writeHead(308, { Location: '/atlas/' }); response.end(); return;
    }
    if (!pathname.startsWith('/atlas/')) { respond(response, 404, 'Expected /atlas/ subpath'); return; }
    const filename = resolve(directory, pathname.slice('/atlas/'.length) || 'index.html');
    if (!filename.startsWith(`${directory}${sep}`)) { respond(response, 403, 'Path outside dist'); return; }
    try {
      const info = await stat(filename);
      if (!info.isFile()) { respond(response, 404, `Not a file: ${pathname}`); return; }
      const headers: Record<string, string | number> = {
        'Content-Type': mime[extname(filename)] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': extname(filename) === '.html' ? 'no-cache' : 'public, max-age=3600',
        'Last-Modified': info.mtime.toUTCString(),
        'X-Content-Type-Options': 'nosniff',
      };
      let start = 0;
      let end = info.size - 1;
      let status = 200;
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (!match || (!match[1] && !match[2])) {
          response.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); response.end(); return;
        }
        if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
          response.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); response.end(); return;
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      headers['Content-Length'] = Math.max(0, end - start + 1);
      // Ordinary static-host compression; byte ranges on archives remain identity encoded.
      if(status===200 && /\.(?:html|js|css|json|geojson)$/.test(filename) && /\bgzip\b/.test(request.headers['accept-encoding']??'')){
        let bytes=compressed.get(filename);
        if(!bytes){bytes=gzipSync(await readFile(filename));compressed.set(filename,bytes);}
        response.writeHead(200,{...headers,'Content-Encoding':'gzip','Vary':'Accept-Encoding','Content-Length':bytes.length});
        response.end(request.method==='HEAD'?undefined:bytes);return;
      }
      response.writeHead(status, headers);
      if (request.method === 'HEAD' || info.size === 0) { response.end(); return; }
      const stream = createReadStream(filename, { start, end });
      stream.on('error', (error: Error) => response.destroy(error));
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      respond(response, code === 'ENOENT' ? 404 : 500, `${pathname}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); accept(); });
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((accept, reject) => {
      server.close((error) => error ? reject(error) : accept());
      server.closeAllConnections();
    }),
  };
}
