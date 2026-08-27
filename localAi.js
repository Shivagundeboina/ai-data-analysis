const PLACEHOLDER_KEYS = new Set([
  "",
  "your-key-here",
  "sk-ant-your-key-here",
  "changeme",
  "placeholder",
]);

export function isApiKeyConfigured(key) {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  return !PLACEHOLDER_KEYS.has(trimmed.toLowerCase());
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

function findColumn(cols, q, type) {
  const filtered = cols.filter((c) => c.type === type);
  const match = filtered.find((c) => q.includes(c.name.toLowerCase().replace(/_/g, " ")) || q.includes(c.name.toLowerCase()));
  return match || filtered[0];
}

function fmt(n) {
  return Math.round(n).toLocaleString();
}

function answerQuestion(rows, columns, question) {
  const q = question.toLowerCase();
  const numericCols = columns.filter((c) => c.type === "number");
  const catCols = columns.filter((c) => c.type === "string");

  if (q.match(/\b(how many|count|number of)\b.*\b(row|record)/)) {
    return { answer: `The dataset contains ${rows.length.toLocaleString()} rows across ${columns.length} columns.`, chart: null };
  }

  if (q.match(/\b(missing|null|empty|incomplete)\b/)) {
    const worst = [...columns].sort((a, b) => b.missingPct - a.missingPct)[0];
    if (!worst || worst.missing === 0) {
      return { answer: "No missing values were detected in any column.", chart: null };
    }
    return {
      answer: `"${worst.name}" has the most missing values (${worst.missing} rows, ${(worst.missingPct * 100).toFixed(1)}% of the dataset).`,
      chart: null,
    };
  }

  const numCol = findColumn(columns, q, "number");
  const catCol = findColumn(columns, q, "string");

  if (numCol && q.match(/\b(total|sum)\b/)) {
    const sum = rows.reduce((a, r) => a + (Number(r[numCol.name]) || 0), 0);
    return { answer: `Total ${numCol.name} across all rows is ${fmt(sum)} (mean ${fmt(numCol.mean)} per row).`, chart: null };
  }

  if (numCol && q.match(/\b(average|mean|avg)\b/)) {
    return {
      answer: `Average ${numCol.name} is ${fmt(numCol.mean)} (range ${fmt(numCol.min)}–${fmt(numCol.max)}).`,
      chart: null,
    };
  }

  if (q.match(/\b(highest|top|most|maximum|best|largest|biggest)\b/) && numCol && catCol) {
    const data = groupSum(rows, catCol.name, numCol.name);
    const top = data[0];
    if (top) {
      return {
        answer: `${top.name} leads with ${fmt(top.value)} in total ${numCol.name}, ahead of ${data[1]?.name ?? "other categories"}.`,
        chart: { type: "bar", title: `${numCol.name} by ${catCol.name}`, data },
      };
    }
  }

  if (q.match(/\b(lowest|bottom|least|minimum|smallest|worst)\b/) && numCol && catCol) {
    const data = groupSum(rows, catCol.name, numCol.name);
    const bottom = data[data.length - 1];
    if (bottom) {
      return {
        answer: `${bottom.name} has the lowest total ${numCol.name} at ${fmt(bottom.value)}.`,
        chart: { type: "bar", title: `${numCol.name} by ${catCol.name}`, data },
      };
    }
  }

  if (catCol && q.match(/\b(category|categories|breakdown|distribution|share)\b/)) {
    const top = catCol.top || [];
    const topStr = top.slice(0, 3).map(([v, n]) => `${v} (${n})`).join(", ");
    return {
      answer: `"${catCol.name}" has ${catCol.unique} unique values. Top entries: ${topStr}.`,
      chart: { type: "pie", title: `Share by ${catCol.name}`, data: top.map(([name, value]) => ({ name: String(name), value })) },
    };
  }

  if (numCol) {
    return {
      answer: `${numCol.name} ranges from ${fmt(numCol.min)} to ${fmt(numCol.max)} with an average of ${fmt(numCol.mean)} across ${rows.length} rows.`,
      chart: null,
    };
  }

  return {
    answer: `This dataset has ${rows.length} rows and ${columns.length} columns. Try asking about totals, averages, or which category ranks highest for a numeric field.`,
    chart: null,
  };
}

function generateInsights(rows, columns) {
  const insights = [];
  insights.push(`Dataset overview: ${rows.length.toLocaleString()} records across ${columns.length} fields ready for analysis.`);

  const missingCols = columns.filter((c) => c.missing > 0);
  if (missingCols.length) {
    const worst = [...missingCols].sort((a, b) => b.missingPct - a.missingPct)[0];
    insights.push(
      `Data quality: ${missingCols.length} column(s) contain missing values; "${worst.name}" is most affected at ${(worst.missingPct * 100).toFixed(1)}% missing — consider imputation or filtering before reporting.`,
    );
  } else {
    insights.push("Data quality: no missing values detected — the dataset is complete and ready for aggregation.");
  }

  const numericCols = columns.filter((c) => c.type === "number");
  if (numericCols.length) {
    const col = numericCols[0];
    const total = rows.reduce((a, r) => a + (Number(r[col.name]) || 0), 0);
    insights.push(
      `Key metric — ${col.name}: totals ${fmt(total)} with values ranging ${fmt(col.min)}–${fmt(col.max)} (mean ${fmt(col.mean)}).`,
    );
  }

  const catCols = columns.filter((c) => c.type === "string");
  if (catCols.length && numericCols.length) {
    const data = groupSum(rows, catCols[0].name, numericCols[0].name);
    if (data.length >= 2) {
      const lead = data[0];
      const gap = lead.value - data[1].value;
      insights.push(
        `Standout segment: ${lead.name} accounts for ${fmt(lead.value)} in ${numericCols[0].name}, ${fmt(gap)} ahead of ${data[1].name}.`,
      );
    }
  }

  if (catCols.length) {
    const col = catCols[0];
    const [topVal, topCount] = col.top?.[0] || [];
    if (topVal) {
      insights.push(
        `Category mix: "${col.name}" spans ${col.unique} values; "${topVal}" is most frequent (${topCount} rows, ${((topCount / rows.length) * 100).toFixed(0)}%).`,
      );
    }
  }

  insights.push(
    "Recommendation: drill into top-performing segments in the Trend tab and validate outliers before presenting to leadership.",
  );

  return { insights: insights.slice(0, 6) };
}

function generateTrendNarrative({ col, direction, slope, projected, recent }) {
  const changePct =
    recent.length >= 2 && recent[0] !== 0
      ? (((recent[recent.length - 1] - recent[0]) / Math.abs(recent[0])) * 100).toFixed(1)
      : null;

  let narrative = `${col} shows a ${direction} linear trend`;
  if (changePct !== null) {
    narrative += `, shifting roughly ${changePct}% over the recent ${recent.length} observations`;
  }
  narrative += `. Slope is ${slope.toFixed(3)} per period.`;

  const projStr = projected.map((v) => fmt(v)).join(", ");
  if (direction === "upward") {
    narrative += ` The 5-period projection continues higher, reaching approximately ${projStr}. Monitor whether growth sustains or mean-reverts.`;
  } else if (direction === "downward") {
    narrative += ` The 5-period projection declines to ${projStr}. Investigate drivers and consider corrective actions if the drop is unintended.`;
  } else {
    narrative += ` Projected values stay near ${projStr}, suggesting stability with limited short-term movement.`;
  }

  return narrative;
}

export function generateLocalResponse({ system = "", prompt = "", context = {} }) {
  const sys = system.toLowerCase();
  const mode = context.mode || (sys.includes("executive insight") ? "insights" : sys.includes("forecasting agent") ? "trend" : sys.includes("data analyst") ? "ask" : null);

  if (mode === "ask") {
    const { rows = [], columns = [], question = "" } = context;
    const q = question || (prompt.match(/Question:\s*(.+)$/s)?.[1]?.trim() ?? prompt);
    if (rows.length && columns.length && q) {
      return JSON.stringify(answerQuestion(rows, columns, q));
    }
  }

  if (mode === "insights") {
    const { rows = [], columns = [] } = context;
    if (rows.length && columns.length) {
      return JSON.stringify(generateInsights(rows, columns));
    }
  }

  if (mode === "trend") {
    const trend = context.trend || parseTrendFromPrompt(prompt);
    if (trend) {
      return generateTrendNarrative(trend);
    }
  }

  return JSON.stringify({
    answer: "Local analysis mode is active. Load data and ask about totals, rankings, or category breakdowns.",
    chart: null,
  });
}

function parseTrendFromPrompt(prompt) {
  const col = prompt.match(/^Metric:\s*(.+)$/m)?.[1]?.trim();
  const direction = prompt.match(/^Trend direction:\s*(.+)$/m)?.[1]?.trim();
  const slope = parseFloat(prompt.match(/^Slope per row:\s*(.+)$/m)?.[1]);
  const projected = (prompt.match(/^Projected next 5 values:\s*(.+)$/m)?.[1] || "")
    .split(",")
    .map((v) => parseFloat(v.trim()))
    .filter((n) => !isNaN(n));
  const recent = (prompt.match(/^Recent values:\s*(.+)$/m)?.[1] || "")
    .split(",")
    .map((v) => parseFloat(v.trim()))
    .filter((n) => !isNaN(n));

  if (!col || isNaN(slope)) return null;
  return { col, direction: direction || "flat", slope, projected, recent };
}
