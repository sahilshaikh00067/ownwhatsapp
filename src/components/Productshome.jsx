import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

/* =====================================================================
   ProductsHome.jsx  –  Infra Infotech · Omni App home page
   Single file. Images ko src/assets/ me rakho (src/components/ProductsHome.jsx ke hisaab se).
   (Font Awesome + Roboto are loaded automatically from CDN.)
   Login ke baad yahi page khulta hai (route: /productshome).
   WhatsApp card -> /dashboard  |  WhatsApp 'Campaign' button -> /wappcampaign
   ===================================================================== */

// Images: src/assets/*.png  (is file ke hisaab se: src/components/ProductsHome.jsx -> ../assets/)
// Vite me saari PNG images apne aap import ho jaati hain, alag-alag import likhne ki zarurat nahi.
const IMAGES = import.meta.glob("../assets/*.png", { eager: true, import: "default" });
const img = (name) => IMAGES["../assets/" + name];

/* ------------------------------ DATA ------------------------------ */
const CHANNELS = [
  {"id": "SMS", "title": "SMS", "desc": "Instant, reliable messaging to any phone !", "img": "SMS.png", "w": 54, "h": null, "mt": null, "active": false},
  {"id": "GlobalSMS", "title": "GlobalSMS", "desc": "Instant, reliable messaging to any phone !", "img": "GlobalSMS.png", "w": 54, "h": null, "mt": null, "active": false},
  {"id": "RCSMessage", "title": "RCS", "desc": "Rich, interactive messaging with media support !", "img": "RCSMessage.png", "w": 54, "h": null, "mt": null, "active": false},
  {"id": "WhatsApp", "title": "WhatsApp", "desc": "Secure, trusted messaging on WhatsApp Business !", "img": "WhatsApp.png", "w": null, "h": null, "mt": null, "active": true},
  {"id": "AI", "title": "AI Agent", "desc": "Intelligent AI conversations with seamless automation.", "img": "AI.png", "w": 43, "h": null, "mt": null, "active": false},
  {"id": "Voice", "title": "Voice", "desc": "Connect customers instantly through high-quality voice !", "img": "Voice.png", "w": 52, "h": null, "mt": null, "active": false},
  {"id": "IVR", "title": "IVR", "desc": "Smart call routing with voice menus !", "img": "IVR.png", "w": null, "h": null, "mt": null, "active": false},
  {"id": "TextToSpeech", "title": "Text-to-Speech", "desc": "Convert text into natural-sounding voice !", "img": "TextToSpeech.png", "w": 41, "h": null, "mt": null, "active": false},
  {"id": "ClickToCall", "title": "ClickToCall", "desc": "Simplify customer outreach with click-to-call !", "img": "ClickToCall.png", "w": null, "h": null, "mt": null, "active": false},
];

const UTILITIES = [
  {"id": "URLShortener", "title": "URL Shortener", "desc": "Used for sharing links on social media.", "img": "URLShortener.png", "w": 133, "h": null, "mt": null, "active": false},
  {"id": "Journey", "title": "Journeys", "desc": "Multi-campaign messaging with fallback handling.", "img": "Journey.png", "w": 50, "h": null, "mt": null, "active": false},
  {"id": "TemplateCategory", "title": "Template Category", "desc": "Event planning templates for smooth execution.", "img": "TemplateCategory.png", "w": null, "h": null, "mt": null, "active": true},
  {"id": "APIs", "title": "API's", "desc": "Secure API practices for developers.", "img": "APIs.png", "w": 52, "h": null, "mt": null, "active": true},
  {"id": "Reports", "title": "Api Logs Reports", "desc": "Campaign performance analysis and key insights", "img": "Reports.png", "w": 53, "h": null, "mt": null, "active": true},
  {"id": "AuditReport", "title": "System Audit", "desc": "Check system activities and transaction details.", "img": "AuditReport.png", "w": 45, "h": null, "mt": null, "active": true},
  {"id": "GlobalAuditReport", "title": "Global SMS Audit", "desc": "Check system activities and transaction details.", "img": "GlobalAuditReport.png", "w": 45, "h": null, "mt": null, "active": true},
  {"id": "DownloadReport", "title": "Download Center", "desc": "View and download all your reports in one place.", "img": "DownloadReport.png", "w": 43, "h": null, "mt": null, "active": true},
];

