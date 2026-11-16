import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE, providerRequest } from "../../utils/providerApi";

const NAV = [
  ["overview", "Overview"], ["integrations", "Integrations"], ["templates", "Templates"],
  ["channels", "Channels"], ["messaging", "Messaging"], ["media", "Media"], ["webhooks", "Webhooks"],
];
const blankTemplate = { name: "", category: "MARKETING", language: "en", components: [] };
const messageExample = { messaging_product: "whatsapp", type: "text", text: { body: "Hello" } };

const styles = `
.pi{--green:#15866d;--ink:#172b4d;--muted:#64748b;--line:#e2e8f0;--wash:#f7faf9;color:var(--ink);font-family:Inter,system-ui,Arial,sans-serif;padding:8px 8px 34px}
.pi *{box-sizing:border-box}.pi-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin:6px 0 22px}.pi h1{font-size:26px;margin:0 0 6px}.pi h2{font-size:19px;margin:0 0 14px}.pi p{color:var(--muted);line-height:1.5;margin:5px 0 12px}.pi-actions{display:flex;gap:9px;flex-wrap:wrap}.pi button,.pi a.btn{border:0;border-radius:8px;background:var(--green);color:#fff;padding:10px 14px;font:600 13px inherit;cursor:pointer;text-decoration:none}.pi button.secondary,.pi a.secondary{background:#edf4f1;color:#226452}.pi button.danger{background:#a83b3b}.pi button:disabled{opacity:.55;cursor:wait}.pi .frame{background:#fff;border:1px solid var(--line);border-radius:13px;padding:18px;margin-bottom:14px;box-shadow:0 3px 12px #173b2810}.pi .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:13px}.pi .metric{font-size:25px;font-weight:700;margin:8px 0;color:#1e735f}.pi .muted{color:var(--muted);font-size:13px}.pi .badge{display:inline-block;padding:5px 9px;border-radius:999px;background:#e6f5ed;color:#20734f;font-size:12px;font-weight:700}.pi .badge.off{background:#fff4df;color:#915f0a}.pi .nav{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px}.pi .nav button{background:#f1f5f9;color:#475569}.pi .nav button.active{background:var(--green);color:white}.pi label{display:block;font-size:12px;font-weight:700;color:#334155;margin:9px 0 5px}.pi input,.pi select,.pi textarea{width:100%;border:1px solid #cbd5e1;border-radius:7px;padding:9px 10px;color:#15243a;background:white;font:13px inherit}.pi textarea{min-height:150px;font:12px/1.5 ui-monospace,Consolas,monospace}.pi .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.pi pre{max-height:420px;overflow:auto;background:#0f1b2d;color:#d7e4ef;border-radius:9px;padding:14px;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}.pi .notice{padding:11px 13px;border-radius:8px;background:#fff5e4;color:#79530c;margin:12px 0;font-size:13px}.pi .error{padding:11px 13px;border-radius:8px;background:#fff0f0;color:#9f2f2f;margin:12px 0;font-size:13px}.pi table{width:100%;border-collapse:collapse;font-size:13px}.pi th,.pi td{text-align:left;padding:9px;border-bottom:1px solid var(--line);vertical-align:top}.pi th{font-size:11px;color:#64748b;text-transform:uppercase}.pi .scroll{overflow:auto}.pi code{font-size:12px;background:#eef2f7;padding:2px 5px;border-radius:4px}.pi .toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.pi .toolbar>div{min-width:130px;flex:1}.pi .small{font-size:11px;color:var(--muted)}@media(max-width:640px){.pi{padding:4px}.pi-head{display:block}.pi-head .pi-actions{margin-top:12px}}
`;

function pretty(value) { return JSON.stringify(value, null, 2); }
function parseObject(raw, label) {
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error(`${label} must be valid JSON.`); }
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`${label} must be a JSON object.`);
  return value;
}

