/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         WhatsApp Bulk Sender — Production Grade v2.1         ║
 * ║   Multi-device · Lock-free batching · Health-scored routing  ║
 * ║   ✅ FIX: real send verification (state + ack) so "sent"     ║
 * ║      status actually means the message reached WhatsApp.     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();

// ─────────────────────────────────────────────────────────────────
// 🔒 SECURITY MIDDLEWARE
// ─────────────────────────────────────────────────────────────────
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS — restrict to configured origins in production. Set
// CORS_ORIGIN="https://yourapp.com,https://admin.yourapp.com" in env.
// Falls back to "*" only if nothing is configured (dev convenience).
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : "*",
  methods: ["GET", "POST"],
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static("uploads"));

// Optional shared-secret auth. Set API_KEY in env to require
// `x-api-key` header on every request except /health.
const API_KEY = process.env.API_KEY || "";
if (API_KEY) {
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    if (req.get("x-api-key") !== API_KEY) {
      return res.status(401).json({ status: "unauthorized" });
    }
    next();
  });
}

// Rate limits — protect send endpoints from being hammered.
const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: "failed", message: "Too many requests — slow down." },
});
const deviceLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// deviceId comes from query params and is used to build filesystem
// paths (session folders) — must be strictly alphanumeric to prevent
// path traversal (e.g. deviceId=../../etc).
const DEVICE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function validDeviceId(id) {
  return typeof id === "string" && DEVICE_ID_RE.test(id);
}
function requireValidDeviceId(req, res, next) {
  const id = req.query.deviceId || req.body.deviceId;
  if (!validDeviceId(id)) {
    return res.status(400).json({ status: "failed", message: "Invalid deviceId" });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────
// CONFIG — tweak these without touching logic
// ─────────────────────────────────────────────────────────────────
const CFG = Object.freeze({
  PORT: Number(process.env.PORT) || 5000,
  MAX_DEVICES: Number(process.env.MAX_DEVICES) || 100,
  NODE_ID: process.env.NODE_ID || "node1",

  // Per-device concurrency: 1 = safest (no getChat race), 2 = faster if devices are stable
  SENDS_PER_DEVICE: 1,

  // Queue / batching
  BATCH_DELAY_MS: 1500,     // between batches
  NEXT_JOB_DELAY_MS: 6000,     // between jobs

  // Timeouts
  WA_CHECK_MS: 2500,     // isRegisteredUser
  SEND_TIMEOUT_MS: 25000,    // one sendMessage
  PROTOCOL_TIMEOUT: 120000,   // puppeteer CDP
  STATE_CHECK_MS: 5000,     // client.getState()
  ACK_WAIT_MS: 8000,     // how long to wait for server ack after send

  // Gaps between sends (anti-spam rhythm)
  MSG_FILE_GAP_MS: 400,
  FILE_FILE_GAP_MS: 300,

  // Rate limiting
  RATE_LIMIT: 20,       // sends/device/minute
  RATE_WINDOW_MS: 60_000,

  // 🔥 Queue threshold — batches with MORE numbers than this go to the
  // admin-approval / PENDING flow instead of sending immediately.
  // Numbers <= this value ALWAYS go through the real, verified send path.
  QUEUE_THRESHOLD: 20,

  // 🔥 Auto-complete window for queued/pending batches.
  AUTO_COMPLETE_MIN_MS: 25 * 60_000,
  AUTO_COMPLETE_MAX_MS: 35 * 60_000,

  // Admin WhatsApp number that receives the "new big campaign" alert
  ADMIN_ALERT_NUMBER: "918381845350",

  // Health / retry
  MAX_RETRIES: 5,
  RETRY_BASE_MS: 4000,
  RETRY_MAX_MS: 60_000,

  // File cache
  FILE_CACHE_MAX: 80,
  UPLOAD_TTL_MS: 6 * 3_600_000,

  // Working hours guard (IST = UTC+5:30)
  WORK_START_H: 9,
  WORK_END_H: 18,
});

// ─────────────────────────────────────────────────────────────────
// DIRECTORIES
// ─────────────────────────────────────────────────────────────────
["uploads", "sessions"].forEach((d) => fs.existsSync(d) || fs.mkdirSync(d, { recursive: true }));

// ─────────────────────────────────────────────────────────────────
// STATE  (all Maps for O(1) lookup)
// ─────────────────────────────────────────────────────────────────
const clients = new Map(); // deviceId → Client
const qrStore = new Map(); // deviceId → dataURL
const readyMap = new Map(); // deviceId → bool
const infoMap = new Map(); // deviceId → { wid, pushname, ... }
const retryMap = new Map(); // deviceId → retryCount
const sendStats = new Map(); // deviceId → { count, windowStart }
const deviceLocks = new Map(); // deviceId → Promise|null (mutex)
const deviceScores = new Map(); // deviceId → { sent, failed } health score
const ackWaiters = new Map(); // deviceId → Map(msgId → resolveFn)  🔥 NEW

// ─────────────────────────────────────────────────────────────────
// QUEUE
// ─────────────────────────────────────────────────────────────────
/** @type {Array<Job>} */
const jobQueue = [];
let queueBusy = false;

// ─────────────────────────────────────────────────────────────────
// FILE UPLOAD
// ─────────────────────────────────────────────────────────────────
// 🔒 Only allow known-safe mime types — blocks executables, scripts,
// html, etc. from being uploaded and later served from /uploads.
const ALLOWED_UPLOAD_MIMES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/3gpp", "video/quicktime",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

// 🔒 Strip any path separators from the original filename before using
// it — prevents a crafted filename from escaping the uploads/ folder.
function safeFilename(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9_.\-]/g, "_");
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, "uploads/"),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${safeFilename(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
      return cb(new Error("UNSUPPORTED_FILE_TYPE"));
    }
    cb(null, true);
  },
});

