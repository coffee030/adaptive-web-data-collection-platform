import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [port, stopFile, marker] = process.argv.slice(2);
let phase = 'load-vite';
try {
  const pkg = path.join(process.cwd(), 'node_modules', 'vite', 'dist', 'node', 'index.js');
  const { createServer } = await import(pathToFileURL(pkg).href);
  phase = 'configure-vite';
  const server = await createServer({
    host: '127.0.0.1',
    server: { host: '127.0.0.1', port: Number(port), strictPort: true },
    plugins: [{
      name: 'windows-launcher-readiness',
      configureServer(vite) {
        vite.middlewares.use('/__launcher_ready', (request, response) => {
          response.setHeader('Cache-Control', 'no-store');
          response.end(marker);
        });
      },
    }],
    logLevel: 'silent',
  });
  phase = 'listen';
  await server.listen();
  const timer = setInterval(async () => {
    if (!fs.existsSync(stopFile)) return;
    clearInterval(timer);
    await server.close();
    fs.rmSync(stopFile, { force: true });
  }, 300);
} catch {
  // Vite errors can include arbitrary config values. Record only the failed phase.
  fs.writeFileSync(stopFile + '.error', phase);
  process.exitCode = 1;
}
