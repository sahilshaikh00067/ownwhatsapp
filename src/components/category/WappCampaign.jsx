import React, { useState, useCallback, useEffect, useMemo, useRef, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useDropzone } from "react-dropzone";
import {
  FaBullhorn,
  FaTableList,
  FaPaperPlane,
  FaArrowLeft,
  FaFileSignature,
  FaSignsPost,
  FaMobileScreenButton,
  FaAnglesRight,
  FaUsersLine,
  FaUpload,
  FaHandPointRight,
  FaHandPointLeft,
  FaClipboardCheck,
  FaCircleCheck,
  FaMicrophone,
  FaPaperclip,
  FaCamera,
  FaRegFaceSmile,
  FaWhatsapp,
  FaFilePdf,
  FaVideo,
  FaImage,
  FaXmark,
  FaBroom,
  FaRegFileLines,
  FaPlay,
  FaRocket,
  FaCheckDouble,
  FaMessage,
  FaCheck,
} from "react-icons/fa6";

/* =====================================================================
   WappCampaign.jsx  –  "Start Your Campaign" (3 step wizard + phone preview)
   Step 1: Campaign   -> naam, channel, numbers (clean / dedupe / blacklist)
   Step 2: Message    -> message + image / video / pdf
   Step 3: Verify & Send -> summary, confirm, background send

   Sending LOGIC tumhara purana hi hai (QUEUE_THRESHOLD, pending queue,
   Node /send-bulk, Django save, campaignUpdated / creditUpdated events).
   ===================================================================== */

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const API_NODE = "https://ownwhatsapp-backend.onrender.com";
const API_DJANGO = "https://ownwhatsapp-backend-django.onrender.com";
const QUEUE_THRESHOLD = 20; // 🔥 numbers above this go to "pending" queue (non-admin)
const MAX_NUMBERS = 5000; // design wali limit: "Max 5,000 allowed"  (badalna ho to yahin)
const BLACKLIST_KEY = "wapp_blacklist"; // localStorage me 10-digit numbers ka array

const CHANNELS = [{ value: "default", label: "Default WhatsApp Channel (QR device)" }];

