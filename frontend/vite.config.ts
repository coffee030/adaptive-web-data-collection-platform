import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import type { Connect, Plugin } from 'vite';

function approvalBoundary(enabled: boolean): Plugin {
  function guard(allowed: boolean): Connect.NextHandleFunction {
    return (request, response, next) => {
      let path: string;
      try {
        path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      } catch {
        next();
        return;
      }
      const profileApproval = /^\/api\/v1\/sources\/[^/]+\/versions\/[^/]+\/approve\/?$/.test(path);
      const bindingChange = request.method === 'POST'
        && /^\/api\/v1\/topics\/[^/]+\/bindings(?:\/[^/]+\/(?:approve|disable))?\/?$/.test(path);
      if (!profileApproval && !bindingChange) {
        next();
        return;
      }
      const host = request.headers.host ?? '';
      if (allowed && request.socket.remoteAddress === '127.0.0.1'
        && /^127\.0\.0\.1:[0-9]+$/.test(host) && request.headers.origin === 'http://' + host) {
        next();
        return;
      }
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'local_approval_required', message: 'Local operator demo only' } }));
    };
  }
  return {
    name: 'local-profile-approval-boundary',
    configureServer(server) {
      if (enabled && server.config.server.host !== '127.0.0.1') {
        throw new Error('The local approval demo requires Vite bound to 127.0.0.1');
      }
      server.middlewares.use(guard(enabled));
    },
    configurePreviewServer(server) {
      server.middlewares.use(guard(false));
    },
  };
}

export default defineConfig(({ mode, command, isPreview }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://127.0.0.1:8000';
  // The container enforces the local approval boundary at its reverse proxy.
  const containerApproval = command === 'build' && env.PLATFORM_CONTAINER_FRONTEND === '1'
    && env.LOCAL_PROFILE_APPROVAL === '1';
  const localApproval = command === 'serve' && !isPreview && env.LOCAL_PROFILE_APPROVAL === '1'
    && /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(target)
    && (!env.VITE_API_BASE_URL || env.VITE_API_BASE_URL === '/api/v1');
  const syntheticDemo = (localApproval || containerApproval) && env.PLATFORM_SYNTHETIC_DEMO === '1';
  const apiProxy = {
    '/api/v1': {
      target,
      // Preserve the browser's loopback authority for the API origin check.
      changeOrigin: false,
    },
  };

  return {
    publicDir: false,
    plugins: [react(), approvalBoundary(localApproval), {
      name: 'third-party-notices',
      generateBundle() {
        for (const file of ['Geist.txt', 'Tremor.txt']) {
          this.emitFile({ type: 'asset', fileName: 'licenses/' + file, source: readFileSync('public/licenses/' + file, 'utf8') });
        }
      },
    }],
    define: {
      __LOCAL_PROFILE_APPROVAL__: JSON.stringify(localApproval || containerApproval),
      __PLATFORM_SYNTHETIC_DEMO__: JSON.stringify(syntheticDemo),
    },
    cacheDir: syntheticDemo ? '../.local-demo/vite' : undefined,
    server: { host: '127.0.0.1', proxy: apiProxy },
    preview: { host: '127.0.0.1', proxy: apiProxy },
  };
});
