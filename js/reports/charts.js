/* =========================================================================
   charts.js  (js/reports/charts.js)
   Shared helpers for the Reports module. Exposes window.RPT.

   Load order in pages/app.html (all BEFORE js/views/reports.js):
     1. ../js/reports/charts.js   (this file)
     2. ../js/reports/views.js
     3. ../js/views/reports.js

   Needs Chart.js (already loaded in app.html). Uses these app globals when
   they exist, with safe fallbacks when they do not: esc, icon, fmtMoney, fmtMoney0.

   What is in here
     - formatters (money, numbers, percentages, dates, humanise)
     - delta()/badge()    previous-period rules (never NaN / Infinity)
     - kpiCard()          KPI card HTML
     - insights()         colour-coded insights banner HTML
     - chartBox()/chartCard()/donutHTML()   HTML builders
     - line()/bar()/combo()/donut()         Chart.js helpers (dark mode aware)
     - registry           every chart is tracked; destroyAll() before each render
   ========================================================================= */
(function (global) {
  "use strict";

  const RPT = (global.RPT = global.RPT || {});

  /* ---------------------------------------------------------------------
     App helpers with fallbacks (typeof is safe even if the name is undeclared)
     --------------------------------------------------------------------- */
  const _esc = function (s) {
    if (typeof esc === "function") return esc(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  const _icon = function (name, size) {
    try {
      if (typeof icon === "function") return icon(name, size || 18) || "";
    } catch (e) { /* unknown icon name: show nothing */ }
    return "";
  };

  /* ---------------------------------------------------------------------
     Number, text and date formatters
     --------------------------------------------------------------------- */
  const toNum = function (v) {
    if (v === null || v === undefined || v === "") return null;
    const x = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(x) ? x : null;
  };
  const num = function (v) {
    const x = toNum(v);
    return x === null ? "—" : x.toLocaleString(undefined, { maximumFractionDigits: 1 });
  };
  const _money = function (v) {
    const x = toNum(v);
    if (x === null) return "—";
    if (typeof fmtMoney === "function") return fmtMoney(x);
    return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };
  const _money0 = function (v) {
    const x = toNum(v);
    if (x === null) return "—";
    if (typeof fmtMoney0 === "function") return fmtMoney0(x);
    return x.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };
  const compact = function (v) {
    const x = toNum(v);
    if (x === null) return "—";
    const a = Math.abs(x);
    const trim = function (n) { return String(Math.round(n * 10) / 10).replace(/\.0$/, ""); };
    if (a >= 1e9) return trim(x / 1e9) + "B";
    if (a >= 1e6) return trim(x / 1e6) + "M";
    if (a >= 1e3) return trim(x / 1e3) + "K";
    return trim(x);
  };
  const pctText = function (v) {
    const x = toNum(v);
    return x === null ? "—" : (Math.round(x * 10) / 10).toFixed(1) + "%";
  };
  // AT_RISK -> "At risk", feed_consumption -> "Feed consumption"
  const human = function (s) {
    const t = String(s == null ? "" : s).replace(/[_-]+/g, " ").trim().toLowerCase();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  };

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = function (n) { return String(n).padStart(2, "0"); };
  const ymd = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const parseDate = function (s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  const fmtDate = function (s) {
    const d = parseDate(s);
    return d ? d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() : "—";
  };
  const fmtDateTime = function (s) {
    const d = new Date(s);
    if (!s || isNaN(d.getTime())) return fmtDate(s);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  };
  // Date string + n days -> "YYYY-MM-DD". Falls back to today when the start date is missing.
  const addDays = function (s, n) {
    const d = parseDate(s) || new Date();
    d.setDate(d.getDate() + Math.round(Number(n) || 0));
    return ymd(d);
  };

  let uidCount = 0;
  const uid = function (p) { uidCount += 1; return (p || "rc") + "-" + uidCount; };

  /* ---------------------------------------------------------------------
     Previous-period rules (section 4 of the plan)
       previous missing           -> kind "none"  ("—", "No comparison")
       previous 0 and current 0   -> kind "flat"  ("0.0%")
       previous 0, current not 0  -> kind "new"   ("New")
       otherwise                  -> (cur - prev) / |prev| x 100, one decimal
     Never returns NaN, Infinity or undefined.
     --------------------------------------------------------------------- */
  const delta = function (cur, prev) {
    const c = toNum(cur);
    const p = toNum(prev);
    if (c === null || p === null) return { kind: "none", pct: null, text: "—" };
    if (p === 0 && c === 0) return { kind: "flat", pct: 0, text: "0.0%" };
    if (p === 0) return { kind: "new", pct: null, text: "New" };
    const raw = ((c - p) / Math.abs(p)) * 100;
    if (!Number.isFinite(raw)) return { kind: "none", pct: null, text: "—" };
    const r = Math.round(raw * 10) / 10;
    return {
      kind: r > 0 ? "up" : r < 0 ? "down" : "flat",
      pct: r,
      text: (r > 0 ? "+" : "") + r.toFixed(1) + "%"
    };
  };
  // inverse = true for costs, losses, outstanding, mortality (a rise is bad).
  const badgeTone = function (d, inverse) {
    switch (d.kind) {
      case "up": return inverse ? "bad" : "good";
      case "down": return inverse ? "good" : "bad";
      case "flat": return "flat";
      case "new": return "new";
      default: return "none";
    }
  };
  const badge = function (d, inverse) {
    const arrow = d.kind === "up" ? "▲ " : d.kind === "down" ? "▼ " : "";
    return '<span class="ra-badge ' + badgeTone(d, inverse) + '">' + arrow + _esc(d.text) + "</span>";
  };

  /* ---------------------------------------------------------------------
     HTML builders
     --------------------------------------------------------------------- */
  // o: { icon, label, value (plain text), cur, prev, inverse, note, tone: "red"|"amber", neg, unavailable }
  // Pass "prev" (even as null) to show the vs-previous-period badge.
  const kpiCard = function (o) {
    o = o || {};
    const ico = o.icon ? '<span class="ra-kpi-ico' + (o.tone ? " " + o.tone : "") + '">' + _icon(o.icon, 20) + "</span>" : "";
    const value = o.unavailable ? "Unavailable" : (o.value == null || o.value === "" ? "—" : String(o.value));
    let foot = "";
    if (!o.unavailable) {
      if (Object.prototype.hasOwnProperty.call(o, "prev")) {
        const d = delta(o.cur, o.prev);
        foot = badge(d, o.inverse) + '<span class="ra-kpi-note">' + (d.kind === "none" ? "No comparison" : "vs previous period") + "</span>";
      } else if (o.note) {
        foot = '<span class="ra-kpi-note">' + _esc(o.note) + "</span>";
      }
    }
    return '<div class="ra-kpi' + (o.unavailable ? " unavailable" : "") + '">' +
      '<div class="ra-kpi-top">' + ico + '<span class="ra-kpi-label">' + _esc(o.label) + "</span></div>" +
      '<div class="ra-kpi-value' + (o.neg ? " neg" : "") + '">' + _esc(value) + "</div>" +
      '<div class="ra-kpi-foot">' + foot + "</div></div>";
  };

  // Colour-coded insights banner. Each item is a string or { text|message, severity|level|type }.
  const insights = function (list) {
    const items = Array.isArray(list) ? list : [];
    const rows = items.map(function (it) {
      const o = it && typeof it === "object" ? it : { text: it };
      const text = o.text != null ? o.text : (o.message != null ? o.message : (o.title != null ? o.title : (o.detail != null ? o.detail : "")));
      if (!text) return "";
      const sev = String(o.severity != null ? o.severity : (o.level != null ? o.level : (o.type != null ? o.type : (o.tone != null ? o.tone : (o.status != null ? o.status : ""))))).toLowerCase();
      let tone = "info";
      if (/crit|danger|bad|error|high|red|negative/.test(sev)) tone = "bad";
      else if (/warn|medium|amber|yellow|caution/.test(sev)) tone = "warn";
      else if (/good|success|positive|ok|green/.test(sev)) tone = "good";
      return '<div class="ra-insight ' + tone + '">' + _icon(tone === "bad" || tone === "warn" ? "alert" : "shield", 18) + "<span>" + _esc(text) + "</span></div>";
    }).join("");
    return rows ? '<div class="ra-insights">' + rows + "</div>" : "";
  };

  // Fixed-height canvas holder, or a friendly empty state.
  // o: { short, empty, emptyText, height }
  const chartBox = function (id, o) {
    o = o || {};
    if (o.empty) {
      return '<div class="ra-chart' + (o.short ? " short" : "") + '"><div class="ra-chart-empty">' + _esc(o.emptyText || "No data in this period yet") + "</div></div>";
    }
    const style = o.height ? ' style="height:' + Math.round(o.height) + 'px"' : "";
    return '<div class="ra-chart' + (o.short ? " short" : "") + '"' + style + '><canvas id="' + id + '"></canvas></div>';
  };

  // o: { title, sub, tools (html), body (html) }
  const chartCard = function (o) {
    o = o || {};
    return '<section class="ra-card"><div class="ra-card-head"><div><h3 class="ra-card-title">' + _esc(o.title) + "</h3>" +
      (o.sub ? '<p class="ra-card-sub">' + _esc(o.sub) + "</p>" : "") + "</div>" + (o.tools || "") + "</div>" + (o.body || "") + "</section>";
  };

  /* ---------------------------------------------------------------------
     Chart registry, theme and defaults
     --------------------------------------------------------------------- */
  const charts = [];
  const destroyAll = function () {
    while (charts.length) {
      const c = charts.pop();
      try { c.destroy(); } catch (e) { /* already gone */ }
    }
  };
  const make = function (el, cfg) {
    if (!el || typeof Chart === "undefined") return null;
    try {
      const old = typeof Chart.getChart === "function" ? Chart.getChart(el) : null;
      if (old) old.destroy();
    } catch (e) { /* ignore */ }
    const c = new Chart(el, cfg);
    charts.push(c);
    return c;
  };

  const cssVar = function (name, fallback) {
    try {
      const v = getComputedStyle(document.body).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  };
  const theme = function () {
    let text = "#111827";
    try { text = getComputedStyle(document.body).color || text; } catch (e) { /* keep default */ }
    return {
      text: text,
      muted: cssVar("--muted", "#6b7280"),
      line: cssVar("--line", "#e5e7eb"),
      card: cssVar("--card", "#ffffff"),
      green: cssVar("--green", "#147a3a"),
      red: cssVar("--error", "#c0392b"),
      income: "#147a3a",
      expense: "#f3b93a"
    };
  };
  const palette = ["#147a3a", "#f3b93a", "#2563eb", "#c0392b", "#8b5cf6", "#0ea5e9", "#f97316", "#64748b", "#14b8a6", "#a855f7"];
  const hexA = function (hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  };
  const valFmt = function (o) { return o && o.fmt ? o.fmt : (o && o.money ? _money : num); };

  const baseOptions = function (t, o) {
    o = o || {};
    const f = valFmt(o);
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: o.legend !== false,
          position: "bottom",
          labels: { color: t.text, usePointStyle: true, boxWidth: 8, boxHeight: 8 }
        },
        tooltip: {
          callbacks: {
            label: function (c) {
              const raw = c.parsed && typeof c.parsed === "object" ? (c.parsed.y != null && o.horizontal !== true ? c.parsed.y : c.parsed.x) : c.parsed;
              const text = o.tips && o.tips[c.dataIndex] != null ? o.tips[c.dataIndex] : f(raw);
              return (c.dataset.label ? c.dataset.label + ": " : "") + text;
            }
          }
        }
      }
    };
  };

  // o: { labels, datasets:[{label,data,color,fill}], money|fmt, legend }
  const lineChart = function (el, o) {
    const t = theme();
    const opts = baseOptions(t, o);
    opts.scales = {
      x: { ticks: { color: t.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: t.muted, callback: function (v) { return compact(v); } }, grid: { color: t.line } }
    };
    return make(el, {
      type: "line",
      data: {
        labels: o.labels,
        datasets: o.datasets.map(function (d) {
          const color = d.color || t.green;
          return {
            label: d.label, data: d.data, borderColor: color, backgroundColor: hexA(color, 0.12),
            fill: !!d.fill, tension: 0.3, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2, spanGaps: true
          };
        })
      },
      options: opts
    });
  };

  // o: { labels, datasets:[{label,data,color | colors[]}], horizontal, stacked, money|fmt, max, tips, legend }
  const barChart = function (el, o) {
    const t = theme();
    const horizontal = !!o.horizontal;
    const opts = baseOptions(t, Object.assign({ legend: o.datasets.length > 1 }, o));
    if (horizontal) opts.indexAxis = "y";
    const valueAxis = {
      beginAtZero: true, stacked: !!o.stacked,
      ticks: { color: t.muted, callback: function (v) { return compact(v); } },
      grid: { color: t.line }
    };
    if (o.max != null) valueAxis.max = o.max;
    const catAxis = { stacked: !!o.stacked, ticks: { color: t.muted }, grid: { display: false } };
    opts.scales = horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis };
    return make(el, {
      type: "bar",
      data: {
        labels: o.labels,
        datasets: o.datasets.map(function (d) {
          return {
            label: d.label, data: d.data,
            backgroundColor: d.colors || d.color || t.green,
            borderRadius: 6, maxBarThickness: 36
          };
        })
      },
      options: opts
    });
  };

  // Bars on the right axis, line on the left axis (used by the FCR report).
  // o: { labels, bar:{label,data,color}, line:{label,data,color}, lineFmt, barFmt }
  const combo = function (el, o) {
    const t = theme();
    const opts = baseOptions(t, {});
    opts.scales = {
      x: { ticks: { color: t.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } },
      y: { position: "left", beginAtZero: true, ticks: { color: t.muted, callback: function (v) { return compact(v); } }, grid: { color: t.line } },
      y1: { position: "right", beginAtZero: true, ticks: { color: t.muted, callback: function (v) { return compact(v); } }, grid: { drawOnChartArea: false } }
    };
    return make(el, {
      type: "bar",
      data: {
        labels: o.labels,
        datasets: [
          { type: "bar", label: o.bar.label, data: o.bar.data, backgroundColor: hexA(o.bar.color || t.expense, 0.55), borderRadius: 6, maxBarThickness: 30, yAxisID: "y1", order: 2 },
          { type: "line", label: o.line.label, data: o.line.data, borderColor: o.line.color || t.green, backgroundColor: hexA(o.line.color || t.green, 0.12), tension: 0.3, pointRadius: 3, borderWidth: 2, yAxisID: "y", order: 1, spanGaps: true }
        ]
      },
      options: opts
    });
  };

  // Donut: the legend is HTML beside the chart (see donutHTML), so it is hidden here.
  const prepItems = function (items) {
    return (Array.isArray(items) ? items : [])
      .map(function (it) { return { label: String(it.label), value: toNum(it.value) || 0, color: it.color }; })
      .filter(function (it) { return it.value > 0; })
      .map(function (it, i) { it.color = it.color || palette[i % palette.length]; return it; });
  };
  // o: { centreValue, centreLabel, money|fmt }
  const donutHTML = function (id, items, o) {
    o = o || {};
    const list = prepItems(items);
    const total = list.reduce(function (t, x) { return t + x.value; }, 0);
    const f = valFmt(o);
    const legend = list.map(function (x) {
      return '<div class="ra-legend-row"><span class="ra-legend-dot" style="background:' + x.color + '"></span>' +
        '<span class="ra-legend-name" title="' + _esc(x.label) + '">' + _esc(x.label) + "</span>" +
        '<span class="ra-legend-val">' + _esc(f(x.value)) + "</span>" +
        '<span class="ra-legend-pct">' + (total ? Math.round((x.value / total) * 100) : 0) + "%</span></div>";
    }).join("");
    const centre = (o.centreValue != null || o.centreLabel)
      ? '<div class="ra-donut-centre"><b>' + _esc(o.centreValue != null ? o.centreValue : "") + "</b><span>" + _esc(o.centreLabel || "") + "</span></div>"
      : "";
    return '<div class="ra-donut"><div class="ra-donut-chart"><canvas id="' + id + '"></canvas>' + centre + "</div>" +
      '<div class="ra-legend">' + legend + "</div></div>";
  };
  const donutChart = function (el, items, o) {
    const t = theme();
    const list = prepItems(items);
    const f = valFmt(o);
    return make(el, {
      type: "doughnut",
      data: {
        labels: list.map(function (x) { return x.label; }),
        datasets: [{ data: list.map(function (x) { return x.value; }), backgroundColor: list.map(function (x) { return x.color; }), borderColor: t.card, borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return c.label + ": " + f(c.parsed); } } }
        }
      }
    });
  };

  /* ---------------------------------------------------------------------
     Print: redraw charts at print size, restore afterwards
     --------------------------------------------------------------------- */
  const resizeAll = function () {
    charts.forEach(function (c) { try { c.resize(); } catch (e) { /* ignore */ } });
  };
  if (!RPT._printBound) {
    RPT._printBound = true;
    window.addEventListener("beforeprint", resizeAll);
    window.addEventListener("afterprint", resizeAll);
  }

  /* ---------------------------------------------------------------------
     Public API
     --------------------------------------------------------------------- */
  Object.assign(RPT, {
    charts: charts, destroyAll: destroyAll, make: make, theme: theme, palette: palette, hexA: hexA, uid: uid,
    esc: _esc, icon: _icon, money: _money, money0: _money0, num: num, compact: compact, pctText: pctText, human: human,
    toNum: toNum, ymd: ymd, parseDate: parseDate, fmtDate: fmtDate, fmtDateTime: fmtDateTime, addDays: addDays,
    delta: delta, badge: badge, kpiCard: kpiCard, insights: insights,
    chartBox: chartBox, chartCard: chartCard, donutHTML: donutHTML,
    line: lineChart, bar: barChart, combo: combo, donut: donutChart,
    views: RPT.views || {}
  });
})(window);