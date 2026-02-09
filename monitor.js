import fs from "fs";
import fetch from "node-fetch";

const SITES = [
  "https://httpbin.org/staus/500", // testing site
  "https://httpbin.org/status/500", // testing site
  "https://google.com",
  "https://happypet.care",
  "https://app.happypet.tech",
  "https://www.happypet.tech",
  
];

const STATE_FILE = "site_state.json";
const TIMEOUT = 10000;          // 10s hard timeout
const SLOW_THRESHOLD = 2000;    // 2s = slow

// Load previous state
let previousState = {};
if (fs.existsSync(STATE_FILE)) {
  previousState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

async function checkSites(urls) {
  const results = [];

  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    const start = Date.now();

    try {
      const res = await fetch(url, { signal: controller.signal });
      const timeMs = Date.now() - start;

      if (!res.ok) {
        results.push({ url, status: "down", reason: `HTTP ${res.status}`, timeMs });
      } else if (timeMs > SLOW_THRESHOLD) {
        results.push({ url, status: "slow", reason: `Slow (${timeMs}ms)`, timeMs });
      } else {
        results.push({ url, status: "up", reason: null, timeMs });
      }
    } catch (err) {
      const timeMs = Date.now() - start;
      results.push({
        url,
        status: "down",
        reason: err.name === "AbortError" ? "Timeout" : err.message,
        timeMs,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return results;
}

function run(results) {
  let hasDown = false;
  let alerts = [];

  for (const r of results) {
    const prev = previousState[r.url];

    if (r.status === "up") {
      console.log(`✅ UP: ${r.url} (${r.timeMs}ms)`);
      if (prev && prev !== "up") {
        alerts.push(`✅ RECOVERED: ${r.url} (${r.timeMs}ms)`);
      }
    }

    if (r.status === "slow") {
      console.log(`⚠️ SLOW: ${r.url} (${r.timeMs}ms)`);
      if (prev !== "slow") {
        alerts.push(`⚠️ SLOW: ${r.url} (${r.timeMs}ms)`);
      }
    }

    if (r.status === "down") {
      console.log(`❌ DOWN: ${r.url} (${r.reason})`);
      hasDown = true;
      if (prev !== "down") {
        alerts.push(`🚨 DOWN: ${r.url} (${r.reason})`);
      }
    }

    previousState[r.url] = r.status;
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(previousState, null, 2));

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

// Run
const results = await checkSites(SITES);
run(results);