const STEPS = [
  { title: "Campaign", icon: FaBullhorn },
  { title: "Template", icon: FaTableList },
  { title: "Verify & Send", icon: FaPaperPlane },
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function getUser() {
  try { return JSON.parse(sessionStorage.getItem("user") || "{}"); } catch { return {}; }
}

function nowName() {
  return new Date()
    .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .replace(",", "");
}

function getBlacklist() {
  try {
    const arr = JSON.parse(localStorage.getItem(BLACKLIST_KEY) || "[]");
    return new Set((Array.isArray(arr) ? arr : []).map((n) => String(n).replace(/\D/g, "").slice(-10)));
  } catch {
    return new Set();
  }
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
 * - Numbers comma / new line / semicolon se alag ho sakte hain.
 * - Strips all non-digit characters (spaces, dashes, +, parens, etc.)
 * - Drops a leading "91" country code whenever the cleaned digit
 *   string is 12 digits long.
 * - Keeps only valid 10-digit Indian mobile numbers (starting 6-9).
 * - dedupe=true  -> duplicates hat jaate hain
 * - blacklist    -> Set of 10-digit numbers jo skip honge
 * Returns { valid, invalidCount, duplicateCount, blacklistedCount, totalEntered }.
 */
function parseAndValidateNumbers(raw, { dedupe = true, blacklist = null } = {}) {
  const lines = raw.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);

  const cleaned = lines.map((n) => {
    let digits = n.replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    return digits;
  });

  const isValid = (n) => /^[6-9]\d{9}$/.test(n);

  const seen = new Set();
  const valid = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  let blacklistedCount = 0;

  for (const n of cleaned) {
    if (!isValid(n)) { invalidCount++; continue; }
    if (blacklist && blacklist.has(n)) { blacklistedCount++; continue; }
    if (dedupe) {
      if (seen.has(n)) { duplicateCount++; continue; }
      seen.add(n);
    }
    valid.push(n);
  }

  return { valid, invalidCount, duplicateCount, blacklistedCount, totalEntered: lines.length };
}

// File objects -> preview URLs (auto revoke)
function useObjectUrls(files) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

// ─────────────────────────────────────────────
// BACKGROUND SENDER  [ORIGINAL LOGIC — unchanged]
// Runs AFTER the UI has already reset + shown the "message will be
// sent" popup. Takes a frozen snapshot of everything it needs so it
// doesn't care that form state has already been cleared. Talks to
// the report screen purely via window events.
// ─────────────────────────────────────────────
async function runCampaignInBackground({ numberList, images, video, pdf, message, user, isLarge }) {
  try {
    const filesData = buildFilesData(images, video, pdf);
    let campaignId = null;

    // ── STEP 1: For large batches, pre-save as "pending" ──
    if (isLarge) {
      const pendingData = await safeFetch(`${API_DJANGO}/api/send-whatsapp/`, {
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
        console.error("Campaign pre-save failed:", pendingData.message);
        return;
      }

      campaignId = pendingData.campaign_id || null;

      if (pendingData.remaining_credit !== undefined) {
        sessionStorage.setItem("user", JSON.stringify({ ...user, credit: pendingData.remaining_credit }));
        window.dispatchEvent(new Event("creditUpdated"));
      }

      // Pending row now exists — let the Report tab pick it up immediately.
      window.dispatchEvent(new Event("campaignUpdated"));

      // 🔥 Fall through to Node call below — Node sends the admin
      // WhatsApp alert + schedules 25-35 min auto-complete.
    }

    // ── STEP 2: Send to Node (handles the real WhatsApp sending) ──
    const formData = new FormData();
    numberList.forEach((n) => formData.append("numbers", n));
    formData.append("message", message || "");
    formData.append("userRole", user?.role || "user");
    if (user?.id) formData.append("userId", user.id);
    if (campaignId) formData.append("campaignId", campaignId);
    images.forEach((img) => formData.append("files", img));
    if (video) formData.append("files", video);
    if (pdf) formData.append("files", pdf);

    const data = await safeFetch(`${API_NODE}/send-bulk`, { method: "POST", body: formData });

    if (data.status === "blocked" || data.status === "no_device") {
      console.error("Campaign failed:", data.status, data.message);
      return;
    }
    if (data.status === "Pending" || data.status === "approval_pending") {
      window.dispatchEvent(new Event("campaignUpdated"));
      return;
    }
    if (!user?.id) {
      console.error("Session missing — could not save completed campaign.");
      return;
    }

    // ── STEP 3: Save completed campaign to Django ──
    const updatedResults = (data.results || []).map((r) => ({ ...r, files: filesData }));

    const saveData = await safeFetch(`${API_DJANGO}/api/send-whatsapp/`, {
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
      console.error("Campaign save failed:", saveData.message);
      return;
    }

    if (saveData.remaining_credit !== undefined) {
      sessionStorage.setItem("user", JSON.stringify({ ...user, credit: saveData.remaining_credit }));
    }

    window.dispatchEvent(new Event("campaignUpdated"));
    window.dispatchEvent(new Event("creditUpdated"));
  } catch (err) {
    console.error("BACKGROUND SEND ERROR:", err);
  }
}

// ─────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────
const MODAL_STYLES = {
  success: { emoji: "🚀", grad: "linear-gradient(135deg,#22c55e,#059669)", bg: "#f0fdf4", bd: "#bbf7d0", fg: "#15803d" },
  error: { emoji: "❌", grad: "linear-gradient(135deg,#ef4444,#e11d48)", bg: "#fef2f2", bd: "#fecaca", fg: "#b91c1c" },
  warning: { emoji: "⚠️", grad: "linear-gradient(135deg,#fb923c,#f97316)", bg: "#fff7ed", bd: "#fed7aa", fg: "#c2410c" },
  info: { emoji: "⏳", grad: "linear-gradient(135deg,#22c55e,#16a34a)", bg: "#f0fdf4", bd: "#bbf7d0", fg: "#15803d" },
};

const Modal = memo(({ modal, onClose }) => {
  if (!modal) return null;
  const s = MODAL_STYLES[modal.type] || MODAL_STYLES.info;
  return (
    <div className="wc-overlay" onClick={onClose}>
      <div className="wc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wc-modal-ico" style={{ background: s.grad }}>{s.emoji}</div>
        <h2 className="wc-modal-title">{modal.title}</h2>
        {modal.body && (
          <div className="wc-modal-body" style={{ background: s.bg, borderColor: s.bd, color: s.fg }}>{modal.body}</div>
        )}
        <button className="wc-modal-btn" style={{ background: s.grad }} onClick={onClose}>OK</button>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────
// UPLOAD BOX
// ─────────────────────────────────────────────
const UploadBox = memo(({ title, hint, type, icon: Icon, images, video, pdf, setImages, setVideo, setPdf }) => {
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

  const imageUrls = useObjectUrls(type === "image" ? images : []);
  const videoFiles = useMemo(() => (type === "video" && video ? [video] : []), [type, video]);
  const videoUrls = useObjectUrls(videoFiles);

  const removeImage = (idx, e) => { e.stopPropagation(); setImages((p) => p.filter((_, i) => i !== idx)); };

  return (
    <div className="wc-up">
      <div className="wc-up-head"><Icon /> {title}</div>
      <div {...getRootProps()} className={"wc-drop" + (isDragActive ? " drag" : "")}>
        <input {...getInputProps()} />
        {type === "image" && images.length > 0 ? (
          <div className="wc-thumbs">
            {images.map((img, i) => (
              <div key={i} className="wc-thumb">
                <img src={imageUrls[i]} alt="" />
                <button type="button" onClick={(e) => removeImage(i, e)} aria-label="Remove image"><FaXmark /></button>
              </div>
            ))}
          </div>
        ) : type === "video" && video ? (
          <div>
            <video src={videoUrls[0]} className="wc-video-sm" controls />
            <button type="button" className="wc-link-red" onClick={(e) => { e.stopPropagation(); setVideo(null); }}>Remove</button>
          </div>
        ) : type === "pdf" && pdf ? (
          <div>
            <p className="wc-pdfname"><FaFilePdf /> {pdf.name}</p>
            <button type="button" className="wc-link-red" onClick={(e) => { e.stopPropagation(); setPdf(null); }}>Remove</button>
          </div>
        ) : (
          <>Drag &amp; Drop {type} files<br />or <span className="wc-underline">Browse {type}</span></>
        )}
      </div>
      <div className="wc-up-hint">{hint}</div>
    </div>
  );
});

// ─────────────────────────────────────────────
// PHONE PREVIEW
// ─────────────────────────────────────────────
const PhonePreview = memo(({ message, images, video, pdf }) => {
  const imageUrls = useObjectUrls(images);
  const videoFiles = useMemo(() => (video ? [video] : []), [video]);
  const videoUrls = useObjectUrls(videoFiles);
  const time = useMemo(() => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), []);
  const hasContent = message.trim() || images.length || video || pdf;

  return (
    <div className="wc-phone">
      <div className="wc-phone-in">
        <div className="wc-notch" />
        <div className="wc-status"><span>{time}</span><span className="wc-status-r">▂▄▆ ▮</span></div>

        <div className="wc-wa-head">
          <FaArrowLeft />
          <div className="wc-wa-av"><FaWhatsapp /></div>
          <div className="wc-wa-name"><b>Message Preview</b><small>Business Account</small></div>
        </div>

        <div className="wc-chat">
          {!hasContent ? (
            <div className="wc-empty-card">
              <FaRegFileLines />
              <b>Empty Message</b>
              <span>Write your message to see the preview</span>
            </div>
          ) : (
            <div className="wc-bubble">
              {images.length > 0 && (
                <div className={"wc-b-imgs n" + Math.min(images.length, 4)}>
                  {images.map((_, i) => <img key={i} src={imageUrls[i]} alt="" />)}
                </div>
              )}
              {video && (
                <div className="wc-b-video">
                  <video src={videoUrls[0]} muted />
                  <span className="wc-b-play"><FaPlay /></span>
                </div>
              )}
              {pdf && <div className="wc-b-pdf"><FaFilePdf /> <span>{pdf.name}</span></div>}
              {message.trim() && <div className="wc-b-text">{message}</div>}
              <div className="wc-b-time">{time} <FaCheckDouble /></div>
            </div>
          )}
        </div>

        <div className="wc-input">
          <FaRegFaceSmile />
          <span>Enter your message</span>
          <FaPaperclip /><FaCamera />
          <i className="wc-mic"><FaMicrophone /></i>
        </div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────
// SMALL UI PIECES
// ─────────────────────────────────────────────
const Switch = ({ id, checked, onChange, label, disabled, title }) => (
  <label className={"wc-switch" + (disabled ? " off" : "")} htmlFor={id} title={title}>
    <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
    <span className="wc-sw-track"><span className="wc-sw-knob" /></span>
    <span className="wc-sw-label">{label}</span>
  </label>
);

const SummaryItem = ({ label, children, wide }) => (
  <div className={"wc-sum-item" + (wide ? " wide" : "")}>
    <span className="wc-sum-label">{label}</span>
    <div className="wc-sum-val">{children}</div>
  </div>
);

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function WappCampaign() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [campaignName, setCampaignName] = useState(nowName);
  const [channel, setChannel] = useState("default");
  const [numbers, setNumbers] = useState("");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState([]);
  const [video, setVideo] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [removeDuplicates, setRemoveDuplicates] = useState(true);
  const [removeBlackList, setRemoveBlackList] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const [modal, setModal] = useState(null);
  const [justCleaned, setJustCleaned] = useState(false);

  const fileInputRef = useRef(null);

  const showModal = useCallback((type, title, body = "") => setModal({ type, title, body }), []);

  const blacklist = useMemo(() => (removeBlackList ? getBlacklist() : null), [removeBlackList]);

  const { valid: numberList, invalidCount, duplicateCount, blacklistedCount } = useMemo(
    () => parseAndValidateNumbers(numbers, { dedupe: removeDuplicates, blacklist }),
    [numbers, removeDuplicates, blacklist]
  );

  const user = getUser();
  const isAdmin = (user?.role || "user").toLowerCase() === "admin";
  const isLarge = !isAdmin && numberList.length > QUEUE_THRESHOLD;
  const needsCleanup = invalidCount > 0 || duplicateCount > 0 || blacklistedCount > 0;
  const tooMany = numberList.length > MAX_NUMBERS;

  const isValidStep1 = campaignName.trim() && channel && numberList.length > 0 && !tooMany;
  const isValidStep2 = message.trim().length > 0;

  // ── AUTO-CLEAN NUMBERS ──
  // "91" prefix hatata hai, invalid / duplicate / blacklist numbers nikal kar
  // textarea ko sirf valid 10-digit numbers se rewrite karta hai.
  // Paste ke baad aur blur par chalta hai (typing ke beech nahi).
  const cleanNumbersField = useCallback(() => {
    setNumbers((prev) => {
      const { valid } = parseAndValidateNumbers(prev, { dedupe: removeDuplicates, blacklist });
      const cleanedText = valid.join(", ");
      if (cleanedText !== prev.trim()) {
        setJustCleaned(true);
        setTimeout(() => setJustCleaned(false), 1500);
      }
      return cleanedText;
    });
  }, [removeDuplicates, blacklist]);

  const handleNumbersPaste = useCallback(() => {
    setTimeout(cleanNumbersField, 0);
  }, [cleanNumbersField]);

  // ── CSV / TXT upload ──
  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (/\.(xlsx|xls)$/i.test(file.name)) {
      showModal("warning", "Excel File ⚠️", "Excel file direct support nahi hai.\nFile ko CSV me save karke upload karo (File → Save As → CSV).");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const found = text.split(/[\n,;\t]+/).map((t) => t.trim()).filter((t) => /\d{10}/.test(t.replace(/\D/g, "")));
      if (!found.length) {
        showModal("error", "No Numbers Found ❌", "File me koi mobile number nahi mila.");
        return;
      }
      setNumbers((prev) => (prev.trim() ? `${prev.trim()}, ` : "") + found.join(", "));
      setTimeout(cleanNumbersField, 0);
    };
    reader.readAsText(file);
  }, [showModal, cleanNumbersField]);

  // ── RESET ──
  const resetForm = useCallback(() => {
    setNumbers(""); setMessage(""); setCampaignName(nowName());
    setImages([]); setVideo(null); setPdf(null);
    setStep(1);
  }, []);

  // ── CONFIRM → "Yes, Send" ──
  // Fires instantly: shows the "message will be sent" popup, clears the
  // form right away, then kicks off the real send in the background.
  const confirmSend = useCallback(() => {
    if (!numberList.length) {
      setShowConfirm(false);
      showModal("error", "No Numbers!", "Please enter at least one number.");
      return;
    }

    // Freeze everything the background sender needs BEFORE we reset the form.
    const snapshot = { numberList, images, video, pdf, message, user, isLarge };

    setShowConfirm(false);

    showModal("info", "Message Will Be Sent 🚀", `Total Numbers: ${numberList.length}\nCampaign Will Be Submitted.`);

    resetForm();

    // Fire and forget — does not block the UI.
    runCampaignInBackground(snapshot);
  }, [numberList, images, video, pdf, message, user, isLarge, showModal, resetForm]);

  // ── STEP NAVIGATION ──
  const goNext = () => {
    if (step === 1) {
      if (!campaignName.trim() || !numbers.trim()) {
        showModal("warning", "Fill All Fields ⚠️", "Please enter Campaign Name and Numbers.");
        return;
      }
      cleanNumbersField();
      if (!numberList.length) {
        showModal("error", "No Valid Numbers ❌", "None of the entered numbers are valid 10-digit Indian mobile numbers.");
        return;
      }
      if (tooMany) {
        showModal("error", "Too Many Numbers ❌", `Ek campaign me max ${MAX_NUMBERS.toLocaleString("en-IN")} numbers allowed hain.`);
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!message.trim()) {
        showModal("warning", "Message Required ⚠️", "Please enter the message before continuing.");
        return;
      }
      setStep(3);
    }
  };

  const goPrev = () => setStep((s) => Math.max(1, s - 1));
  const goBack = () => (step > 1 ? goPrev() : navigate(-1));

  const mediaCount = images.length + (video ? 1 : 0) + (pdf ? 1 : 0);
  const credit = user?.credit;

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div className="wc">
      <style>{CSS}</style>

      {/* NOTE strip */}
      <div className="wc-note">
        <div className="wc-note-in">
          <b>NOTE =</b> All campaigns will be delivered Between 10A.M to 6P.M - (Monday to Saturday)
        </div>
      </div>

      {/* TITLE */}
      <div className="wc-top">
        <button type="button" className="wc-back" onClick={goBack} title="Go Back"><FaArrowLeft /></button>
        <div>
          <h4 className="wc-title">Start Your Campaign</h4>
          <p className="wc-sub">Configure your audience, customize templates, and broadcast messages seamlessly.</p>
        </div>
      </div>

      <div className="wc-layout">
        <div className="wc-main">

          {/* STEPPER */}
          <div className="wc-card wc-stepper">
            {STEPS.map((s, i) => {
              const n = i + 1;
              const cls = step === n ? "active" : step > n ? "done" : "";
              return (
                <div key={s.title} className={`wc-step ${cls}${n > 1 && step >= n - 1 ? " line-on" : ""}`}>
                  <div className="wc-circle-slot">
                    <div className="wc-circle">{step > n ? <FaCheck /> : <s.icon />}</div>
                  </div>
                  <span className="wc-stepnum">STEP {n}</span>
                  <strong className="wc-steptitle">{s.title}</strong>
                </div>
              );
            })}
          </div>

          {/* ═════════ STEP 1 ═════════ */}
          {step === 1 && (
            <div className="wc-card wc-form">
              <h5 className="wc-h">Campaign Details</h5>
              <hr className="wc-hr" />

              <div className="wc-grid2">
                <div>
                  <label className="wc-label"><FaFileSignature /> Campaign Name <span className="req">*</span></label>
                  <p className="wc-hint">Pick something that describes your audience &amp; goals.</p>
                  <input
                    className="wc-input-ctl"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g. Spring Promo 2025"
                  />
                </div>

                <div>
                  <label className="wc-label"><FaSignsPost /> WABA Channel <span className="req">*</span></label>
                  <p className="wc-hint">Pick the Channel in which you want to send the messages</p>
                  <select className="wc-input-ctl" value={channel} onChange={(e) => setChannel(e.target.value)}>
                    <option value="">Select Channel</option>
                    {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="wc-numbers">
                <div className="wc-numbers-head">
                  <label className="wc-label" style={{ margin: 0 }}><FaMobileScreenButton /> Numbers <span className="req">*</span></label>
                  <span className="wc-count"><FaAnglesRight /> Total Count ( {numberList.length} )</span>
                </div>
                <textarea
                  className="wc-input-ctl wc-ta"
                  rows={6}
                  value={numbers}
                  onChange={(e) => setNumbers(e.target.value)}
                  onPaste={handleNumbersPaste}
                  onBlur={cleanNumbersField}
                  placeholder="Enter up to 5,000 comma-separated mobile numbers"
                />
                <p className="wc-hint dark">Enter multiple numbers separated by commas. Max {MAX_NUMBERS.toLocaleString("en-IN")} allowed.</p>

                {(numberList.length > 0 || invalidCount > 0 || duplicateCount > 0 || blacklistedCount > 0) && (
                  <div className="wc-chips">
                    <span className="wc-chip blue">Total Valid Mobile:<b>{numberList.length}</b></span>
                    {removeDuplicates && <span className="wc-chip amber">Duplicate:<b>{duplicateCount}</b></span>}
                    <span className="wc-chip red">Invalid:<b>{invalidCount}</b></span>
                    {removeBlackList && <span className="wc-chip gray">Blacklisted:<b>{blacklistedCount}</b></span>}
                    {justCleaned && <span className="wc-chip indigo"><FaCheck /> List cleaned</span>}
                    {needsCleanup && (
                      <button type="button" className="wc-chip ghost" onClick={cleanNumbersField}><FaBroom /> Clean now</button>
                    )}
                    {tooMany && <span className="wc-chip red">Max {MAX_NUMBERS.toLocaleString("en-IN")} numbers allowed</span>}
                  </div>
                )}
              </div>

              <div className="wc-src">
                <button
                  type="button"
                  className="wc-outline"
                  onClick={() => showModal("info", "Group Contacts", "Group Contacts ka page abhi banana baaki hai.\n(Config → Manage Group se aayega)")}
                >
                  <FaUsersLine /> Group Contacts
                </button>
                <button type="button" className="wc-outline" onClick={() => fileInputRef.current?.click()}>
                  <FaUpload /> Upload File (CSV / Excel)
                </button>
                <input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx,.xls" hidden onChange={handleFile} />
              </div>

              <div className="wc-toggles">
                <Switch id="rd" checked={removeDuplicates} onChange={setRemoveDuplicates} label="Remove Duplicates" />
                <Switch id="rb" checked={removeBlackList} onChange={setRemoveBlackList} label="Remove BlackList" />
                <Switch
                  id="sn"
                  checked={false}
                  onChange={() => {}}
                  disabled
                  title="Scheduling abhi supported nahi hai"
                  label="Schedule Now"
                />
              </div>

              <div className="wc-actions end">
                <button type="button" className="wc-btn" disabled={!isValidStep1} onClick={goNext}>
                  <FaHandPointRight /> Next
                </button>
              </div>
            </div>
          )}

          {/* ═════════ STEP 2 ═════════ */}
          {step === 2 && (
            <div className="wc-card wc-form">
              <h5 className="wc-h">Message Information</h5>
              <hr className="wc-hr" />

              <label className="wc-label"><FaMessage /> Message <span className="req">*</span></label>
              <p className="wc-hint">Ye message har number par bheja jayega.</p>
              <textarea
                className="wc-input-ctl wc-ta"
                rows={8}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here..."
              />
              <p className="wc-hint dark">{message.length} characters</p>

              <div className="wc-media">
                <UploadBox
                  title="Image" hint="Max 1 MB · Max 4 images" type="image" icon={FaImage}
                  images={images} video={video} pdf={pdf}
                  setImages={setImages} setVideo={setVideo} setPdf={setPdf}
                />
                <UploadBox
                  title="Video" hint="Max 3 MB" type="video" icon={FaVideo}
                  images={images} video={video} pdf={pdf}
                  setImages={setImages} setVideo={setVideo} setPdf={setPdf}
                />
                <UploadBox
                  title="PDF" hint="Max 1 MB" type="pdf" icon={FaFilePdf}
                  images={images} video={video} pdf={pdf}
                  setImages={setImages} setVideo={setVideo} setPdf={setPdf}
                />
              </div>

              <div className="wc-actions">
                <button type="button" className="wc-btn sec" onClick={goPrev}><FaHandPointLeft /> Previous</button>
                <button type="button" className="wc-btn" disabled={!isValidStep2} onClick={goNext}><FaHandPointRight /> Next</button>
              </div>
            </div>
          )}

          {/* ═════════ STEP 3 ═════════ */}
          {step === 3 && (
            <div className="wc-card wc-form">
              <div className="wc-sum-head">
                <div>
                  <h5 className="wc-h" style={{ marginBottom: 4 }}><FaClipboardCheck className="wc-h-ico" /> Campaign Summary</h5>
                  <p className="wc-sub" style={{ margin: 0 }}>Review all campaign parameters and audience breakdown before launching.</p>
                </div>
                <span className="wc-ready"><FaCircleCheck /> Ready to Review</span>
              </div>
              <hr className="wc-hr" />

              <div className="wc-sum-grid">
                <SummaryItem label="Campaign Name">{campaignName}</SummaryItem>
                <SummaryItem label="Channel">{CHANNELS.find((c) => c.value === channel)?.label || "-"}</SummaryItem>
                <SummaryItem label="Media">
                  {mediaCount === 0 ? "No media" : [
                    images.length ? `${images.length} image${images.length > 1 ? "s" : ""}` : null,
                    video ? "1 video" : null,
                    pdf ? "1 PDF" : null,
                  ].filter(Boolean).join(", ")}
                </SummaryItem>
                <SummaryItem label="Scheduled Time">Send Immediately</SummaryItem>
                <SummaryItem label="Duplicate Filter">{removeDuplicates ? "Enabled" : "Disabled"}</SummaryItem>
                <SummaryItem label="Blacklist Filter">{removeBlackList ? "Enabled" : "Disabled"}</SummaryItem>
                <SummaryItem label="Message" wide><span className="wc-sum-msg">{message}</span></SummaryItem>
                <SummaryItem label="Total Audience / Numbers"><b className="wc-big">{numberList.length}</b></SummaryItem>
                <SummaryItem label="Available Credit"><b className="wc-big">{credit ?? "∞"}</b></SummaryItem>
              </div>

              {isLarge && (
                <div className="wc-info">
                  <FaCircleCheck /> {numberList.length} numbers ({QUEUE_THRESHOLD}+) — ye campaign <b>Pending</b> me submit hoga aur approval ke baad deliver hoga.
                </div>
              )}

              <div className="wc-actions">
                <button type="button" className="wc-btn sec" onClick={goPrev}><FaHandPointLeft /> Previous</button>
                <button type="button" className="wc-btn" onClick={() => setShowConfirm(true)}><FaRocket /> Launch Campaign</button>
              </div>
            </div>
          )}
        </div>

        {/* PHONE PREVIEW */}
        <div className="wc-side">
          <PhonePreview message={message} images={images} video={video} pdf={pdf} />
        </div>
      </div>

      {/* CONFIRM MODAL */}
      {showConfirm && (
        <div className="wc-overlay">
          <div className="wc-modal">
            <div className="wc-modal-ico" style={{ background: "linear-gradient(135deg,#22c55e,#059669)" }}>✓</div>
            <h2 className="wc-modal-title">Are You Sure?</h2>
            <p className="wc-confirm-text">Campaign will be sent to {numberList.length} numbers</p>
            <div className="wc-confirm-btns">
              <button type="button" className="wc-yes" onClick={confirmSend}>Yes, Send</button>
              <button type="button" className="wc-no" onClick={() => setShowConfirm(false)}>No</button>
            </div>
          </div>
        </div>
      )}

      <Modal modal={modal} onClose={() => setModal(null)} />
    </div>
  );
}

// ─────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────
const CSS = `
.wc{--p:#448c74;--p-rgb:68,140,116;--head:#0f172a;--muted:#64748b;--border:#e2e8f0;font-family:'Inter',system-ui,sans-serif;color:#334155}
.wc *{box-sizing:border-box}
.wc-note{height:26px;overflow:hidden;position:relative;font-size:12px;color:#dc2626;margin-bottom:6px}
.wc-note-in{position:absolute;white-space:nowrap;top:4px;animation:wcMarq 30s linear infinite}
@keyframes wcMarq{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

.wc-top{display:flex;align-items:center;gap:14px;margin:6px 0 14px}
.wc-back{width:38px;height:38px;border-radius:50%;border:1px solid var(--border);background:#fff;color:#334155;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
.wc-back:hover{background:var(--p);border-color:var(--p);color:#fff}
.wc-title{margin:0;font-size:1.25rem;font-weight:700;color:var(--head)}
.wc-sub{margin:2px 0 0;font-size:.74rem;color:var(--muted)}

.wc-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:30px;align-items:start}
.wc-main{display:flex;flex-direction:column;gap:20px;min-width:0}
.wc-side{position:sticky;top:70px;display:flex;justify-content:center}
.wc-card{background:#fff;border:1px solid var(--border);border-radius:16px;box-shadow:0 1px 4px rgba(15,23,42,.04)}

/* stepper */
.wc-stepper{display:flex;padding:16px 10px 14px}
.wc-step{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;text-align:center}
.wc-circle-slot{height:56px;display:flex;align-items:center;justify-content:center;position:relative;z-index:2}
.wc-circle{width:42px;height:42px;border-radius:50%;background:#eef2f6;color:#94a3b8;display:flex;align-items:center;justify-content:center;font-size:15px;transition:all .3s}
.wc-step.active .wc-circle{width:54px;height:54px;background:var(--p);color:#fff;font-size:19px;box-shadow:0 0 0 7px rgba(var(--p-rgb),.16)}
.wc-step.done .wc-circle{background:var(--p);color:#fff}
.wc-step:not(:first-child)::before{content:"";position:absolute;top:27px;right:50%;width:100%;height:2px;background:#e8edf2;z-index:1}
.wc-step.line-on::before{background:var(--p)}
.wc-stepnum{font-size:10px;font-weight:700;letter-spacing:.06em;color:#64748b;margin-top:6px}
.wc-steptitle{font-size:13px;color:#64748b;font-weight:600}
.wc-step.active .wc-steptitle,.wc-step.done .wc-steptitle{color:var(--head);font-weight:700}

/* form */
.wc-form{padding:26px 34px 30px}
.wc-h{margin:6px 0 0;font-size:1.1rem;font-weight:700;color:var(--head);display:flex;align-items:center;gap:8px}
.wc-h-ico{color:var(--p)}
.wc-hr{border:0;border-top:1px solid var(--border);margin:18px -14px 22px}
.wc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:22px}
.wc-label{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--head);margin-bottom:2px}
.wc-label svg{font-size:13px}
.req{color:#ef4444}
.wc-hint{margin:0 0 6px;font-size:11px;color:#5e9c86}
.wc-hint.dark{color:#334155;margin-top:6px}
.wc-input-ctl{width:100%;border:1px solid #d5dbe3;border-radius:8px;background:#fff;padding:10px 12px;font-size:13px;font-family:inherit;color:var(--head);outline:0;transition:border-color .15s,box-shadow .15s}
.wc-input-ctl:focus{border-color:var(--p);box-shadow:0 0 0 3px rgba(var(--p-rgb),.15)}
.wc-input-ctl::placeholder{color:#a8b0bd}
select.wc-input-ctl{appearance:none;background-image:url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%23343a40' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m2 5 6 6 6-6'/%3e%3c/svg%3e");background-repeat:no-repeat;background-position:right 12px center;background-size:14px;padding-right:34px}
.wc-ta{resize:vertical;min-height:120px;line-height:1.5}
.wc-numbers{margin-bottom:6px}
.wc-numbers-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.wc-count{font-size:12px;font-weight:700;color:var(--head);display:flex;align-items:center;gap:5px}

.wc-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}
.wc-chip{display:inline-flex;align-items:center;gap:6px;color:#fff;font-size:12px;font-weight:500;padding:6px 12px;border-radius:6px;white-space:nowrap;border:0;font-family:inherit}
.wc-chip b{margin-left:2px}
.wc-chip.blue{background:#20a8d8}.wc-chip.amber{background:#f0ad4e}.wc-chip.red{background:#f86c6b}.wc-chip.gray{background:#64748b}.wc-chip.indigo{background:#6366f1}
.wc-chip.ghost{background:#fff;color:#475569;border:1px solid #cbd5e1;cursor:pointer}
.wc-chip.ghost:hover{background:#f1f5f9}

.wc-src{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 20px}
.wc-outline{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--p);color:var(--p);background:#fff;border-radius:6px;padding:8px 14px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s}
.wc-outline:hover{background:var(--p);color:#fff}

.wc-toggles{display:flex;gap:26px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.wc-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.wc-switch input{position:absolute;opacity:0;pointer-events:none}
.wc-sw-track{width:32px;height:17px;border-radius:9px;background:#cbd5e1;position:relative;transition:background .2s}
.wc-sw-knob{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .2s}
.wc-switch input:checked + .wc-sw-track{background:var(--p)}
.wc-switch input:checked + .wc-sw-track .wc-sw-knob{left:17px}
.wc-switch input:focus-visible + .wc-sw-track{box-shadow:0 0 0 3px rgba(var(--p-rgb),.25)}
.wc-sw-label{font-size:12.5px;font-weight:600;color:var(--head)}
.wc-switch.off{opacity:.55;cursor:not-allowed}

.wc-actions{display:flex;gap:10px;margin-top:22px;justify-content:space-between}
.wc-actions.end{justify-content:flex-end}
.wc-btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:6px;background:var(--p);color:#fff;font-size:12.5px;font-weight:600;padding:11px 20px;cursor:pointer;font-family:inherit;transition:all .2s}
.wc-btn:hover:not(:disabled){filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 6px 14px rgba(var(--p-rgb),.3)}
.wc-btn:disabled{opacity:.5;cursor:not-allowed}
.wc-btn.sec{background:#64748b}

/* step 2 uploads */
.wc-media{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:20px}
.wc-up{border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff}
.wc-up-head{display:flex;align-items:center;gap:7px;padding:8px 12px;font-size:12px;font-weight:700;color:var(--head);background:#f8fafc;border-bottom:1px solid var(--border)}
.wc-up-head svg{color:var(--p)}
.wc-drop{min-height:112px;padding:12px;text-align:center;font-size:12px;color:#64748b;cursor:pointer;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px dashed transparent;transition:all .2s}
.wc-drop:hover,.wc-drop.drag{background:rgba(var(--p-rgb),.05);border-color:rgba(var(--p-rgb),.4)}
.wc-underline{text-decoration:underline;color:var(--p);font-weight:600}
.wc-up-hint{padding:5px 12px;font-size:10.5px;color:#94a3b8;background:#f8fafc;border-top:1px solid var(--border)}
.wc-thumbs{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.wc-thumb{position:relative}
.wc-thumb img{width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--border);display:block}
.wc-thumb button{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:0;background:#ef4444;color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.wc-video-sm{width:130px;border-radius:8px;display:block;margin:0 auto}
.wc-pdfname{display:flex;align-items:center;gap:6px;justify-content:center;margin:0 0 4px;font-size:12px;word-break:break-all}
.wc-pdfname svg{color:#ef4444;flex:0 0 auto}
.wc-link-red{border:0;background:none;color:#ef4444;font-size:11px;text-decoration:underline;cursor:pointer;margin-top:4px}

/* step 3 */
.wc-sum-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
.wc-ready{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(var(--p-rgb),.35);color:var(--p);background:rgba(var(--p-rgb),.06);font-size:12px;font-weight:600;padding:6px 14px;border-radius:999px}
.wc-sum-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.wc-sum-item{border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:#fafbfc}
.wc-sum-item.wide{grid-column:span 3}
.wc-sum-label{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#94a3b8}
.wc-sum-val{margin-top:4px;font-size:13px;font-weight:600;color:var(--head);word-break:break-word}
.wc-sum-msg{font-weight:500;white-space:pre-wrap;display:block;max-height:140px;overflow:auto}
.wc-big{font-size:1.4rem}
.wc-info{display:flex;gap:8px;align-items:flex-start;margin-top:16px;background:#fff7ed;border:1px solid #fed7aa;color:#c2410c;border-radius:10px;padding:10px 14px;font-size:12.5px}
.wc-info svg{margin-top:2px;flex:0 0 auto}

/* phone */
.wc-phone{width:290px;border-radius:40px;padding:7px;background:linear-gradient(145deg,#cfd6dd,#8f99a3);box-shadow:0 18px 40px rgba(15,23,42,.22)}
.wc-phone-in{position:relative;height:560px;border-radius:34px;background:#0b2e36;border:5px solid #1f2a33;overflow:hidden;display:flex;flex-direction:column}
.wc-notch{position:absolute;top:0;left:50%;transform:translateX(-50%);width:100px;height:20px;background:#0b0f12;border-radius:0 0 14px 14px;z-index:5}
.wc-status{display:flex;justify-content:space-between;padding:6px 14px 2px;font-size:10px;color:#fff;font-weight:600;height:24px}
.wc-status-r{letter-spacing:1px;font-size:8px}
.wc-wa-head{display:flex;align-items:center;gap:8px;padding:6px 12px 10px;background:#0b4f55;color:#fff;font-size:12px}
.wc-wa-av{width:34px;height:34px;border-radius:50%;background:#fff;color:#25d366;display:flex;align-items:center;justify-content:center;font-size:22px}
.wc-wa-name{display:flex;flex-direction:column;line-height:1.15}
.wc-wa-name b{font-size:11.5px}.wc-wa-name small{font-size:9px;opacity:.85}
.wc-chat{flex:1;overflow-y:auto;padding:10px;background-color:#e8e1d8;background-image:radial-gradient(rgba(0,0,0,.06) 1px,transparent 1px),radial-gradient(rgba(0,0,0,.04) 1px,transparent 1px);background-size:18px 18px,34px 34px;background-position:0 0,9px 9px}
.wc-empty-card{margin:6px 0;background:#fff;border-radius:10px;padding:26px 14px;text-align:center;color:#8a94a0;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px}
.wc-empty-card svg{font-size:54px;color:#d3d9df;margin-bottom:6px}
.wc-empty-card b{color:#7b8591;font-size:15px}
.wc-bubble{background:#fff;border-radius:0 10px 10px 10px;padding:6px;max-width:92%;box-shadow:0 1px 1px rgba(0,0,0,.12);font-size:12px;color:#111}
.wc-b-imgs{display:grid;gap:3px;margin-bottom:5px;border-radius:7px;overflow:hidden}
.wc-b-imgs.n1{grid-template-columns:1fr}.wc-b-imgs.n2,.wc-b-imgs.n3,.wc-b-imgs.n4{grid-template-columns:1fr 1fr}
.wc-b-imgs img{width:100%;height:92px;object-fit:cover;display:block}
.wc-b-imgs.n1 img{height:140px}
.wc-b-video{position:relative;margin-bottom:5px;border-radius:7px;overflow:hidden;background:#000}
.wc-b-video video{width:100%;height:120px;object-fit:cover;display:block;opacity:.8}
.wc-b-play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px}
.wc-b-pdf{display:flex;align-items:center;gap:6px;background:#f1f3f5;border-radius:7px;padding:8px;margin-bottom:5px;font-size:11px;word-break:break-all}
.wc-b-pdf svg{color:#ef4444;flex:0 0 auto}
.wc-b-text{white-space:pre-wrap;word-break:break-word;line-height:1.4;padding:2px 3px}
.wc-b-time{text-align:right;font-size:9px;color:#8a94a0;margin-top:2px;display:flex;justify-content:flex-end;gap:4px;align-items:center}
.wc-b-time svg{color:#34b7f1}
.wc-input{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;color:#7b8591;font-size:11px}
.wc-input span{flex:1}
.wc-mic{width:30px;height:30px;border-radius:50%;background:#128c7e;color:#fff;display:flex;align-items:center;justify-content:center;font-style:normal}

/* modals */
.wc-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);animation:wcFade .2s ease}
.wc-modal{background:#fff;border-radius:20px;box-shadow:0 25px 60px rgba(0,0,0,.18);width:92%;max-width:400px;padding:30px 26px 26px;text-align:center;animation:wcUp .3s cubic-bezier(.16,1,.3,1)}
.wc-modal-ico{width:62px;height:62px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:26px;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.15)}
.wc-modal-title{font-size:18px;font-weight:700;color:#1f2937;margin:0 0 12px;line-height:1.4}
.wc-modal-body{border-radius:10px;border:1px solid;padding:12px 14px;font-size:14px;line-height:1.6;margin-bottom:20px;text-align:left;white-space:pre-line}
.wc-modal-btn{color:#fff;border:0;cursor:pointer;padding:10px 36px;border-radius:10px;font-size:15px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.15);transition:transform .2s}
.wc-modal-btn:hover{transform:scale(1.04)}
.wc-confirm-text{font-size:18px;font-weight:600;color:#1f2937;margin:0 0 20px}
.wc-confirm-btns{display:flex;gap:12px;justify-content:center}
.wc-yes{padding:9px 22px;border-radius:10px;border:0;background:linear-gradient(90deg,#22c55e,#059669);color:#fff;font-weight:600;cursor:pointer;transition:transform .2s}
.wc-yes:hover{transform:scale(1.05)}
.wc-no{padding:9px 22px;border-radius:10px;border:0;background:#e5e7eb;color:#374151;font-weight:600;cursor:pointer}
@keyframes wcFade{from{opacity:0}to{opacity:1}}
@keyframes wcUp{from{transform:translateY(24px) scale(.97);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}

@media(max-width:1180px){.wc-layout{grid-template-columns:1fr}.wc-side{position:static;order:2}}
@media(max-width:800px){.wc-grid2,.wc-sum-grid,.wc-media{grid-template-columns:1fr}.wc-sum-item.wide{grid-column:auto}.wc-form{padding:20px 16px}}
@media(prefers-reduced-motion:reduce){.wc-note-in{animation:none;position:static}}
`;