const PLUGINS = [
  {"id": "Shopify", "title": "Shopify", "desc": "With Shopify, users can manage everything.", "img": "Shopify.png", "w": 50, "h": null, "mt": null, "active": false},
  {"id": "CleaverTap", "title": "CleverTap", "desc": "CleverTap is widely used by product teams.", "img": "CleaverTap.png", "w": 50, "h": null, "mt": null, "active": false},
  {"id": "Moengage", "title": "MoEngage", "desc": "Mobile-first and digital-first businesses.", "img": "Moengage.png", "w": 50, "h": null, "mt": null, "active": false},
  {"id": "WebEngage", "title": "", "desc": "Mobile-first and digital-first businesses.", "img": "WebEngage.png", "w": 146, "h": 55, "mt": 24, "active": false},
  {"id": "ZohoFlow", "title": "Zoho Flow", "desc": "It supports a wide range of apps.", "img": "ZohoFlow.png", "w": 47, "h": null, "mt": null, "active": false},
  {"id": "ZohoIntegration", "title": "Zoho Integration", "desc": "It supports a wide range of apps.", "img": "ZohoIntegration.png", "w": 109, "h": null, "mt": null, "active": false},
  {"id": "Plabbly", "title": "Pabbly", "desc": "Pabbly helps businesses streamline repetitive tasks.", "img": "Plabbly.png", "w": 50, "h": null, "mt": null, "active": false},
  {"id": "zapier", "title": "Zapier", "desc": "A customer engagement and software company.", "img": "zapier.png", "w": 173, "h": null, "mt": null, "active": false},
  {"id": "GoogleSheets", "title": "Google Sheets", "desc": "Widely used by individuals and businesses.", "img": "GoogleSheets.png", "w": 50, "h": null, "mt": null, "active": false},
  {"id": "WooCommerce", "title": "WooCommerce", "desc": "Widely used by individuals and businesses.", "img": "WooCommerce.png", "w": 77, "h": null, "mt": null, "active": false},
  {"id": "Hubspot", "title": "Hubspot", "desc": "Widely used by individuals and businesses.", "img": "Hubspot.png", "w": 150, "h": null, "mt": null, "active": false},
];

/* Header search me jo pages dikhenge (aapke existing routes) */
const SEARCH_PAGES = [
  { label: "Dashboard", sub: "WhatsApp dashboard", icon: "fa-solid fa-gauge", to: "/dashboard" },
  { label: "Wapp Campaign", sub: "Send WhatsApp campaign", icon: "fa-brands fa-whatsapp", to: "/wappcampaign" },
  { label: "Wapp DP Campaign", sub: "Send DP campaign", icon: "fa-brands fa-whatsapp", to: "/wappdpcampaign" },
  { label: "Wapp Reports", sub: "WhatsApp campaign reports", icon: "fa-solid fa-chart-pie", to: "/wappreports" },
  { label: "Credit History", sub: "Credit usage history", icon: "fa-solid fa-clock-rotate-left", to: "/credithistory" },
  { label: "Change Password", sub: "Update your password", icon: "fa-solid fa-key", to: "/changepassword" },
  { label: "Whatsapp Scan", sub: "Admin only", icon: "fa-solid fa-qrcode", to: "/whatsappscan", roles: ["admin"] },
  { label: "Add User", sub: "Admin / reseller", icon: "fa-solid fa-user-plus", to: "/adduser", notRoles: ["user"] },
  { label: "Manage User", sub: "Admin / reseller", icon: "fa-solid fa-users", to: "/manageuser", notRoles: ["user"] },
  { label: "Credit Manage", sub: "Admin / reseller", icon: "fa-solid fa-coins", to: "/creditmanage", notRoles: ["user"] },
];

function getSession() {
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem("user")); } catch (e) { /* ignore */ }
  const role = (sessionStorage.getItem("role") || user?.role || "").toLowerCase();
  return { user, role, name: user?.name || user?.username || user?.user_name || "User" };
}

