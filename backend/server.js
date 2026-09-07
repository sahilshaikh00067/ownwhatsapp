/**
 * WhatsApp QR Device Backend
 * Node.js + Express + whatsapp-web.js
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
const path = require("path");


/* =========================================================
   APP
========================================================= */

const app = express();

const PORT = Number(process.env.PORT || 5000);

const NODE_ID =
  process.env.NODE_ID || "node1";

const MAX_DEVICES =
  Number(process.env.MAX_DEVICES || 20);

const API_KEY =
  process.env.API_KEY || "";


/* =========================================================
   PUPPETEER / CHROME
========================================================= */

let CHROME_PATH = "";

try {

  CHROME_PATH = puppeteer.executablePath();

  console.log("========================================");
  console.log("PUPPETEER VERSION:");
  console.log(require("puppeteer/package.json").version);

  console.log("CHROME EXECUTABLE:");
  console.log(CHROME_PATH);

  console.log("CHROME EXISTS:");
  console.log(fs.existsSync(CHROME_PATH));

  console.log("========================================");

} catch (error) {

  console.error(
    "PUPPETEER CHROME PATH ERROR:",
    error.message
  );

}


/* =========================================================
   DIRECTORIES
========================================================= */

const SESSIONS_DIR =
  path.join(__dirname, "sessions");


const AUTH_DIR =
  path.join(
    SESSIONS_DIR,
    ".wwebjs_auth"
  );


try {

  fs.mkdirSync(
    SESSIONS_DIR,
    { recursive: true }
  );

} catch (error) {

  console.error(
    "SESSION DIRECTORY ERROR:",
    error.message
  );

}


/* =========================================================
   EXPRESS CONFIG
========================================================= */

app.set("trust proxy", 1);


app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);


app.use(

  cors({

    origin: true,

    methods: [
      "GET",
      "POST",
      "OPTIONS"
    ]

  })

);


app.use(

  express.json({

    limit: "10mb"

  })

);


app.use(

  express.urlencoded({

    extended: true,

    limit: "10mb"

  })

);


/* =========================================================
   API KEY
========================================================= */

if (API_KEY) {

  app.use(

    (req, res, next) => {

      if (req.path === "/health") {

        return next();

      }


      if (
        req.get("x-api-key") !== API_KEY
      ) {

        return res
          .status(401)
          .json({

            status: "unauthorized"

          });

      }


      next();

    }

  );

}


/* =========================================================
   RATE LIMIT
========================================================= */

const limiter = rateLimit({

  windowMs: 60 * 1000,

  max: 300,

  standardHeaders: true,

  legacyHeaders: false

});


app.use(limiter);


/* =========================================================
   DEVICE STORAGE
========================================================= */

const clients = new Map();

const devices = new Map();


/*

devices:

{
    status:
        creating
        qr
        authenticated
        ready
        disconnected
        error

    qr: ""

    number: ""

    name: ""

    error: ""

    createdAt: ""

    updatedAt: ""
}

*/


/* =========================================================
   CONSTANTS
========================================================= */

const DEVICE_RE =
  /^[a-zA-Z0-9_-]{1,64}$/;


/* =========================================================
   HELPERS
========================================================= */

function now() {

  return new Date().toISOString();

}


function log(...args) {

  console.log(

    `[${new Date().toISOString()}]`,

    ...args

  );

}


function validDeviceId(deviceId) {

  return (

    typeof deviceId === "string"

    &&

    DEVICE_RE.test(deviceId)

  );

}


function getDeviceState(deviceId) {

  return devices.get(deviceId);

}


function setDeviceState(

  deviceId,

  patch

) {

  const oldState =

    devices.get(deviceId)

    ||

    {

      status: "creating",

      qr: "",

      number: "",

      name: "",

      error: "",

      createdAt: now()

    };


  const newState = {

    ...oldState,

    ...patch,

    updatedAt: now()

  };


  devices.set(

    deviceId,

    newState

  );


  return newState;

}


/* =========================================================
   SAFE DESTROY
========================================================= */

async function safeDestroy(client) {

  if (!client) {

    return;

  }


  try {

    await client.destroy();

  }

  catch (error) {

    log(

      "CLIENT DESTROY ERROR:",

      error.message

    );

  }

}


/* =========================================================
   REMOVE DEVICE
========================================================= */

