import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  FaArrowsRotate,
  FaPlus,
  FaXmark,
  FaTrashCan,
  FaStar,
  FaRegStar,
  FaDownload,
  FaMagnifyingGlass,
  FaCircleCheck,
  FaCircleXmark,
  FaCircleInfo,
} from "react-icons/fa6";

/* =====================================================================
   WappPayment.jsx  –  Sidebar "Payment" click karne par ye page khulta hai
   Route: /wapppayment
   Tabs: Configurations | Transactions
   Configurations: channel select, Sync Meta, New Configuration (Razorpay / PayU)

   ⚠️ Abhi ye UI browser (localStorage) me save hota hai. Payment gateway ka
   asli backend / API jodna baaki hai (Sync Meta, Connect, Transactions list).
   ===================================================================== */

// 🔥 Yahan apne WABA channels daalo (ya API se laao). Format: id, waba, label
const CHANNELS = [
  { id: "3038", waba: "1040010095203795", label: "1040010095203795-15559493889 (SHERA)" },
  { id: "56", waba: "1365096008472571", label: "1365096008472571-15558353543 (Tripti Soni Makeover)" },
  { id: "102", waba: "1451125249317321", label: "1451125249317321-15558612938 (Monika Gokul Mehta)" },
];

const STORAGE_KEY = "wapp_payment_configs";
const NAME_PATTERN = /^[A-Za-z0-9._-]{4,40}$/;
const NAME_HELP =
  "Name should be 4 to 40 characters long. It can be alphanumeric and can include dot, hyphen or underscore, but it can't contain spaces.";

const PROVIDERS = [
  { id: "razorpay", name: "Razorpay" },
  { id: "payu", name: "PayU" },
];

function loadConfigs() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const RazorpayLogo = () => (
  <svg viewBox="0 0 24 24" role="img" aria-label="Razorpay" xmlns="http://www.w3.org/2000/svg" className="pg-logo-svg">
    <path fill="#3395FF" d="M22.436 0l-11.91 7.773-1.174 4.276 6.625-4.297L11.65 24h4.391L22.436 0z" />
    <path fill="#072654" d="M14.26 10.098L3.389 17.166 1.564 24h6.044l3.664-13.605-7.012 4.547z" />
  </svg>
);

const PayULogo = () => (
  <svg viewBox="0 0 92 30" role="img" aria-label="PayU" xmlns="http://www.w3.org/2000/svg" className="pg-logo-svg wide">
    <text x="0" y="23" fontFamily="Arial, 'Segoe UI', Helvetica, sans-serif" fontSize="26" fontWeight="800" letterSpacing="-0.5" fill="#0F9D58">
      Pay<tspan fill="#16BE5F">U</tspan>
    </text>
  </svg>
);