/* ------------------------------ STYLES ------------------------------ */
const CSS = `
html,body{margin:0;padding:0;background:#fff}
.ph-root{font-family:'Roboto',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1f2430;min-height:100vh;background:#fff;font-size:13px}
.ph-root{--card-w:160px;--card-gap:20px}  /* <-- width aur gap yahan se badlo */
.ph-root *{box-sizing:border-box}
.ph-root button{font-family:inherit}

/* header */
.ph-header{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 24px 0 30px;background:linear-gradient(#f9f9f9,#ececec);box-shadow:0 2px 6px rgba(0,0,0,.14);position:relative;z-index:30}
.ph-left{display:flex;align-items:center;gap:22px}
.ph-brand{font-size:16.5px;font-weight:700;color:#2b2f4a;text-shadow:1px 1px #9571ee;margin:0;cursor:pointer;letter-spacing:.1px;background:none;border:0;padding:0}
.ph-search{position:relative}
.ph-pill{width:168px;height:28px;background:#fff;border-radius:14px;display:flex;align-items:center;gap:7px;padding:0 10px;box-shadow:0 0 0 1px #e3e3e8,0 1px 3px rgba(0,0,0,.08)}
.ph-pill i{font-size:10px;color:#7b8190}
.ph-pill input{border:0;outline:0;background:transparent;font-size:10px;width:100%;color:#333}
.ph-pill input::placeholder{color:#8b909c}
.ph-dd{position:absolute;top:34px;left:0;width:330px;background:#fff;border-radius:10px;box-shadow:0 10px 30px rgba(20,25,50,.2);border:1px solid #e5e7ee;max-height:320px;overflow:auto;z-index:60}
.ph-dd button{display:flex;gap:10px;align-items:center;width:100%;text-align:left;border:0;background:#fff;padding:9px 12px;cursor:pointer;font-size:12px}
.ph-dd button:hover,.ph-dd button.on{background:#eef4f8}
.ph-dd small{display:block;color:#7b8190;font-size:10.5px}
.ph-dd i{width:16px;color:#4a7a90;text-align:center}
.ph-right{display:flex;align-items:center;gap:14px}
.ph-ibtn{width:54px;height:28px;border:0;border-radius:6px;background:#e9e9e9;color:#555;box-shadow:2px 3px 5px rgba(0,0,0,.22),-1px -1px 3px #fff;cursor:pointer;font-size:12px}
.ph-ibtn:active{box-shadow:inset 1px 2px 4px rgba(0,0,0,.2)}
.ph-user{display:flex;align-items:center;gap:7px;font-weight:700;font-size:11px;color:#2b2f4a}
.ph-user img{width:34px;height:34px;border-radius:50%;border:1px solid #d6d6dc;object-fit:cover;background:#fff}

/* marquee */
.ph-marq{margin-top:5px;height:26px;overflow:hidden;position:relative;font-size:9.5px;color:#22c58b}
.ph-marq-in{position:absolute;white-space:nowrap;top:5px;animation:phMarq 26s linear infinite;display:flex;gap:6px;align-items:center}
.ph-marq i.run{font-size:15px;color:#2d3b55}
.ph-marq b{font-weight:700}
@keyframes phMarq{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

/* floating action */
.ph-fab{position:fixed;right:9px;top:54px;width:34px;height:34px;border-radius:50%;border:0;background:#22c58b;color:#fff;font-size:15px;box-shadow:0 3px 10px rgba(34,197,139,.5);cursor:pointer;z-index:40}

/* sections */
.ph-sec{margin-bottom:34px}
.ph-band{display:flex;justify-content:space-between;align-items:center;min-height:33px;padding:5px 16px;background:#d6d7da;border-radius:12px 12px 0 0}
.ph-band.tall{min-height:42px}
.ph-band h5{margin:0;font-size:15.5px;font-weight:500;color:#10131a;display:flex;align-items:center;gap:6px}
.ph-btn-info{display:inline-flex;align-items:center;gap:5px;border:0;background:#2b7fd8;color:#fff;font-size:10px;font-weight:700;padding:7px 8px;border-radius:4px;cursor:pointer}
.ph-btn-info:hover{background:#1f6bbd}
.ph-grid{display:flex;flex-wrap:wrap;gap:var(--card-gap);padding:19px 14px 0}
.ph-grid.pl{padding-top:19px}

/* cards */
.ph-card{position:relative;width:var(--card-w);height:162px;background:#fff;border:1px solid #e4e6ec;border-radius:8px;box-shadow:0 1px 6px rgba(30,35,60,.10);display:flex;flex-direction:column;align-items:center;padding:10px 8px 18px;text-align:center;flex:0 0 auto;transition:box-shadow .15s}
.ph-card:hover{box-shadow:0 3px 12px rgba(30,35,60,.18)}
.ph-card.over{outline:2px dashed #4a7a90}
.ph-card.clickable{cursor:pointer}
.ph-grip{position:absolute;left:6px;top:4px;font-size:8px;color:#c4c7d0;cursor:grab;padding:3px}
.ph-grip:active{cursor:grabbing}
.ph-ibox{height:52px;display:flex;align-items:center;justify-content:center;margin-top:0}
.ph-ibox img{max-width:130px;object-fit:contain;display:block}
.ph-card h6{margin:6px 0 0;font-size:12.5px;font-weight:500;color:#10131a;line-height:15px;min-height:15px}
.ph-card p{margin:3px 0 0;font-size:9.5px;line-height:13px;color:#6b7280;max-height:27px;overflow:hidden}
.ph-act{margin-top:auto;width:calc(var(--card-w) - 20px);height:23px;border:0;border-radius:6px;background:linear-gradient(180deg,#4f819a,#3f7088);color:#fff;font-size:8.8px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;box-shadow:0 2px 3px rgba(40,70,90,.3)}
.ph-act:hover{filter:brightness(1.08)}
.ph-act i{font-size:8px}
.ph-split{margin-top:auto;display:flex;width:calc(var(--card-w) - 20px);height:23px;border-radius:6px;overflow:hidden;box-shadow:0 2px 3px rgba(40,60,80,.3)}
.ph-split button{flex:1;border:0;background:linear-gradient(180deg,#58798f,#46657b);color:#fff;font-size:8.2px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:4px;cursor:pointer}
.ph-split button+button{border-left:1px solid rgba(255,255,255,.35)}
.ph-split button:hover{filter:brightness(1.1)}
.ph-split i{font-size:7.5px}

/* badge + tooltip */
.ph-bw{position:absolute;right:6px;top:6px;z-index:5}
.ph-badge{width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;box-shadow:0 0 0 2px #fff,0 1px 3px rgba(0,0,0,.3);cursor:default}
.ph-badge.on{background:#139a5b}.ph-badge.off{background:#e11d2e}
.ph-tip{position:absolute;right:-4px;top:24px;width:150px;padding:8px 10px;border-radius:8px;color:#fff;font-size:10px;line-height:13px;text-align:left;box-shadow:0 6px 16px rgba(0,0,0,.25);opacity:0;visibility:hidden;transform:translateY(-4px);transition:.15s;pointer-events:none;z-index:20}
.ph-tip:before{content:"";position:absolute;top:-4px;right:10px;width:8px;height:8px;background:inherit;transform:rotate(45deg)}
.ph-bw:hover .ph-tip{opacity:1;visibility:visible;transform:none}

/* plugins marquee */
.ph-plug{overflow:hidden;padding:19px 0 0 6px}
.ph-track{display:flex;gap:calc(var(--card-gap) - 6px);width:max-content;animation:phSlide 60s linear infinite;padding-bottom:6px}
.ph-plug:hover .ph-track{animation-play-state:paused}
@keyframes phSlide{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.ph-wrap{border:1px solid #e7e9ee;border-top:0;border-radius:0 0 12px 12px;padding-bottom:10px;margin:0 0 10px}

/* toast */
.ph-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#222a3a;color:#fff;padding:10px 16px;border-radius:8px;font-size:12px;z-index:100;box-shadow:0 8px 24px rgba(0,0,0,.3);display:flex;gap:8px;align-items:center;animation:phToast .2s ease-out}
@keyframes phToast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}

@media(max-width:900px){
 .ph-search{display:none}
 .ph-grid{justify-content:center}
 .ph-user span{display:none}
}
@media(prefers-reduced-motion:reduce){.ph-marq-in,.ph-track{animation:none}}
`;