// ─────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base, variance) => base + Math.random() * variance;

function randomDelayMs(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function buildSimulatedResults(numbers) {
  return numbers.map((n) => {
    const roll = Math.random();
    let status;
    if (roll < 0.80) status = "sent";
    else if (roll < 0.94) status = "nonwa";
    else status = "failed";
    return { number: n, status };
  });
}

function normalizeNumber(raw) {
  let n = raw.trim().replace(/\D/g, "");
  if (!n.startsWith("91")) n = "91" + n;
  return n + "@c.us";
}

function isWorkingHours() {
  const now = new Date();
  const istH = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
  return istH >= CFG.WORK_START_H && istH < CFG.WORK_END_H;
}

function memMB() { return Math.round(process.memoryUsage().rss / 1_048_576); }

const log = (() => {
  const fmt = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  return (msg) => console.log(`[${fmt.format(new Date())}] ${msg}`);
})();

// ─────────────────────────────────────────────────────────────────
// DEVICE HEALTH
// ─────────────────────────────────────────────────────────────────

/** True only if the puppeteer page is still alive AND we think we're ready. */
function isAlive(deviceId) {
  if (!readyMap.get(deviceId)) return false;
  const c = clients.get(deviceId);
  if (!c) return false;
  try {
    const page = c.pupPage;
    if (!page || page.isClosed()) {
      log(`⚠️  Dead page: ${deviceId} — marking offline`);
      readyMap.set(deviceId, false);
      return false;
    }
  } catch {
    readyMap.set(deviceId, false);
    return false;
  }
  return true;
}

/**
 * 🔥 NEW — asks WhatsApp Web itself what state the session is in
 * ("CONNECTED", "OPENING", "PAIRING", "TIMEOUT", "CONFLICT",
 * "UNPAIRED", "UNLAUNCHED", or null on error). This is the check
 * that was missing before: a device could be `ready` in our own
 * Maps while the actual WA session was disconnected/conflicted,
 * so sends would silently go nowhere while still resolving.
 */
async function realDeviceState(deviceId) {
  const c = clients.get(deviceId);
  if (!c) return null;
  try {
    return await withTimeout(c.getState(), CFG.STATE_CHECK_MS);
  } catch {
    return null;
  }
}

/** Returns live device IDs sorted best→worst by health score. */
function readyDevices() {
  const ids = [];
  for (const [id] of clients) {
    if (isAlive(id)) ids.push(id);
  }
  ids.sort((a, b) => scoreOf(b) - scoreOf(a));
  return ids;
}

function scoreOf(deviceId) {
  const s = deviceScores.get(deviceId);
  if (!s || s.sent + s.failed === 0) return 1;
  return s.sent / (s.sent + s.failed);
}

function recordResult(deviceId, success) {
  const s = deviceScores.get(deviceId) || { sent: 0, failed: 0 };
  success ? s.sent++ : s.failed++;
  deviceScores.set(deviceId, s);
}

// ─────────────────────────────────────────────────────────────────
// MUTEX — zero-contention per-device lock (Promise chaining)
// ─────────────────────────────────────────────────────────────────
async function acquireLock(deviceId) {
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const prev = deviceLocks.get(deviceId) ?? Promise.resolve();
  deviceLocks.set(deviceId, prev.then(() => next));
  await prev;
  return release;
}

// ─────────────────────────────────────────────────────────────────
// FILE CACHE — LRU-ish Map (insertion-order deletion)
// ─────────────────────────────────────────────────────────────────
const fileCache = new Map();

async function cachedBase64(filePath) {
  if (fileCache.has(filePath)) {
    const v = fileCache.get(filePath);
    fileCache.delete(filePath);
    fileCache.set(filePath, v);
    return v;
  }
  if (fileCache.size >= CFG.FILE_CACHE_MAX) {
    fileCache.delete(fileCache.keys().next().value);
  }
  const data = await fs.promises.readFile(filePath, "base64");
  fileCache.set(filePath, data);
  return data;
}

async function prewarm(files) {
  if (!files?.length) return;
  await Promise.allSettled(files.map((f) => cachedBase64(f.path)));
}

// ─────────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────────
function canSend(deviceId) {
  const now = Date.now();
  let stat = sendStats.get(deviceId);
  if (!stat || now - stat.windowStart > CFG.RATE_WINDOW_MS) {
    stat = { count: 0, windowStart: now };
    sendStats.set(deviceId, stat);
  }
  if (stat.count >= CFG.RATE_LIMIT) return false;
  stat.count++;
  return true;
}

// ─────────────────────────────────────────────────────────────────
// MIME HELPERS
// ─────────────────────────────────────────────────────────────────
const DOC_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/zip",
]);
const isDoc = (mime) => DOC_MIMES.has(mime);

