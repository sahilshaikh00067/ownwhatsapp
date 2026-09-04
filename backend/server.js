"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");

function getChromePath() {
  try {
    const puppeteer = require("puppeteer");
    const chromePath = puppeteer.executablePath();

    if (chromePath && fs.existsSync(chromePath)) {
      console.log("✅ Chrome found:", chromePath);
      return chromePath;
    }
  } catch (error) {
    console.error("Chrome detection error:", error.message);
  }

  console.error("❌ Chrome executable not found");
  return undefined;
}
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 5000);
const NODE_ID = process.env.NODE_ID || "node1";
const MAX_DEVICES = Number(process.env.MAX_DEVICES || 20);
const API_KEY = process.env.API_KEY || "";
process.env.PUPPETEER_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";

fs.mkdirSync(path.join(__dirname, "sessions"), {
  recursive: true,
});

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST"],
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Optional API authentication
if (API_KEY) {
  app.use((req, res, next) => {
    if (req.path === "/health") {
      return next();
    }

    if (req.get("x-api-key") !== API_KEY) {
      return res.status(401).json({
        status: "unauthorized",
      });
    }

    next();
  });
}

// Rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// ============================================================
// DEVICE STATE
// ============================================================

const DEVICE_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const clients = new Map();

const devices = new Map();

/*
devices Map structure:

{
  status: "creating" | "qr" | "authenticated" | "ready" |
          "disconnected" | "error",

  qr: "",
  number: "",
  name: "",
  error: "",
  createdAt: "",
  updatedAt: ""
}
*/

// ============================================================
// HELPERS
// ============================================================

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function now() {
  return new Date().toISOString();
}

function validDeviceId(deviceId) {
  return (
    typeof deviceId === "string" &&
    DEVICE_RE.test(deviceId)
  );
}

function getDevice(deviceId) {
  return devices.get(deviceId);
}

function updateDevice(deviceId, patch) {
  const previous = devices.get(deviceId) || {
    status: "creating",
    qr: "",
    number: "",
    name: "",
    error: "",
    createdAt: now(),
  };

  const updated = {
    ...previous,
    ...patch,
    updatedAt: now(),
  };

  devices.set(deviceId, updated);

  return updated;
}

