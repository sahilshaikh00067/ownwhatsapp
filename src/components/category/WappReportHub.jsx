import React, { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FaBullhorn } from "react-icons/fa6";

import campaignActivity from "../../assets/CampaignActivity.png";
import deliveryStatistics from "../../assets/DeliveryStatistics.png";
import apiCtaReport from "../../assets/ApiCtaReport.png";
import flowReport from "../../assets/FlowReport.png";
import templateReport from "../../assets/TemplateReport.png";

/* =====================================================================
   WappReportHub.jsx  –  Sidebar "Report" click karne par ye page khulta hai
   Route: /wappreports
   5 cards: Campaign Activity (ready) + 4 aur (jinke pages baad me banenge)
   ===================================================================== */

const REPORTS = [
  {
    key: "campaignactivity",
    title: "Campaign Activity",
    desc: "Daily insights on campaign performance here.",
    img: campaignActivity,
    to: "/wappreports/campaignactivity", // ✅ page ready
  },
  {
    key: "deliverystatistics",
    title: "Delivery Statistics",
    desc: "Analyze message delivery with detailed stats.",
    img: deliveryStatistics,
    to: null, // page banne par yaha route daal dena, jaise "/wappreports/deliverystatistics"
  },
  {
    key: "ctareport",
    title: "API CTA Report",
    desc: "Track messaging with WhatsAPP API report.",
    img: apiCtaReport,
    to: null,
  },
  {
    key: "flowreport",
    title: "Flow Report",
    desc: "Track and analyze WhatsApp flow executions and performance.",
    img: flowReport,
    to: null,
  },
  {
    key: "templatereport",
    title: "Template Report",
    desc: "Track and analyze Template executions and performance.",
    img: templateReport,
    to: null,
  },
];

const CSS = `
.rh{--card-w:260px;--card-h:200px;--gap:24px;--p:#448c74;  /* <-- box ki width / height / gap yahan se badlo */
font-family:'Inter',system-ui,sans-serif;color:#475569}
.rh *{box-sizing:border-box}
.rh-note{height:26px;overflow:hidden;position:relative;font-size:12px;color:#dc2626;margin-bottom:8px}
.rh-note-in{position:absolute;white-space:nowrap;top:4px;animation:rhMarq 30s linear infinite}
@keyframes rhMarq{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

.rh-card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.05);padding:16px 16px 6px}
.rh-title{margin:0;font-size:1rem;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px}
.rh-title svg{font-size:1rem}
.rh-hr{border:0;border-top:1px solid rgba(0,0,0,.1);margin:12px 0 16px}
.rh-grid{display:flex;flex-wrap:wrap;gap:var(--gap);padding:0 0 20px}
.rh-wrap{transition:transform .4s ease;transform-style:preserve-3d;border-radius:20px}
.rh-wrap:hover{transform:rotateX(12deg) rotateY(-12deg)}
.rh-btn{width:var(--card-w);height:var(--card-h);padding:30px 14px 12px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;border:0;border-radius:20px;background:#f8f9fa;cursor:pointer;text-align:center;
  transform-style:preserve-3d;transition:all .3s ease-in-out;font-family:inherit;
  box-shadow:0 12px 24px rgba(0,0,0,.2),0 6px 10px rgba(0,0,0,.1)}
.rh-btn:active{transform:scale(.97) translateY(2px);box-shadow:0 5px 10px rgba(0,0,0,.15)}
.rh-btn:focus-visible{outline:3px solid rgba(68,140,116,.5);outline-offset:3px}
.rh-icon{margin-bottom:12px}
.rh-icon img{width:72px;height:72px;object-fit:contain}
.rh-name{font-size:1.12rem;font-weight:600;line-height:23px;color:#212529}
.rh-desc{font-size:14px;color:#212529;margin:4px 0 0;line-height:1.45}
.rh-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:3000;box-shadow:0 8px 24px rgba(0,0,0,.3)}
@media(max-width:600px){.rh-grid{justify-content:center}}
@media(prefers-reduced-motion:reduce){.rh-note-in{animation:none;position:static}.rh-wrap:hover{transform:none}}
`;

export default function WappReportHub() {
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const open = useCallback(
    (r) => {
      if (r.to) return navigate(r.to);
      setToast(`${r.title} ka page abhi banana baaki hai`);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 2500);
    },
    [navigate]
  );

  return (
    <div className="rh">
      <style>{CSS}</style>

      <div className="rh-note">
        <div className="rh-note-in">
          <b>NOTE =</b> All campaigns will be delivered Between 10A.M to 6P.M - (Monday to Saturday) on working days.
        </div>
      </div>

      <div className="rh-card">
        <h6 className="rh-title" style={{ color: "#0f172a" }}>
          <FaBullhorn /> Campaign Report
        </h6>
        <hr className="rh-hr" />

        <div className="rh-grid">
          {REPORTS.map((r) => (
            <div className="rh-wrap" key={r.key}>
              <button type="button" className="rh-btn" onClick={() => open(r)}>
                <div className="rh-icon">
                  <img src={r.img} alt={r.title} draggable={false} />
                </div>
                <div className="rh-name">{r.title}</div>
                <p className="rh-desc">{r.desc}</p>
              </button>
            </div>
          ))}
        </div>
      </div>

      {toast && <div className="rh-toast" role="status">{toast}</div>}
    </div>
  );
}