async function removeDevice(

  deviceId,

  deleteSession = true

) {

  const client =

    clients.get(deviceId);


  clients.delete(deviceId);


  await safeDestroy(client);


  devices.delete(deviceId);


  if (!deleteSession) {

    return;

  }


  const sessionPath =

    path.join(

      AUTH_DIR,

      `session-${deviceId}`

    );


  try {

    fs.rmSync(

      sessionPath,

      {

        recursive: true,

        force: true

      }

    );


    log(

      "SESSION DELETED:",

      deviceId

    );

  }

  catch (error) {

    log(

      "SESSION DELETE ERROR:",

      error.message

    );

  }

}


/* =========================================================
   CREATE WHATSAPP DEVICE
========================================================= */

async function createDevice(deviceId) {


  /* =========================
     VALIDATE
  ========================= */

  if (!validDeviceId(deviceId)) {

    throw new Error(
      "INVALID_DEVICE_ID"
    );

  }


  /* =========================
     ALREADY EXISTS
  ========================= */

  if (clients.has(deviceId)) {

    return clients.get(deviceId);

  }


  /* =========================
     MAX DEVICES
  ========================= */

  if (

    clients.size >= MAX_DEVICES

  ) {

    throw new Error(
      "MAX_DEVICES_REACHED"
    );

  }


  /* =========================
     CHROME CHECK
  ========================= */

  if (!CHROME_PATH) {

    throw new Error(
      "CHROME_EXECUTABLE_NOT_FOUND"
    );

  }


  if (

    !fs.existsSync(CHROME_PATH)

  ) {

    throw new Error(

      "CHROME_EXECUTABLE_DOES_NOT_EXIST: "

      +

      CHROME_PATH

    );

  }


  /* =========================
     STATE
  ========================= */

  setDeviceState(

    deviceId,

    {

      status: "creating",

      qr: "",

      error: "",

      number: "",

      name: ""

    }

  );


  log(

    "========================================"

  );


  log(

    "CREATING WHATSAPP DEVICE:",

    deviceId

  );


  log(

    "CHROME PATH:",

    CHROME_PATH

  );


  log(

    "========================================"

  );


  /* =========================
     CREATE CLIENT
  ========================= */

  const client =

    new Client({

      authStrategy:

        new LocalAuth({

          clientId: deviceId,

          dataPath: SESSIONS_DIR

        }),


      puppeteer: {


        /* IMPORTANT */

        executablePath:

          CHROME_PATH,


        headless: true,


        args: [


          "--no-sandbox",


          "--disable-setuid-sandbox",


          "--disable-dev-shm-usage",


          "--disable-gpu",


          "--disable-software-rasterizer",


          "--disable-extensions",


          "--disable-background-networking",


          "--disable-background-timer-throttling",


          "--disable-renderer-backgrounding",


          "--disable-breakpad",


          "--disable-component-update",


          "--disable-default-apps",


          "--disable-features=TranslateUI",


          "--disable-ipc-flooding-protection",


          "--no-first-run",


          "--no-zygote"


        ],


        timeout: 120000,


        protocolTimeout: 120000

      },


      restartOnAuthFail: true,


      takeoverOnConflict: true,


      takeoverTimeoutMs: 0

    });


  /* =========================
     SAVE CLIENT
  ========================= */

  clients.set(

    deviceId,

    client

  );


  /* =====================================================
     QR EVENT
  ===================================================== */

  client.on(

    "qr",

    async (qr) => {


      try {


        log(

          "QR RECEIVED:",

          deviceId

        );


        const qrDataUrl =

          await qrcode.toDataURL(

            qr,

            {

              errorCorrectionLevel: "M",

              margin: 2,

              scale: 8

            }

          );


        setDeviceState(

          deviceId,

          {

            status: "qr",

            qr: qrDataUrl,

            error: ""

          }

        );


        log(

          "QR GENERATED SUCCESSFULLY:",

          deviceId

        );


      }

      catch (error) {


        console.error(

          "QR GENERATION ERROR:",

          deviceId,

          error

        );


        setDeviceState(

          deviceId,

          {

            status: "error",

            qr: "",

            error:

              "QR_GENERATION_ERROR: "

              +

              error.message

          }

        );


      }


    }

  );


  /* =====================================================
     AUTHENTICATED
  ===================================================== */

  client.on(

    "authenticated",

    () => {


      log(

        "AUTHENTICATED:",

        deviceId

      );


      setDeviceState(

        deviceId,

        {

          status: "authenticated",

          qr: "",

          error: ""

        }

      );


    }

  );


  /* =====================================================
     READY
  ===================================================== */

  client.on(

    "ready",

    () => {


      const info =

        client.info;


      const number =

        info?.wid?.user

        ||

        "";


      const name =

        info?.pushname

        ||

        "";


      setDeviceState(

        deviceId,

        {

          status: "ready",

          qr: "",

          error: "",

          number,

          name

        }

      );


      log(

        "========================================"

      );


      log(

        "WHATSAPP READY:",

        deviceId

      );


      log(

        "NUMBER:",

        number

      );


      log(

        "NAME:",

        name

      );


      log(

        "========================================"

      );


    }

  );


  /* =====================================================
     AUTH FAILURE
  ===================================================== */

  client.on(

    "auth_failure",

    (message) => {


      console.error(

        "AUTH FAILURE:",

        deviceId,

        message

      );


      setDeviceState(

        deviceId,

        {

          status: "error",

          qr: "",

          error:

            "AUTH_FAILURE: "

            +

            (

              message

              ||

              "Unknown authentication failure"

            )

        }

      );


    }

  );


  /* =====================================================
     DISCONNECTED
  ===================================================== */

  client.on(

    "disconnected",

    async (reason) => {


      log(

        "DEVICE DISCONNECTED:",

        deviceId,

        reason

      );


      clients.delete(deviceId);


      setDeviceState(

        deviceId,

        {

          status: "disconnected",

          qr: "",

          error:

            String(

              reason

              ||

              "Disconnected"

            )

        }

      );


    }

  );


  /* =====================================================
     INITIALIZE
  ===================================================== */

  try {


    log(

      "INITIALIZING WHATSAPP:",

      deviceId

    );


    await client.initialize();


  }

  catch (error) {


    clients.delete(deviceId);


    console.error(

      "INITIALIZE ERROR:",

      deviceId,

      error

    );


    setDeviceState(

      deviceId,

      {

        status: "error",

        qr: "",

        error:

          "INITIALIZE_ERROR: "

          +

          error.message

      }

    );


    throw error;

  }


  return client;

}


