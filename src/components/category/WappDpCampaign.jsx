import React, { useState, useCallback, memo } from "react";
import { useDropzone } from "react-dropzone";
import { FaUserCircle } from "react-icons/fa";
import { useRef } from "react";


// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const API_NODE = "https://ownwhatsapp-backend.onrender.com";
const API_DJANGO = "https://ownwhatsapp-backend-django.onrender.com";
const QUEUE_THRESHOLD = 20; // 🔥 numbers above this go to "pending" queue

// ─────────────────────────────────────────────
// MODAL — memoized so it never re-renders unless modal changes
// ─────────────────────────────────────────────
const MODAL_STYLES = {
  success: { emoji: "🚀", bg: "from-green-500 to-emerald-600", border: "border-green-200", text: "text-green-700", light: "bg-green-50" },
  error: { emoji: "❌", bg: "from-red-500 to-rose-600", border: "border-red-200", text: "text-red-700", light: "bg-red-50" },
  warning: { emoji: "⚠️", bg: "from-orange-400 to-orange-500", border: "border-orange-200", text: "text-orange-700", light: "bg-orange-50" },
  info: { emoji: "⏳", bg: "from-green-500 to-green-600", border: "border-green-200", text: "text-green-700", light: "bg-green-50" },
};

const Modal = memo(({ modal, onClose }) => {
  if (!modal) return null;
  const s = MODAL_STYLES[modal.type] || MODAL_STYLES.info;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className={`modal-icon-circle bg-gradient-to-br ${s.bg}`}>
          <span className="modal-emoji">{s.emoji}</span>
        </div>
        <h2 className="modal-title">{modal.title}</h2>
        {modal.body && (
          <div className={`modal-body-box ${s.light} ${s.border} ${s.text}`}>
            {modal.body}
          </div>
        )}
        <button className={`modal-close-btn bg-gradient-to-r ${s.bg}`} onClick={onClose}>
          OK
        </button>
      </div>
      <style>{MODAL_CSS}</style>
    </div>
  );
});

const MODAL_CSS = `
  .modal-overlay{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);animation:fadeIn .22s ease}
  .modal-box{background:#fff;border-radius:20px;box-shadow:0 25px 60px rgba(0,0,0,.18);width:92%;max-width:400px;padding:32px 28px 28px;text-align:center;animation:slideUp .3s cubic-bezier(.16,1,.3,1)}
  .modal-icon-circle{width:62px;height:62px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;box-shadow:0 6px 20px rgba(0,0,0,.15);transition:transform .2s ease}
  .modal-emoji{font-size:26px;line-height:1}
  .modal-title{font-size:18px;font-weight:700;color:#1f2937;margin-bottom:12px;line-height:1.4}
  .modal-body-box{border-radius:10px;border:1px solid;padding:12px 14px;font-size:14px;line-height:1.6;margin-bottom:20px;text-align:left;white-space:pre-line}
  .modal-close-btn{color:#fff;border:none;cursor:pointer;padding:10px 36px;border-radius:10px;font-size:15px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .2s ease,transform .2s cubic-bezier(.4,0,.2,1),box-shadow .2s ease}
  .modal-close-btn:hover{opacity:.92;transform:scale(1.04);box-shadow:0 6px 16px rgba(0,0,0,.2)}
  .modal-close-btn:active{transform:scale(.98)}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes slideUp{from{transform:translateY(24px) scale(.97);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}

  .confirm-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);animation:fadeIn .2s ease}
  .confirm-box{background:#fff;border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,.25);width:92%;max-width:380px;padding:24px;text-align:center;animation:slideUp .3s cubic-bezier(.16,1,.3,1)}
`;

