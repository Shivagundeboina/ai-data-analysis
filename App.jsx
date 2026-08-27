import React, { useState, useMemo, useCallback } from "react";
import Papa from "papaparse";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

/* ---------- design tokens ---------- */
const COLORS = {
  bg: "#0A0E1A", surface: "#111828", surfaceAlt: "#1A2236",
  border: "#232B42", text: "#EDF1F7", muted: "#8B95AC",
  teal: "#22D3B8", tealDim: "#0F6E60", amber: "#F5A623",
  rose: "#F2637A", violet: "#8B7CF6",
};
const CHART_PALETTE = ["#22D3B8", "#F5A623", "#8B7CF6", "#F2637A", "#4F9DFF", "#5EEAD4"];

/* ---------- sample dataset (instant demo, no upload needed) ---------- */
function makeSampleData() {
  const regions = ["North", "South", "East", "West"];
  const products = ["Laptop", "Monitor", "Keyboard", "Headset", "Webcam"];
  const segments = ["Enterprise", "SMB", "Consumer"];
  const rows = [];
  let d = new Date("2025-01-01");
  for (let i = 0; i < 180; i++) {
    d = new Date(d.getTime() + 86400000 * (1 + Math.floor(Math.random() * 2)));
    const region = regions[i % regions.length];
    const product = products[(i * 3) % products.length];
    const segment = segments[i % segments.length];
    const qty = Math.max(1, Math.round(5 + Math.random() * 20 - (region === "West" ? 4 : 0)));
    const unitPrice = { Laptop: 850, Monitor: 220, Keyboard: 45, Headset: 60, Webcam: 35 }[product];
    const seasonal = 1 + 0.25 * Math.sin(i / 20);
    const revenue = Math.round(qty * unitPrice * seasonal * (region === "West" ? 0.82 : 1));
    rows.push({
      order_date: d.toISOString().slice(0, 10),
      region, product, customer_segment: segment,
      quantity: qty, unit_price: unitPrice, revenue,
    });
  }
  return rows;
}

/* ---------- profiling helpers ---------- */
function inferType(values) {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (nonNull.length === 0) return "string";
  const numCount = nonNull.filter((v) => typeof v === "number" || (!isNaN(parseFloat(v)) && isFinite(v))).length;
  if (numCount / nonNull.length > 0.9) return "number";
  const dateCount = nonNull.filter((v) => !isNaN(Date.parse(v))).length;
  if (dateCount / nonNull.length > 0.9) return "date";
  return "string";
}

function profileColumns(rows) {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  return cols.map((name) => {
    const values = rows.map((r) => r[name]);
    const missing = values.filter((v) => v === null || v === undefined || v === "").length;
    const type = inferType(values);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
    let stats = {};
    if (type === "number") {
      const nums = nonNull.map(Number);
      const sum = nums.reduce((a, b) => a + b, 0);
      stats = {
        min: Math.min(...nums), max: Math.max(...nums),
        mean: nums.length ? sum / nums.length : 0,
      };
    } else {
      const counts = {};
      nonNull.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      stats = { unique: Object.keys(counts).length, top };
    }
    return { name, type, missing, missingPct: missing / values.length, ...stats };
  });
}

function bucketHistogram(nums, buckets = 8) {
  if (!nums.length) return [];
  const min = Math.min(...nums), max = Math.max(...nums);
  const width = (max - min) / buckets || 1;
  const bins = Array.from({ length: buckets }, (_, i) => ({
    name: `${(min + i * width).toFixed(0)}–${(min + (i + 1) * width).toFixed(0)}`,
    value: 0,
  }));
  nums.forEach((n) => {
    let idx = Math.floor((n - min) / width);
    if (idx >= buckets) idx = buckets - 1;
    if (idx < 0) idx = 0;
    bins[idx].value += 1;
  });
  return bins;
}

function groupSum(rows, catCol, numCol, topN = 8) {
  const map = {};
  rows.forEach((r) => {
    const k = r[catCol] ?? "—";
    map[k] = (map[k] || 0) + (Number(r[numCol]) || 0);
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name, value]) => ({ name: String(name), value: Math.round(value) }));
}