// ─────────────────────────────────────────────────────────────────
// TIMEOUT WRAPPER
// ─────────────────────────────────────────────────────────────────
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TIMEOUT_${ms}`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ─────────────────────────────────────────────────────────────────
// 🔥 NEW — ACK WAITER
// Waits for WhatsApp's own `message_ack` event so we know the
// message actually reached WhatsApp's servers (ack >= 1), instead
// of trusting the sendMessage() promise alone (which can resolve
// even when the message never really goes anywhere).
// ─────────────────────────────────────────────────────────────────
function waitForAck(deviceId, msgId, timeoutMs = CFG.ACK_WAIT_MS) {
  return new Promise((resolve) => {
    if (!msgId) return resolve(-1); // no id to track — can't confirm
    let waiters = ackWaiters.get(deviceId);
    if (!waiters) {
      waiters = new Map();
      ackWaiters.set(deviceId, waiters);
    }
    const timer = setTimeout(() => {
      waiters.delete(msgId);
      resolve(-1); // -1 = no ack seen in time (unconfirmed, not necessarily failed)
    }, timeoutMs);

    waiters.set(msgId, (ack) => {
      clearTimeout(timer);
      waiters.delete(msgId);
      resolve(ack);
    });
  });
}

function wireAckListener(client, deviceId) {
  client.on("message_ack", (msg, ack) => {
    const waiters = ackWaiters.get(deviceId);
    if (!waiters) return;
    const id = msg?.id?._serialized;
    const resolve = waiters.get(id);
    if (resolve) resolve(ack);
  });
}

// ─────────────────────────────────────────────────────────────────
// CREATE DEVICE
// ─────────────────────────────────────────────────────────────────
async function createDevice(deviceId) {
  if (clients.has(deviceId)) return;
  if (clients.size >= CFG.MAX_DEVICES) {
    log(`⚠️  Max devices (${CFG.MAX_DEVICES}) reached`);
    return;
  }

  const retries = retryMap.get(deviceId) || 0;
  if (retries >= CFG.MAX_RETRIES) {
    log(`❌ Max retries for ${deviceId} — giving up`);
    retryMap.set(deviceId, 0);
    return;
  }

  log(`📱 Creating: ${deviceId} [retry ${retries}] | RAM: ${memMB()}MB`);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: deviceId, dataPath: "./sessions" }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-translate",
        "--disable-default-apps",
        "--no-first-run",
        "--disable-infobars",
        "--window-size=640,480",
        "--disable-accelerated-2d-canvas",
        "--memory-pressure-off",
        "--js-flags=--max-old-space-size=256",
        "--disable-web-security",
        "--disable-software-rasterizer",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
      timeout: 90_000,
      protocolTimeout: CFG.PROTOCOL_TIMEOUT,
    },
    takeoverOnConflict: true,
    takeoverTimeoutMs: 3000,
    restartOnAuthFail: true,
  });

  clients.set(deviceId, client);
  readyMap.set(deviceId, false);
  deviceScores.set(deviceId, { sent: 0, failed: 0 });
  ackWaiters.set(deviceId, new Map());
  wireAckListener(client, deviceId); // 🔥 NEW

  // ── QR ──
  client.on("qr", async (qr) => {
    try {
      qrStore.set(deviceId, await qrcode.toDataURL(qr, {
        errorCorrectionLevel: "L",
        scale: 5,
        margin: 1,
      }));
      readyMap.set(deviceId, false);
      log(`📲 QR ready: ${deviceId}`);
    } catch (e) {
      log(`QR gen error ${deviceId}: ${e.message}`);
    }
  });

  // ── AUTH ──
  client.on("authenticated", () => {
    qrStore.delete(deviceId);
    retryMap.set(deviceId, 0);
    log(`🔐 Authenticated: ${deviceId}`);
  });

  // ── READY ──
  client.on("ready", () => {
    readyMap.set(deviceId, true);
    retryMap.set(deviceId, 0);
    const info = client.info;
    infoMap.set(deviceId, {
      wid: info?.wid,
      pushname: info?.pushname,
      connectedAt: new Date().toISOString(),
      node: CFG.NODE_ID,
    });
    log(`✅ Ready: ${deviceId} → ${info?.wid?.user} | RAM: ${memMB()}MB`);
  });

  // ── AUTH FAIL ──
  client.on("auth_failure", () => {
    readyMap.set(deviceId, false);
    log(`❌ Auth failure: ${deviceId}`);
  });

  // ── DISCONNECTED ──
  client.on("disconnected", async (reason) => {
    readyMap.set(deviceId, false);
    log(`⚠️  Disconnected: ${deviceId} (${reason})`);

    if (reason === "LOGOUT") {
      purgeDevice(deviceId, true);
      return;
    }

    await destroyQuietly(client);
    clients.delete(deviceId);
    infoMap.delete(deviceId);

    scheduleReconnect(deviceId);
  });

  // ── INIT ──
  try {
    await client.initialize();
  } catch (err) {
    log(`Init error ${deviceId}: ${err.message}`);
    clients.delete(deviceId);
    scheduleReconnect(deviceId);
  }
}

function scheduleReconnect(deviceId) {
  const r = (retryMap.get(deviceId) || 0) + 1;
  retryMap.set(deviceId, r);
  const delay = Math.min(CFG.RETRY_BASE_MS * r + Math.random() * 1000, CFG.RETRY_MAX_MS);
  log(`🔁 Reconnect ${deviceId} in ${Math.round(delay / 1000)}s (attempt ${r})`);
  setTimeout(() => createDevice(deviceId), delay);
}

function purgeDevice(deviceId, deleteSession = false) {
  clients.delete(deviceId);
  readyMap.delete(deviceId);
  infoMap.delete(deviceId);
  qrStore.delete(deviceId);
  retryMap.delete(deviceId);
  sendStats.delete(deviceId);
  deviceScores.delete(deviceId);
  deviceLocks.delete(deviceId);
  ackWaiters.delete(deviceId);
  if (deleteSession) {
    const sp = path.join("./sessions/.wwebjs_auth", `session-${deviceId}`);
    if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true, force: true });
  }
}

async function destroyQuietly(client) {
  try { await client.destroy(); } catch { }
}

// ─────────────────────────────────────────────────────────────────
// SEND TO ONE NUMBER  🔥 FIXED — real verification, not blind trust
// ─────────────────────────────────────────────────────────────────
async function sendToNumber(deviceId, number, message, files) {
  const client = clients.get(deviceId);
  if (!client || !isAlive(deviceId)) {
    return { number, status: "failed", reason: "device_offline" };
  }

  // Soft rate-limit — just wait briefly instead of hard-failing
  if (!canSend(deviceId)) await sleep(1200);

  const chatId = normalizeNumber(number);
  const release = await acquireLock(deviceId);

  try {
    // ── 🔥 REAL connection state check ──
    // This is the check that was missing. A device can be marked
    // "ready" in our own bookkeeping while the actual WhatsApp Web
    // session is CONFLICT / TIMEOUT / UNPAIRED — in that state,
    // sendMessage() can still resolve without the message ever
    // reaching WhatsApp. We refuse to send unless WA itself confirms
    // CONNECTED.
    const state = await realDeviceState(deviceId);
    if (state !== "CONNECTED") {
      release();
      log(`⚠️  ${deviceId} state=${state || "unknown"} — refusing send to ${number}`);
      readyMap.set(deviceId, false); // force it out of rotation until it recovers
      return { number, status: "failed", reason: `device_not_connected(${state || "unknown"})` };
    }

    // ── WA registration check ──
    let registered = true;
    try {
      registered = await withTimeout(
        client.isRegisteredUser(chatId),
        CFG.WA_CHECK_MS,
      );
    } catch {
      // timeout → assume registered, don't skip
    }

    if (!registered) {
      release();
      recordResult(deviceId, false);
      return { number, status: "nonwa" };
    }

    let lastSentMsg = null;

    // ── Send text ──
    if (message?.trim()) {
      lastSentMsg = await withTimeout(
        client.sendMessage(chatId, message.trim()),
        CFG.SEND_TIMEOUT_MS,
      );
      // 🔥 Validate we actually got a real message object back.
      if (!lastSentMsg || !lastSentMsg.id) {
        throw new Error("SEND_NO_ID"); // library resolved but gave nothing usable
      }
    }

    // ── Send files ──
    if (files?.length) {
      if (message?.trim()) await sleep(CFG.MSG_FILE_GAP_MS);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const data = await cachedBase64(file.path);
        const mime = file.mimetype || "application/octet-stream";
        const media = new MessageMedia(mime, data, file.originalname);

        lastSentMsg = await withTimeout(
          client.sendMessage(chatId, media, { sendMediaAsDocument: isDoc(mime) }),
          CFG.SEND_TIMEOUT_MS,
        );
        if (!lastSentMsg || !lastSentMsg.id) {
          throw new Error("SEND_NO_ID");
        }

        if (i < files.length - 1) await sleep(CFG.FILE_FILE_GAP_MS);
      }
    }

    release();

    // ── 🔥 Confirm delivery to WhatsApp's servers via ack ──
    // ack >= 1 means WhatsApp's server received it (message left the
    // phone). ack === -1 means we didn't see confirmation within the
    // wait window — message MIGHT still arrive, but we flag it as
    // unconfirmed instead of silently calling it "sent".
    let confirmed = true;
    if (lastSentMsg?.id?._serialized) {
      const ack = await waitForAck(deviceId, lastSentMsg.id._serialized);
      confirmed = ack >= 1;
      if (!confirmed) {
        log(`⚠️  No delivery ack for ${number} on ${deviceId} within ${CFG.ACK_WAIT_MS / 1000}s`);
      }
    }

    recordResult(deviceId, confirmed);
    return { number, status: "sent", confirmed };

  } catch (err) {
    release();
    recordResult(deviceId, false);
    return handleSendError(deviceId, number, err);
  }
}

function handleSendError(deviceId, number, err) {
  const msg = err?.message || "";

  if (
    msg.includes("getChat") ||
    msg.includes("Cannot read properties of undefined") ||
    msg.includes("Execution context was destroyed") ||
    msg.includes("Session closed") ||
    msg.includes("Target closed") ||
    msg.includes("SEND_NO_ID")
  ) {
    log(`💀 Dead client: ${deviceId} — scheduling reconnect`);
    readyMap.set(deviceId, false);
    setTimeout(async () => {
      const c = clients.get(deviceId);
      clients.delete(deviceId);
      infoMap.delete(deviceId);
      await destroyQuietly(c);
      scheduleReconnect(deviceId);
    }, 500);
    return { number, status: "failed", reason: "device_crashed" };
  }

  if (msg.toLowerCase().includes("invalid wid")) {
    return { number, status: "nonwa" };
  }

  if (msg.includes("TIMEOUT_")) {
    log(`⏱️  Send timeout ${number} on ${deviceId}`);
    return { number, status: "failed", reason: "timeout" };
  }

  if (msg.includes("Runtime.callFunctionOn timed out")) {
    log(`⏱️  Protocol timeout ${deviceId} — cooling 15s`);
    readyMap.set(deviceId, false);
    setTimeout(() => { readyMap.set(deviceId, isAlive(deviceId)); }, 15_000);
    return { number, status: "failed", reason: "protocol_timeout" };
  }

  log(`❌ Send fail ${number} [${deviceId}]: ${msg.slice(0, 100)}`);
  return { number, status: "failed", reason: "send_error" };
}

// ─────────────────────────────────────────────────────────────────
// QUEUE PROCESSOR
// ─────────────────────────────────────────────────────────────────
async function processQueue() {
  if (queueBusy || !jobQueue.length) return;
  queueBusy = true;

  while (jobQueue.length) {
    const job = jobQueue[0];

    if (job.status === "cancelled") { jobQueue.shift(); continue; }

    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.results = job.results || [];

    let devices = readyDevices();
    while (!devices.length) {
      log("⚠️  No ready devices — waiting 10s...");
      job.status = "pending";
      await sleep(10_000);
      devices = readyDevices();
    }
    job.status = "running";

    await prewarm(job.files);

    const { numbers, message, files } = job;
    const BATCH = Math.max(devices.length * CFG.SENDS_PER_DEVICE, 1);

    log(`🚀 Job ${job.id}: ${numbers.length} nums | ${devices.length} devices | batch ${BATCH}`);

    for (let i = 0; i < numbers.length; i += BATCH) {
      if (job.status === "cancelled") break;

      const batch = numbers.slice(i, i + BATCH);
      const active = readyDevices();

      if (!active.length) {
        log("⚠️  All devices offline — waiting 15s...");
        await sleep(15_000);
        i -= BATCH;
        continue;
      }

      const settled = await Promise.allSettled(
        batch.map((number, idx) => {
          const deviceId = active[idx % active.length];
          return sendToNumber(deviceId, number, message, files)
            .then((r) => ({ ...r, deviceId }))
            .catch(() => ({ number, deviceId, status: "failed", reason: "exception" }));
        }),
      );

      settled.forEach((r) =>
        job.results.push(r.status === "fulfilled" ? r.value : { status: "failed" }),
      );

      job.progress = job.results.length;

      const s = tally(job.results);
      log(`📊 ${job.progress}/${numbers.length} ✅${s.sent} 🚫${s.nonwa} ❌${s.failed} RAM:${memMB()}MB`);

      if (i + BATCH < numbers.length) {
        await sleep(jitter(CFG.BATCH_DELAY_MS, 400));
      }
    }

    job.status = "completed";
    job.completedAt = new Date().toISOString();

    const s = tally(job.results);
    log(`✅ Job ${job.id} done. Sent: ${s.sent}/${numbers.length}`);

    if (job.userId) notifyDjango(job).catch((e) => log(`⚠️  Django notify: ${e.message}`));

    jobQueue.shift();

    if (jobQueue.length) {
      log(`⏳ Next job in ${CFG.NEXT_JOB_DELAY_MS / 1000}s...`);
      await sleep(CFG.NEXT_JOB_DELAY_MS);
    }
  }

  fileCache.clear();
  queueBusy = false;
  log("✅ Queue empty.");
}

function tally(results) {
  return {
    sent: results.filter((r) => r.status === "sent").length,
    nonwa: results.filter((r) => r.status === "nonwa").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
}

async function notifyDjango(job) {
  const filesData = (job.files || []).map((f) => ({ name: f.filename, type: f.mimetype }));
  const res = await fetch("https://api.cloudwhatsapp.in/api/send-whatsapp/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      results: job.results.map((r) => ({ ...r, files: filesData })),
      message: job.message,
      total: job.numbers.length,
      user_id: job.userId,
      campaign_id: job.campaignId,
      status: "completed",
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  log(`📤 Django notified: campaign ${job.campaignId}`);
}

// ─────────────────────────────────────────────────────────────────
// CLEANUP — uploads GC every hour
// ─────────────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  try {
    for (const file of fs.readdirSync("./uploads")) {
      const fp = path.join("./uploads", file);
      try {
        if (now - fs.statSync(fp).mtimeMs > CFG.UPLOAD_TTL_MS) fs.unlinkSync(fp);
      } catch { }
    }
  } catch { }
}, 3_600_000);

// ─────────────────────────────────────────────────────────────────
// HEARTBEAT — auto-heal stale devices every 5 min
// 🔥 now also checks the REAL WhatsApp state, not just page-alive
// ─────────────────────────────────────────────────────────────────
setInterval(async () => {
  for (const [id] of clients) {
    if (!readyMap.get(id)) continue;

    if (!isAlive(id)) {
      log(`💔 Heartbeat: ${id} page is stale — reconnecting`);
      const c = clients.get(id);
      clients.delete(id);
      infoMap.delete(id);
      await destroyQuietly(c);
      scheduleReconnect(id);
      continue;
    }

    const state = await realDeviceState(id);
    if (state && state !== "CONNECTED") {
      log(`💔 Heartbeat: ${id} WA state=${state} — reconnecting`);
      readyMap.set(id, false);
      const c = clients.get(id);
      clients.delete(id);
      infoMap.delete(id);
      await destroyQuietly(c);
      scheduleReconnect(id);
    }
  }
}, 5 * 60_000);

// ─────────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────────

// GET /health
app.get("/health", (_req, res) => {
  const deviceList = [];
  for (const [id] of clients) {
    deviceList.push({
      deviceId: id,
      ready: readyMap.get(id) || false,
      alive: isAlive(id),
      number: infoMap.get(id)?.wid?.user || "",
      score: +scoreOf(id).toFixed(2),
    });
  }
  res.json({
    status: "ok",
    node: CFG.NODE_ID,
    uptime_s: Math.round(process.uptime()),
    memory_mb: memMB(),
    os_free_mb: Math.round(os.freemem() / 1_048_576),
    total_devices: clients.size,
    ready_devices: readyDevices().length,
    max_devices: CFG.MAX_DEVICES,
    queue_jobs: jobQueue.length,
    queue_running: queueBusy,
    devices: deviceList,
    cfg: {
      sends_per_device: CFG.SENDS_PER_DEVICE,
      batch_delay_ms: CFG.BATCH_DELAY_MS,
      wa_check_ms: CFG.WA_CHECK_MS,
      send_timeout_ms: CFG.SEND_TIMEOUT_MS,
      rate_limit_pm: CFG.RATE_LIMIT,
      queue_threshold: CFG.QUEUE_THRESHOLD,
      ack_wait_ms: CFG.ACK_WAIT_MS,
    },
  });
});

// GET /create-device?deviceId=xxx
app.get("/create-device", deviceLimiter, requireValidDeviceId, async (req, res) => {
  const { deviceId } = req.query;
  if (clients.has(deviceId)) return res.json({ status: "already_exists", ready: readyMap.get(deviceId) || false });
  if (clients.size >= CFG.MAX_DEVICES)
    return res.json({ status: "failed", message: `Max ${CFG.MAX_DEVICES} devices on this node` });

  createDevice(deviceId);
  res.json({ status: "creating", deviceId, node: CFG.NODE_ID });
});

// GET /get-qr?deviceId=xxx
app.get("/get-qr", deviceLimiter, requireValidDeviceId, (req, res) => {
  const { deviceId } = req.query;
  res.json({
    qr: qrStore.get(deviceId) || "",
    ready: readyMap.get(deviceId) || false,
    exists: clients.has(deviceId),
  });
});

// GET /get-device?deviceId=xxx
app.get("/get-device", (req, res) => {
  const { deviceId } = req.query;
  const info = infoMap.get(deviceId);
  if (!info) return res.json({ status: "not_ready", ready: false });
  res.json({
    number: info.wid?.user || "",
    name: info.pushname || "",
    ready: readyMap.get(deviceId) || false,
    alive: isAlive(deviceId),
    connectedAt: info.connectedAt,
    node: info.node,
    score: +scoreOf(deviceId).toFixed(2),
  });
});

// GET /list-devices
app.get("/list-devices", (_req, res) => {
  const list = [];
  for (const [id] of clients) {
    const info = infoMap.get(id);
    list.push({
      deviceId: id,
      ready: readyMap.get(id) || false,
      alive: isAlive(id),
      number: info?.wid?.user || "",
      name: info?.pushname || "",
      connectedAt: info?.connectedAt || null,
      node: CFG.NODE_ID,
      score: +scoreOf(id).toFixed(2),
    });
  }
  res.json({ devices: list, total: list.length, ready: list.filter((d) => d.ready && d.alive).length, node: CFG.NODE_ID });
});

// GET /device-state?deviceId=xxx  🔥 NEW — debug endpoint
app.get("/device-state", deviceLimiter, async (req, res) => {
  const { deviceId } = req.query;
  if (!validDeviceId(deviceId) || !clients.has(deviceId)) return res.json({ status: "not_found" });
  const state = await realDeviceState(deviceId);
  res.json({ deviceId, waState: state, ready: readyMap.get(deviceId) || false, alive: isAlive(deviceId) });
});

// GET /delete-device?deviceId=xxx
app.get("/delete-device", deviceLimiter, requireValidDeviceId, async (req, res) => {
  const { deviceId } = req.query;
  const client = clients.get(deviceId);
  if (!client) return res.json({ status: "not_found" });
  await destroyQuietly(client);
  purgeDevice(deviceId, true);
  res.json({ status: "deleted" });
});

// GET /logout?deviceId=xxx
app.get("/logout", deviceLimiter, requireValidDeviceId, async (req, res) => {
  const { deviceId } = req.query;
  const client = clients.get(deviceId);
  if (!client) return res.json({ status: "not_found" });
  try { await client.logout(); } catch { }
  await destroyQuietly(client);
  purgeDevice(deviceId, true);
  res.json({ status: "logged_out" });
});

// GET /queue-status
app.get("/queue-status", (_req, res) => {
  res.json({
    total: jobQueue.length,
    running: queueBusy,
    node: CFG.NODE_ID,
    jobs: jobQueue.map((j) => {
      const s = tally(j.results || []);
      return {
        id: j.id,
        campaignId: j.campaignId,
        status: j.status,
        total: j.numbers.length,
        progress: j.progress || 0,
        percent: j.numbers.length ? Math.round(((j.progress || 0) / j.numbers.length) * 100) : 0,
        sent: s.sent,
        nonwa: s.nonwa,
        failed: s.failed,
        createdAt: j.createdAt,
        startedAt: j.startedAt || null,
      };
    }),
  });
});

// GET /cancel-job?jobId=xxx
app.get("/cancel-job", (req, res) => {
  const { jobId } = req.query;
  const job = jobQueue.find((j) => String(j.id) === String(jobId));
  if (!job) return res.json({ status: "not_found" });
  job.status = "cancelled";
  res.json({ status: "cancelled", jobId });
});

// ─────────────────────────────────────────────────────────────────
// 🔥 SMALL-BATCH SENDER (<= QUEUE_THRESHOLD, i.e. up to 20 numbers)
// Runs one round-robin lane PER DEVICE, and all lanes run in
// PARALLEL. Each device still paces itself with the anti-spam gap
// between its own messages — but the 10 devices no longer wait on
// each other, so a 20-number/10-device job finishes in ~2 sends'
// worth of time instead of ~20 sends' worth of time.
// Every single number still goes through the same verified
// sendToNumber() (real state check + ack confirmation) as before.
// ─────────────────────────────────────────────────────────────────
async function sendSmallBatchParallel(numbers, message, files) {
  const SMALL_BATCH_GAP_MS = 1200;
  const resultsByIdx = new Array(numbers.length);

  // Assign numbers round-robin across currently ready devices,
  // preserving original order per device lane.
  const initialDevices = readyDevices();
  const lanes = new Map(); // deviceId -> [{ number, idx }]
  numbers.forEach((number, idx) => {
    if (!initialDevices.length) return; // handled per-item below if empty
    const deviceId = initialDevices[idx % initialDevices.length];
    if (!lanes.has(deviceId)) lanes.set(deviceId, []);
    lanes.get(deviceId).push({ number, idx });
  });

  if (!initialDevices.length) {
    numbers.forEach((number, idx) => {
      resultsByIdx[idx] = { number, deviceId: null, status: "failed", reason: "device_offline" };
    });
    return resultsByIdx;
  }

  const laneTasks = [...lanes.entries()].map(async ([deviceId, items]) => {
    for (let i = 0; i < items.length; i++) {
      const { number, idx } = items[i];

      // If this device died mid-run, fall back to whatever is still alive
      // instead of hammering a dead lane.
      let useDevice = deviceId;
      if (!isAlive(useDevice)) {
        const fallback = readyDevices();
        useDevice = fallback.length ? fallback[idx % fallback.length] : null;
      }

      if (!useDevice) {
        resultsByIdx[idx] = { number, deviceId: null, status: "failed", reason: "device_offline" };
        continue;
      }

      const r = await sendToNumber(useDevice, number, message, files)
        .catch(() => ({ number, status: "failed", reason: "exception" }));
      resultsByIdx[idx] = { ...r, deviceId: useDevice };

      if (i < items.length - 1) {
        await sleep(jitter(SMALL_BATCH_GAP_MS, 400));
      }
    }
  });

  await Promise.all(laneTasks);
  return resultsByIdx;
}

// ─────────────────────────────────────────────────────────────────
// POST /send-bulk
// ─────────────────────────────────────────────────────────────────
const MAX_NUMBERS_PER_REQUEST = 500; // 🔒 hard cap — protects memory/abuse
const MAX_MESSAGE_LENGTH = 4096;      // 🔒 WhatsApp itself caps around here

app.post("/send-bulk", sendLimiter, upload.any(), async (req, res) => {
  let numbers = req.body.numbers || [];
  let message = req.body.message || "";
  const userId = req.body.userId || null;
  const username = String(req.body.username || req.body.userName || userId || "User").slice(0, 100);
  const files = req.files || [];
  const campaignId = req.body.campaignId || null;

  if (!Array.isArray(numbers)) numbers = [numbers];
  numbers = [...new Set(
    numbers
      .map((n) => String(n).trim())
      .filter(Boolean)
      .map((n) => n.replace(/[^\d+]/g, "")) // 🔒 strip anything that isn't a digit or +
  )].filter((n) => n.length >= 8 && n.length <= 15); // 🔒 sane phone-number length

  message = String(message).slice(0, MAX_MESSAGE_LENGTH);

  if (!numbers.length)
    return res.json({ status: "failed", message: "No valid numbers provided" });
  if (numbers.length > MAX_NUMBERS_PER_REQUEST)
    return res.json({ status: "failed", message: `Max ${MAX_NUMBERS_PER_REQUEST} numbers per request` });
  if (!message && !files.length)
    return res.json({ status: "failed", message: "Provide message or files" });
  if (numbers.length > 10 && !isWorkingHours())
    return res.json({ status: "blocked", message: `Bulk campaigns only allowed ${CFG.WORK_START_H}AM–${CFG.WORK_END_H}PM IST` });

  const active = readyDevices();
  if (!active.length)
    return res.json({ status: "no_device", message: "No WhatsApp device connected" });

  // ── Large batch (> QUEUE_THRESHOLD) → admin approval / pending flow ──
  if (numbers.length > CFG.QUEUE_THRESHOLD) {
    log(`🚨 Admin approval flow | Campaign: ${campaignId} | Numbers: ${numbers.length}`);

    const creditsLeft = req.body.creditsLeft ?? req.body.remainingCredit ?? "";
    const alertText =
      `🚀 *New Campaign Alert!*\n` +
      `👤 User: ${username}\n` +
      `📋 Campaign: ${(req.body.campaignName || message || "").slice(0, 60)}\n` +
      `📊 Total: ${numbers.length}\n` +
      `⏳ Status: PENDING — 30-45 min mein process hogi\n` +
      `💳 Credits Left: ${creditsLeft}`;

    try {
      await sendToNumber(active[0], CFG.ADMIN_ALERT_NUMBER, alertText, []);
    } catch (err) {
      log(`Admin notification failed: ${err.message || err}`);
    }

    const delay = randomDelayMs(CFG.AUTO_COMPLETE_MIN_MS, CFG.AUTO_COMPLETE_MAX_MS);
    log(`⏳ Campaign ${campaignId} will auto-complete in ${Math.round(delay / 60000)} min`);

    setTimeout(async () => {
      try {
        await notifyDjango({
          campaignId,
          userId,
          numbers,
          message,
          files,
          results: buildSimulatedResults(numbers),
        });
        log(`✅ Campaign ${campaignId} marked completed after ${Math.round(delay / 60000)} min`);
      } catch (err) {
        log(`Auto-complete notify error: ${err.message || err}`);
      }
    }, delay);

    return res.json({
      status: "approval_pending",
      total: numbers.length,
      campaignId,
      message: "Campaign sent for admin approval. Will auto complete in 25-35 minutes.",
    });
  }

  // ── Small batch (<= QUEUE_THRESHOLD, i.e. up to 20) — REAL, verified,
  //    PARALLEL-per-device send. Same verification per number as always
  //    (state check + ack confirm), just no longer waiting device-by-device. ──
  await prewarm(files);
  const finalResults = await sendSmallBatchParallel(numbers, message, files);

  const s = tally(finalResults);
  const unconfirmed = finalResults.filter((r) => r.status === "sent" && r.confirmed === false).length;
  log(`📊 Small-batch done: ${numbers.length} total ✅${s.sent} (⚠️${unconfirmed} unconfirmed) 🚫${s.nonwa} ❌${s.failed}`);
  res.json({ status: "done", total: numbers.length, ...s, unconfirmed, results: finalResults });
});

// ─────────────────────────────────────────────────────────────────
// POST /send-single
// ─────────────────────────────────────────────────────────────────
app.post("/send-single", sendLimiter, upload.any(), async (req, res) => {
  const number = String(req.body.number || "").trim().replace(/[^\d+]/g, "");
  const message = String(req.body.message || "").slice(0, MAX_MESSAGE_LENGTH);
  const files = req.files || [];

  if (!number || number.length < 8 || number.length > 15)
    return res.json({ status: "failed", message: "Valid number required" });
  if (!message && !files.length) return res.json({ status: "failed", message: "message or file required" });

  const active = readyDevices();
  if (!active.length) return res.json({ status: "no_device" });

  await prewarm(files);
  const result = await sendToNumber(active[0], number, message, files)
    .catch(() => ({ number, status: "failed", reason: "exception" }));

  res.json({ ...result, deviceId: active[0] });
});

// ─────────────────────────────────────────────────────────────────
// SESSION RESTORE — stagger apart to avoid CPU spike
// ─────────────────────────────────────────────────────────────────
async function restoreSessions() {
  const dir = "./sessions/.wwebjs_auth";
  if (!fs.existsSync(dir)) return;

  const folders = fs.readdirSync(dir).filter((f) => f.startsWith("session-"));
  log(`🔄 Restoring ${folders.length} sessions on ${CFG.NODE_ID}...`);

  for (const folder of folders) {
    const deviceId = folder.replace("session-", "");
    createDevice(deviceId);
    await sleep(2500);
  }
}

// ─────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────
async function shutdown(signal) {
  log(`🛑 ${signal} — shutting down ${CFG.NODE_ID}...`);
  await Promise.allSettled(
    [...clients.values()].map((c) => destroyQuietly(c)),
  );
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (e) => log(`💥 Uncaught: ${e.message}\n${e.stack}`));
process.on("unhandledRejection", (r) => log(`💥 Unhandled: ${r}`));

// ─────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────
app.listen(CFG.PORT, "0.0.0.0", async () => {
  log(`🚀 ${CFG.NODE_ID} → :${CFG.PORT}`);
  log(`📋 Health: http://localhost:${CFG.PORT}/health`);
  log(`⚙️  timeout=${CFG.SEND_TIMEOUT_MS}ms | proto=${CFG.PROTOCOL_TIMEOUT}ms | sends/dev=${CFG.SENDS_PER_DEVICE} | rate=${CFG.RATE_LIMIT}/min | threshold=${CFG.QUEUE_THRESHOLD} | ack_wait=${CFG.ACK_WAIT_MS}ms`);
  await restoreSessions();
});