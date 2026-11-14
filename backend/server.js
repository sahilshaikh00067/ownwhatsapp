/**
 * WhatsApp QR Device Backend — Render-ready
 * Node.js + Express + whatsapp-web.js
 *
 * Device status flow:
 *   creating -> qr -> authenticated -> ready
 *   (any stage) -> error | disconnected
 *
 * Open  https://YOUR-APP.onrender.com/app  -> click "Connect WhatsApp" -> scan QR.
 * The same API is used by your React frontend (unchanged endpoints).
 */

"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Client, LocalAuth } = require("whatsapp-web.js");
const puppeteer = require("puppeteer");
const qrcode = require("qrcode");
const fs = require("fs");
const os = require("os");
const path = require("path");


/* =========================================================
   CONFIG
========================================================= */

const app = express();

const PORT = Number(process.env.PORT || 5000);
const NODE_ID = process.env.NODE_ID || "node1";
const MAX_DEVICES = Number(process.env.MAX_DEVICES || 20);
const API_KEY = process.env.API_KEY || "";

// Watchdogs: if a stage hangs, retry / show an error and close Chrome (frees RAM).
const INIT_TIMEOUT_MS = Number(process.env.INIT_TIMEOUT_MS || 3 * 60 * 1000);   // Chrome + WhatsApp Web load (until QR)
const QR_TIMEOUT_MS = Number(process.env.QR_TIMEOUT_MS || 3 * 60 * 1000);       // until the QR is scanned
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 5 * 60 * 1000); // chats load after scan
const PROTOCOL_TIMEOUT_MS = Number(process.env.PROTOCOL_TIMEOUT_MS || 5 * 60 * 1000);

// If QR does not appear in time, the server restarts Chrome by itself this many times.
const MAX_AUTO_RETRIES = Number(process.env.MAX_AUTO_RETRIES || 2);

// Optional: pin a WhatsApp Web version if the QR shows but "ready" never fires, e.g.
// WEB_VERSION_URL=https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/<version>.html
const WEB_VERSION_URL = process.env.WEB_VERSION_URL || "";

// On very low RAM (Render 512 MB) set CHROME_SINGLE_PROCESS=1 if Chrome keeps crashing.
const SINGLE_PROCESS = process.env.CHROME_SINGLE_PROCESS === "1";

// If Chrome is missing at runtime the server downloads it itself. Set CHROME_AUTO_INSTALL=0 to disable.
const CHROME_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, ".cache", "puppeteer");
const CHROME_AUTO_INSTALL = process.env.CHROME_AUTO_INSTALL !== "0";
const CHROME_INSTALL_TIMEOUT_MS = Number(process.env.CHROME_INSTALL_TIMEOUT_MS || 5 * 60 * 1000);

// Render: attach a Persistent Disk (paid) and set SESSIONS_DIR=/var/data/sessions,
// otherwise WhatsApp login sessions are wiped on every deploy / restart / sleep.
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, "sessions");

// LocalAuth stores each session in <dataPath>/session-<deviceId>
const AUTH_DIR = SESSIONS_DIR;

try {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
} catch (error) {
  console.error("SESSION DIRECTORY ERROR:", error.message);
}


