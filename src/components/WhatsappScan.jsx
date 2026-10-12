import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/* =========================================================
   CONFIG
========================================================= */

const API = "https://ownwhatsapp-backend.onrender.com"; // backend URL (change only here)
const STORAGE_KEY = "wapp_devices";

const QR_POLL_MS = 1500;
const STATUS_POLL_MS = 5000;
const QR_MAX_WAIT_MS = 5 * 60 * 1000; // Chrome can be slow to start on a small Render instance


/* =========================================================
   HELPERS
========================================================= */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getUser = () => {
  try {
    return JSON.parse(sessionStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
};

const loadSaved = () => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

// fetch with timeout. Throws on network error / timeout, never on HTTP status.
async function api(path, params = {}, timeoutMs = 20000) {
  const query = new URLSearchParams({ ...params, _: Date.now() }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API}${path}?${query}`, {
      signal: controller.signal,
      cache: "no-store",
    });

    let data = {};
    try {
      data = (await res.json()) || {};
    } catch {
      /* response was not JSON */
    }

    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const TRANSIENT = [429, 502, 503, 504]; // Render is waking up / busy: just retry


/* =========================================================
   STATUS BADGE
========================================================= */

const BADGES = {
  connected: { dot: "bg-[#4DBD74] animate-pulse", text: "text-[#4DBD74]", label: "Connected" },
  connecting: { dot: "bg-yellow-400 animate-pulse", text: "text-yellow-500", label: "Connecting..." },
  scan: { dot: "bg-blue-400 animate-pulse", text: "text-blue-500", label: "Waiting for scan" },
  offline: { dot: "bg-gray-400", text: "text-gray-500", label: "Server unreachable" },
  disconnected: { dot: "bg-red-400", text: "text-red-500", label: "Not Connected" },
};

const StatusBadge = ({ status }) => {
  const badge = BADGES[status] || BADGES.disconnected;

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full inline-block ${badge.dot}`} />
      <span className={`${badge.text} text-sm font-medium`}>{badge.label}</span>
    </div>
  );
};


/* =========================================================
   COMPONENT
========================================================= */