function linregress(xs, ys) {
  const n = xs.length;
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - xMean) * (ys[i] - yMean); den += (xs[i] - xMean) ** 2; }
  const slope = den ? num / den : 0;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

/* ---------- LLM call helper ----------
   Calls our own backend (server/index.js), which forwards the request to
   the Anthropic API using a server-side API key. Never call api.anthropic.com
   directly from the browser — that would require exposing your key client-side. */
async function callClaude(systemPrompt, userPrompt, context = null) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: systemPrompt, prompt: userPrompt, context }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Backend error (${res.status})`);
  }
  const data = await res.json();
  const cleaned = (data.text || "").replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  return cleaned;
}

function buildDataSummary(rows, columns) {
  const lines = [];
  lines.push(`Dataset: ${rows.length} rows, ${columns.length} columns.`);
  lines.push("Schema:");
  columns.forEach((c) => {
    if (c.type === "number") {
      lines.push(`- ${c.name} (number): min=${c.min?.toFixed?.(2)}, max=${c.max?.toFixed?.(2)}, mean=${c.mean?.toFixed?.(2)}, missing=${c.missing}`);
    } else if (c.type === "date") {
      lines.push(`- ${c.name} (date): missing=${c.missing}`);
    } else {
      const topStr = (c.top || []).map(([v, n]) => `${v}(${n})`).join(", ");
      lines.push(`- ${c.name} (category): unique=${c.unique}, top values=${topStr}, missing=${c.missing}`);
    }
  });
  lines.push("Sample rows (first 12):");
  rows.slice(0, 12).forEach((r) => lines.push(JSON.stringify(r)));
  return lines.join("\n");
}

/* ---------- small UI atoms ---------- */
function Card({ title, sub, children, className = "" }) {
  return (
    <div className={`edip-card ${className}`}>
      {title && (
        <div className="edip-card-head">
          <span className="edip-card-title">{title}</span>
          {sub && <span className="edip-card-sub">{sub}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

function KPI({ label, value, accent }) {
  return (
    <div className="edip-kpi">
      <div className="edip-kpi-value" style={{ color: accent || COLORS.text }}>{value}</div>
      <div className="edip-kpi-label">{label}</div>
    </div>
  );
}

function ChartBlock({ type, data, title, dataKey = "value" }) {
  if (!data || !data.length) return <div className="edip-empty">No data to chart.</div>;
  return (
    <div>
      {title && <div className="edip-chart-title">{title}</div>}
      <ResponsiveContainer width="100%" height={220}>
        {type === "pie" ? (
          <PieChart>
            <Pie data={data} dataKey={dataKey} nameKey="name" cx="50%" cy="50%" outerRadius={80}
              label={(e) => e.name}>
              {data.map((_, i) => <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text }} />
          </PieChart>
        ) : type === "line" ? (
          <LineChart data={data}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
            <XAxis dataKey="name" stroke={COLORS.muted} tick={{ fontSize: 11 }} />
            <YAxis stroke={COLORS.muted} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text }} />
            <Line type="monotone" dataKey={dataKey} stroke={COLORS.teal} strokeWidth={2} dot={false} />
          </LineChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
            <XAxis dataKey="name" stroke={COLORS.muted} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis stroke={COLORS.muted} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text }} />
            <Bar dataKey={dataKey} fill={COLORS.teal} radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- main app ---------- */
export default function App() {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [tab, setTab] = useState("overview");
  const [question, setQuestion] = useState("");
  const [chatLog, setChatLog] = useState([]);
  const [asking, setAsking] = useState(false);
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [trendCol, setTrendCol] = useState("");
  const [trendResult, setTrendResult] = useState(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [error, setError] = useState("");

  const columns = useMemo(() => profileColumns(rows), [rows]);
  const numericCols = useMemo(() => columns.filter((c) => c.type === "number"), [columns]);
  const catCols = useMemo(() => columns.filter((c) => c.type === "string"), [columns]);
  const dateCols = useMemo(() => columns.filter((c) => c.type === "date"), [columns]);

  const kpis = useMemo(() => {
    if (!rows.length) return null;
    const totalCells = rows.length * columns.length;
    const missingCells = columns.reduce((a, c) => a + c.missing, 0);
    return {
      rows: rows.length, cols: columns.length,
      missingPct: totalCells ? ((missingCells / totalCells) * 100).toFixed(1) : "0.0",
      numeric: numericCols.length,
    };
  }, [rows, columns, numericCols]);

  const loadSample = useCallback(() => {
    const data = makeSampleData();
    setRows(data); setFileName("sample_sales_data.csv");
    setChatLog([]); setInsights(null); setTrendResult(null); setError("");
  }, []);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setError("");
    Papa.parse(file, {
      header: true, dynamicTyping: true, skipEmptyLines: true,
      complete: (res) => {
        if (!res.data.length) { setError("No rows found in file."); return; }
        setRows(res.data); setFileName(file.name);
        setChatLog([]); setInsights(null); setTrendResult(null);
      },
      error: (err) => setError("Parse error: " + err.message),
    });
  }, []);

  const overviewCharts = useMemo(() => {
    if (!rows.length) return [];
    const blocks = [];
    if (catCols[0] && numericCols[0]) {
      blocks.push({ type: "bar", title: `${numericCols[0].name} by ${catCols[0].name}`, data: groupSum(rows, catCols[0].name, numericCols[0].name) });
    }
    if (numericCols[0]) {
      blocks.push({ type: "bar", title: `Distribution of ${numericCols[0].name}`, data: bucketHistogram(rows.map((r) => Number(r[numericCols[0].name])).filter((n) => !isNaN(n))) });
    }
    if (catCols[0]) {
      blocks.push({ type: "pie", title: `Share by ${catCols[0].name}`, data: (catCols[0].top || []).map(([name, value]) => ({ name: String(name), value })) });
    }
    if (dateCols[0] && numericCols[0]) {
      const map = {};
      rows.forEach((r) => { const k = r[dateCols[0].name]; if (k) map[k] = (map[k] || 0) + (Number(r[numericCols[0].name]) || 0); });
      const data = Object.entries(map).sort(([a], [b]) => new Date(a) - new Date(b)).map(([name, value]) => ({ name, value: Math.round(value) }));
      blocks.push({ type: "line", title: `${numericCols[0].name} over time`, data });
    }
    return blocks;
  }, [rows, catCols, numericCols, dateCols]);

  const askQuestion = useCallback(async () => {
    if (!question.trim() || !rows.length) return;
    setAsking(true); setError("");
    const q = question.trim();
    try {
      const summary = buildDataSummary(rows, columns);
      const system = `You are a data analyst agent. You are given a dataset schema, computed statistics, and a small sample of rows. Answer the user's question using ONLY the information provided — never invent numbers not derivable from it. Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{"answer": "<concise answer, under 80 words>", "chart": null | {"type": "bar"|"line"|"pie", "title": "<title>", "data": [{"name": "<label>", "value": <number>}, ...]}}