/* =========================================================
   GET WHATSAPP STATE
========================================================= */

async function getWhatsAppState(deviceId) {


  const client =

    clients.get(deviceId);


  if (!client) {

    return null;

  }


  try {


    return await client.getState();


  }

  catch (error) {


    return null;


  }

}


/* =========================================================
   NORMALIZE NUMBER
========================================================= */

function normalizeNumber(number) {


  const digits =

    String(

      number

      ||

      ""

    )

      .replace(

        /\D/g,

        ""

      );


  if (

    digits.length < 8

    ||

    digits.length > 15

  ) {

    return null;

  }


  return (

    `${digits}@c.us`

  );

}


/* =========================================================
   HEALTH
========================================================= */

app.get(

  "/health",

  async (

    req,

    res

  ) => {


    const list = [];


    for (

      const [

        deviceId,

        data

      ]

      of

      devices.entries()

    ) {


      const waState =

        data.status === "ready"

          ?

          await getWhatsAppState(

            deviceId

          )

          :

          null;


      list.push({

        deviceId,

        status: data.status,

        number: data.number,

        name: data.name,

        waState,

        error: data.error

      });


    }


    return res.json({


      status: "ok",


      node: NODE_ID,


      uptime:

        Math.floor(

          process.uptime()

        ),


      chromePath:

        CHROME_PATH,


      chromeExists:

        fs.existsSync(

          CHROME_PATH

        ),


      devices: list,


      totalDevices:

        clients.size,


      maxDevices:

        MAX_DEVICES


    });


  }

);


/* =========================================================
   CREATE DEVICE
========================================================= */

app.get(

  "/create-device",

  async (

    req,

    res

  ) => {


    const deviceId =

      String(

        req.query.deviceId

        ||

        ""

      );


    /* VALIDATE */

    if (

      !validDeviceId(deviceId)

    ) {


      return res

        .status(400)

        .json({


          status: "failed",


          message:

            "Invalid deviceId"


        });


    }


    /* EXISTS */

    if (

      clients.has(deviceId)

    ) {


      const data =

        getDeviceState(

          deviceId

        );


      return res.json({


        status:

          "already_exists",


        deviceId,


        qr:

          data?.qr

          ||

          "",


        ready:

          data?.status === "ready",


        exists: true,


        error:

          data?.error

          ||

          ""


      });


    }


    /* CREATE IN BACKGROUND */

    createDevice(

      deviceId

    )

      .catch(

        (error) => {


          console.error(

            "BACKGROUND CREATE ERROR:",

            deviceId,

            error

          );


        }

      );


    return res.json({


      status:

        "creating",


      deviceId,


      qr: "",


      ready: false,


      exists: false,


      node:

        NODE_ID


    });


  }

);


/* =========================================================
   GET QR
========================================================= */

