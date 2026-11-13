import { NavLink, Link, useNavigate, Outlet } from "react-router-dom";
import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogPanel } from "@headlessui/react";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { IoMenu } from "react-icons/io5";
import {
  FaHouse,
  FaTableColumns,
  FaHeadset,
  FaRegMessage,
  FaSliders,
  FaChartSimple,
  FaUsersLine,
  FaCreditCard,
  FaGlobe,
  FaRobot,
  FaRegImages,
  FaMagnifyingGlass,
  FaRightFromBracket,
} from "react-icons/fa6";

import avatar from "../assets/avatar.png"; // src/assets/avatar.png

/* =====================================================================
   Header.jsx  –  Omni App style header + left icon rail + footer
   Logic same hai: credit polling (3 sec), campaignUpdated event, role checks, logout.
   Naya: "Home" (top-left rail + brand) -> /productshome
   ===================================================================== */

const API = "https://ownwhatsapp-backend-django.onrender.com";

// 🔥 FIXED LINKS (mobile menu)
const links = [
  { text: "Dashboard", to: "/dashboard" },
  { text: "Agent", to: "/wappagent" },
  { text: "Wapp Campaign", to: "/wappcampaign" },
  { text: "Config", to: "/wappconfig" },
  { text: "Automation", to: "/wappautomation" },
  { text: "Catalog", to: "/wappcatalog" },
  { text: "Wapp Reports", to: "/wappreports" },
  { text: "Add User", to: "/adduser" },
  { text: "Manage User", to: "/manageuser" },
  { text: "Payment", to: "/wapppayment" },
  { text: "API Console", to: "/wappapi" },
];

// Header search me jo pages dikhenge
const SEARCH_PAGES = [
  { label: "Products Home", sub: "All channels & utilities", to: "/productshome", icon: FaHouse },
  { label: "Dashboard", sub: "Campaign statistics", to: "/dashboard", icon: FaTableColumns },
  { label: "Wapp Campaign", sub: "Send WhatsApp campaign", to: "/wappcampaign", icon: FaRegMessage },
  { label: "Config", sub: "Channels, templates & contacts", to: "/wappconfig", icon: FaSliders },
  { label: "Wapp Reports", sub: "Campaign reports", to: "/wappreports", icon: FaChartSimple },
  { label: "Automation", sub: "Chatbot, flows, QR codes & widget", to: "/wappautomation", icon: FaRobot },
  { label: "Catalog", sub: "Manage catalog & catalog activity", to: "/wappcatalog", icon: FaRegImages },
  { label: "Agent", sub: "Live agents, agent list & WhatsApp scan", to: "/wappagent", icon: FaHeadset, roles: ["admin"] },
  { label: "Add User", sub: "Admin / reseller", to: "/adduser", icon: FaUsersLine, notRoles: ["user"] },
  { label: "Manage User", sub: "Admin / reseller", to: "/manageuser", icon: FaUsersLine, notRoles: ["user"] },
  { label: "Payment", sub: "Payment gateway configurations & transactions", to: "/wapppayment", icon: FaCreditCard, notRoles: ["user"] },
  { label: "API Console", sub: "WhatsApp API documentation", to: "/wappapi", icon: FaGlobe },
];