async function safeDestroy(client) {
  if (!client) {
    return;
  }

  try {
    await client.destroy();
  } catch (error) {
    // Ignore destroy errors
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ============================================================
// REMOVE DEVICE
// ============================================================

async function removeDevice(
  deviceId,
  deleteSession = true
) {
  const client = clients.get(deviceId);

  clients.delete(deviceId);

  await safeDestroy(client);

  devices.delete(deviceId);

  if (deleteSession) {
    const sessionPath = path.join(
      __dirname,
      "sessions",
      ".wwebjs_auth",
      `session-${deviceId}`
    );

    try {
      fs.rmSync(sessionPath, {
        recursive: true,
        force: true,
      });

      log(`Session deleted: ${deviceId}`);
    } catch (error) {
      log(
        `Session delete error ${deviceId}:`,
        error.message
      );
    }
  }
}

// ============================================================
// CREATE WHATSAPP DEVICE
// ============================================================

async function createDevice(deviceId) {
  if (!validDeviceId(deviceId)) {
    throw new Error("INVALID_DEVICE_ID");
  }

  if (clients.has(deviceId)) {
    log(`Device already exists: ${deviceId}`);
    return;
  }

  if (clients.size >= MAX_DEVICES) {
    throw new Error(
      `MAX_DEVICES_REACHED (${MAX_DEVICES})`
    );
  }

  updateDevice(deviceId, {
    status: "creating",
    qr: "",
    error: "",
    number: "",
    name: "",
  });

  log(`Creating WhatsApp device: ${deviceId}`);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: deviceId,
      dataPath: "./.wwebjs_auth"
    }),

    puppeteer: {
      headless: true,
      executablePath: getChromePath(),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--disable-software-rasterizer"
      ]
    }
  });

  clients.set(deviceId, client);

  // ----------------------------------------------------------
  // QR EVENT
  // ----------------------------------------------------------

  client.on("qr", async (qr) => {
    try {
      log(`QR received from WhatsApp: ${deviceId}`);

      const qrDataUrl =
        await qrcode.toDataURL(qr, {
          errorCorrectionLevel: "M",
          margin: 2,
          scale: 8,
        });

      updateDevice(deviceId, {
        status: "qr",
        qr: qrDataUrl,
        error: "",
      });

      log(`QR generated successfully: ${deviceId}`);
    } catch (error) {
      log(
        `QR generation error ${deviceId}:`,
        error.message
      );

      updateDevice(deviceId, {
        status: "error",
        error: `QR_GENERATION_ERROR: ${error.message}`,
      });
    }
  });

  // ----------------------------------------------------------
  // AUTHENTICATED
  // ----------------------------------------------------------

  client.on("authenticated", () => {
    log(`Authenticated: ${deviceId}`);

    updateDevice(deviceId, {
      status: "authenticated",
      qr: "",
      error: "",
    });
  });

  // ----------------------------------------------------------
  // READY
  // ----------------------------------------------------------

  client.on("ready", () => {
    const info = client.info;

    updateDevice(deviceId, {
      status: "ready",
      qr: "",
      error: "",
      number: info?.wid?.user || "",
      name: info?.pushname || "",
    });

    log(
      `DEVICE READY: ${deviceId} -> ${info?.wid?.user || "unknown"
      }`
    );
  });

  // ----------------------------------------------------------
  // AUTH FAILURE
  // ----------------------------------------------------------

  client.on("auth_failure", (message) => {
    log(
      `AUTH FAILURE ${deviceId}:`,
      message
    );

    updateDevice(deviceId, {
      status: "error",
      qr: "",
      error: `AUTH_FAILURE: ${message || "Unknown error"
        }`,
    });
  });

  // ----------------------------------------------------------
  // DISCONNECTED
  // ----------------------------------------------------------

  client.on("disconnected", async (reason) => {
    log(
      `DEVICE DISCONNECTED ${deviceId}:`,
      reason
    );

    clients.delete(deviceId);

    updateDevice(deviceId, {
      status: "disconnected",
      qr: "",
      error: String(reason || "Disconnected"),
    });
  });

  // ----------------------------------------------------------
  // INITIALIZE
  // ----------------------------------------------------------

  try {
    log(`Initializing WhatsApp: ${deviceId}`);

    await client.initialize();

    log(
      `Initialize finished: ${deviceId}`
    );
  } catch (error) {
    log(
      `INITIALIZE ERROR ${deviceId}:`,
      error.stack || error.message
    );

    clients.delete(deviceId);

    updateDevice(deviceId, {
      status: "error",
      qr: "",
      error: `INITIALIZE_ERROR: ${error.message}`,
    });

    throw error;
  }
}

// ============================================================
// WHATSAPP STATE
// ============================================================

async function getWhatsAppState(deviceId) {
  const client = clients.get(deviceId);

  if (!client) {
    return null;
  }

  try {
    return await client.getState();
  } catch (error) {
    return null;
  }
}

// ============================================================
// NORMALIZE NUMBER
// ============================================================

function normalizeNumber(number) {
  const digits = String(number || "")
    .replace(/\D/g, "");

  if (
    digits.length < 8 ||
    digits.length > 15
  ) {
    return null;
  }

  return `${digits}@c.us`;
}

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  async (req, res) => {
    const deviceList = [];

    for (const [
      deviceId,
      data,
    ] of devices.entries()) {
      let waState = null;

      if (data.status === "ready") {
        waState =
          await getWhatsAppState(deviceId);
      }

      deviceList.push({
        deviceId,
        status: data.status,
        number: data.number || "",
        name: data.name || "",
        waState,
        error: data.error || "",
      });
    }

    res.json({
      status: "ok",
      node: NODE_ID,
      uptime: Math.floor(
        process.uptime()
      ),
      totalDevices: clients.size,
      maxDevices: MAX_DEVICES,
      devices: deviceList,
    });
  }
);

// ============================================================
// CREATE DEVICE
//
// GET /create-device?deviceId=testqr123
// ============================================================