const WhatsappScan = () => {
  const navigate = useNavigate();
  const user = getUser();

  const [devices, setDevices] = useState(loadSaved);
  const [deviceStatus, setDeviceStatus] = useState(() =>
    Object.fromEntries(loadSaved().map((id) => [id, "connecting"]))
  ); // connected | connecting | scan | disconnected | offline
  const [deviceInfo, setDeviceInfo] = useState({});
  const [deviceError, setDeviceError] = useState({});

  // QR modal
  const [showQR, setShowQR] = useState(false);
  const [activeDevice, setActiveDevice] = useState(null);
  const [attempt, setAttempt] = useState(0); // bump to restart the QR loop (Retry)
  const [qr, setQr] = useState("");
  const [phase, setPhase] = useState("starting"); // starting | qr | error
  const [qrMsg, setQrMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const devicesRef = useRef(devices);
  const pollingRef = useRef(false);

  // 🔒 ADMIN ONLY
  useEffect(() => {
    if (user?.role !== "admin") navigate("/dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep localStorage + ref in sync with the device list
  useEffect(() => {
    devicesRef.current = devices;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
    } catch {
      /* storage full / blocked */
    }
  }, [devices]);


  /* ---------- STATUS OF ONE DEVICE ---------- */

  const refreshStatus = useCallback(async (id) => {
    try {
      const { data } = await api("/get-device", { deviceId: id });

      // Connected means the server says ready. A saved phone number alone is not enough.
      if (data.ready === true) {
        setDeviceStatus((prev) => ({ ...prev, [id]: "connected" }));
        setDeviceInfo((prev) => ({
          ...prev,
          [id]: {
            number: data.number || "",
            name: data.name || "",
            token: id,
            time: prev[id]?.time || new Date().toLocaleString(),
          },
        }));
        setDeviceError((prev) => ({ ...prev, [id]: "" }));
        return;
      }

      const next =
        data.status === "creating" || data.status === "authenticated"
          ? "connecting"
          : data.status === "qr"
          ? "scan"
          : "disconnected"; // not_found / error / disconnected

      setDeviceStatus((prev) => ({ ...prev, [id]: next }));
      setDeviceError((prev) => ({ ...prev, [id]: data.error || "" }));
      setDeviceInfo((prev) => {
        if (!prev[id]) return prev;
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    } catch {
      setDeviceStatus((prev) => ({ ...prev, [id]: "offline" }));
    }
  }, []);


  // Merge devices that exist on the server (after a Render restart or from another browser)
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api("/list-devices");
        const serverIds = (data.devices || []).map((d) => d.deviceId).filter(Boolean);
        if (!serverIds.length) return;

        setDevices((prev) => [...new Set([...prev, ...serverIds])]);
      } catch {
        /* server asleep: the status poll below will report it */
      }
    })();
  }, []);


  // Background status polling
  useEffect(() => {
    const tick = async () => {
      if (pollingRef.current || document.hidden) return;

      pollingRef.current = true;
      try {
        await Promise.all(devicesRef.current.map(refreshStatus));
      } finally {
        pollingRef.current = false;
      }
    };

    tick();
    const timer = setInterval(tick, STATUS_POLL_MS);

    return () => clearInterval(timer);
  }, [refreshStatus]);


  /* ---------- QR MODAL ---------- */

  const closeModal = useCallback(() => {
    setShowQR(false);
    setActiveDevice(null); // stops the QR loop
    setQr("");
    setPhase("starting");
    setQrMsg("");
  }, []);

  const startQR = (id) => {
    setActiveDevice(id);
    setShowQR(true);
    setQr("");
    setPhase("starting");
    setQrMsg("Connecting to the server... If Render was asleep this can take up to a minute.");
    setElapsed(0);
    setAttempt((n) => n + 1);
  };

  // QR loop: make sure the device exists on the server, then poll until QR / ready / error
  useEffect(() => {
    if (!activeDevice) return undefined;

    let cancelled = false;
    const id = activeDevice;
    const startedAt = Date.now();

    const fail = (message) => {
      if (cancelled) return;
      setPhase("error");
      setQrMsg(message);
      setQr("");
    };

    const run = async () => {
      // 1) Create the device (also recreates it if the server restarted and forgot it)
      let created = false;

      for (let i = 0; i < 3 && !created && !cancelled; i += 1) {
        try {
          const res = await api("/create-device", { deviceId: id }, 70000);
          if (cancelled) return;

          if (res.status === 401) {
            return fail(
              "The server rejected the request (401). Remove the API_KEY variable on Render, or send the x-api-key header from this app."
            );
          }

          if (TRANSIENT.includes(res.status)) {
            await sleep(2000);
            continue;
          }

          if (!res.ok) {
            return fail(`Server error ${res.status}: ${res.data.message || "could not create the device"}`);
          }

          if (res.data.status === "error") {
            return fail(res.data.error || "The server could not start this device.");
          }

          created = true;
        } catch {
          await sleep(2000);
        }
      }

      if (cancelled) return;

      if (!created) {
        return fail(
          "Cannot reach the backend. Check that the Render service is running and that the URL in this file is correct."
        );
      }

      // 2) Poll for QR / ready
      let recreated = 0;

      while (!cancelled) {
        const waited = Date.now() - startedAt;
        setElapsed(Math.floor(waited / 1000));

        if (waited > QR_MAX_WAIT_MS) {
          return fail(
            "No QR after 5 minutes. Open the Render logs, look for CHROME EXISTS and INITIALIZE_ERROR, then click Retry."
          );
        }

        try {
          const { status, data } = await api("/get-qr", { deviceId: id });
          if (cancelled) return;

          if (status === 401) {
            return fail("The server rejected the request (401). The API_KEY does not match.");
          }

          const st = data.status;

          if (data.ready || st === "ready") {
            await refreshStatus(id);
            if (!cancelled) closeModal();
            return;
          }

          if (st === "qr" && typeof data.qr === "string" && data.qr.startsWith("data:image")) {
            setQr(data.qr);
            setPhase("qr");
          } else if (st === "error" || st === "disconnected") {
            return fail(data.error || `Device status: ${st}. Click Retry.`);
          } else if (st === "not_found") {
            if (recreated >= 3) {
              return fail("The server no longer has this device (it probably restarted). Click Retry.");
            }
            recreated += 1;
            await api("/create-device", { deviceId: id }, 70000);
          } else {
            setPhase("starting");
            setQrMsg(
              st === "authenticated"
                ? "Scan accepted. Loading your chats..."
                : "Starting Chrome and WhatsApp Web on the server..."
            );
          }
        } catch {
          // Keep showing a QR that is already on screen; otherwise show a waiting message
          setPhase((p) => (p === "qr" ? p : "starting"));
          setQrMsg("The server is not responding yet. Trying again...");
        }

        await sleep(QR_POLL_MS);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [activeDevice, attempt, refreshStatus, closeModal]);


  /* ---------- ACTIONS ---------- */

  const addDevice = () => {
    const id = `device_${Date.now()}`;

    setDevices((prev) => [...prev, id]);
    setDeviceStatus((prev) => ({ ...prev, [id]: "connecting" }));
    startQR(id);
  };

  const removeDevice = (id) => {
    setDevices((prev) => prev.filter((d) => d !== id));

    const drop = (setter) =>
      setter((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });

    drop(setDeviceStatus);
    drop(setDeviceInfo);
    drop(setDeviceError);

    if (activeDevice === id) closeModal();
  };

  const deleteDevice = async (id) => {
    if (!window.confirm("Delete this device?")) return;

    try {
      const { data } = await api("/delete-device", { deviceId: id }, 30000);

      if (data.status === "deleted" || data.status === "not_found") {
        removeDevice(id);
        if (data.status === "deleted") alert("Deleted ✅");
      } else {
        alert(`Delete failed ❌ ${data.message || ""}`);
      }
    } catch {
      alert("Delete failed ❌ The server is unreachable.");
    }
  };

  const disconnectDevice = async (id) => {
    if (!window.confirm("Disconnect this device? Session will be cleared.")) return;

    try {
      const { data } = await api("/logout", { deviceId: id }, 40000);

      if (data.status === "logged_out" || data.status === "not_found") {
        removeDevice(id);
        alert("Disconnected ✅");
      } else {
        alert(`Disconnect failed ❌ ${data.message || ""}`);
      }
    } catch {
      alert("Disconnect failed ❌ The server is unreachable.");
    }
  };


  /* ---------- RENDER ---------- */

  const connectedCount = devices.filter((d) => deviceStatus[d] === "connected").length;

  return (
    <div className="min-h-screen bg-[#f1f1f1] p-6">

      {/* HEADER */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-800">
          WhatsApp QR — Scan to Connect
        </h1>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
          {connectedCount} / {devices.length} Connected
        </div>
      </div>

      {/* ADD DEVICE BUTTON */}
      <button
        onClick={addDevice}
        className="bg-[#4DBD74] hover:bg-[#3ea764] text-white px-5 py-2 rounded mb-6 font-medium transition"
      >
        + Add Device
      </button>

      {/* DEVICE LIST */}
      <div className="grid gap-4">
        {devices.length === 0 && (
          <div className="bg-white border border-gray-300 rounded p-8 text-center text-gray-400">
            No devices added. Click "+ Add Device" to connect WhatsApp.
          </div>
        )}

        {devices.map((d) => {
          const connected = deviceStatus[d] === "connected";

          return (
            <div
              key={d}
              className="bg-white border border-gray-300 p-4 rounded flex justify-between items-center"
            >
              <div className="flex items-center gap-4">
                {/* WhatsApp Icon */}
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-xl font-bold ${
                    connected ? "bg-[#4DBD74]" : "bg-gray-300"
                  }`}
                >
                  {connected ? "✓" : "📱"}
                </div>

                <div>
                  <p className="font-semibold text-gray-800 text-[15px]">
                    {deviceInfo[d]?.number
                      ? `+${deviceInfo[d].number}`
                      : deviceStatus[d] === "connecting"
                      ? "Connecting..."
                      : "Not Connected"}
                  </p>

                  {deviceInfo[d]?.name && (
                    <p className="text-gray-500 text-sm">{deviceInfo[d].name}</p>
                  )}

                  <StatusBadge status={deviceStatus[d]} />

                  {connected && deviceInfo[d]?.time && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Connected since {deviceInfo[d].time}
                    </p>
                  )}

                  {deviceStatus[d] === "disconnected" && (
                    <p className="text-xs text-orange-400 mt-0.5 max-w-md break-words">
                      ⚠️ {deviceError[d] || "No active session on the server. Click Show QR to link again."}
                    </p>
                  )}

                  {deviceStatus[d] === "offline" && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      The backend is not responding (Render may be asleep or restarting).
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                {!connected && (
                  <button
                    onClick={() => startQR(d)}
                    className="bg-[#20A8D8] hover:bg-[#1b8db8] text-white px-4 py-1.5 rounded text-sm transition"
                  >
                    Show QR
                  </button>
                )}

                <button
                  onClick={() => disconnectDevice(d)}
                  className="bg-[#F86C6B] hover:bg-red-600 text-white px-4 py-1.5 rounded text-sm transition"
                >
                  Disconnect
                </button>

                <button
                  onClick={() => deleteDevice(d)}
                  className="bg-[#3ea764] hover:bg-[#2d8a52] text-white px-4 py-1.5 rounded text-sm transition"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* QR MODAL */}
      {showQR && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center w-[340px]">

            <h2 className="text-xl font-semibold text-gray-800 mb-1">
              Scan QR Code
            </h2>
            <p className="text-gray-400 text-sm mb-5">
              Open WhatsApp → Linked Devices → Link a Device
            </p>

            {/* QR Display */}
            <div className="flex items-center justify-center w-[240px] h-[240px] mx-auto border-2 border-gray-200 rounded-xl overflow-hidden bg-white">
              {phase === "qr" && qr ? (
                <img src={qr} alt="QR Code" className="w-full h-full object-contain" />
              ) : phase === "error" ? (
                <div className="p-3 text-xs text-red-500 text-left break-words overflow-auto max-h-full">
                  ⚠️ {qrMsg}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-gray-400 px-3">
                  <div className="w-10 h-10 border-4 border-gray-200 border-t-[#4DBD74] rounded-full animate-spin" />
                  <p className="text-xs">{qrMsg || "Generating QR..."}</p>
                </div>
              )}
            </div>

            {/* Status */}
            <p className="text-xs text-gray-400 mt-4 mb-5">
              {phase === "qr"
                ? "✅ QR ready — scan now before it expires"
                : phase === "error"
                ? "❌ Could not get a QR code"
                : `⏳ Waiting for the server... ${elapsed}s`}
            </p>

            <div className="flex justify-center gap-2">
              {phase === "error" && (
                <button
                  onClick={() => startQR(activeDevice)}
                  className="bg-[#20A8D8] hover:bg-[#1b8db8] text-white px-5 py-2 rounded-lg transition"
                >
                  Retry
                </button>
              )}

              <button
                onClick={closeModal}
                className="bg-[#F86C6B] hover:bg-red-600 text-white px-6 py-2 rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default WhatsappScan;