const CSS = `
.hd-root{--z:.85;--primary:#448c74;--rail-bg:#eef1f8;--content-bg:#ffffff;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#475569;background:var(--content-bg);min-height:100vh}
@media(min-width:700px){.hd-root{zoom:var(--z);min-height:calc(100vh / var(--z))}}
.hd-root *{box-sizing:border-box}
.hd-root button{font-family:inherit}

/* ---------- top bar ---------- */
.hd-top{position:fixed;top:0;left:0;right:0;height:52px;z-index:1020;display:flex;align-items:center;justify-content:space-between;
  padding:0 22px 0 16px;background:#f4f4f4;box-shadow:rgba(0,0,0,.1) 0 18px 18px -5px,rgba(0,0,0,.04) 0 0 0 -7px}
.hd-left{display:flex;align-items:center;gap:14px;min-width:0}
.hd-burger{border:0;background:transparent;color:#2b2f4a;cursor:pointer;display:flex;padding:6px;border-radius:6px}
.hd-burger:hover{background:rgba(0,0,0,.06)}
.hd-brand{font-size:19px;font-weight:700;color:#1b1f3b;text-shadow:1px 1px #9571ee;margin:0;border:0;background:none;padding:0;cursor:pointer;white-space:nowrap}
.hd-search{position:relative;margin-left:6px}
.hd-pill{position:relative;display:flex;align-items:center;width:220px;height:36px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:0 12px 0 34px;
  box-shadow:0 1px 3px rgba(0,0,0,.04);transition:width .2s,border-color .2s,box-shadow .2s}
.hd-pill:focus-within{width:270px;border-color:#7c5cfc;box-shadow:0 0 0 3px rgba(124,92,252,.15)}
.hd-pill svg{position:absolute;left:13px;color:#94a3b8;font-size:12px}
.hd-pill:focus-within svg{color:#7c5cfc}
.hd-pill input{all:unset;box-sizing:border-box;width:100%;height:100%;font-size:12px;color:#1e293b}
.hd-pill input::placeholder{color:#94a3b8}
.hd-dd{position:absolute;top:42px;left:0;width:340px;background:#fff;border:1px solid #e5e7ee;border-radius:12px;box-shadow:0 12px 30px rgba(20,25,50,.18);overflow:hidden;z-index:60}
.hd-dd button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:#fff;text-align:left;padding:9px 14px;cursor:pointer;font-size:12.5px;color:#1e293b}
.hd-dd button:hover,.hd-dd button.on{background:#f1f5f9}
.hd-dd small{display:block;color:#94a3b8;font-size:11px}
.hd-dd svg{color:var(--primary);flex:0 0 auto}
.hd-right{display:flex;align-items:center;gap:10px}
.hd-btn{border:0;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;transition:filter .15s,transform .15s;text-decoration:none;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.hd-btn:hover{filter:brightness(1.07);transform:translateY(-1px)}
.hd-btn.credit{background:#20a8d8}
.hd-btn.wa{background:#fa6f7d}
.hd-btn.out{background:transparent;color:#334155;border:1px solid #ffc107}
.hd-btn.out:hover{background:#ffc107;color:#000}
.hd-user{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;color:#475a7a;margin-left:6px}
.hd-user img{width:36px;height:36px;border-radius:50%;border:1px solid #d9dee8;background:#fff;object-fit:cover}
.hd-mob{display:none;border:0;background:transparent;color:#1b1f3b;cursor:pointer}

/* ---------- rail ---------- */
.hd-rail{position:fixed;top:52px;left:0;bottom:0;width:90px;background:var(--rail-bg);z-index:999;padding-top:18px;overflow-y:auto;overflow-x:hidden;transition:width .25s}
.hd-rail.closed{width:0}
.hd-rail ul{list-style:none;margin:0;padding:0 0 30px;display:flex;flex-direction:column;gap:14px}
.hd-item{position:relative;display:block}
.hd-link{display:flex;flex-direction:column;align-items:center;gap:6px;padding:11px 4px;text-decoration:none;color:#212529;border-radius:5px;border-right:4px solid transparent}
.hd-link svg{font-size:21px}
.hd-ico{position:relative;display:inline-flex}
.hd-badge{position:absolute;top:-8px;right:-14px;background:#fbbf24;color:#111;font-style:normal;font-size:9px;font-weight:800;line-height:1;padding:3px 4px;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.25);animation:hdAI 3s ease-in-out infinite}
/* AI badge: yellow -> green -> red, baar baar (3 sec ka cycle, speed yahan se badlo) */
@keyframes hdAI{0%,26%{background:#fbbf24;color:#111}33%,60%{background:#22c55e;color:#fff}66%,93%{background:#ef4444;color:#fff}100%{background:#fbbf24;color:#111}}
@media(prefers-reduced-motion:reduce){.hd-badge{animation:none}}
.hd-link span.t{font-size:12px;font-weight:700;text-align:center;line-height:1.15}
.hd-link:hover{background:rgba(174,197,216,.35)}
.hd-link.active{background:rgba(174,197,216,.73);border-right-color:#1b75ca}
.hd-tip{position:absolute;top:50%;left:calc(100% + 8px);transform:translateY(-50%);opacity:0;visibility:hidden;background:#111;color:#f5f5f5;padding:7px 12px;border-radius:8px;font-size:12px;white-space:nowrap;transition:opacity .2s;pointer-events:none;z-index:1100}
.hd-tip:before{content:"";position:absolute;left:-6px;top:50%;transform:translateY(-50%);border:6px solid transparent;border-right-color:#111;border-left:0}
.hd-item:hover .hd-tip{opacity:1;visibility:visible}

/* ---------- content + footer ---------- */
.hd-main{margin-top:52px;margin-left:90px;padding:18px 18px 0;transition:margin-left .25s;min-height:calc(100vh - 52px)}
.hd-main.full{margin-left:0}
.hd-foot{text-align:center;font-size:12.5px;color:#212529;padding:22px 10px 14px}
.hd-foot a{color:#0dcaf0;text-decoration:none}
.hd-foot a:hover{text-decoration:underline}

/* ---------- mobile ---------- */
@media(max-width:991px){
  .hd-rail{width:0}
  .hd-main{margin-left:0}
  .hd-burger{display:none}
  .hd-right .hd-btn,.hd-right .hd-user span{display:none}
  .hd-mob{display:flex}
  .hd-pill{width:150px}.hd-pill:focus-within{width:180px}
}
@media(max-width:600px){.hd-search{display:none}.hd-brand{font-size:16px}}
`;