// ─────────────────────────────────────────────
// UPLOAD BOX — memoized with stable setter refs
// ─────────────────────────────────────────────
const UploadBox = memo(({ title, type, color, images, video, pdf, setImages, setVideo, setPdf }) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept:
      type === "image" ? { "image/*": [] }
        : type === "video" ? { "video/*": [] }
          : { "application/pdf": [] },
    multiple: type === "image",
    onDrop: useCallback((files) => {
      if (!files.length) return;
      if (type === "image") setImages((p) => [...p, ...files].slice(0, 4));
      if (type === "video") setVideo(files[0]);
      if (type === "pdf") setPdf(files[0]);
    }, [type, setImages, setVideo, setPdf]),
  });

  const removeImage = useCallback((idx, e) => {
    e.stopPropagation();
    setImages((p) => p.filter((_, i) => i !== idx));
  }, [setImages]);

  return (
    <div className="border border-gray-300 rounded overflow-hidden transition-shadow duration-200 hover:shadow-md">
      <div className={`${color} text-white px-4 py-2 text-[13px] font-semibold`}>{title}</div>
      <div
        {...getRootProps()}
        className={`bg-gray-100 text-gray-600 text-center p-3 min-h-[120px] cursor-pointer transition-colors duration-200 ${isDragActive ? "bg-gray-200" : "hover:bg-gray-200"
          }`}
      >
        <input {...getInputProps()} />
        {type === "image" && images.length > 0 ? (
          <div className="flex gap-2 flex-wrap justify-center">
            {images.map((img, i) => (
              <div key={i} className="relative group transition-transform duration-150 hover:scale-105">
                <img src={URL.createObjectURL(img)} alt="" className="w-16 h-16 object-cover border rounded" />
                <button
                  onClick={(e) => removeImage(i, e)}
                  className="absolute top-0 right-0 bg-red-500 text-white text-xs px-1 rounded-bl transition-colors duration-150 hover:bg-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : type === "video" && video ? (
          <div>
            <video src={URL.createObjectURL(video)} className="w-28 mx-auto rounded" controls />
            <button
              onClick={(e) => { e.stopPropagation(); setVideo(null); }}
              className="mt-1 text-red-500 text-xs underline block mx-auto transition-colors duration-150 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ) : type === "pdf" && pdf ? (
          <div>
            <p className="text-sm">📄 {pdf.name}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setPdf(null); }}
              className="mt-1 text-red-500 text-xs underline transition-colors duration-150 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ) : (
          <>Drag & Drop {type} files<br />or <span className="underline">Browse {type}</span></>
        )}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function getUser() {
  try { return JSON.parse(sessionStorage.getItem("user") || "{}"); } catch { return {}; }
}

function buildFilesData(images, video, pdf) {
  return [
    ...images.map((f) => ({ name: f.name, type: f.type })),
    ...(video ? [{ name: video.name, type: video.type }] : []),
    ...(pdf ? [{ name: pdf.name, type: pdf.type }] : []),
  ];
}

async function safeFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Cleans, validates, and deduplicates a raw numbers textarea value.
 * - Strips all non-digit characters (spaces, dashes, +, parens, etc.)
 * - Drops a leading "91" country code whenever the cleaned digit
 *   string is 12 digits long, so "919876543210" and "9876543210"
 *   both resolve to the same 10-digit number.
 * - Keeps only valid 10-digit Indian mobile numbers (starting 6-9).
 * - Deduplicates the result.
 * Returns { valid: string[], invalidCount, duplicateCount, totalEntered }.
 */
function parseAndValidateNumbers(raw) {
  const lines = raw.split("\n").map((n) => n.trim()).filter(Boolean);

  const cleaned = lines.map((n) => {
    let digits = n.replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) {
      digits = digits.slice(2);
    }
    return digits;
  });

  const isValid = (n) => /^[6-9]\d{9}$/.test(n);

  const seen = new Set();
  const valid = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const n of cleaned) {
    if (!isValid(n)) { invalidCount++; continue; }
    if (seen.has(n)) { duplicateCount++; continue; }
    seen.add(n);
    valid.push(n);
  }

  return { valid, invalidCount, duplicateCount, totalEntered: lines.length };
}

