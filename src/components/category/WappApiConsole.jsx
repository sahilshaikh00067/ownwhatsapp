import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/* =====================================================================
   WappApiConsole.jsx  –  Sidebar "API" click karne par ye FULL PAGE khulta hai
   Route: /wappapi          (default: WhatsApp API)
          /wappapi?api=sms  (config neeche API_CONFIG me)

   Ye page RapiDoc (swagger viewer) se banta hai — original console page jaisa:
   header (back, logo, title) + left menu (Filter/Search, API Servers,
   Authentication, Operations) + right side docs + "Try" + curl.

   📄 API ka sab data swagger.json file se aata hai. File yahan chahiye:
        public/swagger/whatsapp/swagger.json        (URL: /swagger/whatsapp/swagger.json)
   File nahi mili to page par steps dikhte hain (neeche SPEC_FALLBACK_BASE bhi try hota hai).
   ===================================================================== */

const RAPIDOC_SRC = "https://unpkg.com/rapidoc@9.3.8/dist/rapidoc-min.js";

// Local file nahi mili to is server se try karega (CORS allow ho tabhi chalega)
const SPEC_FALLBACK_BASE = "https://wbbox.infrainfotech.com";

const API_CONFIG = {
  whatsapp: { title: "WhatsApp API Console", color: "#22c55e" },
  sms: { title: "SMS API Console", color: "#3b82f6" },
  rcs: { title: "RCS API Console", color: "#f97316" },
  voice: { title: "Voice API Console", color: "#22c55e" },
  ivr: { title: "Ivr API Console", color: "#22c55e" },
  tts: { title: "Tts API Console", color: "#22c55e" },
  ctc: { title: "Ctc API Console", color: "#22c55e" },
  journey: { title: "Journey API Console", color: "#038cfc" },
  "webenage-sms": { title: "WebEngage - SMS API", color: "#8b5cf6" },
  "webenage-rcs": { title: "WebEngage - RCS API", color: "#8b5cf6" },
  "webenage-whatsapp": { title: "WebEngage - WhatsApp API", color: "#8b5cf6" },
  "clevertap-sms": { title: "CleverTap - SMS API", color: "#10b981" },
  "clevertap-rcs": { title: "CleverTap - RCS API", color: "#10b981" },
  "clevertap-whatsapp": { title: "CleverTap - WhatsApp API", color: "#10b981" },
  apis: { title: "Single Sending API Console", color: "#0ea5e9" },
  global: { title: "Global SMS API Console", color: "#0284c7" },
  ai: { title: "AI API Console", color: "#8b5cf6" },
};

const specPath = (api) => `/swagger/${api}/swagger.json`;

// RapiDoc script sirf ek baar load hota hai
let rapidocPromise = null;
function loadRapiDoc() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.customElements?.get("rapi-doc")) return Promise.resolve();
  if (!rapidocPromise) {
    rapidocPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.type = "module";
      s.src = RAPIDOC_SRC;
      s.onload = () => resolve();
      s.onerror = () => {
        rapidocPromise = null;
        reject(new Error("RapiDoc script load nahi hui (internet / unpkg check karo)."));
      };
      document.head.appendChild(s);
    }).then(() => window.customElements.whenDefined("rapi-doc"));
  }
  return rapidocPromise;
}

// Pehle local, phir fallback server — jo valid swagger/openapi JSON de wahi use hoga
async function fetchSpec(api) {
  const candidates = [specPath(api), `${SPEC_FALLBACK_BASE}${specPath(api)}`];
  const tried = [];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) { tried.push(`${url}  →  HTTP ${res.status}`); continue; }
      const json = await res.json(); // SPA fallback (index.html) yahan fail hoga
      if (json && (json.openapi || json.swagger)) return { spec: json, url, tried };
      tried.push(`${url}  →  valid swagger JSON nahi hai`);
    } catch (e) {
      tried.push(`${url}  →  ${e?.message || "request fail"}`);
    }
  }
  return { spec: null, url: null, tried };
}

const CSS = `
.ac{position:fixed;inset:0;display:flex;flex-direction:column;background:#f8fafc;z-index:50;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
.ac *{box-sizing:border-box}
.ac-bar{background:linear-gradient(135deg,#ffffff 0%,#f1f5f9 100%);border-bottom:1px solid #e2e8f0;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,.05);flex:0 0 auto}
.ac-left{display:flex;align-items:center;gap:16px}
.ac-back{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;color:#64748b;cursor:pointer;transition:all .2s;flex-shrink:0;padding:0}
.ac-back:hover{border-color:var(--c);color:var(--c);box-shadow:0 2px 8px rgba(15,23,42,.08)}
.ac-back svg{width:18px;height:18px}
.ac-logo-wrap{display:flex;align-items:center;gap:12px;cursor:pointer}
.ac-logo{width:40px;height:40px;background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:20px;box-shadow:0 2px 8px rgba(34,197,94,.25)}
.ac-titles{display:flex;flex-direction:column}
.ac-title{font-size:20px;font-weight:600;color:#0f172a;line-height:1.2}
.ac-sub{font-size:13px;color:#64748b;font-weight:400}
.ac-body{flex:1 1 auto;min-height:0;background:#fff;position:relative}
.ac-body rapi-doc{display:block;height:100%;width:100%}
.ac-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}
.ac-spin{width:38px;height:38px;border:4px solid #e2e8f0;border-top-color:var(--c);border-radius:50%;animation:acSpin .8s linear infinite}
@keyframes acSpin{to{transform:rotate(360deg)}}
.ac-card{max-width:640px;width:100%;border:1px solid #e2e8f0;border-radius:14px;padding:26px 28px;background:#fff;box-shadow:0 8px 28px rgba(15,23,42,.06)}
.ac-card h3{margin:0 0 6px;font-size:18px;color:#0f172a}
.ac-card p{margin:0 0 10px;font-size:13.5px;color:#475569;line-height:1.55}
.ac-card ol{margin:0 0 14px;padding-left:20px;font-size:13.5px;color:#334155;line-height:1.7}
.ac-card code{background:#f1f5f9;border-radius:5px;padding:1px 6px;font-size:12.5px;word-break:break-all}
.ac-tried{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:11.5px;color:#64748b;white-space:pre-wrap;word-break:break-all;margin-bottom:16px;font-family:ui-monospace,Menlo,Consolas,monospace}
.ac-btns{display:flex;gap:10px}
.ac-btn{border:1px solid var(--c);background:var(--c);color:#fff;border-radius:8px;padding:9px 18px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit}
.ac-btn.ghost{background:#fff;color:var(--c)}
.ac-btn:hover{filter:brightness(1.07)}
@media(max-width:768px){.ac-bar{padding:12px 16px}.ac-title{font-size:17px}}
`;