Only include a chart if it materially helps illustrate the answer; otherwise set chart to null.`;
      const raw = await callClaude(system, `${summary}\n\nQuestion: ${q}`, { mode: "ask", rows, columns, question: q });
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = { answer: raw, chart: null }; }
      setChatLog((log) => [...log, { question: q, answer: parsed.answer, chart: parsed.chart }]);
      setQuestion("");
    } catch (e) {
      setError("Couldn't reach the AI agent. Try again in a moment.");
    } finally {
      setAsking(false);
    }
  }, [question, rows, columns]);

  const generateInsights = useCallback(async () => {
    if (!rows.length) return;
    setInsightsLoading(true); setError("");
    try {
      const summary = buildDataSummary(rows, columns);
      const system = `You are an executive insight agent for a business intelligence platform. Given a dataset schema, computed statistics, and a sample of rows, write 5-6 short executive insights an analyst would report to leadership — trends, standouts, risks, and one actionable recommendation. Use ONLY facts derivable from the provided data; do not fabricate figures. Respond with ONLY valid JSON, no markdown fences: {"insights": ["<insight 1>", "<insight 2>", ...]}`;
      const raw = await callClaude(system, summary, { mode: "insights", rows, columns });
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = { insights: [raw] }; }
      setInsights(parsed.insights || []);
    } catch (e) {
      setError("Couldn't reach the AI agent. Try again in a moment.");
    } finally {
      setInsightsLoading(false);
    }
  }, [rows, columns]);

  const runTrend = useCallback(async () => {
    const col = trendCol || numericCols[0]?.name;
    if (!col || !rows.length) return;
    setTrendLoading(true); setError("");
    try {
      const ys = rows.map((r) => Number(r[col])).filter((n) => !isNaN(n));
      const xs = ys.map((_, i) => i);
      const { slope, intercept } = linregress(xs, ys);
      const lastX = xs.length - 1;
      const projected = Array.from({ length: 5 }, (_, i) => Math.round(slope * (lastX + i + 1) + intercept));
      const chartData = [
        ...ys.slice(-15).map((v, i) => ({ name: `t-${15 - i}`, value: Math.round(v) })),
        ...projected.map((v, i) => ({ name: `t+${i + 1}`, value: v })),
      ];
      const direction = slope > 0 ? "upward" : slope < 0 ? "downward" : "flat";
      const system = `You are a forecasting agent. You are given a computed linear trend (slope, recent values, and a 5-period projection) for one metric. Write a short (under 60 words) plain-business-language narrative explaining the trend and projection. Use ONLY the numbers given; do not invent additional figures.`;
      const userMsg = `Metric: ${col}\nTrend direction: ${direction}\nSlope per row: ${slope.toFixed(3)}\nRecent values: ${ys.slice(-10).map((v) => v.toFixed(1)).join(", ")}\nProjected next 5 values: ${projected.join(", ")}`;
      const narrative = await callClaude(system, userMsg, {
        mode: "trend",
        trend: { col, direction, slope, projected, recent: ys.slice(-10) },
      });
      setTrendResult({ col, chartData, narrative, direction });
    } catch (e) {
      setError("Couldn't reach the AI agent. Try again in a moment.");
    } finally {
      setTrendLoading(false);
    }
  }, [trendCol, numericCols, rows]);

  return (
    <div className="edip-root">
      <style>{`
        .edip-root { background: ${COLORS.bg}; color: ${COLORS.text}; font-family: 'Inter', system-ui, sans-serif; min-height: 100vh; padding: 20px; box-sizing: border-box; position: relative; top: 0; margin-top: 0; }
        .edip-root * { box-sizing: border-box; }
        .edip-header { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
        .edip-title { font-family: 'Space Grotesk', 'Inter', sans-serif; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
        .edip-title span { color: ${COLORS.teal}; }
        .edip-subtitle { color: ${COLORS.muted}; font-size: 13px; margin-top: 2px; }
        .edip-upload-row { display: flex; gap: 8px; align-items: center; }
        .edip-btn { background: ${COLORS.surfaceAlt}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; padding: 8px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; transition: border-color .15s; }
        .edip-btn:hover { border-color: ${COLORS.teal}; }
        .edip-btn-primary { background: ${COLORS.teal}; color: #06201B; border: 1px solid ${COLORS.teal}; font-weight: 600; }
        .edip-btn-primary:hover { opacity: 0.9; }
        .edip-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .edip-file-label { font-size: 12px; color: ${COLORS.muted}; }
        .edip-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 18px; }
        .edip-kpi { background: ${COLORS.surface}; border: 1px solid ${COLORS.border}; border-radius: 10px; padding: 12px 14px; }
        .edip-kpi-value { font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 600; }
        .edip-kpi-label { color: ${COLORS.muted}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
        .edip-schema-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
        .edip-chip { background: ${COLORS.surface}; border: 1px solid ${COLORS.border}; border-radius: 8px; padding: 6px 10px; font-size: 11px; font-family: 'JetBrains Mono', monospace; display: flex; flex-direction: column; gap: 4px; min-width: 110px; }
        .edip-chip-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
        .edip-chip-name { color: ${COLORS.text}; font-weight: 600; }
        .edip-chip-type { color: ${COLORS.muted}; font-size: 10px; }
        .edip-chip-bar-track { height: 4px; background: ${COLORS.border}; border-radius: 2px; overflow: hidden; }
        .edip-chip-bar-fill { height: 100%; background: ${COLORS.amber}; }
        .edip-tabs { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid ${COLORS.border}; }
        .edip-tab { padding: 8px 14px; font-size: 13px; color: ${COLORS.muted}; cursor: pointer; border-bottom: 2px solid transparent; }
        .edip-tab.active { color: ${COLORS.teal}; border-bottom-color: ${COLORS.teal}; }
        .edip-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
        .edip-card { background: ${COLORS.surface}; border: 1px solid ${COLORS.border}; border-radius: 12px; padding: 14px; }
        .edip-card-head { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .edip-card-title { font-size: 13px; font-weight: 600; }
        .edip-card-sub { font-size: 11px; color: ${COLORS.muted}; }
        .edip-chart-title { font-size: 12px; color: ${COLORS.muted}; margin-bottom: 6px; }
        .edip-empty { color: ${COLORS.muted}; font-size: 13px; padding: 30px 0; text-align: center; }
        .edip-ask-row { display: flex; gap: 8px; margin-bottom: 14px; }
        .edip-input { flex: 1; background: ${COLORS.surfaceAlt}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-family: inherit; }
        .edip-input:focus { outline: none; border-color: ${COLORS.teal}; }
        .edip-chat-item { border: 1px solid ${COLORS.border}; border-radius: 10px; padding: 12px; margin-bottom: 10px; background: ${COLORS.surface}; }
        .edip-chat-q { font-size: 12px; color: ${COLORS.violet}; font-weight: 600; margin-bottom: 6px; }
        .edip-chat-a { font-size: 13px; line-height: 1.5; color: ${COLORS.text}; margin-bottom: 8px; }
        .edip-insight-item { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid ${COLORS.border}; font-size: 13px; line-height: 1.5; }
        .edip-insight-item:last-child { border-bottom: none; }
        .edip-insight-dot { color: ${COLORS.teal}; flex-shrink: 0; }
        .edip-select { background: ${COLORS.surfaceAlt}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; padding: 8px 10px; border-radius: 8px; font-size: 13px; font-family: inherit; }
        .edip-error { background: rgba(242,99,122,0.1); border: 1px solid ${COLORS.rose}; color: ${COLORS.rose}; padding: 10px 12px; border-radius: 8px; font-size: 12px; margin-bottom: 14px; }
        .edip-empty-state { text-align: center; padding: 60px 20px; color: ${COLORS.muted}; }
        .edip-narrative { background: ${COLORS.surfaceAlt}; border-left: 3px solid ${COLORS.teal}; padding: 10px 14px; border-radius: 6px; font-size: 13px; line-height: 1.6; margin-top: 10px; }
      `}</style>

      <div className="edip-header">
        <div>
          <div className="edip-title">AI Data Analyst <span>Agent</span></div>
          <div className="edip-subtitle">Upload → auto-profile → visualize → ask questions → executive insights</div>
        </div>
        <div className="edip-upload-row">
          {fileName && <span className="edip-file-label">{fileName} · {rows.length} rows</span>}
          <label className="edip-btn">
            Upload CSV
            <input type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
          </label>
          <button className="edip-btn edip-btn-primary" onClick={loadSample}>Load sample data</button>
        </div>
      </div>

      {error && <div className="edip-error">{error}</div>}

      {!rows.length ? (
        <div className="edip-empty-state">
          <div style={{ fontSize: 15, marginBottom: 6 }}>No dataset loaded</div>
          <div style={{ fontSize: 13 }}>Upload a CSV, or click "Load sample data" to try the agent instantly.</div>
        </div>
      ) : (
        <>
          <div className="edip-kpi-row">
            <KPI label="Rows" value={kpis.rows} />
            <KPI label="Columns" value={kpis.cols} />
            <KPI label="Missing data" value={`${kpis.missingPct}%`} accent={kpis.missingPct > 5 ? COLORS.amber : COLORS.teal} />
            <KPI label="Numeric fields" value={kpis.numeric} accent={COLORS.violet} />
          </div>

          <div className="edip-schema-strip">
            {columns.map((c) => (
              <div key={c.name} className="edip-chip">
                <div className="edip-chip-top">
                  <span className="edip-chip-name">{c.name}</span>
                  <span className="edip-chip-type">{c.type}</span>
                </div>
                <div className="edip-chip-bar-track">
                  <div className="edip-chip-bar-fill" style={{ width: `${Math.min(100, c.missingPct * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="edip-tabs">
            {["overview", "ask", "insights", "trend"].map((t) => (
              <div key={t} className={`edip-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                {t === "overview" ? "Overview" : t === "ask" ? "Ask the data" : t === "insights" ? "Executive insights" : "Trend & forecast"}
              </div>
            ))}
          </div>

          {tab === "overview" && (
            <div className="edip-grid">
              {overviewCharts.map((b, i) => (
                <Card key={i}><ChartBlock type={b.type} data={b.data} title={b.title} /></Card>
              ))}
              {!overviewCharts.length && <div className="edip-empty">Not enough structure in this dataset to auto-chart. Try "Ask the data" instead.</div>}
            </div>
          )}

          {tab === "ask" && (
            <div>
              <div className="edip-ask-row">
                <input
                  className="edip-input"
                  placeholder="e.g. Which region has the highest revenue?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && askQuestion()}
                />
                <button className="edip-btn edip-btn-primary" onClick={askQuestion} disabled={asking}>
                  {asking ? "Thinking…" : "Ask"}
                </button>
              </div>
              {chatLog.length === 0 && <div className="edip-empty">Ask a question in plain English about your dataset.</div>}
              {[...chatLog].reverse().map((c, i) => (
                <div key={i} className="edip-chat-item">
                  <div className="edip-chat-q">{c.question}</div>
                  <div className="edip-chat-a">{c.answer}</div>
                  {c.chart && <ChartBlock type={c.chart.type} data={c.chart.data} title={c.chart.title} />}
                </div>
              ))}
            </div>
          )}

          {tab === "insights" && (
            <Card
              title="Executive summary"
              sub={insights ? `${insights.length} findings` : ""}
            >
              <button className="edip-btn edip-btn-primary" onClick={generateInsights} disabled={insightsLoading} style={{ marginBottom: 12 }}>
                {insightsLoading ? "Generating…" : insights ? "Regenerate insights" : "Generate executive insights"}
              </button>
              {insights && insights.map((ins, i) => (
                <div key={i} className="edip-insight-item">
                  <span className="edip-insight-dot">●</span>
                  <span>{ins}</span>
                </div>
              ))}
              {!insights && <div className="edip-empty">Click the button to generate an AI-written executive summary of this dataset.</div>}
            </Card>
          )}

          {tab === "trend" && (
            <Card title="Trend & forecast">
              <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
                <select className="edip-select" value={trendCol || numericCols[0]?.name || ""} onChange={(e) => setTrendCol(e.target.value)}>
                  {numericCols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <button className="edip-btn edip-btn-primary" onClick={runTrend} disabled={trendLoading || !numericCols.length}>
                  {trendLoading ? "Modeling…" : "Project next 5 periods"}
                </button>
              </div>
              {!numericCols.length && <div className="edip-empty">No numeric column available to forecast.</div>}
              {trendResult && (
                <>
                  <ChartBlock type="line" data={trendResult.chartData} title={`${trendResult.col} — recent values + 5-period linear projection`} />
                  <div className="edip-narrative">{trendResult.narrative}</div>
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