app.get("/create-device", async (req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  });

  const deviceId = String(req.query.deviceId || "");

  if (!validDeviceId(deviceId)) {
    return res.status(400).json({
      status: "failed",
      message:
        "Invalid deviceId. Use only letters, numbers, _ or -",
    });
  }

  if (clients.has(deviceId)) {
    const data = getDevice(deviceId);

    return res.json({
      status: "already_exists",
      deviceId,
      deviceStatus: data?.status || "unknown",
      ready: data?.status === "ready",
      qrAvailable: Boolean(data?.qr),
    });
  }

  if (clients.size >= MAX_DEVICES) {
    return res.status(400).json({
      status: "failed",
      message: `Maximum ${MAX_DEVICES} devices reached`,
    });
  }

  // Create immediately in memory
  updateDevice(deviceId, {
    status: "creating",
    qr: "",
    error: "",
    number: "",
    name: "",
  });

  // Background initialize
  createDevice(deviceId).catch((error) => {
    console.error(
      `BACKGROUND CREATE ERROR ${deviceId}:`,
      error.stack || error.message
    );

    updateDevice(deviceId, {
      status: "error",
      qr: "",
      error: error.message || "Failed to initialize WhatsApp",
    });
  });

  return res.json({
    status: "creating",
    deviceId,
    node: NODE_ID,
  });
});

// ============================================================
// GET QR
//
// GET /get-qr?deviceId=testqr123
// ============================================================

app.get("/get-qr", (req, res) => {
  // IMPORTANT: QR response kabhi cache nahi hona chahiye
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
  });

  const deviceId = String(req.query.deviceId || "");

  if (!validDeviceId(deviceId)) {
    return res.status(400).json({
      status: "failed",
      message: "Invalid deviceId",
      qr: "",
      ready: false,
      exists: false,
      error: "",
    });
  }

  const data = getDevice(deviceId);
  const client = clients.get(deviceId);

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
    status: data.status || "creating",
    deviceId,
    qr: data.qr || "",
    ready: data.status === "ready",
    exists: Boolean(client),
    error: data.error || "",
    number: data.number || "",
    name: data.name || "",
    updatedAt: data.updatedAt || now(),
  });
});

// ============================================================
// GET DEVICE
// ============================================================

app.get(
  "/get-device",
  async (req, res) => {
    const deviceId = String(
      req.query.deviceId || ""
    );

    const data =
      getDevice(deviceId);

    if (!data) {
      return res.json({
        status: "not_found",
        ready: false,
      });
    }

    const waState =
      await getWhatsAppState(deviceId);

    return res.json({
      deviceId,
      status: data.status,
      ready:
        data.status === "ready",
      number:
        data.number || "",
      name:
        data.name || "",
      waState,
      error:
        data.error || "",
      createdAt:
        data.createdAt,
      updatedAt:
        data.updatedAt,
    });
  }
);

// ============================================================
// DEVICE STATE
// ============================================================

app.get(
  "/device-state",
  async (req, res) => {
    const deviceId = String(
      req.query.deviceId || ""
    );

    const data =
      getDevice(deviceId);

    if (!data) {
      return res.status(404).json({
        status: "not_found",
      });
    }

    const waState =
      await getWhatsAppState(deviceId);

    return res.json({
      deviceId,
      backendStatus:
        data.status,
      waState,
      ready:
        data.status === "ready",
      hasQr:
        Boolean(data.qr),
      error:
        data.error || "",
    });
  }
);

// ============================================================
// LIST DEVICES
// ============================================================

app.get(
  "/list-devices",
  (req, res) => {
    const list = [];

    for (const [
      deviceId,
      data,
    ] of devices.entries()) {
      list.push({
        deviceId,
        status: data.status,
        ready:
          data.status === "ready",
        number:
          data.number || "",
        name:
          data.name || "",
        error:
          data.error || "",
      });
    }

    return res.json({
      devices: list,
      total: list.length,
      node: NODE_ID,
    });
  }
);

// ============================================================
// DELETE DEVICE
// ============================================================