/* ------------------------------ HELPERS ------------------------------ */
function useHeadAssets() {
  useEffect(() => {
    const add = (id, href) => {
      if (document.getElementById(id)) return;
      const l = document.createElement("link");
      l.id = id; l.rel = "stylesheet"; l.href = href;
      document.head.appendChild(l);
    };
    add("ph-fa", "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css");
    add("ph-roboto", "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap");
  }, []);
}

function useReorder(initial) {
  const [list, setList] = useState(initial);
  const [armed, setArmed] = useState(null);
  const [over, setOver] = useState(null);
  const dragId = useRef(null);
  const move = (from, to) => {
    if (!from || !to || from === to) return;
    setList((l) => {
      const a = [...l];
      const i = a.findIndex((x) => x.id === from);
      const j = a.findIndex((x) => x.id === to);
      const [m] = a.splice(i, 1);
      a.splice(j, 0, m);
      return a;
    });
  };
  const dragProps = (id) => ({
    draggable: armed === id,
    onDragStart: (e) => { dragId.current = id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); },
    onDragOver: (e) => { if (dragId.current) { e.preventDefault(); setOver(id); } },
    onDrop: (e) => { e.preventDefault(); move(dragId.current, id); },
    onDragEnd: () => { dragId.current = null; setArmed(null); setOver(null); },
  });
  return { list, dragProps, arm: setArmed, over };
}

