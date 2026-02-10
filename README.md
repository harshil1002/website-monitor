# Website Monitor

[![Website Monitor](https://github.com/harshil1002/website-monitor/actions/workflows/monitor.yml/badge.svg?branch=main)](https://github.com/harshil1002/website-monitor/actions/workflows/monitor.yml)

A GitHub Actions–powered monitor that checks a list of URLs on a schedule, tracks up/down/slow state, and sends **Discord** alerts when sites go down, become slow, or recover.

## What it does

- **Runs every 5 minutes** (or on manual trigger) via `.github/workflows/monitor.yml`
- **Checks each URL**: UP (OK), DOWN (error/timeout), or SLOW (> 2s response)
- **Persists state** in the repo (`monitor-state/`) so it can detect:
  - **New down** → Discord alert
  - **Slow** (was up) → Discord alert
  - **Recovery** (was down/slow, now up) → Discord alert
- **10s timeout** per request; slow threshold is **2 seconds**

## Setup

### 1. Repo and workflow

- Use the **default branch** (e.g. `main`) for the workflow; scheduled runs only work from the default branch.
- Ensure `.github/workflows/monitor.yml` is on that branch.

### 2. Discord webhook

1. In Discord: Server → Server Settings → Integrations → Webhooks → New Webhook. Copy the webhook URL.
2. In GitHub: repo → **Settings → Secrets and variables → Actions** → New repository secret.
3. Name: `DISCORD_WEBHOOK`, Value: your webhook URL.

Alerts will be sent to that channel for down, slow, and recovery events.

### 3. Sites to monitor

Edit the `SITES` array in **`monitor.js`**:

```js
const SITES = [
  "https://example.com",
  "https://staging.example.com",
  // ...
];
```

## Running locally

```bash
npm install
node monitor.js
```

State files (`site_state.json`, `down_since.json`) are read/written in the current directory. The script does not send Discord alerts unless `DISCORD_WEBHOOK` is set in the environment (the workflow sets it from GitHub Secrets).

## Project layout

| File / folder           | Purpose |
|-------------------------|--------|
| `monitor.js`            | Main script: checks URLs, updates state, writes report JSONs |
| `.github/workflows/monitor.yml` | Runs monitor on schedule + manual, persists state, sends Discord alerts |
| `monitor-state/`        | Committed state (site_state, down_since) for the next run |
| `site_state.json`      | Current status per URL (up/down/slow) — generated at runtime |
| `down_since.json`       | When each URL went down — used for recovery duration |
| `recovery_report.json`  | Sites that recovered this run (workflow posts to Discord) |
| `slow_alert_report.json`| Sites that went slow this run |
| `down_alert_report.json`| Sites that went down this run |

## Requirements

- **Node.js** 20 (workflow uses `actions/setup-node@v4` with `node-version: "20"`)
- **npm** dependencies: `node-fetch` (see `package.json`)

## License

ISC
