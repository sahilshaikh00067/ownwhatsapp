import React, { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Label,
} from "recharts";
import {
  FaPaperPlane,
  FaCircleCheck,
  FaPercent,
  FaTriangleExclamation,
  FaCalendarDay,
  FaClockRotateLeft,
  FaCalendarWeek,
  FaChartLine,
  FaChartColumn,
  FaCalendarDays,
} from "react-icons/fa6";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const API = "https://ownwhatsapp-backend-django.onrender.com";
const FILTERS = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "Custom Range"];
// chart colors (Omni App theme)
const C_TOTAL = "#448c74";
const C_ACTIVE = "#0dcaf0";
const C_ERROR = "#ef4444";

// ─────────────────────────────────────────────
// HELPERS (stable — defined outside component)  [ORIGINAL LOGIC]
// ─────────────────────────────────────────────
function passesFilter(isoDate, filter, fromDate, toDate) {
  // Django returns UTC ISO strings — convert to local for correct date comparison
  const d   = new Date(isoDate);
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
    case "Custom Range": {
      if (!fromDate || !toDate) return true;
      const from = new Date(fromDate);
      const to   = new Date(toDate);
      to.setHours(23, 59, 59, 999); // inclusive end-of-day
      return d >= from && d <= to;
    }
    default:
      return true;
  }
}

function tally(reports) {
  return reports.reduce(
    (acc, r) => ({
      total:   acc.total   + (r.total   || 0),
      success: acc.success + (r.success || 0),
      failed:  acc.failed  + (r.failed  || 0),
    }),
    { total: 0, success: 0, failed: 0 }
  );
}

// ─────────────────────────────────────────────
// NEW UI HELPERS
// ─────────────────────────────────────────────
const nf = (n) => Number(n || 0).toLocaleString("en-IN");
const pct = (v, t) => (t > 0 ? (v / t) * 100 : 0);
const fmtDay = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function rangeLabel(filter, fromDate, toDate) {
  const now = new Date();
  switch (filter) {
    case "Today":
      return fmtDay(now);
    case "Yesterday": {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return fmtDay(y);
    }
    case "Last 7 Days": {
      const p = new Date(now); p.setDate(p.getDate() - 7);
      return `${fmtDay(p)} - ${fmtDay(now)}`;
    }
    case "Last 30 Days": {
      const p = new Date(now); p.setDate(p.getDate() - 30);
      return `${fmtDay(p)} - ${fmtDay(now)}`;
    }
    default:
      return fromDate && toDate ? `${fmtDay(new Date(fromDate))} - ${fmtDay(new Date(toDate))}` : "Custom Range";
  }
}

