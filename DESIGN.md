---
name: "Data Collection Platform Dashboard"
description: "Cobalt and slate design system for the M5.5 React dashboard."
colors:
  page: "#F4F6FB"
  surface: "#FFFFFF"
  text: "#17233B"
  text-secondary: "#576781"
  divider: "#D8E1EF"
  accent: "#375DDD"
  on-accent: "#FFFFFF"
  control-border: "#74839D"
  success: "#19704A"
  warning: "#875807"
  error: "#A93048"
typography:
  body:
    fontFamily: "Inter, IBM Plex Sans, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.5
  section-title:
    fontSize: "1.125rem"
    lineHeight: 1.4
    fontWeight: 600
  mono:
    fontFamily: "IBM Plex Mono, Consolas, monospace"
    fontSize: "0.875rem"
rounded:
  compact: "6px"
  standard: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.compact}"
    height: "36px"
---

# Data Collection Platform Dashboard

The Overview puts the first action beside the Collect → Validate → Trace → Use workflow. Recent activity and records use persisted data. Sources, jobs and profiles share the same navigation, panels, forms and status styling.

## Theme tokens

| Semantic CSS token | Light | Dark |
| --- | --- | --- |
| `--page` | `#F4F6FB` | `#0C1424` |
| `--surface` | `#FFFFFF` | `#172237` |
| `--accent` | `#375DDD` | `#7090FF` |
| `--on-accent` | `#FFFFFF` | `#10182C` |
| `--accent-ink` | `#2B4CBF` | `#9BB0FF` |
| `--text` | `#17233B` | `#E9EFFB` |
| `--text-secondary` | `#576781` | `#AFBCD2` |
| `--divider` | `#D8E1EF` | `#344158` |
| `--control-border` | `#74839D` | `#70809D` |

The rest of the palette lives in `frontend/src/styles/console.css`. Use `--divider` for grouping and `--control-border` for interactive boundaries. Status text uses `--success`, `--warning` and `--error` with explicit labels. Reserve the blue introduction surface and its dedicated text colors for the Overview.

System mode uses the browser's active color scheme through CSS `light-dark()`. Explicit Light or Dark mode sets `data-theme` on the document root. The initial HTML applies the stored choice before React mounts. `collection-theme` is a local browser preference and the current page can still switch themes if storage is unavailable.

## Typography and layout

- Use the local Inter/IBM Plex Sans fallback stack with system UI for offline use. Use monospace for hashes, IDs and raw JSON. Align counting and timestamps with tabular numerals.
- Use 4/8/16/24/32px spacing and 6px control or 12px panel corners. The desktop sidebar becomes a wrapping nav on narrower screens. Use fluid workspace padding and avoid horizontal scrolling at page level.
- Make wide data grids scroll in a named, keyboard-focusable region. Keep persistent control labels and visible keyboard focus. Preserve copyable payload and lineage values in record detail. Use selected field columns for table previews.
- Distinguish data loading, empty responses and errors with scoped copy. Label time zones and quality scope. Use the guided flow for eligible sources and retain direct Source/Profile links for advanced operators.
