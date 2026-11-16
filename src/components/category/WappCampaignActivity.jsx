import React, { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { panelAuthHeaders } from "../../utils/panelAuth";
import { useNavigate } from "react-router-dom";
import { FaCalendarDays, FaArrowLeft, FaRotate, FaDownload, FaPlus, FaMinus, FaFilePdf } from "react-icons/fa6";

/* =====================================================================
   WappCampaignActivity.jsx  –  "Campaign Activity" report
   Route: /wappreports/campaignactivity
   Logic tumhare purane WappReports.jsx wala hi hai (API, filter, polling, CSV, pending/admin rules).
   Sirf UI Omni App style me hai.
   ===================================================================== */

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const API_DJANGO = "https://ownwhatsapp-backend-django.onrender.com";
const UPLOADS = "https://ownwhatsapp-backend.onrender.com/uploads/";
const POLL_MS = 5000;
const FILTERS = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "This Month", "Last Month", "Custom Range"];

// ─────────────────────────────────────────────
// PURE HELPERS (outside component  never recreated)  [ORIGINAL LOGIC]
// ─────────────────────────────────────────────
function getUserId() {
  try {
    const u = JSON.parse(sessionStorage.getItem("user") || "{}");
    return u?.id || sessionStorage.getItem("user_id");
  } catch {
    return sessionStorage.getItem("user_id");
  }
}

function getUserRole() {
  try {
    const u = JSON.parse(sessionStorage.getItem("user") || "{}");
    return (u?.role || "user").toLowerCase();
  } catch {
    return "user";
  }
}

function passesFilter(isoDate, filter, fromDate, toDate) {
  const d = new Date(isoDate);
  const now = new Date();

  switch (filter) {
    case "Today":
      return d.toDateString() === now.toDateString();
    case "Yesterday": {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return d.toDateString() === y.toDateString();
    }
    case "Last 7 Days": {
      const p = new Date(now); p.setDate(p.getDate() - 7);
      return d >= p;
    }
    case "Last 30 Days": {
      const p = new Date(now); p.setDate(p.getDate() - 30);
      return d >= p;
    }
    case "This Month":
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    case "Last Month": {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }
    case "Custom Range": {
      // (naya) pehle ye filter kuch nahi karta tha, ab dates ke hisaab se chalta hai
      if (!fromDate || !toDate) return true;
      const from = new Date(fromDate);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      return d >= from && d <= to;
    }
    default:
      return true;
  }
}

