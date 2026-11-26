# Serve the local Dashboard from Compose

Implemented in the release candidate on 21 November 2026. [Merged deployment change](https://github.com/coffee030/adaptive-web-data-collection-platform/pull/8)

## Context

Normal and Demo depended on a Windows Node installation and a launcher-owned Vite process. These prerequisites added a separate installation and recovery path. The milestone calls for local deployment on Windows 11 x64, repeatable Demo startup, and an approximately 8 GB target. [Windows clean-checkout acceptance](https://github.com/coffee030/adaptive-web-data-collection-platform/blob/8f96b1d8ea7a335570e55a754c14f2d2dce37e24/docs/evaluation/Clean-Checkout-Acceptance.md)

## Decision

Build the existing React and TypeScript project in Node and serve the static bundle with Nginx in Compose. Nginx proxies same-origin requests to the existing FastAPI service. The frontend and direct API bind to loopback, Redis remains private to Compose, and PostgreSQL retains its loopback binding for development and maintenance. Keep the existing FastAPI Host and Origin checks and require the exact loopback browser Origin for enabled local Profile approval and binding actions in the proxy. Use the existing independent Source authorization and immutable Profile approval model.

The Windows launcher scopes each project, verifies dependency health and migration head, and retains the original volumes and settings across Stop. The default has one Worker with concurrency and prefetch set to one. Node remains available for optional Vite development. The default requires the Docker Engine even when the source tree and package caches are local.

## Alternatives considered

- Keeping the host Vite server preserved the existing development path but required local Node and left lifecycle split across Windows and Compose.
- Running a Vite development server within Docker removed the host installer but retained watchers and development behavior in the release runtime.
- Serving static files in FastAPI removed a service but coupled Dashboard delivery to the API release and availability and moved the existing browser approval boundary into the API process.

The selected approach introduces a small static server and a separately testable same-origin boundary. The release gate verifies the image and proxy with a clean build. Windows installation and physical memory acceptance use the separate host procedures.

## Scope and approval

The release request authorizes the deployment change. The formal Proposal file was absent from the checkout, so a direct comparison is pending. The current approved scope remains a reusable Core, with the downstream application and major visual redesign deferred. [Current product scope](../../PRODUCT.md)