/* =========================================================
   BUILT-IN TEST PAGE  ->  /app
   Mounted BEFORE helmet because it has inline script and its own CSP.
========================================================= */

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Connect</title>
<style>
  :root { color-scheme: light dark; --bg:#f4f6f8; --card:#fff; --text:#111b21; --muted:#667781; --green:#25d366; --red:#d93025; --border:#e2e8ec; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b141a; --card:#1f2c34; --text:#e9edef; --muted:#8696a0; --border:#2a3942; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:16px; }
  .card { width:100%; max-width:380px; background:var(--card); border:1px solid var(--border); border-radius:16px; padding:24px; text-align:center; }
  h1 { font-size:20px; margin:0 0 4px; }
  p.sub { margin:0 0 16px; color:var(--muted); font-size:14px; }
  input { width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:transparent; color:inherit; font-size:15px; margin-bottom:12px; }
  button { width:100%; padding:12px; border:0; border-radius:10px; font-size:16px; font-weight:600; cursor:pointer; background:var(--green); color:#04210f; margin-bottom:8px; }
  button.secondary { background:transparent; color:var(--text); border:1px solid var(--border); font-weight:500; font-size:14px; padding:9px; }
  #qrbox { margin:14px 0 6px; min-height:0; }
  #qrbox img { width:100%; max-width:300px; border-radius:12px; background:#fff; padding:8px; }
  #status { font-size:14px; margin-top:8px; color:var(--muted); white-space:pre-wrap; word-break:break-word; }
  #status.err { color:var(--red); }
  #status.ok { color:var(--green); font-weight:600; }
  .hide { display:none; }
</style>
</head>
<body>
<div class="card">
  <h1>Connect WhatsApp</h1>
  <p class="sub">Click the button, then scan the QR from WhatsApp &rarr; Linked devices.</p>
  <input id="dev" value="device1" maxlength="64" placeholder="Device ID" autocomplete="off">
  <button id="go">Connect WhatsApp</button>
  <div id="qrbox"></div>
  <div id="status">Ready.</div>
  <button id="retry" class="secondary hide">Retry (fresh QR)</button>
  <button id="logout" class="secondary hide">Logout / Delete device</button>
</div>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var timer = null;
  var busy = false;

  function devId() { return $("dev").value.trim().replace(/[^a-zA-Z0-9_-]/g, ""); }

  function api(p) {
    return fetch(p, { cache: "no-store" }).then(function (r) { return r.json(); });
  }

  function setStatus(text, cls) {
    var el = $("status");
    el.textContent = text;
    el.className = cls || "";
  }

  function setQr(src) {
    var box = $("qrbox");
    if (!src) { box.textContent = ""; return; }
    var img = box.querySelector("img");
    if (!img) { img = document.createElement("img"); img.alt = "WhatsApp QR"; box.appendChild(img); }
    if (img.src !== src) img.src = src;
  }

  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }

  function render(d) {
    var s = d.status;
    $("logout").classList.toggle("hide", s === "not_found");
    $("retry").classList.toggle("hide", !(s === "error" || s === "disconnected" || s === "not_found"));

    if (s === "ready") {
      setQr("");
      setStatus("Connected: +" + (d.number || "") + (d.name ? " (" + d.name + ")" : ""), "ok");
      stopPolling();
    } else if (s === "qr" && d.qr) {
      setQr(d.qr);
      setStatus("Scan this QR with your phone.", "");
    } else if (s === "authenticated") {
      setQr("");
      setStatus("Scanned. Loading chats, please wait...", "");
    } else if (s === "error" || s === "disconnected") {
      setQr("");
      setStatus(d.error || s, "err");
      stopPolling();
    } else if (s === "not_found") {
      setQr("");
      setStatus("Device not found. Click Connect.", "err");
      stopPolling();
    } else {
      setQr("");
      setStatus(d.note || "Starting Chrome and WhatsApp Web (can take up to a minute)...", "");
    }
  }

  function poll() {
    api("/get-qr?deviceId=" + encodeURIComponent(devId()))
      .then(render)
      .catch(function () { setStatus("Cannot reach server. Is it awake?", "err"); });
  }

  function start() {
    if (busy) return;
    var id = devId();
    if (!id) { setStatus("Enter a device ID.", "err"); return; }
    busy = true;
    stopPolling();
    setQr("");
    setStatus("Starting...", "");
    api("/create-device?deviceId=" + encodeURIComponent(id))
      .then(function () { poll(); timer = setInterval(poll, 5000); })
      .catch(function () { setStatus("Cannot reach server. Is it awake?", "err"); })
      .then(function () { busy = false; });
  }

  function retry() {
    var id = devId();
    stopPolling();
    setStatus("Resetting...", "");
    api("/delete-device?deviceId=" + encodeURIComponent(id)).then(start, start);
  }

  function logout() {
    var id = devId();
    stopPolling();
    setStatus("Logging out...", "");
    api("/logout?deviceId=" + encodeURIComponent(id)).then(function () {
      setQr("");
      setStatus("Device removed.", "");
      $("retry").classList.add("hide");
      $("logout").classList.add("hide");
    });
  }

  $("go").addEventListener("click", start);
  $("retry").addEventListener("click", retry);
  $("logout").addEventListener("click", logout);

  // If this device already exists on the server, show its state right away
  api("/get-qr?deviceId=" + encodeURIComponent(devId())).then(function (d) {
    if (d.status && d.status !== "not_found") { render(d); if (d.status !== "ready" && d.status !== "error" && d.status !== "disconnected") timer = setInterval(poll, 5000); }
  }).catch(function () {});
})();
</script>
</body>
</html>`;

app.get("/app", (req, res) => {
  res.set(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'"
  );
  res.set("Cache-Control", "no-store");
  res.type("html").send(PAGE_HTML);
});


/* =========================================================
   CHROME DETECTION + RUNTIME INSTALL
========================================================= */

const CHROME_NOT_FOUND_MSG =
  "CHROME_NOT_FOUND: Chrome is not installed on this server. " +
  "Deploy with the Dockerfile (recommended) or set Render Build Command to 'npm run build' " +
  "with puppeteer.config.cjs, then redeploy with 'Clear build cache & deploy'.";

function chromeCandidates() {
  const list = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH];

  try {
    list.push(puppeteer.executablePath());
  } catch (_) {
    /* ignore */
  }

  // Chrome downloaded by Puppeteer (project .cache, default cache folders, runtime install)
  const cacheRoots = [
    CHROME_CACHE_DIR,
    path.join(__dirname, ".cache", "puppeteer"),
    path.join(process.cwd(), ".cache", "puppeteer"),
    path.join(os.homedir(), ".cache", "puppeteer"),
    "/opt/render/.cache/puppeteer",
  ];

  for (const root of cacheRoots) {
    try {
      const base = path.join(root, "chrome");
      for (const version of fs.readdirSync(base).sort().reverse()) {
        list.push(path.join(base, version, "chrome-linux64", "chrome"));
        list.push(path.join(base, version, "chrome-linux", "chrome"));
      }
    } catch (_) {
      /* folder does not exist */
    }
  }

  // System installs (Docker / apt)
  list.push(
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome"
  );

  return [...new Set(list.filter(Boolean))];
}

const resolveChromePath = () => chromeCandidates().find((p) => fs.existsSync(p)) || "";

// @puppeteer/browsers ships with Puppeteer; find it even if npm nested it
function loadBrowsersApi() {
  try {
    return require("@puppeteer/browsers");
  } catch (_) {
    /* try next */
  }

  try {
    const from = path.dirname(require.resolve("puppeteer"));
    return require(require.resolve("@puppeteer/browsers", { paths: [from] }));
  } catch (_) {
    return null;
  }
}

async function installChrome() {
  const api = loadBrowsersApi();
  if (!api) throw new Error("@puppeteer/browsers module not found");

  const { install, Browser, detectBrowserPlatform, resolveBuildId } = api;

  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("this operating system is not supported by the Chrome downloader");

  // The Chrome version this Puppeteer release is built for
  let buildId = puppeteer.PUPPETEER_REVISIONS && puppeteer.PUPPETEER_REVISIONS.chrome;
  if (!buildId) buildId = await resolveBuildId(Browser.CHROME, platform, "stable");

  log("CHROME NOT FOUND. DOWNLOADING:", buildId, "->", CHROME_CACHE_DIR);

  let lastQuarter = -1;

  const options = {
    browser: Browser.CHROME,
    buildId,
    cacheDir: CHROME_CACHE_DIR,
    unpack: true,
    downloadProgressCallback: (downloaded, total) => {
      const quarter = total ? Math.floor((downloaded / total) * 4) : 0;

      if (quarter !== lastQuarter) {
        lastQuarter = quarter;
        log(`CHROME DOWNLOAD: ${Math.round(downloaded / 1048576)} / ${Math.round(total / 1048576)} MB`);
      }
    },
  };

  // Optional mirror (same variable Puppeteer itself uses)
  if (process.env.PUPPETEER_CHROME_DOWNLOAD_BASE_URL) {
    options.baseUrl = process.env.PUPPETEER_CHROME_DOWNLOAD_BASE_URL;
  }

  const installed = await install(options);

  log("CHROME INSTALLED:", installed.executablePath);
  return installed.executablePath;
}

let chromeInstallPromise = null;

// One download at a time, shared by every device that needs Chrome
function ensureChrome() {
  const found = resolveChromePath();
  if (found) return Promise.resolve(found);

  if (!CHROME_AUTO_INSTALL) return Promise.reject(new Error(CHROME_NOT_FOUND_MSG));

  if (!chromeInstallPromise) {
    chromeInstallPromise = withTimeout(installChrome(), CHROME_INSTALL_TIMEOUT_MS, "download timed out")
      .catch((error) => {
        throw new Error(
          `CHROME_INSTALL_FAILED: ${String(error.message || error).slice(0, 300)}. ` +
            "Deploy with the Dockerfile (recommended) or set Render Build Command to 'npm run build'."
        );
      })
      .finally(() => {
        chromeInstallPromise = null;
      });
  }

  return chromeInstallPromise;
}

let PUPPETEER_VERSION = "unknown";
try {
  PUPPETEER_VERSION = require("puppeteer/package.json").version;
} catch (_) {
  /* package.json not exported by this version */
}

const CHROME_PATH_AT_BOOT = resolveChromePath();

console.log("========================================");
console.log("PUPPETEER VERSION:", PUPPETEER_VERSION);
console.log("CHROME EXECUTABLE:", CHROME_PATH_AT_BOOT || "NOT FOUND");
console.log("CHROME EXISTS:", Boolean(CHROME_PATH_AT_BOOT));

if (!CHROME_PATH_AT_BOOT) {
  console.log("CHROME CACHE DIR:", CHROME_CACHE_DIR, fs.existsSync(CHROME_CACHE_DIR) ? "(exists)" : "(missing)");
  console.log("CHROME AUTO INSTALL:", CHROME_AUTO_INSTALL ? "ON (downloads on first Connect)" : "OFF");
  console.log("CWD:", process.cwd(), "| DIRNAME:", __dirname);
}

console.log("SESSIONS_DIR:", SESSIONS_DIR);
console.log("========================================");

function chromeArgs() {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-accelerated-2d-canvas",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-default-apps",
    // ONE --disable-features flag only (a second one overrides the first). site-per-process off saves RAM.
    "--disable-features=TranslateUI,site-per-process,IsolateOrigins",
    "--disable-ipc-flooding-protection",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-first-run",
    "--no-zygote",
    "--js-flags=--max-old-space-size=256",
  ];

  if (SINGLE_PROCESS) args.push("--single-process");

  return args;
}


/* =========================================================
   EXPRESS CONFIG
========================================================= */

app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: false }));

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// QR / status responses must never be cached by browser or proxy
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});


/* =========================================================
   API KEY (optional)
   NOTE: /app and the React app do not send x-api-key, so leave API_KEY
   unset on Render unless you also add the header in the frontend.
========================================================= */

if (API_KEY) {
  app.use((req, res, next) => {
    if (req.path === "/" || req.path === "/health") return next();

    if (req.get("x-api-key") !== API_KEY) {
      return res.status(401).json({ status: "unauthorized" });
    }

    next();
  });
}


/* =========================================================
   RATE LIMIT
========================================================= */

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);


/* =========================================================
   DEVICE STORAGE
========================================================= */

const clients = new Map();     // deviceId -> whatsapp-web.js Client
const devices = new Map();     // deviceId -> { status, qr, number, name, error, createdAt, updatedAt }
const watchers = new Map();    // deviceId -> watchdog timer
const pending = new Set();     // deviceIds that are inside createDevice() right now
const retrying = new Set();    // deviceIds waiting for an automatic retry
const retryCount = new Map();  // deviceId -> automatic retries used

const DEVICE_RE = /^[a-zA-Z0-9_-]{1,64}$/;


/* =========================================================
   HELPERS
========================================================= */

const now = () => new Date().toISOString();

const log = (...args) => console.log(`[${now()}]`, ...args);

const validDeviceId = (deviceId) =>
  typeof deviceId === "string" && DEVICE_RE.test(deviceId);

const getDeviceState = (deviceId) => devices.get(deviceId);

const isBusy = (deviceId) =>
  clients.has(deviceId) || pending.has(deviceId) || retrying.has(deviceId);

function setDeviceState(deviceId, patch) {
  const oldState = devices.get(deviceId) || {
    status: "creating",
    qr: "",
    number: "",
    name: "",
    error: "",
    note: "",
    createdAt: now(),
  };

  const newState = { ...oldState, ...patch, updatedAt: now() };
  devices.set(deviceId, newState);
  return newState;
}

// Only touch the state if nobody has started a fresh client for this device meanwhile
function failDevice(deviceId, patch) {
  if (clients.has(deviceId)) return;
  setDeviceState(deviceId, { qr: "", number: "", name: "", note: "", ...patch });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || "TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const sessionPath = (deviceId) => path.join(AUTH_DIR, `session-${deviceId}`);

function deleteSessionFiles(deviceId) {
  try {
    fs.rmSync(sessionPath(deviceId), { recursive: true, force: true });
    log("SESSION DELETED:", deviceId);
  } catch (error) {
    log("SESSION DELETE ERROR:", error.message);
  }
}

// A crashed Chrome leaves lock files behind and the next launch fails with "profile in use"
function clearChromeLocks(deviceId) {
  for (const file of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.rmSync(path.join(sessionPath(deviceId), file), { force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

async function safeDestroy(client) {
  if (!client) return;

  try {
    await withTimeout(client.destroy(), 15000, "DESTROY_TIMEOUT");
  } catch (error) {
    log("CLIENT DESTROY ERROR:", error.message);

    // Chrome stuck? Kill the process so it does not keep eating RAM
    try {
      const proc = client.pupBrowser && client.pupBrowser.process && client.pupBrowser.process();
      if (proc) proc.kill("SIGKILL");
    } catch (_) {
      /* ignore */
    }
  }
}

function clearWatch(deviceId) {
  const timer = watchers.get(deviceId);
  if (timer) {
    clearTimeout(timer);
    watchers.delete(deviceId);
  }
}

// Close the client and forget it. Device state is kept so the UI can still read the error.
async function teardownClient(deviceId) {
  clearWatch(deviceId);

  const client = clients.get(deviceId);
  clients.delete(deviceId);

  await safeDestroy(client);
}

async function removeDevice(deviceId, deleteSession = true) {
  retryCount.delete(deviceId);
  retrying.delete(deviceId);

  await teardownClient(deviceId);
  devices.delete(deviceId);

  if (deleteSession) deleteSessionFiles(deviceId);
}

// Restart Chrome automatically (QR did not come / Chrome failed to start). Returns false when no retries are left.
function scheduleRetry(deviceId, reason) {
  const used = retryCount.get(deviceId) || 0;

  if (used >= MAX_AUTO_RETRIES || !devices.has(deviceId)) return false;

  retryCount.set(deviceId, used + 1);
  retrying.add(deviceId);

  log(`AUTO RETRY ${used + 1}/${MAX_AUTO_RETRIES}:`, deviceId, "|", String(reason || "").slice(0, 120));

  setDeviceState(deviceId, {
    status: "creating",
    qr: "",
    error: "",
    note: `Restarting Chrome automatically (${used + 1}/${MAX_AUTO_RETRIES})...`,
  });

  setTimeout(() => {
    retrying.delete(deviceId);

    if (!devices.has(deviceId)) return; // deleted meanwhile

    createDevice(deviceId).catch((error) => {
      console.error("RETRY CREATE ERROR:", deviceId, error.message);
    });
  }, 3000);

  return true;
}

// If the device is still in `expectedStatus` after `ms`, close it and store `patch` as the new state
function watch(deviceId, expectedStatus, ms, patch, options = {}) {
  clearWatch(deviceId);

  const timer = setTimeout(async () => {
    watchers.delete(deviceId);

    const state = devices.get(deviceId);
    if (!state || state.status !== expectedStatus) return;

    log(`WATCHDOG: ${deviceId} stuck in "${expectedStatus}" for ${Math.round(ms / 1000)}s`);

    await teardownClient(deviceId);

    if (options.retry && scheduleRetry(deviceId, patch.error)) return;

    failDevice(deviceId, patch);

    if (options.deleteSession) deleteSessionFiles(deviceId);
  }, ms);

  watchers.set(deviceId, timer);
}

async function getWhatsAppState(deviceId) {
  const client = clients.get(deviceId);
  if (!client) return null;

  try {
    return await withTimeout(client.getState(), 8000, "GET_STATE_TIMEOUT");
  } catch (_) {
    return null;
  }
}

function normalizeNumber(number) {
  const digits = String(number || "").replace(/\D/g, "");

  if (digits.length < 8 || digits.length > 15) return null;

  return `${digits}@c.us`;
}


/* =========================================================
   WHATSAPP EVENTS
========================================================= */

function attachEvents(client, deviceId, isCurrent) {
  client.on("qr", async (qr) => {
    if (!isCurrent()) return;

    try {
      log("QR RECEIVED:", deviceId);

      const qrDataUrl = await qrcode.toDataURL(qr, {
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 8,
      });

      if (!isCurrent()) return;

      const firstQr = getDeviceState(deviceId)?.status !== "qr";

      setDeviceState(deviceId, { status: "qr", qr: qrDataUrl, error: "", note: "" });

      // Timer starts at the first QR only (WhatsApp stops refreshing it after ~2 minutes)
      if (firstQr) {
        retryCount.delete(deviceId); // Chrome works, so reset the auto-retry counter

        watch(
          deviceId,
          "qr",
          QR_TIMEOUT_MS,
          { status: "disconnected", error: "QR_EXPIRED: The QR was not scanned in time. Click Retry to get a new one." },
          { deleteSession: true }
        );
      }
    } catch (error) {
      console.error("QR GENERATION ERROR:", deviceId, error);
      setDeviceState(deviceId, {
        status: "error",
        qr: "",
        error: `QR_GENERATION_ERROR: ${error.message}`,
      });
    }
  });

  client.on("loading_screen", (percent, message) => {
    if (isCurrent()) log("LOADING:", deviceId, `${percent}%`, message);
  });

  client.on("authenticated", () => {
    if (!isCurrent()) return;

    log("AUTHENTICATED:", deviceId);
    setDeviceState(deviceId, { status: "authenticated", qr: "", error: "" });

    watch(deviceId, "authenticated", READY_TIMEOUT_MS, {
      status: "error",
      error: "READY_TIMEOUT: WhatsApp took too long to load chats. Click Retry.",
    });
  });

  client.on("ready", () => {
    if (!isCurrent()) return;

    clearWatch(deviceId);
    retryCount.delete(deviceId);

    const info = client.info;
    const number = info?.wid?.user || "";
    const name = info?.pushname || "";

    setDeviceState(deviceId, { status: "ready", qr: "", error: "", note: "", number, name });

    log("WHATSAPP READY:", deviceId, "| NUMBER:", number, "| NAME:", name);
  });

  client.on("auth_failure", async (message) => {
    if (!isCurrent()) return;

    console.error("AUTH FAILURE:", deviceId, message);

    await teardownClient(deviceId);
    failDevice(deviceId, {
      status: "error",
      error: `AUTH_FAILURE: ${message || "Unknown authentication failure"}. Click Retry to link again.`,
    });

    // Saved session is invalid, so the next attempt must start with a fresh QR
    deleteSessionFiles(deviceId);
  });

  client.on("disconnected", async (reason) => {
    if (!isCurrent()) return;

    log("DEVICE DISCONNECTED:", deviceId, reason);

    await teardownClient(deviceId);
    failDevice(deviceId, {
      status: "disconnected",
      error: String(reason || "Disconnected"),
    });

    // Unlinked from the phone => session is dead
    if (String(reason).toUpperCase() === "LOGOUT") deleteSessionFiles(deviceId);
  });
}


/* =========================================================
   CREATE WHATSAPP DEVICE
========================================================= */

async function createDevice(deviceId) {
  if (!validDeviceId(deviceId)) throw new Error("INVALID_DEVICE_ID");

  if (isBusy(deviceId)) return clients.get(deviceId);

  if (new Set([...clients.keys(), ...pending, ...retrying]).size >= MAX_DEVICES) {
    const message = `MAX_DEVICES_REACHED: server allows ${MAX_DEVICES} devices. Delete an unused device first.`;
    setDeviceState(deviceId, { status: "error", qr: "", number: "", name: "", error: message });
    throw new Error(message);
  }

  pending.add(deviceId);

  // State is set BEFORE anything can fail, so /get-qr never answers "not_found" for a device being created
  setDeviceState(deviceId, { status: "creating", qr: "", number: "", name: "", error: "", note: "" });

  let client = null;
  const isCurrent = () => client !== null && clients.get(deviceId) === client;

  try {
    let chromePath = resolveChromePath();

    if (!chromePath) {
      if (CHROME_AUTO_INSTALL) {
        setDeviceState(deviceId, {
          note: "Downloading Chrome on the server (first time only, about 1-2 minutes)...",
        });
      }

      chromePath = await ensureChrome();

      // Deleted (or failed) while Chrome was downloading
      if (devices.get(deviceId)?.status !== "creating") return null;

      setDeviceState(deviceId, { note: "" });
    }

    clearChromeLocks(deviceId);

    log("========================================");
    log("CREATING WHATSAPP DEVICE:", deviceId);
    log("CHROME PATH:", chromePath);
    log("========================================");

    const clientOptions = {
      authStrategy: new LocalAuth({ clientId: deviceId, dataPath: AUTH_DIR }),

      puppeteer: {
        executablePath: chromePath,
        headless: true,
        args: chromeArgs(),
        timeout: 180000,
        protocolTimeout: PROTOCOL_TIMEOUT_MS,
      },

      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
    };

    if (WEB_VERSION_URL) {
      clientOptions.webVersionCache = { type: "remote", remotePath: WEB_VERSION_URL };
    }

    client = new Client(clientOptions);

    clients.set(deviceId, client);
    attachEvents(client, deviceId, isCurrent);

    watch(
      deviceId,
      "creating",
      INIT_TIMEOUT_MS,
      {
        status: "error",
        error:
          "INIT_TIMEOUT: Chrome / WhatsApp Web did not load in time. " +
          "The server is probably too slow or out of memory (Chrome needs about 1 GB RAM). Click Retry or use a bigger instance.",
      },
      { retry: true }
    );

    log("INITIALIZING WHATSAPP:", deviceId);

    await client.initialize();

    return client;
  } catch (error) {
    console.error("CREATE DEVICE ERROR:", deviceId, error);

    // Ignore errors caused by our own teardown / watchdog / delete
    if (devices.has(deviceId) && (client === null || isCurrent())) {
      if (client) await teardownClient(deviceId);
      else clearWatch(deviceId);

      const raw = String(error.message || error).slice(0, 700);
      const message = /^[A-Z_]{4,}:/.test(raw) ? raw : `INITIALIZE_ERROR: ${raw}`;

      // Chrome failed to start / page failed to load: try again by itself before showing an error
      const retryable = client !== null && !/^(CHROME_|MAX_DEVICES|INVALID_)/.test(message);

      if (!(retryable && scheduleRetry(deviceId, message))) {
        failDevice(deviceId, { status: "error", error: message });
      }
    }

    throw error;
  } finally {
    pending.delete(deviceId);
  }
}


/* =========================================================
   ROUTES
========================================================= */

app.get("/", (req, res) => {
  res.json({ status: "ok", node: NODE_ID, app: "/app" });
});


/* ---------- HEALTH ---------- */

app.get("/health", async (req, res) => {
  const list = [];

  for (const [deviceId, data] of devices.entries()) {
    const waState = data.status === "ready" ? await getWhatsAppState(deviceId) : null;

    list.push({
      deviceId,
      status: data.status,
      number: data.number,
      name: data.name,
      waState,
      error: data.error,
      note: data.note,
    });
  }

  const chromePath = resolveChromePath();

  const body = {
    status: "ok",
    node: NODE_ID,
    uptime: Math.floor(process.uptime()),
    chromePath,
    chromeExists: Boolean(chromePath),
    chromeInstalling: Boolean(chromeInstallPromise),
    chromeAutoInstall: CHROME_AUTO_INSTALL,
    memoryMB: {
      rss: Math.round(process.memoryUsage().rss / 1048576),
      systemFree: Math.round(os.freemem() / 1048576),
      systemTotal: Math.round(os.totalmem() / 1048576),
    },
    devices: list,
    totalDevices: clients.size,
    maxDevices: MAX_DEVICES,
  };

  // /health?debug=1 shows where the server looked for Chrome
  if (req.query.debug === "1") {
    body.debug = {
      cwd: process.cwd(),
      dirname: __dirname,
      cacheDir: CHROME_CACHE_DIR,
      cacheDirExists: fs.existsSync(CHROME_CACHE_DIR),
      candidates: chromeCandidates().map((p) => ({ path: p, exists: fs.existsSync(p) })),
    };
  }

  return res.json(body);
});


/* ---------- CREATE DEVICE ---------- */

app.get("/create-device", (req, res) => {
  const deviceId = String(req.query.deviceId || "");

  if (!validDeviceId(deviceId)) {
    return res.status(400).json({ status: "failed", message: "Invalid deviceId" });
  }

  if (isBusy(deviceId)) {
    const data = getDeviceState(deviceId);

    return res.json({
      status: "already_exists",
      deviceId,
      qr: data?.qr || "",
      ready: data?.status === "ready",
      exists: true,
      error: data?.error || "",
      note: data?.note || "",
    });
  }

  // Fresh manual start: reset the automatic retry counter
  retryCount.delete(deviceId);

  // Runs in the background; its synchronous part already sets the device state
  createDevice(deviceId).catch((error) => {
    console.error("BACKGROUND CREATE ERROR:", deviceId, error.message);
  });

  const data = getDeviceState(deviceId);

  // Failed immediately (e.g. too many devices): tell the frontend right away
  if (data?.status === "error") {
    return res.json({
      status: "error",
      deviceId,
      qr: "",
      ready: false,
      exists: false,
      error: data.error,
      node: NODE_ID,
    });
  }

  return res.json({
    status: "creating",
    deviceId,
    qr: "",
    ready: false,
    exists: false,
    note: data?.note || "",
    node: NODE_ID,
  });
});


/* ---------- GET QR ---------- */

app.get("/get-qr", (req, res) => {
  const deviceId = String(req.query.deviceId || "");

  if (!validDeviceId(deviceId)) {
    return res.status(400).json({ status: "failed", message: "Invalid deviceId" });
  }

  const data = getDeviceState(deviceId);

  if (!data) {
    return res.json({
      status: "not_found",
      deviceId,
      qr: "",
      ready: false,
      exists: false,
      error: "",
    });
  }

  return res.json({
    status: data.status,
    deviceId,
    qr: data.qr || "",
    ready: data.status === "ready",
    exists: clients.has(deviceId),
    error: data.error || "",
    note: data.note || "",
    number: data.number || "",
    name: data.name || "",
  });
});


/* ---------- GET DEVICE ---------- */

app.get("/get-device", async (req, res) => {
  const deviceId = String(req.query.deviceId || "");
  const data = getDeviceState(deviceId);

  if (!data) {
    return res.json({
      deviceId,
      status: "not_found",
      ready: false,
      exists: false,
      number: "",
      name: "",
      error: "",
    });
  }

  // Ask WhatsApp only when the device is ready (a busy page would hang the request)
  const waState = data.status === "ready" ? await getWhatsAppState(deviceId) : null;

  return res.json({
    deviceId,
    status: data.status,
    ready: data.status === "ready",
    exists: clients.has(deviceId),
    number: data.number || "",
    name: data.name || "",
    waState,
    error: data.error || "",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  });
});


/* ---------- DEVICE STATE ---------- */

app.get("/device-state", async (req, res) => {
  const deviceId = String(req.query.deviceId || "");
  const data = getDeviceState(deviceId);

  if (!data) {
    return res.status(404).json({ status: "not_found" });
  }

  const waState = data.status === "ready" ? await getWhatsAppState(deviceId) : null;

  return res.json({
    deviceId,
    backendStatus: data.status,
    waState,
    ready: data.status === "ready",
    hasQr: Boolean(data.qr),
    error: data.error || "",
  });
});


/* ---------- LIST DEVICES ---------- */

app.get("/list-devices", (req, res) => {
  const list = [];

  for (const [deviceId, data] of devices.entries()) {
    list.push({
      deviceId,
      status: data.status,
      ready: data.status === "ready",
      number: data.number || "",
      name: data.name || "",
      error: data.error || "",
    });
  }

  return res.json({ devices: list, total: list.length, node: NODE_ID });
});


/* ---------- DELETE DEVICE ---------- */

app.get("/delete-device", async (req, res) => {
  const deviceId = String(req.query.deviceId || "");

  if (!validDeviceId(deviceId)) {
    return res.status(400).json({ status: "failed", message: "Invalid deviceId" });
  }

  if (!clients.has(deviceId) && !devices.has(deviceId)) {
    return res.json({ status: "not_found" });
  }

  await removeDevice(deviceId, true);

  return res.json({ status: "deleted", deviceId });
});


/* ---------- LOGOUT ---------- */

app.get("/logout", async (req, res) => {
  const deviceId = String(req.query.deviceId || "");

  if (!validDeviceId(deviceId)) {
    return res.status(400).json({ status: "failed", message: "Invalid deviceId" });
  }

  const client = clients.get(deviceId);

  if (!client && !devices.has(deviceId)) {
    return res.json({ status: "not_found" });
  }

  if (client) {
    try {
      await withTimeout(client.logout(), 20000, "LOGOUT_TIMEOUT");
    } catch (error) {
      log("LOGOUT ERROR:", error.message);
    }
  }

  await removeDevice(deviceId, true);

  return res.json({ status: "logged_out", deviceId });
});


/* ---------- SEND SINGLE MESSAGE ---------- */

app.post("/send-single", async (req, res) => {
  const body = req.body || {}; // Express 5: req.body is undefined when no body was sent
  const deviceId = String(body.deviceId || "");
  const number = normalizeNumber(body.number);
  const message = String(body.message || "").trim();

  if (!validDeviceId(deviceId)) {
    return res.status(400).json({ status: "failed", message: "Valid deviceId required" });
  }

  if (!number) {
    return res.status(400).json({ status: "failed", message: "Valid number required" });
  }

  if (!message) {
    return res.status(400).json({ status: "failed", message: "Message required" });
  }

  if (message.length > 4096) {
    return res.status(400).json({ status: "failed", message: "Message too long" });
  }

  const client = clients.get(deviceId);
  const data = getDeviceState(deviceId);

  if (!client || !data || data.status !== "ready") {
    return res.status(409).json({ status: "failed", message: "Device not ready" });
  }

  try {
    const waState = await getWhatsAppState(deviceId);

    if (waState && waState !== "CONNECTED") {
      return res.status(409).json({
        status: "failed",
        message: `WhatsApp not connected: ${waState}`,
      });
    }

    const registered = await client.isRegisteredUser(number);

    if (!registered) {
      return res.json({ status: "nonwa" });
    }

    const result = await client.sendMessage(number, message);

    return res.json({
      status: "sent",
      messageId: result?.id?._serialized || "",
    });
  } catch (error) {
    console.error("SEND ERROR:", error);

    return res.status(500).json({
      status: "failed",
      message: error.message || "Send failed",
    });
  }
});


/* =========================================================
   RESTORE SESSIONS (after restart, needs a persistent SESSIONS_DIR)
========================================================= */

async function restoreSessions() {
  if (process.env.RESTORE_SESSIONS === "0") {
    log("SESSION RESTORE DISABLED");
    return;
  }

  let folders = [];

  try {
    folders = fs
      .readdirSync(AUTH_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("session-"))
      .map((entry) => entry.name);
  } catch (error) {
    log("SESSION READ ERROR:", error.message);
    return;
  }

  log(`FOUND ${folders.length} SAVED SESSIONS`);

  for (const folder of folders) {
    const deviceId = folder.replace(/^session-/, "");

    if (!validDeviceId(deviceId)) continue;

    log("RESTORING DEVICE:", deviceId);

    createDevice(deviceId).catch((error) => {
      console.error("RESTORE ERROR:", deviceId, error.message);
    });

    // Start Chrome one by one so a small server does not choke
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}


/* =========================================================
   BROWSER CRASH SWEEPER (Chrome killed / out of memory)
========================================================= */

setInterval(() => {
  for (const [deviceId, client] of [...clients.entries()]) {
    const state = devices.get(deviceId);
    if (!state || state.status === "creating") continue;

    const browser = client.pupBrowser;

    if (browser && typeof browser.isConnected === "function" && !browser.isConnected()) {
      log("BROWSER CRASHED:", deviceId);

      teardownClient(deviceId).then(() =>
        failDevice(deviceId, {
          status: "error",
          error:
            "BROWSER_CRASHED: Chrome stopped, usually because the server ran out of memory. " +
            "Click Retry. If it keeps happening, use a bigger Render instance (1 GB+).",
        })
      );
    }
  }
}, 30 * 1000).unref();


/* =========================================================
   EXPRESS ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {
  console.error("EXPRESS ERROR:", error);

  return res.status(500).json({
    status: "failed",
    message: error.message || "Internal server error",
  });
});


/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, "0.0.0.0", async (error) => {
  // Express 5 passes startup errors (e.g. port already in use) to this callback
  if (error) {
    console.error("LISTEN ERROR:", error);
    process.exit(1);
  }

  log("========================================");
  log(`SERVER RUNNING ON PORT ${PORT}`);
  log(`NODE ID: ${NODE_ID}`);
  log(`MAX DEVICES: ${MAX_DEVICES}`);
  log(`CHROME PATH: ${CHROME_PATH_AT_BOOT || "NOT FOUND"}`);
  log(`OPEN THE TEST PAGE: /app`);
  log("========================================");

  await restoreSessions();
});


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown(signal) {
  log(`${signal}: SHUTTING DOWN`);

  await Promise.allSettled([...clients.values()].map((client) => safeDestroy(client)));

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));


/* =========================================================
   UNCAUGHT ERRORS
========================================================= */

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});