app.get(
  "/delete-device",
  async (req, res) => {
    const deviceId = String(
      req.query.deviceId || ""
    );

    if (!validDeviceId(deviceId)) {
      return res.status(400).json({
        status: "failed",
        message: "Invalid deviceId",
      });
    }

    if (
      !clients.has(deviceId) &&
      !devices.has(deviceId)
    ) {
      return res.json({
        status: "not_found",
      });
    }

    await removeDevice(
      deviceId,
      true
    );

    return res.json({
      status: "deleted",
      deviceId,
    });
  }
);

// ============================================================
// LOGOUT
// ============================================================

app.get(
  "/logout",
  async (req, res) => {
    const deviceId = String(
      req.query.deviceId || ""
    );

    const client =
      clients.get(deviceId);

    if (!client) {
      return res.json({
        status: "not_found",
      });
    }

    try {
      await client.logout();
    } catch (error) {
      log(
        `Logout error ${deviceId}:`,
        error.message
      );
    }

    await removeDevice(
      deviceId,
      true
    );

    return res.json({
      status: "logged_out",
      deviceId,
    });
  }
);

// ============================================================
// SEND SINGLE MESSAGE
//
// POST /send-single
//
// {
//   "deviceId": "testqr123",
//   "number": "919999999999",
//   "message": "Hello"
// }
// ============================================================

app.post(
  "/send-single",
  async (req, res) => {
    const deviceId = String(
      req.body.deviceId || ""
    );

    const number =
      normalizeNumber(
        req.body.number
      );

    const message = String(
      req.body.message || ""
    ).trim();

    if (!validDeviceId(deviceId)) {
      return res.status(400).json({
        status: "failed",
        message:
          "Valid deviceId required",
      });
    }

    if (!number) {
      return res.status(400).json({
        status: "failed",
        message:
          "Valid number required",
      });
    }

    if (!message) {
      return res.status(400).json({
        status: "failed",
        message:
          "Message required",
      });
    }

    if (message.length > 4096) {
      return res.status(400).json({
        status: "failed",
        message:
          "Message too long",
      });
    }

    const client =
      clients.get(deviceId);

    const data =
      getDevice(deviceId);

    if (
      !client ||
      !data ||
      data.status !== "ready"
    ) {
      return res.status(409).json({
        status: "failed",
        message:
          "Device is not ready",
      });
    }

    try {
      const waState =
        await getWhatsAppState(
          deviceId
        );

      if (
        waState &&
        waState !== "CONNECTED"
      ) {
        return res.status(409).json({
          status: "failed",
          message:
            `WhatsApp not connected: ${waState}`,
        });
      }

      const registered =
        await client.isRegisteredUser(
          number
        );

      if (!registered) {
        return res.json({
          status: "nonwa",
          message:
            "Number is not registered on WhatsApp",
        });
      }

      const result =
        await client.sendMessage(
          number,
          message
        );

      return res.json({
        status: "sent",
        messageId:
          result?.id?._serialized || "",
      });
    } catch (error) {
      log(
        "SEND ERROR:",
        error.stack || error.message
      );

      return res.status(500).json({
        status: "failed",
        message:
          error.message || "Send failed",
      });
    }
  }
);



const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});