// ─────────────────────────────────────────────
// BACKGROUND DP UPDATER
// Runs AFTER the UI has already reset + shown the "DP update started"
// popup. Takes a frozen snapshot of everything it needs so it doesn't
// care that form state has already been cleared. Talks to the report
// screen purely via window events — never touches modal/form state
// directly (component may have moved on to a new draft).
// ─────────────────────────────────────────────
async function runDpUpdateInBackground({ numberList, images, video, pdf, message, user, isLarge }) {
  try {
    const filesData = buildFilesData(images, video, pdf);
    let campaignId = null;

    // ── STEP 1: For large batches, pre-save as "pending" ──
    if (isLarge) {
      const pendingData = await safeFetch(`${API_DJANGO}/api/update-dp/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: numberList.map((n) => ({ number: n, status: "pending", files: filesData })),
          message,
          total: numberList.length,
          user_id: user.id,
          status: "pending",
        }),
      });

      if (pendingData.status === "failed") {
        console.error("DP campaign pre-save failed:", pendingData.message);
        return;
      }

      campaignId = pendingData.campaign_id || null;

      if (pendingData.remaining_credit !== undefined) {
        sessionStorage.setItem("user", JSON.stringify({ ...user, credit: pendingData.remaining_credit }));
        window.dispatchEvent(new Event("creditUpdated"));
      }

      // Pending row now exists — let the Report tab pick it up immediately.
      window.dispatchEvent(new Event("dpCampaignUpdated"));

      // 🔥 Fall through to Node call below — Node sends the admin
      // WhatsApp alert + schedules 25-35 min auto-complete.
    }

    // ── STEP 2: Send to Node (handles the actual DP update) ──
    const formData = new FormData();
    numberList.forEach((n) => formData.append("numbers", n));
    formData.append("message", message || "");
    formData.append("userRole", user?.role || "user");
    if (user?.id) formData.append("userId", user.id);
    if (campaignId) formData.append("campaignId", campaignId);
    images.forEach((img) => formData.append("files", img));
    if (video) formData.append("files", video);
    if (pdf) formData.append("files", pdf);

    const data = await safeFetch(`${API_NODE}/update-dp-bulk`, { method: "POST", body: formData });

    if (data.status === "blocked" || data.status === "no_device") {
      console.error("DP update failed:", data.status, data.message);
      return;
    }
    if (data.status === "Pending" || data.status === "approval_pending") {
      window.dispatchEvent(new Event("dpCampaignUpdated"));
      return;
    }
    if (!user?.id) {
      console.error("Session missing — could not save completed DP campaign.");
      return;
    }

    // ── STEP 3: Save completed campaign to Django ──
    const updatedResults = (data.results || []).map((r) => ({ ...r, files: filesData }));

    const saveData = await safeFetch(`${API_DJANGO}/api/update-dp/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results: updatedResults,
        message,
        total: data.total || numberList.length,
        user_id: user.id,
        status: "completed",
      }),
    });

    if (saveData.status === "failed") {
      console.error("DP campaign save failed:", saveData.message);
      return;
    }

    if (saveData.remaining_credit !== undefined) {
      sessionStorage.setItem("user", JSON.stringify({ ...user, credit: saveData.remaining_credit }));
    }

    window.dispatchEvent(new Event("dpCampaignUpdated"));
    window.dispatchEvent(new Event("creditUpdated"));

  } catch (err) {
    console.error("BACKGROUND DP UPDATE ERROR:", err);
  }
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function WappDpCampaign() {
  const dpRef = useRef(null);
  const [dp, setDp] = useState(null);
  const [images, setImages] = useState([]);
  const [video, setVideo] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [campaignName, setCampaignName] = useState("");
  const [numbers, setNumbers] = useState("");
  const [message, setMessage] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [modal, setModal] = useState(null);
  const [justCleaned, setJustCleaned] = useState(false);

  const showModal = useCallback((type, title, body = "") => setModal({ type, title, body }), []);

  const { valid: numberList, invalidCount, duplicateCount, totalEntered } = parseAndValidateNumbers(numbers);

  const user = getUser();
  const isAdmin = (user?.role || "user").toLowerCase() === "admin";
  const isLarge = !isAdmin && numberList.length > QUEUE_THRESHOLD;
  const needsCleanup = invalidCount > 0 || duplicateCount > 0;

  // ── AUTO-CLEAN NUMBERS ──
  // Strips "91" country-code prefixes, drops invalid/duplicate lines,
  // and rewrites the textarea to only the valid 10-digit numbers.
  // Fires on paste (right after the pasted text lands) and on blur
  // (when the user leaves the field) — never on every keystroke, so
  // typing a fresh number isn't wiped before it reaches 10 digits.
  const cleanNumbersField = useCallback(() => {
    setNumbers((prev) => {
      const { valid } = parseAndValidateNumbers(prev);
      const cleanedText = valid.join("\n");
      if (cleanedText !== prev.trim()) {
        setJustCleaned(true);
        setTimeout(() => setJustCleaned(false), 1500);
      }
      return cleanedText;
    });
  }, []);

  const handleNumbersPaste = useCallback(() => {
    setTimeout(cleanNumbersField, 0);
  }, [cleanNumbersField]);

  // ── RESET ──
  const resetForm = useCallback(() => {
    setNumbers(""); setMessage(""); setCampaignName("");
    setImages([]);
    setVideo(null);
    setPdf(null);
    setDp(null);
    if (dpRef.current) dpRef.current.value = "";
  }, []);

  // ── CONFIRM → "Yes, Update" ──
  // Fires instantly: shows the "DP update started" popup, clears the
  // form right away, then kicks off the real update in the background.
  // Report tab updates itself via the dpCampaignUpdated/creditUpdated events.
  const confirmSend = useCallback(() => {
    if (!numberList.length) {
      setShowConfirm(false);
      showModal("error", "No Numbers!", "Please enter at least one number.");
      return;
    }

    // Freeze everything the background updater needs BEFORE we reset the form.
    const snapshot = {
      numberList,
      images,
      video,
      pdf,
      message,
      user,
      isLarge,
    };

    setShowConfirm(false);

    showModal(
      "info",
      "DP Update Will Be Started 🚀",
      isLarge
        ? `Total Numbers: ${numberList.length}\nDP Campaign Will Be Submitted.`
        : `Total Numbers: ${numberList.length}\nDP Campaign Will Be Submitted.`
    );

    resetForm();

    // Fire and forget — does not block the UI.
    runDpUpdateInBackground(snapshot);
  }, [numberList, images, video, pdf, message, user, isLarge, showModal, resetForm]);

  const handleSendClick = useCallback(() => {
    if (!campaignName.trim() || !numbers.trim()) {
      showModal("warning", "Fill All Fields ⚠️", "Please enter Campaign Name and Numbers before updating.");
      return;
    }
    cleanNumbersField();
    if (!numberList.length) {
      showModal("error", "No Valid Numbers ❌", "None of the entered numbers are valid 10-digit Indian mobile numbers.");
      return;
    }
    setShowConfirm(true);
  }, [campaignName, numbers, numberList, showModal, cleanNumbersField]);

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f1f1f1] relative">

      <div className="bg-gray-200">
        <marquee className="text-red-600 py-2 text-[18px]">
          NOTE = All DP Updates will be delivered Between 9A.M to 6P.M - (Monday to Saturday)
        </marquee>
      </div>

      <div className="camp-wrap">
        <div className="bg-white border border-gray-300 rounded">

          <div className="px-4 py-3 text-[18px] font-semibold text-gray-800 bg-[#f0f3f5] flex items-center gap-2">
            <FaUserCircle /> Wapp DP Update
          </div>

          <div className="p-4">

            {/* CAMPAIGN NAME + LIVE NUMBER STATS */}
            <div className="camp-header-row">
              <div className="camp-name-row">
                <div className="bg-[#F86C6B] text-white px-4 py-2 text-[15px] flex items-center whitespace-nowrap">
                  Campaign Name
                </div>
                <input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="camp-name-input border border-gray-300 h-[38px] px-3 outline-none transition-shadow duration-200 focus:shadow-[0_0_0_3px_rgba(32,168,216,0.2)] focus:border-[#20A8D8]"
                />
              </div>

              {(numberList.length > 0 || invalidCount > 0 || duplicateCount > 0) && (
                <div className="camp-stats-row">
                  <span className="camp-stat-badge bg-[#20A8D8] transition-transform duration-200 hover:scale-[1.03]">
                    Total Valid Mobile:<b className="ml-1">{numberList.length}</b>
                  </span>
                  <span className="camp-stat-badge bg-[#F0AD4E] transition-transform duration-200 hover:scale-[1.03]">
                    Duplicate:<b className="ml-1">{duplicateCount}</b>
                  </span>
                  <span className="camp-stat-badge bg-[#F86C6B] transition-transform duration-200 hover:scale-[1.03]">
                    Invalid:<b className="ml-1">{invalidCount}</b>
                  </span>
                  {justCleaned && (
                    <span className="camp-stat-badge bg-indigo-500 transition-all duration-200">
                      ✓ List cleaned
                    </span>
                  )}
                  {needsCleanup && (
                    <button
                      type="button"
                      onClick={cleanNumbersField}
                      className="camp-stat-badge bg-white text-gray-600 border border-gray-300 transition-all duration-150 hover:bg-gray-100 hover:shadow-sm"
                    >
                      🧹 Clean now
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="camp-grid">

              {/* LEFT — NUMBERS */}
              <div className="camp-left">
                <p className="mb-1 text-[18px]">Numbers:</p>
                <textarea
                  value={numbers}
                  onChange={(e) => setNumbers(e.target.value)}
                  onPaste={handleNumbersPaste}
                  onBlur={cleanNumbersField}
                  placeholder="One number per line"
                  className="camp-textarea border border-green-400 rounded px-2 py-2 text-[13px] outline-none resize-none transition-shadow duration-200 focus:shadow-[0_0_0_3px_rgba(74,222,128,0.25)]"
                />
              </div>

              {/* RIGHT — CAPTION/MESSAGE + MEDIA */}
              <div className="camp-right">
                <p className="mb-1 text-[18px]">Message:</p>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full h-[190px] border border-green-400 rounded px-2 py-2 text-[13px] outline-none resize-none mb-3 transition-shadow duration-200 focus:shadow-[0_0_0_3px_rgba(74,222,128,0.25)]"
                />

                {/* DP UPLOAD */}
                <div className="border border-gray-300 rounded overflow-hidden mb-3 transition-shadow duration-200 hover:shadow-md">
                  <div className="bg-[#F86C6B] text-white px-4 py-2 text-[13px] font-semibold">
                    DP Image — Profile picture set hogi (Max 1 MB)
                  </div>
                  <div className="bg-gray-100 px-3 py-2 flex items-center gap-3 flex-wrap">
                    <input
                      ref={dpRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => setDp(e.target.files[0] || null)}
                      className="text-[13px]"
                    />
                    {dp && (
                      <div className="flex items-center gap-2 transition-opacity duration-200">
                        <img src={URL.createObjectURL(dp)} alt="DP preview"
                          className="w-12 h-12 rounded-full object-cover border-2 border-[#F86C6B] transition-transform duration-150 hover:scale-105" />
                        <button
                          onClick={() => { setDp(null); if (dpRef.current) dpRef.current.value = ""; }}
                          className="text-red-500 text-xs underline transition-colors duration-150 hover:text-red-700"
                        >Remove</button>
                      </div>
                    )}
                  </div>
                </div>

                <UploadBox
                  title="DP Image (Optional · Max 1 MB · Max 4 images)"
                  type="image" color="bg-[#63C2DE]"
                  images={images} video={video} pdf={pdf}
                  setImages={setImages} setVideo={setVideo} setPdf={setPdf}
                />

                <div className="flex gap-3 mt-2">
                  <div className="w-1/2 h-[130px] overflow-hidden">
                    <UploadBox
                      title="Video Upload (Max 3 MB)"
                      type="video" color="bg-[#4DBD74]"
                      images={images} video={video} pdf={pdf}
                      setImages={setImages} setVideo={setVideo} setPdf={setPdf}
                    />
                  </div>
                  <div className="w-1/2 h-[130px] overflow-hidden">
                    <UploadBox
                      title="PDF (Max 1 MB)"
                      type="pdf" color="bg-[#F86C6B]"
                      images={images} video={video} pdf={pdf}
                      setImages={setImages} setVideo={setVideo} setPdf={setPdf}
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSendClick}
              className="mt-4 bg-[#20A8D8] hover:bg-[#1b8db8] text-white px-7 py-3 rounded-b-md transition-all duration-200 ease-out hover:shadow-lg active:scale-[0.98]"
            >
              Update DP Now
            </button>

          </div>
        </div>
      </div>

      {/* CONFIRM MODAL */}
      {showConfirm && (
        <div className="confirm-overlay">
          <div className="confirm-box">
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 flex items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600 text-white text-2xl shadow-md">✓</div>
            </div>
            <h2 className="text-xl font-semibold text-gray-800 mb-3">Are You Sure?</h2>

            {isAdmin ? (
              <p className="text-xl font-semibold text-gray-800 mb-4 px-3 py-2">
                DP Campaign Will Be Send {numberList.length}
              </p>
            ) : isLarge ? (
              <p className="text-xl font-semibold text-gray-800 mb-4 px-3 py-2">
                DP Campaign Will Be Send {numberList.length}<br />
              </p>
            ) : (
              <p className="text-xl font-semibold text-gray-800 mb-4 px-3 py-2">
                DP Campaign Will Be Send {numberList.length}
              </p>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={confirmSend}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium shadow transition-all duration-200 hover:scale-105 hover:shadow-lg active:scale-[0.98]"
              >
                Yes, Update
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="px-5 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium transition-all duration-200 hover:bg-gray-300 active:scale-[0.98]"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal modal={modal} onClose={() => setModal(null)} />

      <style>{MODAL_CSS}</style>

      <style>{`
        .camp-wrap { padding: 24px; }
        .camp-header-row { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
        .camp-name-row { display: flex; flex-wrap: wrap; gap: 0; }
        .camp-name-input { width: 320px; }
        .camp-stats-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; animation: fadeIn .25s ease; }
        .camp-stat-badge {
          display: inline-flex; align-items: center; color: #fff; font-size: 13px; font-weight: 500;
          padding: 8px 14px; border-radius: 6px; white-space: nowrap; cursor: default;
          box-shadow: 0 1px 3px rgba(0,0,0,.12);
        }
        button.camp-stat-badge { cursor: pointer; box-shadow: none; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .camp-grid { display: flex; gap: 20px; }
        .camp-left { width: 25%; }
        .camp-right { width: 75%; }
        .camp-textarea { width: 100%; height: 500px; }
        @media (max-width: 900px) {
          .camp-wrap { padding: 12px; }
          .camp-grid { flex-direction: column; }
          .camp-left, .camp-right { width: 100%; }
          .camp-textarea { height: 180px; }
          .camp-name-input { width: 100%; flex: 1; }
          .camp-name-row { flex-wrap: nowrap; width: 100%; }
          .camp-header-row { flex-direction: column; align-items: stretch; gap: 10px; }
        }
        @media (max-width: 480px) {
          .camp-wrap { padding: 8px; }
          .camp-name-row { flex-direction: column; }
          .camp-name-input { width: 100%; }
        }
      `}</style>
    </div>
  );
}