/* ------------------------------ HEADER ------------------------------ */
function Header({ onHome }) {
  const navigate = useNavigate();
  const { role, name } = useMemo(getSession, []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const box = useRef(null);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return SEARCH_PAGES
      .filter((p) => (!p.roles || p.roles.includes(role)) && (!p.notRoles || !p.notRoles.includes(role)))
      .filter((p) => (p.label + " " + p.sub).toLowerCase().includes(t))
      .slice(0, 8);
  }, [q, role]);

  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (r) => { setOpen(false); setQ(""); if (r) navigate(r.to); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") pick(results[idx]);
    if (e.key === "Escape") setOpen(false);
  };
  const logout = () => { sessionStorage.clear(); navigate("/login"); };

  return (
    <header className="ph-header">
      <div className="ph-left">
        <button className="ph-brand" onClick={onHome}>Infra Infotech</button>
        <div className="ph-search" ref={box}>
          <div className="ph-pill">
            <i className="fa-solid fa-magnifying-glass" />
            <input value={q} placeholder="Search pages..." onChange={(e) => { setQ(e.target.value); setOpen(true); setIdx(0); }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
          </div>
          {open && results.length > 0 && (
            <div className="ph-dd">
              {results.map((r, i) => (
                <button key={r.to} className={i === idx ? "on" : ""} onMouseEnter={() => setIdx(i)} onClick={() => pick(r)}>
                  <i className={r.icon} />
                  <span>{r.label}<small>{r.sub}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="ph-right">
        <button className="ph-ibtn" title="Wallet" onClick={() => navigate("/credithistory")}><i className="fa-solid fa-wallet" /></button>
        <button className="ph-ibtn" title="Log out" onClick={logout}><i className="fa-solid fa-right-from-bracket" /></button>
        <div className="ph-user"><img src={img("avatar.png")} alt={name} /><span>{name}</span></div>
      </div>
    </header>
  );
}

/* ------------------------------ HOME ------------------------------ */
function Badge({ item }) {
  const bg = item.active ? "linear-gradient(135deg,#007bff 0%,#00c6ff 100%)" : "linear-gradient(135deg,#ff4e50 0%,#f9d423 100%)";
  return (
    <div className="ph-bw">
      <span className={"ph-badge " + (item.active ? "on" : "off")}>{item.active ? "✓" : "✕"}</span>
      <div className="ph-tip" style={{ background: bg }}>
        {item.active ? `You have access to the ${item.id} product.` : `${item.id} Please Update Your Plan. `}
      </div>
    </div>
  );
}

function Card({ item, kind, onAction, dnd }) {
  const imgStyle = {};
  if (item.w) { imgStyle.width = Math.round(item.w * 0.7); imgStyle.maxWidth = "none"; } else { imgStyle.width = 36; imgStyle.maxHeight = 42; }
  if (item.h) imgStyle.height = Math.round(item.h * 0.7);
  if (item.mt) imgStyle.marginTop = Math.round(item.mt * 0.7);
  const label = kind === "channel" ? "Campaign" : "Visit";
  const dp = dnd ? dnd.dragProps(item.id) : {};
  return (
    <div className={"ph-card" + (item.id === "WhatsApp" ? " clickable" : "") + (dnd && dnd.over === item.id ? " over" : "")} {...dp} onClick={() => item.id === "WhatsApp" && onAction(item, "open")}>
      {dnd && (
        <span className="ph-grip" title="Hold & drag to reorder" onMouseDown={() => dnd.arm(item.id)} onMouseUp={() => dnd.arm(null)} onClick={(e) => e.stopPropagation()}>
          <i className="fa-solid fa-grip-vertical" />
        </span>
      )}
      <Badge item={item} />
      <div className="ph-ibox"><img src={img(item.img)} alt={item.title || item.id} style={imgStyle} draggable={false} /></div>
      <h6>{item.title}</h6>
      <p>{item.desc}</p>
      {kind === "plugin" ? (
        <div className="ph-split">
          <button onClick={(e) => { e.stopPropagation(); onAction(item, "plugin"); }}><i className="fa-solid fa-arrow-up-right-from-square" />Plugins</button>
          <button onClick={(e) => { e.stopPropagation(); onAction(item, "docs"); }}><i className="fa-solid fa-arrow-up-right-from-square" />Docs</button>
        </div>
      ) : (
        <button className="ph-act" onClick={(e) => { e.stopPropagation(); onAction(item, "button"); }}>
          <i className="fa-solid fa-arrow-up-right-from-square" />{label}
        </button>
      )}
    </div>
  );
}

function Home({ onAction }) {
  const ch = useReorder(CHANNELS);
  const ut = useReorder(UTILITIES);
  return (
    <>
      <div className="ph-marq" aria-label="Announcement">
        <div className="ph-marq-in">
          <i className="fa-solid fa-person-running run" />:
          <b>Update <i className="fa-solid fa-bell" /></b>
          <span>Technology is best when it brings people together &nbsp;|&nbsp;</span>
        </div>
      </div>

      <section className="ph-sec" style={{ marginBottom: 34 }}>
        <div className="ph-band tall">
          <h5>Channels <i className="fa-solid fa-laptop" /></h5>
          <button className="ph-btn-info" onClick={() => onAction({ title: "Daily Consumption" }, "toast")}>
            <i className="fa-solid fa-money-bill-transfer" /> Daily Consumption
          </button>
        </div>
        <div className="ph-grid">
          {ch.list.map((c) => <Card key={c.id} item={c} kind="channel" onAction={onAction} dnd={ch} />)}
        </div>
      </section>

      <section className="ph-sec">
        <div className="ph-band"><h5>Utilities <i className="fa-solid fa-screwdriver-wrench" /></h5></div>
        <div className="ph-grid" style={{ paddingTop: 19 }}>
          {ut.list.map((c) => <Card key={c.id} item={c} kind="utility" onAction={onAction} dnd={ut} />)}
        </div>
      </section>

      <section className="ph-sec" style={{ marginBottom: 0 }}>
        <div className="ph-band"><h5>Plugins <i className="fa-solid fa-link" /></h5></div>
        <div className="ph-wrap">
          <div className="ph-plug">
            <div className="ph-track">
              {[...PLUGINS, ...PLUGINS].map((c, i) => <Card key={c.id + i} item={c} kind="plugin" onAction={onAction} />)}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ------------------------------ APP ------------------------------ */
export default function ProductsHome() {
  useHeadAssets();
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  // Home dekh liya -> ab Dashboard/WhatsApp pages khul sakte hain (logout par sessionStorage.clear() isse reset kar deta hai)
  useEffect(() => { sessionStorage.setItem("homeSeen", "1"); }, []);

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const onAction = (item, how) => {
    // WhatsApp -> aapka existing Header + Sidebar layout
    if (item.id === "WhatsApp") return navigate(how === "button" ? "/wappcampaign" : "/dashboard");
    if (how === "toast") return say(item.title + " opens here");
    if (item.active === false && how !== "docs") return say(`Please update your ${item.title || item.id} plan.`);
    say(`${item.title || item.id} opens here`);
  };

  return (
    <div className="ph-root">
      <style>{CSS}</style>
      <Header onHome={() => window.scrollTo(0, 0)} />
      <button className="ph-fab" title="Quick actions" onClick={() => say("Quick actions")}><i className="fa-solid fa-wand-magic-sparkles" /></button>
      <Home onAction={onAction} />
      {toast && <div className="ph-toast" role="status"><i className="fa-solid fa-circle-info" />{toast}</div>}
    </div>
  );
}