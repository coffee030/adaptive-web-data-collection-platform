---
name: fyp-frontend-design
description: "Use when building or changing FYP React pages, dashboards, shared components, forms, tables, or views for sources, jobs, records, and analysis, including UI, accessibility, and responsive changes."
---

# FYP Frontend Design

## Start with shared UI and contracts

- Inspect the design system, tokens, shared components, page layouts, API client, domain types, and tests. Reuse existing conventions. Read [PRODUCT.md](../../../../PRODUCT.md) and [DESIGN.md](../../../../DESIGN.md) for the shared operator workflows and design tokens. Use Impeccable selectively for scoped design review when available.
- Inspect the implemented or agreed API contract before wiring a page. Use its fields and types. Coordinate contract changes with Member A and affected owners. Use clearly labelled fixtures or mocks in tests and prototypes. Surface missing fields or endpoints as dependencies. Keep schema and backend business logic changes outside UI-only work.

## Build and check the interaction

- Use React functional components with TypeScript. Separate API access from presentation. Reuse shared domain types and keep business rules in the backend. Keep state local when it serves one view. Use shared tokens and components for navigation, typography, colors, spacing, radii, buttons, inputs, tables, cards, icons, and status indicators. Keep the dashboard clear, with lightweight dependencies and restrained motion.
- Handle loading, empty, success, validation, and request failure states, with retry or refresh where appropriate. Use actual job state from the API and distinguish pending, running, completed, and failed, plus cancelled when supported. Map labels to contract values and show unavailable operational data honestly.
- Use semantic controls, readable contrast, visible keyboard focus, meaningful labels, and text or icons alongside status colors. Keep forms and tables usable at narrow and desktop widths.

## Verify and report

Use existing frontend tooling for component and interaction tests. Cover affected form validation, loading, empty and error states, and retry or refresh behavior. Check keyboard use and narrow and desktop layouts. Verify the real client contract where integration is available.

Report components reused, new components and design choices, checks run and their results, and missing backend dependencies.
