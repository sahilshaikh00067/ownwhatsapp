import React, { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FaBullhorn } from "react-icons/fa6";

import manageCatalog from "../../assets/ManageCatalog.png";
import catalogActivity from "../../assets/CatalogActivity.png";

/* =====================================================================
   WappCatalogHub.jsx  –  Sidebar "Catalog" click karne par ye page khulta hai
   Route: /wappcatalog
   Section "Commerce": Manage Catalog + Catalog Activity

   Har box ka `to` abhi null hai (pages baad me banenge). Jab page ban jaye to
   `to: "/wappcatalog/manage"` jaisa route daal do, click par wahi khulega.
   ===================================================================== */

const SECTIONS = [
  {
    title: "Commerce",
    items: [
      { key: "manage", title: "Manage Catalog", desc: "View and Manage Catalog.", img: manageCatalog, to: null },
      { key: "activity", title: "Catalog Activity", desc: "View and Manage Catalog Activity.", img: catalogActivity, to: null },
    ],
  },
];

const CSS = `
.ch{--card-w:260px;--card-h:190px;--gap:24px;--p:#448c74;  /* <-- box ki width / height / gap yahan se badlo */
  font-family:'Inter',system-ui,sans-serif;color:#475569;display:flex;flex-direction:column;gap:22px}
.ch *{box-sizing:border-box}
.ch-note{height:26px;overflow:hidden;position:relative;font-size:12px;color:#dc2626;margin-bottom:-8px}
.ch-note-in{position:absolute;white-space:nowrap;top:4px;animation:chMarq 30s linear infinite}
@keyframes chMarq{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

.ch-card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.05);padding:16px 16px 6px}
.ch-title{margin:0;font-size:1rem;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px}
.ch-title svg{font-size:1rem}
.ch-hr{border:0;border-top:1px solid rgba(0,0,0,.1);margin:12px 0 16px}
.ch-grid{display:flex;flex-wrap:wrap;gap:var(--gap);padding:0 0 20px}
.ch-wrap{transition:transform .4s ease;transform-style:preserve-3d;border-radius:20px}
.ch-wrap:hover{transform:rotateX(12deg) rotateY(-12deg)}
.ch-btn{width:var(--card-w);height:var(--card-h);padding:30px 14px 12px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  border:0;border-radius:20px;background:#f8f9fa;cursor:pointer;text-align:center;transform-style:preserve-3d;transition:all .3s ease-in-out;font-family:inherit;
  box-shadow:0 12px 24px rgba(0,0,0,.2),0 6px 10px rgba(0,0,0,.1)}
.ch-btn:active{transform:scale(.97) translateY(2px);box-shadow:0 5px 10px rgba(0,0,0,.15)}
.ch-btn:focus-visible{outline:3px solid rgba(68,140,116,.5);outline-offset:3px}
.ch-icon{margin-bottom:12px}
.ch-icon img{width:72px;height:72px;object-fit:contain}
.ch-name{font-size:1.12rem;font-weight:600;line-height:23px;color:#212529}
.ch-desc{font-size:14px;color:#212529;margin:4px 0 0;line-height:1.45}
.ch-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:3000;box-shadow:0 8px 24px rgba(0,0,0,.3)}
@media(max-width:600px){.ch-grid{justify-content:center}}
@media(prefers-reduced-motion:reduce){.ch-note-in{animation:none;position:static}.ch-wrap:hover{transform:none}}
`;

export default function WappCatalogHub() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const open = useCallback(
    (item) => {
      if (item.to) return navigate(item.to);
      setToast(`${item.title} ka page abhi banana baaki hai`);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 2500);
    },
    [navigate]
  );

  return (
    <div className="ch">
      <style>{CSS}</style>

      <div className="ch-note">
        <div className="ch-note-in">
          <b>NOTE =</b> All campaigns will be delivered Between 10A.M to 6P.M - (Monday to Saturday) on working days.
        </div>
      </div>

      {SECTIONS.map((sec) => (
        <div className="ch-card" key={sec.title}>
          <h6 className="ch-title">
            <FaBullhorn /> {sec.title}
          </h6>
          <hr className="ch-hr" />

          <div className="ch-grid">
            {sec.items.map((it) => (
              <div className="ch-wrap" key={it.key}>
                <button type="button" className="ch-btn" onClick={() => open(it)}>
                  <div className="ch-icon">
                    <img src={it.img} alt={it.title} draggable={false} />
                  </div>
                  <div className="ch-name">{it.title}</div>
                  <p className="ch-desc">{it.desc}</p>
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {toast && <div className="ch-toast" role="status">{toast}</div>}
    </div>
  );
}