export default function ProviderIntegrations() {
  const [tab, setTab] = useState("overview");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [integration, setIntegration] = useState("clevertap");
  const [integrationPayload, setIntegrationPayload] = useState("{}" );
  const [search, setSearch] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [page, setPage] = useState("1");
  const [limit, setLimit] = useState("50");
  const [templateId, setTemplateId] = useState("");
  const [metaTemplateId, setMetaTemplateId] = useState("");
  const [metaPayload, setMetaPayload] = useState(pretty(blankTemplate));
  const [resourceId, setResourceId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [toNumber, setToNumber] = useState("");
  const [messagePayload, setMessagePayload] = useState(pretty(messageExample));
  const [file, setFile] = useState(null);
  const [syncStart, setSyncStart] = useState("");
  const [syncEnd, setSyncEnd] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [deleteName, setDeleteName] = useState("");

  const run = async (work) => {
    setBusy(true); setError("");
    try { const value = await work(); setResult(value); return value; }
    catch (e) { setError(e.message || "Provider request failed."); return null; }
    finally { setBusy(false); }
  };
  const refreshStatus = async () => {
    const data = await run(() => providerRequest("status/"));
    if (data) setStatus(data);
  };
  useEffect(() => { refreshStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const templates = useMemo(() => {
    const data = result?.data;
    return Array.isArray(data?.templates) ? data.templates : Array.isArray(data?.data?.templates) ? data.data.templates : [];
  }, [result]);

  const fetchWallet = () => run(() => providerRequest("dispatch/", { method: "POST", body: { operation: "balance" } }));
  const runIntegration = () => run(async () => providerRequest("dispatch/", {
    method: "POST", body: { operation: integration, payload: parseObject(integrationPayload, "Payload") },
  }));
  const fetchTemplates = () => {
    const query = new URLSearchParams({ page, limit });
    if (search.trim()) query.set("template_name", search.trim());
    if (filterStartDate) query.set("start_date", filterStartDate);
    if (filterEndDate) query.set("end_date", filterEndDate);
    return run(() => providerRequest(`templates/?${query.toString()}`));
  };
  const syncTemplates = () => run(() => providerRequest("templates/sync/", {
    method: "POST", body: { ...(syncStart && { startDate: syncStart }), ...(syncEnd && { endDate: syncEnd }) },
  })).then((value) => { if (value) refreshStatus(); });
  const getTemplate = () => run(() => providerRequest(`templates/${encodeURIComponent(templateId)}/`));
  const getMetaTemplates = () => run(() => providerRequest("meta/templates/?limit=50"));
  const createMetaTemplate = () => run(() => providerRequest("meta/templates/", {
    method: "POST", body: { payload: parseObject(metaPayload, "Template payload") },
  }));
  const editMetaTemplate = () => run(() => providerRequest(`meta/template/${encodeURIComponent(metaTemplateId)}/`, {
    method: "POST", body: { payload: parseObject(metaPayload, "Template payload") },
  }));
  const deleteMetaTemplate = () => {
    if (!window.confirm(`Delete provider template ${deleteName}?`)) return;
    const query = new URLSearchParams({ hsm_id: deleteId, name: deleteName });
    run(() => providerRequest(`meta/templates/?${query}`, { method: "DELETE" }));
  };
  const getResource = () => {
    const suffix = phoneNumberId.trim() ? `?phone_number_id=${encodeURIComponent(phoneNumberId.trim())}` : "";
    return run(() => providerRequest(`meta/resource/${encodeURIComponent(resourceId)}/${suffix}`));
  };
  const getChannels = () => run(() => providerRequest("meta/channels/"));
  const sendMessage = () => run(() => providerRequest("meta/messages/", {
    method: "POST", body: { to_number: toNumber.trim(), payload: parseObject(messagePayload, "Message payload") },
  }));
  const uploadMedia = () => file ? run(() => providerRequest("meta/media/", { method: "POST", file })) : setError("Choose a media file first.");
  const sendWebhook = () => run(() => providerRequest("dispatch/", {
    method: "POST", body: { operation: "webhook", payload: parseObject(integrationPayload, "Webhook payload") },
  }));

  return (
    <div className="pi">
      <style>{styles}</style>
      <header className="pi-head">
        <div><h1>Provider API integrations</h1><p>Use the server configured WABOX account from the Omni Channel Panel.</p></div>
        <div className="pi-actions"><button className="secondary" onClick={refreshStatus} disabled={busy}>Refresh status</button><Link className="btn secondary" to="/wappapi">API documentation</Link></div>
      </header>
      <nav className="nav" aria-label="Provider API sections">
        {NAV.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setError(""); }}>{label}</button>)}
      </nav>
      {error && <div className="error" role="alert">{error}</div>}

      {tab === "overview" && <>
        <div className="grid">
          <section className="frame"><h2>Provider connection</h2><span className={`badge ${status?.configured ? "" : "off"}`}>{status?.configured ? "Credential configured" : "Credential missing"}</span><p>Provider: {status?.provider || "WABOX"}</p><p className="small">{status?.base_url || "Checking provider settings…"}</p><p>Meta identifiers: <b>{status?.meta_configured ? "Configured" : "Incomplete"}</b></p></section>
          <section className="frame"><h2>Wallet balance</h2><div className="metric">{result?.operation === "balance" ? pretty(result.data) : "—"}</div><button onClick={fetchWallet} disabled={busy}>Get wallet balance</button></section>
          <section className="frame"><h2>Template sync</h2><span className={`badge ${status?.templates_sync_status === "success" ? "" : "off"}`}>{status?.templates_sync_status || "Not synced"}</span><p className="small">Last sync: {status?.templates_last_synced_at || "Never"}</p><button onClick={() => setTab("templates")}>Open templates</button></section>
        </div>
        {!status?.configured && <div className="notice">Set <code>WBOX_API_TOKEN</code> on the Django server. Meta operations also need the version, WABA ID, and phone number ID environment variables. Values stay on the server.</div>}
        <section className="frame"><h2>Recent provider response</h2><p>Requests are recorded with operation and status metadata; payloads and bearer credentials are not stored.</p>{result && <pre>{pretty(result)}</pre>}</section>
      </>}

      {tab === "integrations" && <section className="frame">
        <h2>Marketing platform connectors</h2><p>Run the documented CleverTap, MoEngage, or WebEngage endpoint. Provider specific JSON schemas are not included in the source document.</p>
        <div className="row"><div><label>Connector</label><select value={integration} onChange={(e) => setIntegration(e.target.value)}><option value="clevertap">CleverTap WhatsApp</option><option value="moengage">MoEngage WhatsApp</option><option value="webengage">WebEngage WhatsApp</option></select></div><div><label>JSON request</label><textarea value={integrationPayload} onChange={(e) => setIntegrationPayload(e.target.value)} /></div></div>
        <div className="pi-actions"><button onClick={runIntegration} disabled={busy}>Call connector</button></div>
        <div className="notice">The provider documentation omits the required body schema for these three calls. Use the payload defined by your connector account.</div>
      </section>}

      {tab === "templates" && <>
        <section className="frame"><h2>Synced template library</h2><div className="toolbar"><div><label>Template name</label><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" /></div><div><label>Start date</label><input type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} /></div><div><label>End date</label><input type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} /></div><div><label>Page</label><input type="number" min="1" value={page} onChange={(e) => setPage(e.target.value)} /></div><div><label>Limit</label><input type="number" min="1" max="200" value={limit} onChange={(e) => setLimit(e.target.value)} /></div><button onClick={fetchTemplates} disabled={busy}>Load templates</button></div>
          <div className="toolbar" style={{ marginTop: 12 }}><div><label>Sync from</label><input type="datetime-local" value={syncStart} onChange={(e) => setSyncStart(e.target.value)} /></div><div><label>Sync through</label><input type="datetime-local" value={syncEnd} onChange={(e) => setSyncEnd(e.target.value)} /></div><button className="secondary" onClick={syncTemplates} disabled={busy}>Sync templates</button></div>
          {templates.length > 0 && <div className="scroll"><table><thead><tr><th>Name</th><th>Language</th><th>Category</th><th>State</th><th>Action</th></tr></thead><tbody>{templates.map((template) => <tr key={template.id}><td>{template.name}</td><td>{template.language}</td><td>{template.category_name}</td><td>{template.state}</td><td><button className="secondary" onClick={() => { setTemplateId(String(template.id)); run(() => providerRequest(`templates/${encodeURIComponent(template.id)}/`)); }}>Details</button></td></tr>)}</tbody></table></div>}
        </section>
        <section className="frame"><h2>Meta template operations</h2><div className="pi-actions"><button onClick={getMetaTemplates} disabled={busy}>List Meta templates</button></div>
          <div className="row"><div><label>Template ID for detail</label><input value={templateId} onChange={(e) => setTemplateId(e.target.value)} /><button className="secondary" style={{ marginTop: 7 }} onClick={getTemplate} disabled={busy || !templateId}>Get template detail</button></div><div><label>Template ID for edit</label><input value={metaTemplateId} onChange={(e) => setMetaTemplateId(e.target.value)} /></div></div>
          <label>Template JSON</label><textarea value={metaPayload} onChange={(e) => setMetaPayload(e.target.value)} />
          <div className="pi-actions" style={{ marginTop: 9 }}><button onClick={createMetaTemplate} disabled={busy}>Create Meta template</button><button className="secondary" onClick={editMetaTemplate} disabled={busy || !metaTemplateId}>Edit Meta template</button></div>
          <div className="row" style={{ marginTop: 12 }}><div><label>Template hsm_id</label><input value={deleteId} onChange={(e) => setDeleteId(e.target.value)} /></div><div><label>Template name</label><input value={deleteName} onChange={(e) => setDeleteName(e.target.value)} /></div><div style={{ alignSelf: "end" }}><button className="danger" onClick={deleteMetaTemplate} disabled={busy || !deleteId || !deleteName}>Delete Meta template</button></div></div>
          <div className="row" style={{ marginTop: 12 }}><div><label>Template or media ID</label><input value={resourceId} onChange={(e) => setResourceId(e.target.value)} /></div><div><label>phone_number_id (media lookup)</label><input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} /></div><div style={{ alignSelf: "end" }}><button className="secondary" onClick={getResource} disabled={busy || !resourceId}>Get template or media by ID</button></div></div>
        </section>
      </>}

      {tab === "channels" && <section className="frame"><h2>WhatsApp channels</h2><p>Fetch channels associated with the server configured WABA.</p><button onClick={getChannels} disabled={busy}>Load channels</button></section>}

      {tab === "messaging" && <section className="frame"><h2>Send WhatsApp message</h2><p>This sends a provider API request from the configured phone number ID.</p><label>Recipient phone number</label><input value={toNumber} onChange={(e) => setToNumber(e.target.value)} placeholder="International format, e.g. 919000000000" /><label>Message JSON</label><textarea value={messagePayload} onChange={(e) => setMessagePayload(e.target.value)} /><div className="pi-actions" style={{ marginTop: 9 }}><button onClick={sendMessage} disabled={busy || !toNumber.trim()}>Send message</button></div><div className="notice">A live request may deliver a real message. Use a provider sandbox and test recipient.</div></section>}

      {tab === "media" && <section className="frame"><h2>Upload WhatsApp media</h2><p>Allowed: JPEG, PNG, WebP, AVIF, MP4, MPEG audio, OGG audio, PDF. Maximum size: 16 MiB.</p><label>Choose media</label><input type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,audio/mpeg,audio/ogg,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /><p className="small">{file ? `${file.name} · ${Math.ceil(file.size / 1024)} KiB` : "No file selected"}</p><button onClick={uploadMedia} disabled={busy || !file}>Upload media</button></section>}

      {tab === "webhooks" && <>
        <section className="frame"><h2>Provider webhook API</h2><p>Send a JSON payload to the documented provider webhook endpoint.</p><label>Webhook JSON payload</label><textarea value={integrationPayload} onChange={(e) => setIntegrationPayload(e.target.value)} /><div className="pi-actions" style={{ marginTop: 9 }}><button onClick={sendWebhook} disabled={busy}>Call provider webhook</button></div></section>
        <section className="frame"><h2>Inbound callback receiver</h2><p>Configure your provider callback to this Django URL and set the same random shared secret on the server as <code>WBOX_WEBHOOK_SECRET</code>.</p><pre>{`${API_BASE}/api/provider/webhook/inbound/`}</pre><p className="small">The receiver validates the bearer secret and stores only event ID/type metadata, not webhook bodies that may contain message content.</p></section>
      </>}

      {result && <section className="frame"><h2>Last provider response</h2><pre>{pretty(result)}</pre></section>}
      {busy && <p className="muted" aria-live="polite">Request in progress…</p>}
    </div>
  );
}