app.get(

  "/get-qr",

  (

    req,

    res

  ) => {


    const deviceId =

      String(

        req.query.deviceId

        ||

        ""

      );


    if (

      !validDeviceId(deviceId)

    ) {


      return res

        .status(400)

        .json({


          status: "failed",


          message:

            "Invalid deviceId"


        });


    }


    const data =

      getDeviceState(

        deviceId

      );


    /* NOT FOUND */

    if (!data) {


      return res.json({


        status:

          "not_found",


        deviceId,


        qr: "",


        ready: false,


        exists: false,


        error: ""


      });


    }


    /* RETURN QR STATE */

    return res.json({


      status:

        data.status,


      deviceId,


      qr:

        data.qr

        ||

        "",


      ready:

        data.status === "ready",


      exists:

        clients.has(deviceId),


      error:

        data.error

        ||

        "",


      number:

        data.number

        ||

        "",


      name:

        data.name

        ||

        ""


    });


  }

);


/* =========================================================
   GET DEVICE
========================================================= */

app.get(

  "/get-device",

  async (

    req,

    res

  ) => {


    const deviceId =

      String(

        req.query.deviceId

        ||

        ""

      );


    const data =

      getDeviceState(

        deviceId

      );


    if (!data) {


      return res.json({


        deviceId,


        status:

          "not_found",


        ready: false,


        exists: false


      });


    }


    const waState =

      await getWhatsAppState(

        deviceId

      );


    return res.json({


      deviceId,


      status:

        data.status,


      ready:

        data.status === "ready",


      exists:

        clients.has(deviceId),


      number:

        data.number

        ||

        "",


      name:

        data.name

        ||

        "",


      waState,


      error:

        data.error

        ||

        "",


      createdAt:

        data.createdAt,


      updatedAt:

        data.updatedAt


    });


  }

);


/* =========================================================
   DEVICE STATE
========================================================= */

app.get(

  "/device-state",

  async (

    req,

    res

  ) => {


    const deviceId =

      String(

        req.query.deviceId

        ||

        ""

      );


    const data =

      getDeviceState(

        deviceId

      );


    if (!data) {


      return res

        .status(404)

        .json({


          status:

            "not_found"


        });


    }


    const waState =

      await getWhatsAppState(

        deviceId

      );


    return res.json({


      deviceId,


      backendStatus:

        data.status,


      waState,


      ready:

        data.status === "ready",


      hasQr:

        Boolean(

          data.qr

        ),


      error:

        data.error

        ||

        ""


    });


  }

);


/* =========================================================
   LIST DEVICES
========================================================= */

app.get(

  "/list-devices",

  (

    req,

    res

  ) => {


    const list = [];


    for (

      const [

        deviceId,

        data

      ]

      of

      devices.entries()

    ) {


      list.push({


        deviceId,


        status:

          data.status,


        ready:

          data.status === "ready",


        number:

          data.number

          ||

          "",


        name:

          data.name

          ||

          "",


        error:

          data.error

          ||

          ""


      });


    }


    return res.json({


      devices: list,


      total:

        list.length,


      node:

        NODE_ID


    });


  }

);


/* =========================================================
   DELETE DEVICE
========================================================= */

app.get(

  "/delete-device",

  async (

    req,

    res

  ) => {


    const deviceId =

      String(

        req.query.deviceId

        ||

        ""

      );


    if (

      !validDeviceId(deviceId)

    ) {


      return res

        .status(400)

        .json({


          status:

            "failed",


          message:

            "Invalid deviceId"


        });


    }


    if (

      !clients.has(deviceId)

      &&

      !devices.has(deviceId)

    ) {


      return res.json({


        status:

          "not_found"


      });


    }


    await removeDevice(

      deviceId,

      true

    );


    return res.json({


      status:

        "deleted",


      deviceId


    });


  }

);


/* =========================================================
   LOGOUT
========================================================= */

app.get(

  "/logout",

  async (

    req,

    res

  ) => {


    const deviceId =

      String(

        req.query.deviceId

        ||

        ""

      );


    const client =

      clients.get(deviceId);


    if (!client) {


      return res.json({


        status:

          "not_found"


      });


    }


    try {


      await client.logout();


    }

    catch (error) {


      log(

        "LOGOUT ERROR:",

        error.message

      );


    }


    await removeDevice(

      deviceId,

      true

    );


    return res.json({


      status:

        "logged_out",


      deviceId


    });


  }

);


/* =========================================================
   SEND SINGLE MESSAGE
========================================================= */