export default function WappApiConsole() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const apiKey = (params.get("api") || "whatsapp").toLowerCase();
  const config = API_CONFIG[apiKey] || API_CONFIG.whatsapp;
  const api = API_CONFIG[apiKey] ? apiKey : "whatsapp";

  const [status, setStatus] = useState("loading"); // loading | ready | missing | error
  const [message, setMessage] = useState("");
  const [tried, setTried] = useState([]);
  const [spec, setSpec] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const docRef = useRef(null);

  useEffect(() => {
    const prev = document.title;
    document.title = config.title;
    return () => { document.title = prev; };
  }, [config.title]);

  // RapiDoc script + spec file dono load karo
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setSpec(null);

    (async () => {
      try {
        await loadRapiDoc();
      } catch (e) {
        if (!cancelled) { setStatus("error"); setMessage(e.message); }
        return;
      }
      const result = await fetchSpec(api);
      if (cancelled) return;
      if (!result.spec) {
        setTried(result.tried);
        setStatus("missing");
        return;
      }
      setSpec(result.spec);
      setStatus("ready");
    })();

    return () => { cancelled = true; };
  }, [api, attempt]);

  // spec ko RapiDoc me daalo
  useEffect(() => {
    if (status !== "ready" || !spec) return;
    const el = docRef.current;
    if (el && typeof el.loadSpec === "function") el.loadSpec(spec);
  }, [status, spec]);

  const goBack = useCallback(() => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/dashboard");
  }, [navigate]);

  const docEl = useMemo(
    () =>
      React.createElement("rapi-doc", {
        key: api,
        ref: docRef,
        "render-style": "focused",
        "show-header": "false",
        "show-method-in-nav-bar": "as-colored-block",
        "allow-try": "true",
        "show-curl-before-try": "true",
        "schema-style": "table",
        theme: "light",
        "bg-color": "#ffffff",
        "text-color": "#0f172a",
        "primary-color": config.color,
        "nav-bg-color": "#f8fafc",
        "nav-text-color": "#334155",
        "nav-hover-bg-color": "#f1f5f9",
        "nav-hover-text-color": "#0f172a",
        "nav-accent-color": config.color,
        "font-size": "default",
        "regular-font": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "api-key-name": "Authorization",
        "api-key-location": "header",
        "schema-expand-level": "1",
        "default-schema-tab": "example",
      }),
    [api, config.color]
  );

  return (
    <div className="ac" style={{ "--c": config.color }}>
      <style>{CSS}</style>

      {/* HEADER BAR */}
      <div className="ac-bar">
        <div className="ac-left">
          <button type="button" className="ac-back" onClick={goBack} title="Go Back" aria-label="Go Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <div className="ac-logo-wrap" onClick={goBack}>
            <div className="ac-logo">C</div>
            <div className="ac-titles">
              <span className="ac-title">{config.title}</span>
              <span className="ac-sub">Cpaas Cloud Platform</span>
            </div>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="ac-body">
        {status === "ready" && docEl}

        {status === "loading" && (
          <div className="ac-state"><div className="ac-spin" aria-label="Loading" /></div>
        )}

        {status === "error" && (
          <div className="ac-state">
            <div className="ac-card">
              <h3>API Console load nahi hui</h3>
              <p>{message}</p>
              <div className="ac-btns">
                <button type="button" className="ac-btn" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
                <button type="button" className="ac-btn ghost" onClick={goBack}>Back</button>
              </div>
            </div>
          </div>
        )}

        {status === "missing" && (
          <div className="ac-state">
            <div className="ac-card">
              <h3>API spec file nahi mili</h3>
              <p>Is page ka saara data (menu, operations, parameters, curl) <code>swagger.json</code> file se aata hai. File add karo:</p>
              <ol>
                <li>Original console me ye URL browser me kholo: <code>{`${SPEC_FALLBACK_BASE}${specPath(api)}`}</code></li>
                <li>Page ko <b>swagger.json</b> naam se save karo (Ctrl + S).</li>
                <li>File ko apne project me rakho: <code>{`public${specPath(api)}`}</code></li>
                <li>Page refresh karo (ya Retry dabao).</li>
              </ol>
              <div className="ac-tried">{tried.join("\n")}</div>
              <div className="ac-btns">
                <button type="button" className="ac-btn" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
                <button type="button" className="ac-btn ghost" onClick={goBack}>Back</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}