app.post(
  "/send-bulk",
  upload.array("files", 20),
  async (req, res) => {
    try {
      console.log("SEND BULK BODY:", req.body);
      console.log(
        "SEND BULK FILES:",
        req.files?.length || 0
      );

      // Frontend FormData se multiple numbers
      let numbers = req.body.numbers;

      if (!numbers) {
        return res.status(400).json({
          status: "failed",
          message: "No numbers received",
        });
      }

      // Single number ko array banao
      if (!Array.isArray(numbers)) {
        numbers = [numbers];
      }

      numbers = numbers
        .map((n) => String(n).trim())
        .filter(Boolean);

      const message = String(
        req.body.message || ""
      ).trim();

      const visitUrl = String(
        req.body.visitUrl || ""
      ).trim();

      const callNumber = String(
        req.body.callNumber || ""
      )
        .replace(/\D/g, "")
        .trim();

      // Validate Visit URL
      if (visitUrl) {
        try {
          const parsedUrl = new URL(visitUrl);

          if (
            parsedUrl.protocol !== "http:" &&
            parsedUrl.protocol !== "https:"
          ) {
            throw new Error("Invalid URL");
          }
        } catch (error) {
          return res.status(400).json({
            status: "failed",
            message: "Invalid Visit Now URL",
          });
        }
      }

      // Validate Call Number
      if (
        callNumber &&
        (
          callNumber.length < 8 ||
          callNumber.length > 15
        )
      ) {
        return res.status(400).json({
          status: "failed",
          message: "Invalid Call Now number",
        });
      }

      // =====================================================
      // ✨ BUILD PREMIUM WHATSAPP CAMPAIGN MESSAGE
      // =====================================================

      let finalMessage = String(message || "").trim();


      // =====================================================
      // 🌐 PREMIUM WEBSITE CTA
      // =====================================================

      if (visitUrl) {

        finalMessage +=
          `${finalMessage ? "\n\n" : ""}` +
          `🔗 *${visitUrl}*\n\n` +
          `👉 _Tap the link above to visit now_`;

      }


      // =====================================================
      // 📞 PREMIUM Call CTA
      // =====================================================

      if (callNumber) {

        finalMessage +=
          `${finalMessage ? "\n\n" : ""}` +
          `📱 *+${callNumber}*\n\n` +
          `👉 _Tap the number above to connect with us_`;
      }


      // =====================================================
      // CONNECTED DEVICE FIND
      // =====================================================

      const readyDevices = [];

      for (const [deviceId, device] of devices.entries()) {
        const client = clients.get(deviceId);

        if (
          client &&
          device &&
          device.status === "ready"
        ) {
          readyDevices.push({
            deviceId,
            client,
          });
        }
      }

      if (readyDevices.length === 0) {
        return res.status(200).json({
          status: "no_device",
          message: "No WhatsApp device connected",
        });
      }

      if (numbers.length === 0) {
        return res.status(400).json({
          status: "failed",
          message: "No valid numbers received",
        });
      }

      if (
        !finalMessage &&
        (!req.files || req.files.length === 0)
      ) {
        return res.status(400).json({
          status: "failed",
          message: "Message or media is required",
        });
      }

      console.log(
        `Sending campaign to ${numbers.length} numbers using ${readyDevices.length} device(s)`
      );

      const results = [];

      let deviceIndex = 0;

      // =====================================================
      // SEND LOOP
      // =====================================================

      for (const rawNumber of numbers) {
        let number = String(rawNumber)
          .replace(/\D/g, "");

        // Indian 10 digit number → add 91
        if (number.length === 10) {
          number = `91${number}`;
        }

        if (
          number.length < 8 ||
          number.length > 15
        ) {
          results.push({
            number: rawNumber,
            status: "invalid",
            error: "Invalid phone number",
          });

          continue;
        }

        // Round-robin device
        const selected =
          readyDevices[
          deviceIndex % readyDevices.length
          ];

        deviceIndex++;

        const client = selected.client;
        const deviceId =
          selected.deviceId;

        const chatId =
          `${number}@c.us`;

        try {
          console.log(
            `Checking ${number} using ${deviceId}`
          );

          const registered =
            await client.isRegisteredUser(
              chatId
            );

          if (!registered) {
            results.push({
              number,
              deviceId,
              status: "nonwa",
            });

            continue;
          }

          // ===============================================
          // MEDIA + MESSAGE CAPTION
          // ===============================================

          if (
            req.files &&
            req.files.length > 0
          ) {

            const { MessageMedia } =
              require("whatsapp-web.js");

            let mediaIndex = 0;

            for (const file of req.files) {

              const media =
                new MessageMedia(
                  file.mimetype,
                  file.buffer.toString("base64"),
                  file.originalname
                );

              const isImage =
                file.mimetype.startsWith("image/");

              const isVideo =
                file.mimetype.startsWith("video/");

              const options = {
                sendMediaAsDocument:
                  !isImage && !isVideo,
              };

              // FIRST IMAGE / VIDEO KE SAATH
              // PURA MESSAGE + VISIT URL + CALL NUMBER
              if (
                mediaIndex === 0 &&
                finalMessage &&
                (isImage || isVideo)
              ) {
                options.caption = finalMessage;
              }

              await client.sendMessage(
                chatId,
                media,
                options
              );

              mediaIndex++;

              await new Promise(
                (resolve) =>
                  setTimeout(resolve, 500)
              );
            }

          } else if (finalMessage) {

            // =================================================
            // AGAR MEDIA NAHI HAI TO NORMAL MESSAGE
            // =================================================

            await client.sendMessage(
              chatId,
              finalMessage
            );
          }
          results.push({
            number,
            deviceId,
            status: "sent",
          });

          console.log(
            `SUCCESS: ${number}`
          );

        } catch (error) {
          console.error(
            `FAILED ${number}:`,
            error.message
          );

          results.push({
            number,
            deviceId,
            status: "failed",
            error:
              error.message ||
              "Message send failed",
          });
        }

        // Gap between recipients
        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              1200
            )
        );
      }

      // =====================================================
      // SUMMARY
      // =====================================================

      const sent = results.filter(
        (r) =>
          r.status === "sent"
      ).length;

      const failed = results.filter(
        (r) =>
          r.status === "failed"
      ).length;

      const nonwa = results.filter(
        (r) =>
          r.status === "nonwa"
      ).length;

      const invalid = results.filter(
        (r) =>
          r.status === "invalid"
      ).length;

      console.log({
        total: results.length,
        sent,
        failed,
        nonwa,
        invalid,
      });

      return res.json({
        status: "completed",
        total: results.length,
        sent,
        failed,
        nonwa,
        invalid,
        results,
      });

    } catch (error) {
      console.error(
        "SEND BULK FATAL ERROR:",
        error.stack || error.message
      );

      return res.status(500).json({
        status: "failed",
        message:
          error.message ||
          "Bulk send failed",
      });
    }
  }
);