app.post(

  "/send-single",

  async (

    req,

    res

  ) => {


    const deviceId =

      String(

        req.body.deviceId

        ||

        ""

      );


    const number =

      normalizeNumber(

        req.body.number

      );


    const message =

      String(

        req.body.message

        ||

        ""

      )

        .trim();


    if (

      !validDeviceId(deviceId)

    ) {


      return res

        .status(400)

        .json({


          status:

            "failed",


          message:

            "Valid deviceId required"


        });


    }


    if (!number) {


      return res

        .status(400)

        .json({


          status:

            "failed",


          message:

            "Valid number required"


        });


    }


    if (!message) {


      return res

        .status(400)

        .json({


          status:

            "failed",


          message:

            "Message required"


        });


    }


    if (

      message.length > 4096

    ) {


      return res

        .status(400)

        .json({


          status:

            "failed",


          message:

            "Message too long"


        });


    }


    const client =

      clients.get(deviceId);


    const data =

      getDeviceState(deviceId);


    if (


      !client

      ||

      !data

      ||

      data.status !== "ready"

    ) {


      return res

        .status(409)

        .json({


          status:

            "failed",


          message:

            "Device not ready"


        });


    }


    try {


      const waState =

        await getWhatsAppState(

          deviceId

        );


      if (

        waState

        &&

        waState !== "CONNECTED"

      ) {


        return res

          .status(409)

          .json({


            status:

              "failed",


            message:

              `WhatsApp not connected: ${waState}`


          });


      }


      const registered =

        await client.isRegisteredUser(

          number

        );


      if (!registered) {


        return res.json({


          status:

            "nonwa"


        });


      }


      const result =

        await client.sendMessage(

          number,

          message

        );


      return res.json({


        status:

          "sent",


        messageId:

          result?.id?._serialized

          ||

          ""


      });


    }

    catch (error) {


      console.error(

        "SEND ERROR:",

        error

      );


      return res

        .status(500)

        .json({


          status:

            "failed",


          message:

            error.message

            ||

            "Send failed"


        });


    }


  }

);


/* =========================================================
   RESTORE SESSIONS
========================================================= */

async function restoreSessions() {


  if (

    !fs.existsSync(AUTH_DIR)

  ) {


    log(

      "NO SAVED SESSIONS FOUND"

    );


    return;


  }


  let folders = [];


  try {


    folders =

      fs

        .readdirSync(AUTH_DIR)

        .filter(

          (name) =>

            name.startsWith(

              "session-"

            )

        );


  }

  catch (error) {


    log(

      "SESSION READ ERROR:",

      error.message

    );


    return;


  }


  log(

    `FOUND ${folders.length} SAVED SESSIONS`

  );


  for (

    const folder

    of

    folders

  ) {


    const deviceId =

      folder.replace(

        /^session-/,

        ""

      );


    if (

      !validDeviceId(deviceId)

    ) {

      continue;

    }


    log(

      "RESTORING DEVICE:",

      deviceId

    );


    createDevice(

      deviceId

    )

      .catch(

        (error) => {


          console.error(

            "RESTORE ERROR:",

            deviceId,

            error.message

          );


        }

      );


    await new Promise(

      (resolve) =>

        setTimeout(

          resolve,

          3000

        )

    );


  }


}


/* =========================================================
   EXPRESS ERROR HANDLER
========================================================= */

app.use(

  (

    error,

    req,

    res,

    next

  ) => {


    console.error(

      "EXPRESS ERROR:",

      error

    );


    return res

      .status(500)

      .json({


        status:

          "failed",


        message:

          error.message

          ||

          "Internal server error"


      });


  }

);


/* =========================================================
   START SERVER
========================================================= */

app.listen(

  PORT,

  "0.0.0.0",

  async () => {


    log(

      "========================================"

    );


    log(

      `SERVER RUNNING ON PORT ${PORT}`

    );


    log(

      `NODE ID: ${NODE_ID}`

    );


    log(

      `MAX DEVICES: ${MAX_DEVICES}`

    );


    log(

      `CHROME PATH: ${CHROME_PATH}`

    );


    log(

      `CHROME EXISTS: ${fs.existsSync(CHROME_PATH)}`

    );


    log(

      "========================================"

    );


    await restoreSessions();


  }

);


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown(signal) {


  log(

    `${signal}: SHUTTING DOWN`

  );


  const allClients =

    [

      ...clients.values()

    ];


  await Promise.allSettled(

    allClients.map(

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


/* =========================================================
   UNCAUGHT ERRORS
========================================================= */

process.on(

  "uncaughtException",

  (error) => {


    console.error(

      "UNCAUGHT EXCEPTION:",

      error

    );


  }

);


process.on(

  "unhandledRejection",

  (reason) => {


    console.error(

      "UNHANDLED REJECTION:",

      reason

    );


  }

);