function readUser() {
  try {
    return JSON.parse(sessionStorage.getItem("user"));
  } catch {
    return null;
  }
}

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  const [user, setUser] = useState(readUser);

  /* Inter font */
  useEffect(() => {
    if (document.getElementById("hd-inter")) return;
    const l = document.createElement("link");
    l.id = "hd-inter";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }, []);

  useEffect(() => {
    const fetchCredit = async () => {
      const stored = JSON.parse(sessionStorage.getItem("user"));

      if (!stored?.id) return;

      try {
        const res = await fetch(`${API}/api/get-user/?user_id=${stored.id}`);

        const data = await res.json();

        if (data.credit !== undefined) {
          const updatedUser = {
            ...stored,
            credit: data.credit,
          };

          setUser(updatedUser);

          sessionStorage.setItem("user", JSON.stringify(updatedUser));
        }
      } catch (err) {
        console.log("Credit fetch error:", err);
      }
    };

    // 🔥 FIRST LOAD
    fetchCredit();

    // 🔥 EVERY 3 SEC AUTO UPDATE
    const interval = setInterval(() => {
      fetchCredit();
    }, 3000);

    // 🔥 REALTIME EVENT
    const handleRealtimeCredit = () => {
      fetchCredit();
    };

    window.addEventListener("campaignUpdated", handleRealtimeCredit);

    return () => {
      clearInterval(interval);
      window.removeEventListener("campaignUpdated", handleRealtimeCredit);
    };
  }, []);

  // 🔥 FIX ROLE
  const role = sessionStorage.getItem("role")?.toLowerCase();

  // 🔥 FIX LOGOUT
  const handleLogout = () => {
    sessionStorage.clear();
    navigate("/login");
  };

  /* ---------- rail items ---------- */
  const railItems = [
    { text: "Home", tip: "Products Home", to: "/productshome", icon: FaHouse, isHome: true },
    { text: "Dashboard", tip: "Dashboard", to: "/dashboard", icon: FaTableColumns },
    { text: "Agent", tip: "Agent", to: "/wappagent", icon: FaHeadset, show: user?.role === "admin" },
    { text: "Campaign", tip: "Wapp Campaign", to: "/wappcampaign", icon: FaRegMessage },
    { text: "Config", tip: "Config", to: "/wappconfig", icon: FaSliders },
    { text: "Catalog", tip: "Catalog", to: "/wappcatalog", icon: FaRegImages },
    { text: "Automation", tip: "Automation", to: "/wappautomation", icon: FaRobot, badge: "AI" },
    { text: "Reports", tip: "Wapp Reports", to: "/wappreports", icon: FaChartSimple },
    { text: "Users", tip: "Manage User", to: "/manageuser", icon: FaUsersLine, show: role !== "user" },
    { text: "Payment", tip: "Payment", to: "/wapppayment", icon: FaCreditCard, show: role !== "user" },
    { text: "API", tip: "Product Api", to: "/wappapi", icon: FaGlobe },
  ].filter((i) => i.show === undefined || i.show);

  /* ---------- header search ---------- */
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const box = useRef(null);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return SEARCH_PAGES.filter(
      (p) => (!p.roles || p.roles.includes(role)) && (!p.notRoles || !p.notRoles.includes(role))
    )
      .filter((p) => (p.label + " " + p.sub).toLowerCase().includes(t))
      .slice(0, 7);
  }, [q, role]);

  useEffect(() => {
    const h = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const pick = (r) => {
    setOpen(false);
    setQ("");
    if (r) navigate(r.to);
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") pick(results[idx]);
    if (e.key === "Escape") setOpen(false);
  };

  const name = user?.username || user?.name || "User";

  return (
    <div className="hd-root">
      <style>{CSS}</style>

      {/* ================= TOP BAR ================= */}
      <header className="hd-top">
        <div className="hd-left">
          <button className="hd-burger" onClick={() => setCollapsed(!collapsed)} title="Toggle menu">
            <IoMenu size={20} />
          </button>

          {/* 🔥 brand click -> Products Home */}
          <button className="hd-brand" onClick={() => navigate("/productshome")} title="Products Home">
            Infra Infotech
          </button>

          <div className="hd-search" ref={box}>
            <div className="hd-pill">
              <FaMagnifyingGlass />
              <input
                value={q}
                placeholder="Search pages..."
                onChange={(e) => { setQ(e.target.value); setOpen(true); setIdx(0); }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKey}
              />
            </div>
            {open && results.length > 0 && (
              <div className="hd-dd">
                {results.map((r, i) => (
                  <button key={r.to} className={i === idx ? "on" : ""} onMouseEnter={() => setIdx(i)} onClick={() => pick(r)}>
                    <r.icon />
                    <span>{r.label}<small>{r.sub}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT SIDE BUTTONS */}
        <div className="hd-right">
          {/* 🔥 ROLE FIX */}
          {role !== "user" && (
            <Link to="/manageuser" className="hd-btn credit">Credit</Link>
          )}

          <button className="hd-btn wa">WHATSAPP : {user?.credit ?? "∞"}</button>

          <button onClick={handleLogout} className="hd-btn out">
            <FaRightFromBracket /> Log Out
          </button>

          <div className="hd-user">
            <img src={avatar} alt={name} />
            <span>{name}</span>
          </div>

          {/* MOBILE MENU BUTTON */}
          <button className="hd-mob" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu">
            <Bars3Icon className="w-6" style={{ width: 26 }} />
          </button>
        </div>

        {/* MOBILE MENU */}
        <Dialog open={mobileMenuOpen} onClose={setMobileMenuOpen}>
          <DialogPanel className="fixed inset-y-0 right-0 w-full bg-white p-6 text-black" style={{ zIndex: 2000 }}>
            <div className="flex justify-between">
              <h2 className="font-bold">Menu</h2>
              <button onClick={() => setMobileMenuOpen(false)}>
                <XMarkIcon className="w-6" style={{ width: 24 }} />
              </button>
            </div>

            {/* MOBILE LINKS */}
            <div className="mt-6 flex flex-col gap-4" style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
              <NavLink to="/productshome" onClick={() => setMobileMenuOpen(false)} className="text-lg" style={{ fontSize: 18 }}>
                Home
              </NavLink>
              {links
                .filter((item) => {
                  if (
                    (item.to === "/adduser" || item.to === "/manageuser" || item.to === "/wapppayment") &&
                    role === "user"
                  ) {
                    return false;
                  }
                  return true;
                })
                .map((item, i) => (
                  <NavLink key={i} to={item.to} onClick={() => setMobileMenuOpen(false)} className="text-lg" style={{ fontSize: 18 }}>
                    {item.text}
                  </NavLink>
                ))}

              <button onClick={handleLogout} className="text-left text-red-500 mt-4" style={{ textAlign: "left", color: "#ef4444", marginTop: 16 }}>
                Logout
              </button>
            </div>
          </DialogPanel>
        </Dialog>
      </header>

      {/* ================= LEFT RAIL ================= */}
      <aside className={"hd-rail" + (collapsed ? " closed" : "")}>
        <ul>
          {railItems.map((it) => (
            <li className="hd-item" key={it.to}>
              {it.isHome ? (
                <Link to={it.to} className="hd-link">
                  <span className="hd-ico"><it.icon />{it.badge && <i className="hd-badge">{it.badge}</i>}</span>
                  <span className="t">{it.text}</span>
                </Link>
              ) : (
                <NavLink to={it.to} className={({ isActive }) => "hd-link" + (isActive ? " active" : "")}>
                  <span className="hd-ico"><it.icon />{it.badge && <i className="hd-badge">{it.badge}</i>}</span>
                  <span className="t">{it.text}</span>
                </NavLink>
              )}
              <span className="hd-tip">{it.tip}</span>
            </li>
          ))}
        </ul>
      </aside>

      {/* ================= PAGE CONTENT ================= */}
      <main className={"hd-main" + (collapsed ? " full" : "")}>
        <Outlet />

        <footer className="hd-foot">
          <b>Email Id:</b> socialinfrainfotech@gmail.com | <b>Mobile Number :</b> 9004100213 | <b>Infra Infotech</b> -{" "}
          <a href="#privacy" onClick={(e) => e.preventDefault()}>Privacy</a> |{" "}
          <a href="#terms" onClick={(e) => e.preventDefault()}>Terms &amp; Conditions</a>
        </footer>
      </main>
    </div>
  );
}