// chart data: Today/Yesterday -> hourly, baaki -> daily
function buildTrend(records, filter, fromDate, toDate) {
  const hourly = filter === "Today" || filter === "Yesterday";
  const base = () => ({ total: 0, success: 0, failed: 0 });
  const rows = [];
  const index = new Map();

  if (hourly) {
    for (let h = 0; h < 24; h++) {
      const label = `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
      index.set(h, rows.length);
      rows.push({ label, ...base() });
    }
    records.forEach((r) => {
      const row = rows[index.get(new Date(r.created_at).getHours())];
      row.total += r.total || 0; row.success += r.success || 0; row.failed += r.failed || 0;
    });
    return rows;
  }

  // daily buckets
  const now = new Date();
  let start; let end = startOfDay(now);
  if (filter === "Last 7 Days") { start = startOfDay(now); start.setDate(start.getDate() - 7); }
  else if (filter === "Last 30 Days") { start = startOfDay(now); start.setDate(start.getDate() - 30); }
  else if (fromDate && toDate) { start = startOfDay(new Date(fromDate)); end = startOfDay(new Date(toDate)); }
  else if (records.length) {
    const ds = records.map((r) => startOfDay(new Date(r.created_at)).getTime());
    start = new Date(Math.min(...ds)); end = new Date(Math.max(...ds));
  } else { start = end; }

  for (let d = new Date(start), n = 0; d <= end && n < 400; d.setDate(d.getDate() + 1), n++) {
    index.set(dayKey(d), rows.length);
    rows.push({ label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), ...base() });
  }
  records.forEach((r) => {
    const i = index.get(dayKey(new Date(r.created_at)));
    if (i === undefined) return;
    rows[i].total += r.total || 0; rows[i].success += r.success || 0; rows[i].failed += r.failed || 0;
  });
  return rows;
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────
const Meta = memo(({ children, center }) => (
  <p className={"wd-meta" + (center ? " center" : "")}>{children}</p>
));

const Progress = memo(({ value }) => (
  <div className="wd-track">
    <div className="wd-bar" style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
  </div>
));

const StatCard = memo(({ icon: Icon, danger, children, meta, progress }) => (
  <div className={"wd-card wd-stat" + (danger ? " danger" : "")}>
    <div className="wd-card-body">
      <div className="wd-row">
        <div className="wd-vals">{children}</div>
        <div className="wd-icon"><Icon /></div>
      </div>
      <Meta>{meta}</Meta>
      <Progress value={progress} />
    </div>
  </div>
));

const Val = ({ value, label }) => (
  <div>
    <span className="wd-val">{value}</span>
    <h6 className="wd-label">{label}</h6>
  </div>
);

const PeriodCard = memo(({ icon: Icon, title, data }) => {
  const rate = pct(data.success, data.total);
  return (
    <div className="wd-card wd-stat">
      <div className="wd-card-body">
        <div className="wd-cat-head">
          <div className="wd-icon sm"><Icon /></div>
          <h6 className="wd-cat-title">{title}</h6>
        </div>
        <div className="wd-cat-vals">
          <Val value={nf(data.total)} label="Total" />
          <div className="wd-div" />
          <Val value={nf(data.success)} label="ACTIVEWA" />
        </div>
        <Meta center>
          <b className="ok">{rate.toFixed(2)}%</b> <span>ACTIVEWA of total</span>
        </Meta>
        <Progress value={rate} />
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
const Dashboard = () => {
  const [showFilter,      setShowFilter]      = useState(false);
  const [selectedFilter,  setSelectedFilter]  = useState("Today");
  const [fromDate,        setFromDate]        = useState("");
  const [toDate,          setToDate]          = useState("");
  const [records,         setRecords]         = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [chartType,       setChartType]       = useState("line");

  const filterRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) setShowFilter(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const userId = sessionStorage.getItem("user_id");
      const res    = await fetch(`${API}/api/get-campaigns/?user_id=${userId}`);
      const data   = await res.json();
      setRecords(Array.isArray(data) ? data.filter((r) => r.created_at) : []);
    } catch (err) {
      console.error("DASHBOARD ERROR:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once + real-time campaign event
  useEffect(() => {
    loadData();
    window.addEventListener("campaignUpdated", loadData);
    return () => window.removeEventListener("campaignUpdated", loadData);
  }, [loadData]);

  const handleFilter = useCallback((f) => {
    setSelectedFilter(f);
    if (f !== "Custom Range") setShowFilter(false);
  }, []);

  // 🔥 original filter + tally
  const filtered = useMemo(
    () => records.filter((r) => passesFilter(r.created_at, selectedFilter, fromDate, toDate)),
    [records, selectedFilter, fromDate, toDate]
  );
  const stats = useMemo(() => tally(filtered), [filtered]);

  // quick period cards (Today / Yesterday / Last 7 Days) — filter se independent
  const periods = useMemo(
    () => ({
      today:     tally(records.filter((r) => passesFilter(r.created_at, "Today"))),
      yesterday: tally(records.filter((r) => passesFilter(r.created_at, "Yesterday"))),
      week:      tally(records.filter((r) => passesFilter(r.created_at, "Last 7 Days"))),
    }),
    [records]
  );

  const trend = useMemo(
    () => buildTrend(filtered, selectedFilter, fromDate, toDate),
    [filtered, selectedFilter, fromDate, toDate]
  );

  const successRate = pct(stats.success, stats.total);
  const errorRate   = pct(stats.failed, stats.total);

  const axis = { fontSize: 12, fill: "#64748b" };
  const common = { data: trend, margin: { top: 10, right: 24, left: 4, bottom: 18 } };
  const grid = <CartesianGrid stroke="#e2e8f0" vertical={false} />;
  const xAxis = (
    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} interval="preserveStartEnd" minTickGap={14}>
      <Label value={selectedFilter === "Today" || selectedFilter === "Yesterday" ? "Time" : "Date"} position="bottom" offset={2} style={{ fill: "#64748b", fontStyle: "italic", fontSize: 12 }} />
    </XAxis>
  );
  const yAxis = (
    <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false}>
      <Label value="Count" angle={-90} position="insideLeft" style={{ fill: "#64748b", fontStyle: "italic", fontSize: 12, textAnchor: "middle" }} />
    </YAxis>
  );
  const legend = <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }} />;
  const tip = <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />;

  return (
    <div className="wd">

      {/* NOTE strip */}
      <div className="wd-note" aria-label="Note">
        <div className="wd-note-in">
          <b>NOTE =</b> All campaigns will be delivered Between 10A.M to 6P.M - (Monday to Saturday)
        </div>
      </div>

      <div className="wd-wrap">

        {/* ───────── TOP 4 CARDS ───────── */}
        <div className="wd-grid g4">
          <StatCard icon={FaPaperPlane} progress={stats.total ? 100 : 0}
            meta={<><b className="ok">{pct(stats.total, stats.total).toFixed(2)}%</b> <span>of total</span></>}>
            <Val value={nf(stats.total)} label="Total" />
          </StatCard>

          <StatCard icon={FaCircleCheck} progress={successRate}
            meta={<><b className="ok">{successRate.toFixed(2)}%</b> <span>of total</span></>}>
            <Val value={nf(stats.success)} label="ACTIVEWA" />
          </StatCard>

          <StatCard icon={FaPercent} progress={successRate}
            meta={<><b className="ok">{filtered.length}</b> <span>{filtered.length === 1 ? "campaign" : "campaigns"} in this period</span></>}>
            <div className="wd-pair">
              <Val value={`${successRate.toFixed(1)}%`} label="Success" />
              <div className="wd-div" />
              <Val value={`${errorRate.toFixed(1)}%`} label="Error" />
            </div>
          </StatCard>

          <StatCard icon={FaTriangleExclamation} danger progress={errorRate}
            meta={<><b className="bad">{errorRate.toFixed(2)}%</b> <span>of total</span></>}>
            <Val value={nf(stats.failed)} label="ERROR" />
          </StatCard>
        </div>

        {/* ───────── PERIOD CARDS ───────── */}
        <div className="wd-grid g3">
          <PeriodCard icon={FaCalendarDay}     title="Today"       data={periods.today} />
          <PeriodCard icon={FaClockRotateLeft} title="Yesterday"   data={periods.yesterday} />
          <PeriodCard icon={FaCalendarWeek}    title="Last 7 Days" data={periods.week} />
        </div>

        {/* ───────── STATUS ANALYTICS ───────── */}
        <div className="wd-card wd-chart">
          <div className="wd-chart-head">
            <div className="wd-chart-left">
              <div className="wd-icon md"><FaChartLine /></div>
              <div>
                <h6 className="wd-chart-title">Status Analytics</h6>
                <span className="wd-chart-sub">Trends across total, ACTIVEWA and error counts</span>
              </div>
            </div>

            <div className="wd-controls">
              {/* date range / filter */}
              <div ref={filterRef} className="wd-rel">
                <button type="button" className="wd-date" onClick={() => setShowFilter((v) => !v)}>
                  <FaCalendarDays /> &nbsp;{rangeLabel(selectedFilter, fromDate, toDate)}
                </button>

                {showFilter && (
                  <div className="wd-filter">
                    {FILTERS.map((f) => (
                      <div key={f} onClick={() => handleFilter(f)} className={"wd-filter-item" + (f === selectedFilter ? " on" : "")}>
                        {f}
                      </div>
                    ))}

                    {selectedFilter === "Custom Range" && (
                      <div className="wd-custom">
                        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                        <span>to</span>
                        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                        <button type="button" onClick={() => setShowFilter(false)}>Apply</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button type="button" title="Line Chart" className={"wd-type" + (chartType === "line" ? " active" : "")} onClick={() => setChartType("line")}>
                <FaChartLine />
              </button>
              <button type="button" title="Bar Chart" className={"wd-type" + (chartType === "bar" ? " active" : "")} onClick={() => setChartType("bar")}>
                <FaChartColumn />
              </button>
            </div>
          </div>

          <div className="wd-chart-body">
            {loading ? (
              <div className="wd-empty">Loading…</div>
            ) : (
              <ResponsiveContainer width="100%" height={430}>
                {chartType === "line" ? (
                  <LineChart {...common}>
                    {grid}{xAxis}{yAxis}{tip}{legend}
                    <Line type="monotone" dataKey="total"   name="Total"    stroke={C_TOTAL}  strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="success" name="ACTIVEWA" stroke={C_ACTIVE} strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="failed"  name="ERROR"    stroke={C_ERROR}  strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                ) : (
                  <BarChart {...common}>
                    {grid}{xAxis}{yAxis}{tip}{legend}
                    <Bar dataKey="total"   name="Total"    fill={C_TOTAL}  radius={[4, 4, 0, 0]} />
                    <Bar dataKey="success" name="ACTIVEWA" fill={C_ACTIVE} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="failed"  name="ERROR"    fill={C_ERROR}  radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .wd{--p:#448c74;--p-rgb:68,140,116;--info:#0dcaf0;--danger:#ef4444;--danger-rgb:239,68,68;--success:#10b981;
          --bg:#fff;--border:rgba(0,0,0,.08);--head:#1e293b;--text:#475569;--muted:#64748b;
          --shadow:0 4px 20px -2px rgba(0,0,0,.05),0 2px 6px -1px rgba(0,0,0,.04);
          --shadow-h:0 14px 28px -4px rgba(var(--p-rgb),.16),0 6px 12px -2px rgba(0,0,0,.05);
          --radius:14px;--tr:all .25s cubic-bezier(.4,0,.2,1);font-family:'Inter',system-ui,sans-serif;color:var(--text)}
        .wd *{box-sizing:border-box}

        /* note strip */
        .wd-note{height:26px;overflow:hidden;position:relative;font-size:12px;color:#dc2626;margin:0 0 6px}
        .wd-note-in{position:absolute;white-space:nowrap;top:4px;animation:wdMarq 30s linear infinite}
        .wd-note-in b{margin-right:4px}
        @keyframes wdMarq{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

        .wd-wrap{display:flex;flex-direction:column;gap:20px;margin-top:12px}
        .wd-grid{display:grid;gap:16px}
        .wd-grid.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
        .wd-grid.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
        @media(max-width:1200px){.wd-grid.g4{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:768px){.wd-grid.g4,.wd-grid.g3{grid-template-columns:1fr}}

        .wd-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);position:relative;overflow:hidden}
        .wd-stat{height:100%;cursor:pointer;transition:var(--tr)}
        .wd-stat:before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--p),rgba(var(--p-rgb),.2));opacity:.85;transition:var(--tr)}
        .wd-stat:hover{transform:translateY(-4px);box-shadow:var(--shadow-h);border-color:rgba(var(--p-rgb),.35)}
        .wd-stat:hover:before{height:4px;opacity:1}
        .wd-stat.danger:before{background:linear-gradient(90deg,var(--danger),rgba(var(--danger-rgb),.2))}
        .wd-stat.danger:hover{border-color:rgba(var(--danger-rgb),.35);box-shadow:0 14px 28px -4px rgba(var(--danger-rgb),.25)}
        .wd-card-body{padding:1.25rem;display:flex;flex-direction:column;justify-content:space-between}

        .wd-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
        .wd-pair{display:flex;align-items:center}
        .wd-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(var(--p-rgb),.12);color:var(--p);font-size:1.25rem;transition:var(--tr);flex-shrink:0}
        .wd-icon.sm{width:38px;height:38px;font-size:1rem}
        .wd-icon.md{width:40px;height:40px;border-radius:10px;font-size:1.1rem}
        .wd-stat:hover .wd-icon{background:var(--p);color:#fff;transform:scale(1.06) rotate(6deg);box-shadow:0 6px 16px rgba(var(--p-rgb),.35)}
        .wd-stat.danger .wd-icon{background:rgba(var(--danger-rgb),.12);color:var(--danger)}
        .wd-stat.danger:hover .wd-icon{background:var(--danger);color:#fff;box-shadow:0 6px 16px rgba(var(--danger-rgb),.35)}

        .wd-val{display:block;font-size:1.65rem;font-weight:700;color:var(--head);line-height:1.2;letter-spacing:-.02em;transition:var(--tr)}
        .wd-stat:hover .wd-val{color:var(--p)}
        .wd-stat.danger .wd-val{color:var(--danger)}
        .wd-label{font-size:.825rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0;padding-top:.25rem}
        .wd-div{width:1px;height:34px;background:var(--border);align-self:center;margin:0 .75rem}

        .wd-meta{font-size:.785rem;font-weight:500;color:var(--muted);display:flex;align-items:center;gap:.35rem;margin:.65rem 0 0}
        .wd-meta.center{justify-content:center;text-align:center}
        .wd-meta .ok{color:var(--success);font-weight:600}
        .wd-meta .bad{color:var(--danger);font-weight:600}
        .wd-track{width:100%;height:4px;background:rgba(var(--p-rgb),.1);border-radius:4px;overflow:hidden;margin-top:.4rem;transition:var(--tr)}
        .wd-stat:hover .wd-track{height:5px}
        .wd-bar{height:100%;background:linear-gradient(90deg,var(--p),var(--info));transition:width .6s ease;border-radius:4px}
        .wd-stat.danger .wd-track{background:rgba(var(--danger-rgb),.1)}
        .wd-stat.danger .wd-bar{background:linear-gradient(90deg,#f87171,#ef4444)}

        .wd-cat-head{display:flex;align-items:center;justify-content:center;gap:.6rem;margin-bottom:.75rem;padding-bottom:.5rem;border-bottom:1px dashed var(--border)}
        .wd-cat-title{font-size:.95rem;font-weight:600;color:var(--head);margin:0;letter-spacing:.02em}
        .wd-cat-vals{display:flex;justify-content:space-around;text-align:center;padding:.25rem 0}

        /* chart card */
        .wd-chart-head{border-bottom:1px solid var(--border);padding:1rem 1.25rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem}
        .wd-chart-left{display:flex;align-items:center;gap:.75rem}
        .wd-chart-title{font-size:1.05rem;font-weight:700;color:var(--head);margin:0}
        .wd-chart-sub{font-size:.8rem;color:var(--muted)}
        .wd-controls{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
        .wd-rel{position:relative}
        .wd-date,.wd-type{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;font-size:.85rem;cursor:pointer;transition:var(--tr);font-family:inherit}
        .wd-date{padding:.45rem .85rem;font-weight:500;display:inline-flex;align-items:center}
        .wd-date:hover{border-color:var(--p);color:var(--p);box-shadow:0 2px 8px rgba(var(--p-rgb),.15)}
        .wd-type{padding:.45rem .75rem;color:var(--muted);display:inline-flex;align-items:center}
        .wd-type:hover{color:var(--p);border-color:rgba(var(--p-rgb),.35);background:rgba(var(--p-rgb),.05)}
        .wd-type.active{background:var(--p);color:#fff;border-color:var(--p);box-shadow:0 4px 10px rgba(var(--p-rgb),.3)}
        .wd-filter{position:absolute;top:calc(100% + 6px);right:0;width:220px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 12px 28px rgba(15,23,42,.15);z-index:50;overflow:hidden}
        .wd-filter-item{padding:9px 14px;font-size:13px;cursor:pointer;color:#334155}
        .wd-filter-item:hover{background:var(--p);color:#fff}
        .wd-filter-item.on{font-weight:700;color:var(--p)}
        .wd-filter-item.on:hover{color:#fff}
        .wd-custom{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#64748b}
        .wd-custom input{border:1px solid #cbd5e1;border-radius:6px;padding:5px 8px;font-size:12px;font-family:inherit;outline:0}
        .wd-custom input:focus{border-color:var(--p)}
        .wd-custom button{border:0;background:var(--p);color:#fff;border-radius:6px;padding:6px;font-size:12px;font-weight:600;cursor:pointer}
        .wd-chart-body{padding:1rem 1rem .5rem;min-height:450px}
        .wd-empty{display:flex;align-items:center;justify-content:center;height:430px;color:var(--muted);font-size:14px}
        @media(prefers-reduced-motion:reduce){.wd-note-in{animation:none;position:static}}
      `}</style>
    </div>
  );
};

export default Dashboard;