function dedupeMedia(media) {
  const seen = new Set();
  return (media || []).filter((m) => {
    const key = m?.name || JSON.stringify(m);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatEntry(r, index, total) {
  return {
    id: r.id,
    name: `Campaign ${total - index}`,
    number: r.total,
    message: r.message,
    date: new Date(r.created_at).toLocaleString(),
    total: r.total,
    failed: r.failed,
    valid: r.success,
    nonwa: r.nonwa || 0,
    rejected: r.rejected || 0,
    media: dedupeMedia(r.media),
    results: r.results || [],
    status: r.status || "completed",
  };
}

function buildCSV(data) {
  const headers = ["Sr No", "Number", "Status", "Message", "Campaign", "Date"];
  const rows = (data.results || []).map((r, i) => [
    i + 1,
    `"${r.number || r.phone || r.mobile || r.to || ""}"`,
    `"${(r.status || "unknown").toUpperCase()}"`,
    `"${(data.message || "").replace(/"/g, '""')}"`,
    `"${data.name || `Campaign-${data.id || ""}`}"`,
    `"${data.date || ""}"`,
  ].join(","));

  return [headers.join(","), ...rows].join("\n");
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────
const StatusBadge = memo(({ status }) =>
  status === "pending" ? (
    <span className="wr-badge pending"><i className="wr-dot" />PENDING</span>
  ) : (
    <span className="wr-badge done">COMPLETED</span>
  )
);

const Details = memo(({ entry }) => {
  const images = (entry.media || []).filter((f) => f?.type?.includes("image"));
  const videos = (entry.media || []).filter((f) => f?.type?.includes("video"));
  const pdfs = (entry.media || []).filter((f) => f?.type?.includes("pdf"));

  return (
    <>
      {images.length > 0 && (
        <div className="wr-media">
          {images.map((img, i) => (
            <img key={i} src={`${UPLOADS}${img.name}`} className="wr-img" alt="" />
          ))}
        </div>
      )}

      {videos.map((vid, i) => (
        <video key={i} controls className="wr-video">
          <source src={`${UPLOADS}${vid.name}`} />
        </video>
      ))}

      {pdfs.map((pdf, i) => (
        <a key={i} href={`${UPLOADS}${pdf.name}`} target="_blank" rel="noreferrer" className="wr-pdf">
          <FaFilePdf /> {pdf.name}
        </a>
      ))}

      <div className="wr-chips">
        <span className="wr-chip">TOTAL <b>{entry.total}</b></span>
        <span className="wr-chip bad">FAILED <b>{entry.failed}</b></span>
        <span className="wr-chip ok">VALID <b>{entry.valid}</b></span>
        <span className="wr-chip">NONWA <b>{entry.nonwa}</b></span>
      </div>
    </>
  );
});

const ExpandedRow = memo(({ entry, isAdmin }) => {
  if (entry.status === "pending") {
    if (isAdmin) {
      return (
        <>
          <div className="wr-warn">
            <p>⏳ Still pending — figures below may update once processing completes.</p>
          </div>
          <Details entry={entry} />
        </>
      );
    }
    return (
      <div className="wr-warn big">
        <div className="wr-warn-ico">⏳</div>
        <p className="t">Status Pending</p>
        <p className="s">{entry.total}</p>
      </div>
    );
  }
  return <Details entry={entry} />;
});

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
const WappCampaignActivity = () => {
  const navigate = useNavigate();

  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState("Today");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [entries, setEntries] = useState([]);
  const [openRow, setOpenRow] = useState(null);
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const isAdmin = getUserRole() === "admin";

  const pollRef = useRef(null);
  const filterRef = useRef(null);

  // ── Close dropdown on outside click ──
  useEffect(() => {
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Fetch + format ──
  const loadReports = useCallback(async () => {
    try {
      const userId = getUserId();
      const res = await fetch(`${API_DJANGO}/api/get-campaigns/?user_id=${userId}`, { headers: panelAuthHeaders() });
      const data = await res.json();

      const list = Array.isArray(data) ? data : [];
      const filtered = list.filter((r) => passesFilter(r.created_at, selectedFilter, fromDate, toDate));
      const formatted = filtered.map((r, i) => formatEntry(r, i, filtered.length));

      setEntries(formatted);
      setPage(1);
    } catch (err) {
      console.error("REPORTS ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedFilter, fromDate, toDate]);

  // ── Initial load + filter change ──
  useEffect(() => {
    loadReports();
    const handler = () => loadReports();
    window.addEventListener("campaignUpdated", handler);
    return () => window.removeEventListener("campaignUpdated", handler);
  }, [loadReports]);

  // ── Auto-poll when pending campaigns exist ──
  useEffect(() => {
    const hasPending = entries.some((e) => e.status === "pending");

    if (hasPending && !pollRef.current) {
      pollRef.current = setInterval(loadReports, POLL_MS);
    } else if (!hasPending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [entries, loadReports]);

  const handleDownload = useCallback((data) => {
    try {
      const csv = buildCSV(data);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), {
        href: url,
        download: `campaign-report-${Date.now()}.csv`,
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("DOWNLOAD ERROR:", err);
    }
  }, []);

  const toggleRow = useCallback((i) => setOpenRow((prev) => (prev === i ? null : i)), []);

  const selectFilter = useCallback((f) => {
    setSelectedFilter(f);
    if (f !== "Custom Range") setFilterOpen(false);
  }, []);

  // ── Pagination ──
  const totalPages = Math.ceil(entries.length / perPage);
  const paginated = useMemo(() => entries.slice((page - 1) * perPage, page * perPage), [entries, page, perPage]);
  const pendingCount = entries.filter((e) => e.status === "pending").length;

  return (
    <div className="wr">
      {/* NOTE strip */}
      <div className="wr-note">
        <div className="wr-note-in">
          <b>NOTE =</b> All campaigns will be delivered Between 10A.M to 6P.M - (Monday to Saturday) on working days.
        </div>
      </div>

      <div className="wr-card">
        {/* HEADER */}
        <div className="wr-head">
          <div className="wr-head-l">
            <button type="button" className="wr-back" onClick={() => navigate("/wappreports")} title="Back to Reports">
              <FaArrowLeft />
            </button>
            <div>
              <h2 className="wr-h">Whatsapp Report</h2>
              <span className="wr-sub">Campaign Activity — daily insights on campaign performance</span>
            </div>

            {pendingCount > 0 && (
              <div className="wr-pend">
                <span className="wr-pill">⏳ {pendingCount} Pending</span>
                <span className="wr-auto"><i className="wr-dot green" />Auto-refreshing...</span>
              </div>
            )}
          </div>

          <div className="wr-head-r">
            <button type="button" onClick={loadReports} className="wr-btn light">
              <FaRotate /> Refresh
            </button>

            <div className="wr-rel" ref={filterRef}>
              <button type="button" onClick={() => setFilterOpen((v) => !v)} className="wr-btn primary">
                <FaCalendarDays />
                {selectedFilter === "Custom Range" && fromDate && toDate ? `${fromDate} → ${toDate}` : selectedFilter}
              </button>

              {filterOpen && (
                <div className="wr-filter">
                  {FILTERS.map((f) => (
                    <div key={f} onClick={() => selectFilter(f)} className={"wr-fi" + (f === selectedFilter ? " on" : "")}>
                      {f}
                    </div>
                  ))}

                  {selectedFilter === "Custom Range" && (
                    <div className="wr-custom">
                      <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                      <span>to</span>
                      <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                      <button type="button" onClick={() => setFilterOpen(false)}>Apply</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* BODY */}
        <div className="wr-body">
          <div className="wr-show">
            <span>Show</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            >
              {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>entries</span>
          </div>

          <div className="wr-tbl-wrap">
            <table className="wr-tbl">
              <thead>
                <tr>
                  <th style={{ width: 44 }}></th>
                  <th>Campname</th>
                  <th>Number</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Submit Date</th>
                  <th>Download</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr><td colSpan="7" className="wr-empty">Loading…</td></tr>
                ) : paginated.length === 0 ? (
                  <tr><td colSpan="7" className="wr-empty">No data available in table</td></tr>
                ) : (
                  paginated.map((e, i) => (
                    <React.Fragment key={e.id ?? i}>
                      <tr className={openRow === i ? "open" : ""}>
                        <td>
                          <button type="button" onClick={() => toggleRow(i)} className="wr-plus" aria-label="Toggle details">
                            {openRow === i ? <FaMinus /> : <FaPlus />}
                          </button>
                        </td>
                        <td className="b">{e.name}</td>
                        <td>{e.number}</td>
                        <td className="msg" title={e.message}>{e.message}</td>
                        <td><StatusBadge status={e.status} /></td>
                        <td className="nw">{e.date}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleDownload(e)}
                            disabled={e.status === "pending" && !isAdmin}
                            title={e.status === "pending" && !isAdmin ? "Available after completion" : "Download CSV"}
                            className="wr-dl"
                          >
                            {e.status === "pending" && !isAdmin ? "⏳ Wait" : <><FaDownload /> Download</>}
                          </button>
                        </td>
                      </tr>

                      {openRow === i && (
                        <tr className="wr-exp">
                          <td colSpan="7">
                            <div className="wr-exp-in">
                              <ExpandedRow entry={e} isAdmin={isAdmin} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}
          <div className="wr-foot">
            <span>
              Showing {entries.length === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, entries.length)} of {entries.length} entries
            </span>
            <div className="wr-pg">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0}>Next</button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .wr{--p:#448c74;--p-rgb:68,140,116;--info:#0dcaf0;--border:rgba(0,0,0,.08);--head:#1e293b;--muted:#64748b;font-family:'Inter',system-ui,sans-serif;color:#475569}
        .wr *{box-sizing:border-box}
        .wr-note{height:26px;overflow:hidden;position:relative;font-size:12px;color:#dc2626;margin-bottom:8px}
        .wr-note-in{position:absolute;white-space:nowrap;top:4px;animation:wrMarq 30s linear infinite}
        @keyframes wrMarq{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

        .wr-card{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 4px 20px -2px rgba(0,0,0,.05),0 2px 6px -1px rgba(0,0,0,.04)}
        .wr-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:1rem 1.25rem;border-bottom:1px solid var(--border)}
        .wr-head-l,.wr-head-r{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
        .wr-back{width:38px;height:38px;border-radius:10px;border:1px solid var(--border);background:#fff;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s}
        .wr-back:hover{background:var(--p);color:#fff;border-color:var(--p);box-shadow:0 4px 10px rgba(var(--p-rgb),.3)}
        .wr-h{margin:0;font-size:1.1rem;font-weight:700;color:var(--head)}
        .wr-sub{font-size:.8rem;color:var(--muted)}
        .wr-pend{display:flex;align-items:center;gap:.5rem;margin-left:.5rem}
        .wr-pill{background:#f97316;color:#fff;font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:999px}
        .wr-auto{display:flex;align-items:center;gap:5px;font-size:.72rem;color:#94a3b8}
        .wr-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;animation:wrPulse 1.2s ease-in-out infinite}
        .wr-dot.green{background:#4ade80;width:8px;height:8px}
        @keyframes wrPulse{50%{opacity:.35}}

        .wr-btn{display:inline-flex;align-items:center;gap:7px;border-radius:8px;font-size:.85rem;font-weight:600;padding:.5rem .95rem;cursor:pointer;font-family:inherit;transition:all .2s;border:1px solid transparent}
        .wr-btn.light{background:#fff;border-color:#e2e8f0;color:#475569}
        .wr-btn.light:hover{border-color:var(--p);color:var(--p)}
        .wr-btn.primary{background:var(--p);color:#fff;box-shadow:0 4px 10px rgba(var(--p-rgb),.28)}
        .wr-btn.primary:hover{filter:brightness(1.08);transform:translateY(-1px)}
        .wr-rel{position:relative}
        .wr-filter{position:absolute;right:0;top:calc(100% + 6px);width:230px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 12px 28px rgba(15,23,42,.15);z-index:50;overflow:hidden}
        .wr-fi{padding:9px 14px;font-size:13px;color:#334155;cursor:pointer}
        .wr-fi:hover{background:var(--p);color:#fff}
        .wr-fi.on{font-weight:700;color:var(--p)}
        .wr-fi.on:hover{color:#fff}
        .wr-custom{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#64748b}
        .wr-custom input{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:12px;font-family:inherit;outline:0}
        .wr-custom input:focus{border-color:var(--p)}
        .wr-custom button{border:0;background:var(--p);color:#fff;border-radius:6px;padding:6px;font-size:12px;font-weight:600;cursor:pointer}

        .wr-body{padding:1.25rem}
        .wr-show{display:flex;align-items:center;gap:8px;font-size:.85rem;margin-bottom:.9rem}
        .wr-show select{border:1px solid #e2e8f0;border-radius:6px;padding:4px 8px;outline:0;font-family:inherit;background:#fff}
        .wr-show select:focus{border-color:var(--p)}

        .wr-tbl-wrap{border:1px solid var(--border);border-radius:10px;overflow-x:auto}
        .wr-tbl{width:100%;border-collapse:collapse;font-size:.88rem;text-align:center}
        .wr-tbl thead th{background:#f1f5f9;color:#334155;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:.8rem .75rem;border-bottom:2px solid rgba(var(--p-rgb),.35);white-space:nowrap}
        .wr-tbl td{padding:.7rem .75rem;border-top:1px solid #eef2f6;vertical-align:middle}
        .wr-tbl tbody tr:hover:not(.wr-exp){background:#f8fafc}
        .wr-tbl tr.open{background:rgba(var(--p-rgb),.06)}
        .wr-tbl td.b{font-weight:600;color:var(--head)}
        .wr-tbl td.msg{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .wr-tbl td.nw{white-space:nowrap}
        .wr-empty{padding:2.2rem 1rem!important;color:#94a3b8;text-align:center}
        .wr-plus{width:26px;height:26px;border-radius:50%;border:0;background:var(--p);color:#fff;font-size:.65rem;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:transform .2s}
        .wr-plus:hover{transform:scale(1.12)}
        .wr-badge{display:inline-flex;align-items:center;gap:6px;font-size:.7rem;font-weight:700;color:#fff;padding:4px 10px;border-radius:6px}
        .wr-badge.done{background:#10b981}
        .wr-badge.pending{background:#f97316}
        .wr-dl{display:inline-flex;align-items:center;gap:6px;background:#20a8d8;color:#fff;border:0;border-radius:7px;padding:.4rem .8rem;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s}
        .wr-dl:hover:not(:disabled){background:#1b8db8;transform:translateY(-1px)}
        .wr-dl:disabled{background:#cbd5e1;cursor:not-allowed}

        .wr-exp td{background:#f8fafc;padding:0}
        .wr-exp-in{padding:1rem 1.25rem;text-align:left}
        .wr-media{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
        .wr-img{width:80px;height:80px;object-fit:cover;border:1px solid #e2e8f0;border-radius:8px}
        .wr-video{width:140px;margin-right:8px;border-radius:8px}
        .wr-pdf{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px;font-size:.78rem;margin:4px 8px 0 0;color:#334155;text-decoration:none}
        .wr-pdf svg{color:#ef4444}
        .wr-chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
        .wr-chip{background:#e0f2fe;color:#0369a1;font-size:.72rem;font-weight:600;padding:5px 12px;border-radius:999px}
        .wr-chip b{margin-left:4px}
        .wr-chip.ok{background:#dcfce7;color:#15803d}
        .wr-chip.bad{background:#fee2e2;color:#b91c1c}
        .wr-warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:.7rem;text-align:center;margin-bottom:.75rem}
        .wr-warn p{margin:0;color:#c2410c;font-size:.85rem;font-weight:500}
        .wr-warn.big{padding:1.2rem;margin:0}
        .wr-warn-ico{font-size:1.6rem;margin-bottom:6px}
        .wr-warn .t{font-weight:700;font-size:.95rem}
        .wr-warn .s{color:#f97316;margin-top:4px}

        .wr-foot{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:1rem;font-size:.85rem}
        .wr-pg{display:flex;gap:8px}
        .wr-pg button{border:1px solid #e2e8f0;background:#fff;border-radius:7px;padding:.4rem .9rem;cursor:pointer;font-family:inherit;color:#334155;transition:all .2s}
        .wr-pg button:hover:not(:disabled){border-color:var(--p);color:var(--p)}
        .wr-pg button:disabled{opacity:.4;cursor:not-allowed}
        @media(prefers-reduced-motion:reduce){.wr-note-in{animation:none;position:static}}
      `}</style>
    </div>
  );
};

export default WappCampaignActivity;