// ============================================================
// RESTORE SAVED SESSIONS
// ============================================================

async function restoreSessions() {
  const authDir = path.join(
    __dirname,
    "sessions",
    ".wwebjs_auth"
  );

  if (!fs.existsSync(authDir)) {
    log(
      "No previous sessions found"
    );

    return;
  }

  const folders =
    fs.readdirSync(authDir)
      .filter((folder) =>
        folder.startsWith("session-")
      );

  log(
    `Restoring ${folders.length} saved session(s)`
  );

  for (const folder of folders) {
    const deviceId =
      folder.replace(
        /^session-/,
        ""
      );

    if (!validDeviceId(deviceId)) {
      continue;
    }

    try {
      createDevice(deviceId)
        .catch((error) => {
          log(
            `RESTORE ERROR ${deviceId}:`,
            error.message
          );
        });

      await sleep(2000);
    } catch (error) {
      log(
        `RESTORE SETUP ERROR ${deviceId}:`,
        error.message
      );
    }
  }
}

// ============================================================
// EXPRESS ERROR HANDLER
// ============================================================

app.use(
  (error, req, res, next) => {
    log(
      "EXPRESS ERROR:",
      error.stack || error.message
    );

    res.status(500).json({
      status: "failed",
      message:
        error.message ||
        "Internal server error",
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  async () => {
    log(
      `Server started on port ${PORT}`
    );

    log(
      `Node ID: ${NODE_ID}`
    );

    log(
      `Maximum devices: ${MAX_DEVICES}`
    );

    await restoreSessions();
  }
);

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {
  log(
    `${signal} received. Shutting down...`
  );

  await Promise.allSettled(
    [...clients.values()].map(
      (client) =>
        safeDestroy(client)
    )
  );

  process.exit(0);
}

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "uncaughtException",
  (error) => {
    log(
      "UNCAUGHT EXCEPTION:",
      error.stack || error.message
    );
  }
);

process.on(
  "unhandledRejection",
  (reason) => {
    log(
      "UNHANDLED REJECTION:",
      reason
    );
  }
);