export default function WappPayment() {
  const [tab, setTab] = useState("configurations");
  const [channelId, setChannelId] = useState(CHANNELS[0]?.id || "");
  const [configs, setConfigs] = useState(loadConfigs);

  // modal
  const [showNew, setShowNew] = useState(false);
  const [provider, setProvider] = useState(null);
  const [cfgName, setCfgName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  // delete confirm
  const [toDelete, setToDelete] = useState(null);

  // toasts
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  // transactions filters (UI)
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("All");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    } catch {
      /* storage blocked */
    }
  }, [configs]);

  const notify = useCallback((message, type = "success") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const channelConfigs = useMemo(() => configs.filter((c) => c.channelId === channelId), [configs, channelId]);

  const nameValid = NAME_PATTERN.test(cfgName.trim());
  const nameDup = channelConfigs.some((c) => c.name.toLowerCase() === cfgName.trim().toLowerCase());
  const canCreate = provider && nameValid && !nameDup;

  const openNew = () => {
    setProvider(null);
    setCfgName("");
    setNameTouched(false);
    setShowNew(true);
  };

  const closeNew = () => setShowNew(false);

  const createConfig = () => {
    if (!canCreate) return;
    const isFirst = channelConfigs.length === 0;
    setConfigs((prev) => [
      ...prev,
      {
        id: Date.now(),
        channelId,
        name: cfgName.trim(),
        provider: provider.name,
        active: true,
        isDefault: isFirst,
        createdAt: new Date().toISOString(),
      },
    ]);
    setShowNew(false);
    notify(`Configuration "${cfgName.trim()}" created.`);
  };

  const toggleActive = (id) =>
    setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c)));

  const setDefault = (id) =>
    setConfigs((prev) =>
      prev.map((c) => (c.channelId === channelId ? { ...c, isDefault: c.id === id } : c))
    );

  const confirmDelete = () => {
    if (!toDelete) return;
    setConfigs((prev) => {
      const rest = prev.filter((c) => c.id !== toDelete.id);
      // default hat gaya to usi channel ka pehla config default ban jaye
      if (toDelete.isDefault) {
        const first = rest.find((c) => c.channelId === toDelete.channelId);
        if (first) return rest.map((c) => (c.id === first.id ? { ...c, isDefault: true } : c));
      }
      return rest;
    });
    notify("Configuration deleted.");
    setToDelete(null);
  };

  const syncMeta = () =>
    notify("Sync Meta ke liye server API connect karna baaki hai.", "info");

  const exportTx = () => notify("Export ke liye server API connect karna baaki hai.", "info");

  return (
    <div className="pg">
      <style>{CSS}</style>

      {/* toasts */}
      <div className="pg-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={"pg-toast " + t.type}>
            {t.type === "success" ? <FaCircleCheck /> : t.type === "danger" ? <FaCircleXmark /> : <FaCircleInfo />}
            <span>{t.message}</span>
            <button type="button" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Close"><FaXmark /></button>
          </div>
        ))}
      </div>

      <div className="pg-shell">
        {/* TABS */}
        <div className="pg-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "configurations"} className={tab === "configurations" ? "on" : ""} onClick={() => setTab("configurations")}>
            Configurations
          </button>
          <button type="button" role="tab" aria-selected={tab === "transactions"} className={tab === "transactions" ? "on" : ""} onClick={() => setTab("transactions")}>
            Transactions
          </button>
        </div>

        {/* ═════════ CONFIGURATIONS ═════════ */}
        {tab === "configurations" && (
          <div className="pg-panel">
            <div className="pg-panel-head">
              <h2 className="pg-title">Payment Configurations</h2>
              <div className="pg-controls">
                <select className="pg-select" value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Payment channel">
                  {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button type="button" className="pg-btn outline" onClick={syncMeta}>
                  <FaArrowsRotate /> Sync Meta
                </button>
                <button type="button" className="pg-btn primary" onClick={openNew}>
                  <FaPlus /> New Configuration
                </button>
              </div>
            </div>

            {channelConfigs.length === 0 ? (
              <div className="pg-empty">
                No configurations yet. Click <strong>New Configuration</strong> to add your first payment gateway.
              </div>
            ) : (
              <div className="pg-table-wrap">
                <table className="pg-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Configuration Name</th><th>Gateway</th><th>Active</th><th>Default</th><th>Created</th><th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channelConfigs.map((c, i) => (
                      <tr key={c.id}>
                        <td>{i + 1}</td>
                        <td className="b">{c.name}</td>
                        <td><span className={"pg-gw " + c.provider.toLowerCase()}>{c.provider}</span></td>
                        <td>
                          <button type="button" className={"pg-switch" + (c.active ? " on" : "")} onClick={() => toggleActive(c.id)} aria-pressed={c.active} aria-label="Toggle active">
                            <span />
                          </button>
                        </td>
                        <td>
                          {c.isDefault ? (
                            <span className="pg-default"><FaStar /> Default</span>
                          ) : (
                            <button type="button" className="pg-link" onClick={() => setDefault(c.id)}><FaRegStar /> Set default</button>
                          )}
                        </td>
                        <td className="nw">{new Date(c.createdAt).toLocaleString()}</td>
                        <td>
                          <button type="button" className="pg-icon-btn" title="Delete" onClick={() => setToDelete(c)}><FaTrashCan /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═════════ TRANSACTIONS ═════════ */}
        {tab === "transactions" && (
          <div className="pg-panel">
            <div className="pg-panel-head">
              <h2 className="pg-title">Transactions</h2>
              <div className="pg-controls">
                <input type="date" className="pg-input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
                <input type="date" className="pg-input" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
                <select className="pg-select sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                  <option>All</option><option>Success</option><option>Pending</option><option>Failed</option>
                </select>
                <button type="button" className="pg-btn outline" onClick={() => notify("Transactions list ke liye server API connect karna baaki hai.", "info")}>
                  <FaMagnifyingGlass /> Search
                </button>
                <button type="button" className="pg-btn primary" onClick={exportTx}>
                  <FaDownload /> Export
                </button>
              </div>
            </div>
            <div className="pg-table-wrap">
              <table className="pg-table">
                <thead>
                  <tr><th>Date</th><th>Order ID</th><th>Customer Number</th><th>Amount</th><th>Gateway</th><th>Status</th></tr>
                </thead>
                <tbody>
                  <tr><td colSpan="6" className="pg-empty-cell">No transactions found.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ═════════ NEW CONFIGURATION MODAL ═════════ */}
      {showNew && (
        <div className="pg-overlay" onClick={closeNew}>
          <div className="pg-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Payment Gateways">
            <div className="pg-modal-head">
              <h5>Payment Gateways</h5>
              <button type="button" onClick={closeNew} aria-label="Close"><FaXmark /></button>
            </div>

            <div className="pg-modal-body">
              <p className="pg-modal-note">You can set up multiple payment configurations</p>

              <div className="pg-providers">
                {PROVIDERS.map((p) => (
                  <div
                    key={p.id}
                    className={"pg-provider" + (provider?.id === p.id ? " sel" : "")}
                    onClick={() => setProvider(p)}
                  >
                    <h6>{p.name}</h6>
                    <div className="pg-logo-badge">{p.id === "razorpay" ? <RazorpayLogo /> : <PayULogo />}</div>
                    <button type="button" className="pg-btn primary full" onClick={(e) => { e.stopPropagation(); setProvider(p); }}>
                      {provider?.id === p.id ? "Selected" : "Configure"}
                    </button>
                  </div>
                ))}
              </div>

              {provider && (
                <div className="pg-name-sec">
                  <label htmlFor="pg-cfg-name" className="pg-form-label">Payment configuration name</label>
                  <input
                    id="pg-cfg-name"
                    className={"pg-input full" + (nameTouched && (!nameValid || nameDup) ? " bad" : "")}
                    maxLength={40}
                    placeholder="Enter configuration name"
                    value={cfgName}
                    onChange={(e) => { setCfgName(e.target.value); setNameTouched(true); }}
                    autoFocus
                  />
                  {nameTouched && !nameValid ? (
                    <div className="pg-help bad">{NAME_HELP}</div>
                  ) : nameTouched && nameDup ? (
                    <div className="pg-help bad">Is naam ka configuration is channel me pehle se hai.</div>
                  ) : (
                    <div className="pg-help">{NAME_HELP}</div>
                  )}
                </div>
              )}
            </div>

            <div className="pg-modal-foot">
              <button type="button" className="pg-btn blue" disabled={!canCreate} onClick={createConfig}>Create</button>
              <button type="button" className="pg-btn gray" onClick={closeNew}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════ DELETE CONFIRM ═════════ */}
      {toDelete && (
        <div className="pg-overlay" onClick={() => setToDelete(null)}>
          <div className="pg-modal sm" onClick={(e) => e.stopPropagation()} role="alertdialog">
            <div className="pg-modal-body center">
              <div className="pg-del-ico"><FaTrashCan /></div>
              <h5>Are you sure?</h5>
              <p className="pg-modal-note">Do you want to delete the payment gateway configuration <b>{toDelete.name}</b>?</p>
            </div>
            <div className="pg-modal-foot center">
              <button type="button" className="pg-btn danger" onClick={confirmDelete}>Yes, delete</button>
              <button type="button" className="pg-btn gray" onClick={() => setToDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.pg{--p:#10b981;--p2:#059669;--blue:#3b82f6;font-family:'Inter',system-ui,sans-serif;color:#334155}
.pg *{box-sizing:border-box}
.pg-shell{background:#fff;border:1px solid #e8ecf1;border-radius:18px;padding:26px 24px 30px;box-shadow:0 1px 4px rgba(15,23,42,.03);min-height:560px}

/* tabs */
.pg-tabs{display:flex;gap:6px;padding:6px;border:1px solid #d9efe6;background:#f2f9f6;border-radius:14px;margin-bottom:24px}
.pg-tabs button{flex:1;border:0;border-radius:10px;padding:11px 10px;font-size:13px;font-weight:600;color:#334155;background:#eef3fb;cursor:pointer;font-family:inherit;transition:all .2s;border:1px solid transparent}
.pg-tabs button:hover:not(.on){background:#e4ecf8}
.pg-tabs button.on{background:linear-gradient(180deg,#14c08a,#059669);color:#fff;font-weight:700;box-shadow:0 4px 10px rgba(5,150,105,.3)}

/* panel */
.pg-panel{border:1px solid #e3eaf3;border-radius:16px;background:#fff;overflow:hidden}
.pg-panel-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:20px 26px;border-bottom:1px solid #e8edf3}
.pg-title{margin:0;font-size:1.08rem;font-weight:700;color:#0f172a}
.pg-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pg-select,.pg-input{border:1px solid #d6dde6;border-radius:8px;background:#fff;padding:9px 14px;font-size:13px;color:#1e293b;font-family:inherit;outline:0;height:42px;transition:border-color .15s,box-shadow .15s}
.pg-select{min-width:380px;appearance:none;background-image:url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='%23343a40' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m2 5 6 6 6-6'/%3e%3c/svg%3e");background-repeat:no-repeat;background-position:right 14px center;background-size:13px;padding-right:38px}
.pg-select.sm{min-width:120px}
.pg-input.full{width:100%;height:auto;padding:10px 14px}
.pg-select:focus,.pg-input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(59,130,246,.15)}
.pg-input.bad{border-color:#ef4444}
.pg-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:8px;padding:0 20px;height:42px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s;white-space:nowrap}
.pg-btn.full{width:100%;height:40px}
.pg-btn.outline{background:#fff;border-color:#d6dde6;color:#475569}
.pg-btn.outline:hover{border-color:var(--blue);color:var(--blue)}
.pg-btn.primary{background:var(--blue);color:#fff;box-shadow:0 4px 10px rgba(59,130,246,.3)}
.pg-btn.primary:hover{filter:brightness(1.07);transform:translateY(-1px)}
.pg-btn.blue{background:#2563eb;color:#fff}
.pg-btn.blue:hover:not(:disabled){filter:brightness(1.08)}
.pg-btn.blue:disabled{opacity:.5;cursor:not-allowed}
.pg-btn.gray{background:#64748b;color:#fff}
.pg-btn.danger{background:#ef4444;color:#fff}

.pg-empty{padding:60px 20px 70px;text-align:center;font-size:15px;color:#64748b}
.pg-empty strong{color:#475569}

/* table */
.pg-table-wrap{overflow-x:auto}
.pg-table{width:100%;border-collapse:collapse;font-size:13px}
.pg-table th{text-align:left;background:#f6f8fb;color:#475569;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:12px 18px;border-bottom:1px solid #e8edf3;white-space:nowrap}
.pg-table td{padding:13px 18px;border-bottom:1px solid #f0f3f7;color:#334155;vertical-align:middle}
.pg-table td.b{font-weight:600;color:#0f172a}
.pg-table td.nw{white-space:nowrap}
.pg-empty-cell{text-align:center;color:#94a3b8;padding:46px 12px!important}
.pg-gw{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700}
.pg-gw.razorpay{background:#e7f1ff;color:#1d4ed8}.pg-gw.payu{background:#dcfce7;color:#15803d}
.pg-switch{width:36px;height:20px;border-radius:10px;border:0;background:#cbd5e1;position:relative;cursor:pointer;transition:background .2s}
.pg-switch span{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .2s}
.pg-switch.on{background:var(--p)}.pg-switch.on span{left:19px}
.pg-default{display:inline-flex;align-items:center;gap:6px;color:#b45309;font-weight:600}
.pg-default svg{color:#f59e0b}
.pg-link{border:0;background:none;color:var(--blue);font-weight:600;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit}
.pg-link:hover{text-decoration:underline}
.pg-icon-btn{width:34px;height:34px;border-radius:8px;border:1px solid #fecaca;background:#fef2f2;color:#ef4444;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all .2s}
.pg-icon-btn:hover{background:#ef4444;color:#fff}

/* modal */
.pg-overlay{position:fixed;inset:0;z-index:3000;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:16px;animation:pgFade .18s ease}
.pg-modal{background:#fff;border-radius:14px;width:100%;max-width:520px;box-shadow:0 25px 60px rgba(0,0,0,.25);animation:pgUp .25s cubic-bezier(.16,1,.3,1);overflow:hidden}
.pg-modal.sm{max-width:400px}
.pg-modal-head{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #e8edf3}
.pg-modal-head h5{margin:0;font-size:1.05rem;font-weight:700;color:#0f172a}
.pg-modal-head button{border:0;background:none;color:#64748b;font-size:16px;cursor:pointer;padding:4px;display:flex}
.pg-modal-head button:hover{color:#0f172a}
.pg-modal-body{padding:20px 22px}
.pg-modal-body.center{text-align:center;padding:28px 22px 12px}
.pg-modal-body.center h5{margin:12px 0 6px;font-size:1.1rem}
.pg-modal-note{margin:0 0 16px;font-size:13.5px;color:#475569}
.pg-modal-body.center .pg-modal-note{margin:0}
.pg-modal-foot{display:flex;gap:10px;padding:14px 22px;border-top:1px solid #e8edf3}
.pg-modal-foot.center{justify-content:center;border-top:0;padding-bottom:22px}
.pg-modal-foot .pg-btn{height:38px}
.pg-del-ico{width:54px;height:54px;border-radius:50%;background:#fef2f2;color:#ef4444;display:flex;align-items:center;justify-content:center;margin:0 auto;font-size:20px}

.pg-providers{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.pg-provider{border:1px solid #e0e7ef;border-radius:12px;padding:16px 14px;text-align:center;cursor:pointer;transition:all .2s;background:#fff}
.pg-provider h6{margin:0 0 10px;font-size:15px;font-weight:700;color:#0f172a}
.pg-provider:hover{border-color:var(--blue);box-shadow:0 6px 16px rgba(59,130,246,.12)}
.pg-provider.sel{border-color:var(--blue);background:#f5f9ff;box-shadow:0 0 0 2px rgba(59,130,246,.2)}
.pg-logo-badge{height:62px;display:flex;align-items:center;justify-content:center;margin-bottom:14px;border-radius:10px;background:#f8fafc}
.pg-logo-svg{height:34px;width:34px}
.pg-logo-svg.wide{width:84px}
.pg-name-sec{margin-top:20px}
.pg-form-label{display:block;font-size:13px;font-weight:600;color:#0f172a;margin-bottom:6px}
.pg-help{margin-top:6px;font-size:11.5px;color:#64748b;line-height:1.45}
.pg-help.bad{color:#dc2626}

/* toasts */
.pg-toasts{position:fixed;top:68px;right:18px;z-index:3500;display:flex;flex-direction:column;gap:8px;max-width:340px}
.pg-toast{display:flex;align-items:flex-start;gap:10px;padding:11px 14px;border-radius:10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.15);animation:pgUp .25s ease;border:1px solid}
.pg-toast span{flex:1}
.pg-toast button{border:0;background:none;color:inherit;opacity:.6;cursor:pointer;display:flex;padding:2px}
.pg-toast svg{margin-top:2px;flex:0 0 auto}
.pg-toast.success{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
.pg-toast.danger{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
.pg-toast.info{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}

@keyframes pgFade{from{opacity:0}to{opacity:1}}
@keyframes pgUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
@media(max-width:820px){.pg-select{min-width:0;width:100%}.pg-controls{width:100%}.pg-shell{padding:16px 12px}.pg-panel-head{padding:16px}.pg-providers{grid-template-columns:1fr}}
`;