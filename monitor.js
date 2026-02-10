import fs from "fs";
import fetch from "node-fetch";

const SITES = [
  // "https://httpbin.org/status/500", // always 500 (testing site)
  "https://google.com",
  "https://happypet.care",
  "https://app.happypet.tech",
  "https://www.happypet.tech",
  
];

const STATE_FILE = "site_state.json";
const DOWN_SINCE_FILE = "down_since.json";
const RECOVERY_REPORT_FILE = "recovery_report.json";
const SLOW_ALERT_REPORT_FILE = "slow_alert_report.json";
const TIMEOUT = 10000;          // 10s hard timeout
const SLOW_THRESHOLD = 2000;    // 2s = slow

// Load previous state (safe parse: corrupt file => start fresh)
let previousState = {};
try {
  if (fs.existsSync(STATE_FILE)) {
    previousState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (typeof previousState !== "object" || previousState === null) previousState = {};
  }
} catch {
  previousState = {};
}

// Load when each URL went down (for recovery duration)
let downSince = {};
try {
  if (fs.existsSync(DOWN_SINCE_FILE)) {
    downSince = JSON.parse(fs.readFileSync(DOWN_SINCE_FILE, "utf8"));
    if (typeof downSince !== "object" || downSince === null) downSince = {};
  }
} catch {
  downSince = {};
}

async function checkOne(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    const timeMs = Date.now() - start;
    if (!res.ok) {
      return { url, status: "down", reason: `HTTP ${res.status}`, timeMs };
    }
    if (timeMs > SLOW_THRESHOLD) {
      return { url, status: "slow", reason: `Slow (${timeMs}ms)`, timeMs };
    }
    return { url, status: "up", reason: null, timeMs };
  } catch (err) {
    const timeMs = Date.now() - start;
    return {
      url,
      status: "down",
      reason: err.name === "AbortError" ? "Timeout" : err.message,
      timeMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkSites(urls) {
  const results = await Promise.all(urls.map(checkOne));
  return results;
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  if (min >= 1) {
    const s = sec % 60;
    return s > 0 ? `${min} minute${min !== 1 ? "s" : ""} and ${s} second${s !== 1 ? "s" : ""}` : `${min} minute${min !== 1 ? "s" : ""}`;
  }
  return `${sec} second${sec !== 1 ? "s" : ""}`;
}

/** Format ISO date string to India time (IST) for Discord */
function formatIST(iso) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }) + " IST";
}

function run(results) {
  let hasDown = false;
  let alerts = [];
  const recoveries = [];
  const slowAlerts = [];

  const now = new Date();
  const checkedUrls = new Set(results.map((r) => r.url));

  for (const r of results) {
    const prev = previousState[r.url];

    if (r.status === "up") {
      console.log(`✅ UP: ${r.url} (${r.timeMs}ms)`);
      // Recovery: was DOWN and is now UP
      if (prev === "down" && downSince[r.url]) {
        const startMs = new Date(downSince[r.url]).getTime();
        const durationMs = now.getTime() - startMs;
        recoveries.push({
          url: r.url,
          recoveredFrom: "down",
          incidentStartedAt: formatIST(downSince[r.url]),
          resolvedAt: formatIST(now.toISOString()),
          durationMs,
          durationText: formatDuration(durationMs),
        });
        delete downSince[r.url];
        alerts.push(`✅ RECOVERED: ${r.url} (${r.timeMs}ms)`);
      }
      // Recovery: was SLOW and is now UP (back to normal)
      if (prev === "slow") {
        recoveries.push({
          url: r.url,
          recoveredFrom: "slow",
          resolvedAt: formatIST(now.toISOString()),
        });
        alerts.push(`✅ Back to normal: ${r.url} (was slow, now ${r.timeMs}ms)`);
      }
    }

    if (r.status === "slow") {
      console.log(`⚠️ SLOW: ${r.url} (${r.timeMs}ms)`);
      if (prev !== "slow") {
        alerts.push(`⚠️ SLOW: ${r.url} (${r.timeMs}ms)`);
        // UP → SLOW: send Discord alert
        if (prev === "up") {
          slowAlerts.push({
            url: r.url,
            timeMs: r.timeMs,
            detectedAt: formatIST(now.toISOString()),
          });
        }
      }
    }

    if (r.status === "down") {
      console.log(`❌ DOWN: ${r.url} (${r.reason})`);
      hasDown = true;
      if (prev !== "down") {
        alerts.push(`🚨 DOWN: ${r.url} (${r.reason})`);
      }
      // Record when it went down (if not already set, e.g. state had "down" but down_since was empty)
      if (!downSince[r.url]) {
        downSince[r.url] = now.toISOString();
      }
    }

    previousState[r.url] = r.status;
  }

  // Prune state to only URLs we still check (remove sites no longer in SITES)
  const prunedState = {};
  const prunedDownSince = {};
  for (const url of checkedUrls) {
    if (previousState[url] !== undefined) prunedState[url] = previousState[url];
    if (downSince[url] !== undefined) prunedDownSince[url] = downSince[url];
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(prunedState, null, 2));
  fs.writeFileSync(DOWN_SINCE_FILE, JSON.stringify(prunedDownSince, null, 2));

  if (recoveries.length > 0) {
    fs.writeFileSync(RECOVERY_REPORT_FILE, JSON.stringify({ recoveries }, null, 2));
  }
  if (slowAlerts.length > 0) {
    fs.writeFileSync(SLOW_ALERT_REPORT_FILE, JSON.stringify({ slowAlerts }, null, 2));
  }

  if (alerts.length > 0) {
    console.error("ALERTS:");
    console.error(alerts.join("\n"));
  }

  if (hasDown) {
    process.exit(1); // trigger Discord alert in GitHub Actions
  } else {
    console.log("🎉 All sites healthy (no DOWN)");
  }
}

// Run (all sites checked in parallel — total time ≈ slowest site, not sum)
const scriptStart = Date.now();
console.log(`Checking ${SITES.length} site(s) in parallel...`);
const checkStart = Date.now();
const results = await checkSites(SITES);
console.log(`Check completed in ${Date.now() - checkStart}ms`);
run(results);
console.log(`Script total: ${Date.now() - scriptStart}ms`);
