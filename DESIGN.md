---
name: "Data Collection Workspace"
description: "Cobalt and Slate design system for the Data Collection Workspace."
colors:
  page: "#F4F6FB"
  surface: "#FFFFFF"
  navigation: "#FAFBFF"
  text: "#17233B"
  text-secondary: "#576781"
  divider: "#D8E1EF"
  accent: "#375DDD"
  accent-ink: "#2B4CBF"
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

# Data Collection Workspace

M11 adopted Modern Data Workspace. Overview starts with available topics and uses the ledgers below to relate Requests, child Jobs, and valid records. Operations navigation is grouped separately from the main collection workflow. The M11 decisions cover design trade-offs and the pinned UI Slop v1.7 version. [M11 decisions](docs/evaluation/M11-Frontend-Redesign-Decisions.md)

## Colours and surfaces

| CSS token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--page` | `#F4F6FB` | `#0C1424` | Workspace background |
| `--navigation-surface` | `#FAFBFF` | `#101B2E` | Navigation and ledger headers |
| `--surface` | `#FFFFFF` | `#172237` | Data rows, topic directory, and existing panels |
| `--accent` | `#375DDD` | `#7090FF` | Primary actions, current navigation, and focus |
| `--on-accent` | `#FFFFFF` | `#10182C` | Text on primary actions |
| `--accent-ink` | `#2B4CBF` | `#9BB0FF` | Standard links and selected text |
| `--selected` | `#E8EEFF` | `#24385B` | Current page and interactive hover states |
| `--text` | `#17233B` | `#E9EFFB` | Headings and primary text |
| `--text-secondary` | `#576781` | `#AFBCD2` | Status details, dates, and scope |
| `--divider` | `#D8E1EF` | `#344158` | Data separators |
| `--control-border` | `#74839D` | `#70809D` | Control outlines |
| `--success` | `#19704A` | `#79D4A8` | Completed operations and valid data |
| `--warning` | `#875807` | `#F4C16A` | Partial success and data-source notices |
| `--error` | `#A93048` | `#FF9BAA` | Failures and errors |

Shared tokens live in `frontend/src/styles/console.css`. System uses the browser colour preference and CSS `light-dark()`. An explicit Light or Dark selection sets `data-theme` on the document root. The browser stores `collection-theme` locally and the HTML applies it before React mounts.

## Typography and spacing

- Use the existing local Inter and IBM Plex Sans fonts and system fallbacks. The Overview page title is 1.65–2.125 rem, section titles are 1.125 rem, and record summaries and supporting text are 0.8125–0.9375 rem. Use tabular figures for times and counts. Use IBM Plex Mono or Consolas for IDs, hashes, and JSON.
- Use 4, 8, 16, 24, and 32 px spacing. Controls and Overview data boundaries use 6 px corners. Existing feature panels keep 12 px corners. Internal separators guide reading through the topic directory, and aligned columns connect related ledger data.
- The shell uses `frontend/src/app/shell.css`. At viewport widths of 900 px or below, navigation moves to the top. Below 600 px, the primary workflow uses a 2×2 layout and a separate Operations toggle. Overview responds to the available workspace width. Below 640 px, topics use one column. Each request row retains its status and records link.
- Existing wide tables use named, keyboard-focusable horizontal scroll regions. Keep horizontal scrolling within those regions. The workspace uses normal page scrolling and static status feedback, including with reduced motion enabled.

## Controls and states

- Primary actions use solid Cobalt and explicit labels. Navigation uses links that expose the current page. An available topic opens the form with that Topic selected. When no topics are available, Manage sources becomes the section's primary action. Collection requires an explicit approved source selection and a keyword.
- Use named regions, native links and buttons, and a visible 2 px focus indicator. On narrow screens, the main navigation and Operations toggle are at least 44 px high. Escape closes Operations and returns focus to the toggle. The skip link focuses main.
- Status combines text and colour. Failures and partial success show a status label, a child job summary, and relevant error information. Overview labels submission times as UTC. Record links preserve the Request scope.
- Use a status announcement for loading, and an alert with a local Retry action for API errors. Retry returns focus to the section heading. Refresh can keep existing results readable and announce completion. An empty state points to the relevant next step, such as configuring a source, binding a topic, or waiting for valid records.
- Existing feature pages retain their forms, states, tables, and deep-link rules while using the same shell and shared tokens.
