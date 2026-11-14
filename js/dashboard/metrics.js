/* js/dashboard/metrics.js - dashboard numbers and the SVG chart */
"use strict";

  /* =====================================================================
     DASHBOARD CALCULATIONS
     Everything here is worked out in the browser from the records already
     loaded from the server (flocks, production, sales, purchases, expenses).
     The cards and the Financial Overview chart all follow the period filter.
     ===================================================================== */
  const sumBy = (arr, field, pred = () => true) => arr.filter(pred).reduce((s, r) => s + num(r[field]), 0);
  const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

  // [key, label shown in the dropdown, short text used inside card titles]
  const DASH_PERIODS = [["today", "Today", "today"], ["7d", "Last 7 days", "last 7 days"], ["30d", "Last 30 days", "last 30 days"], ["month", "This month", "this month"], ["lastmonth", "Last month", "last month"], ["year", "This year", "this year"], ["all", "All time", "all time"]];
  const dashPeriod = () => DASH_PERIODS.find((p) => p[0] === state.dashPeriod) || DASH_PERIODS[1];

  // The chosen period as ISO dates, plus the period it is compared with (for the +/- % on the cards).
  // "all" has no dates and no comparison.
  function periodRange(key) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const today = new Date(y, m, d);
    let from = today, to = today, pf, pt;
    if (key === "all") return { from: "", to: "", prevFrom: "", prevTo: "", days: 0 };
    if (key === "month") { from = new Date(y, m, 1); pf = new Date(y, m - 1, 1); pt = new Date(y, m - 1, Math.min(d, new Date(y, m, 0).getDate())); }
    else if (key === "lastmonth") { from = new Date(y, m - 1, 1); to = new Date(y, m, 0); pf = new Date(y, m - 2, 1); pt = new Date(y, m - 1, 0); }
    else if (key === "year") { from = new Date(y, 0, 1); pf = new Date(y - 1, 0, 1); pt = new Date(y - 1, m, d); }
    else {
      if (key === "7d") from = new Date(y, m, d - 6);
      else if (key === "30d") from = new Date(y, m, d - 29);
      const len = Math.round((to - from) / 86400000) + 1; // days in the period
      pt = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
      pf = new Date(pt.getFullYear(), pt.getMonth(), pt.getDate() - (len - 1));
    }
    return { from: localISO(from), to: localISO(to), prevFrom: localISO(pf), prevTo: localISO(pt), days: Math.round((to - from) / 86400000) + 1 };
  }

  // True when an activity falls inside the chosen period. It checks the same date the cards use (the record's
  // own date), so a record never appears here for a period its numbers are not counted in.
  // a.on is that date; a.at (created time) and a.day are fallbacks. A row with no usable date is left out,
  // except under "All time".
  function inDashPeriod(a) {
    const p = periodRange(dashPeriod()[0]);
    if (!p.from) return true;
    const raw = String(a.on || a.at || a.day || "").trim();
    let day = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) day = raw; // date only: compare as written, no timezone shift
    else if (raw && !isNaN(new Date(raw))) day = localISO(new Date(raw));
    if (!day) return false;
    return day >= p.from && day <= p.to;
  }

  function metrics() {
    const d = state.data, now = new Date();
    const p = periodRange(dashPeriod()[0]);
    const ym = localISO(now).slice(0, 7);
    const pm = localISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
    const inMonth = (mm) => (r) => (r.date || "").startsWith(mm);
    const within = (a, b) => (r) => { const x = r.date || ""; return (!a || x >= a) && (!b || x <= b); };
    const live = sumBy(d.flock, "current_count", (f) => f.status === "Active");
    // Eggs and sales follow the dropdown. "From" the previous period gives the +/- % (none for "all time").
    const eggs = sumBy(d.production, "collected", within(p.from, p.to));
    const eggsPrev = p.from ? sumBy(d.production, "collected", within(p.prevFrom, p.prevTo)) : 0;
    const sell = sumBy(d.sales, "total", within(p.from, p.to));
    const sellPrev = p.from ? sumBy(d.sales, "total", within(p.prevFrom, p.prevTo)) : 0;
    // Stock Value is a running total, so it does not depend on the period.
       const buyAll = sumBy(d.purchase, "total_cost");
    // The running total as it stood at the end of last month, so the badge compares like with like.
    const lastMonthEnd = localISO(new Date(now.getFullYear(), now.getMonth(), 0));
    const buyPrev = sumBy(d.purchase, "total_cost", (r) => (r.date || "") <= lastMonthEnd);
        // Stock Value = what the inventory is worth now (valuation calculated by the backend).
    // null while inventory is still loading or the server sends no valuation.
    const valued = (state.inventory && state.inventory.status === "ready" ? state.inventory.items : [])
      .filter((i) => i.is_stock_tracked && i.is_active !== false && i.total_stock_value != null);
    const stockValue = valued.length ? valued.reduce((s, i) => s + num(i.total_stock_value), 0) : null;
     // The laying target is per day, so it grows with the number of days in the period.
    let days = p.days;
    if (!days) {
      const first = d.production.map((r) => r.date).filter(Boolean).sort()[0];
      days = first ? Math.max(1, Math.round((new Date(localISO(now)) - new Date(first)) / 86400000) + 1) : 1;
    }
    const target = (state.settings.dailyEggTarget || live) * days;
    return { live, eggsToday: eggs, target, buyAll, stockValue, sellM: sell, days,
    eggsDelta: pct(eggs, eggsPrev), buyDelta: pct(buyAll, buyPrev), sellDelta: pct(sell, sellPrev) };
  }

  /* ---------- Financial Overview: one set of buckets, shared by the chart and the export ----------
     Follows the period filter. Up to about two months it is one bucket per day; longer than that it is
     one per month (or per quarter, from the Monthly/Quarterly dropdown).
     Income = sales, Expenses = purchases + expenses, Profit = Income - Expenses, all by the record's own date
     and as recorded (not cash received). */
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function finSeries() {
    const d = state.data, p = periodRange(dashPeriod()[0]);
    const sources = [[d.sales, "total", false], [d.purchase, "total_cost", true], [d.expense, "amount", true]];
    let from = p.from, to = p.to;
    if (!from) { // "All time": start at the oldest record
      const dates = sources.flatMap(([arr]) => arr.map((r) => String(r.date || "").slice(0, 10))).filter(Boolean).sort();
      to = localISO(new Date());
      from = dates.length && dates[0] < to ? dates[0] : to.slice(0, 4) + "-01-01";
    }
    const parse = (t) => new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
    const a = parse(from), b = parse(to);
    const gran = Math.round((b - a) / 86400000) + 1 <= 62 ? "day" : state.range === "quarterly" ? "quarter" : "month";
    const multiYear = a.getFullYear() !== b.getFullYear();
    const yy = (dt) => (multiYear ? " '" + String(dt.getFullYear()).slice(2) : "");
    const keyOf = (t) => gran === "day" ? t : gran === "month" ? t.slice(0, 7) : t.slice(0, 4) + "-Q" + (Math.floor((+t.slice(5, 7) - 1) / 3) + 1);
    const keys = [], labels = [], tips = [];
    if (gran === "day") {
      for (let dt = new Date(a); dt <= b; dt.setDate(dt.getDate() + 1)) {
        keys.push(localISO(dt));
        labels.push(dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
        tips.push(dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
      }
    } else if (gran === "month") {
      for (let dt = new Date(a.getFullYear(), a.getMonth(), 1); dt <= b; dt.setMonth(dt.getMonth() + 1)) {
        keys.push(localISO(dt).slice(0, 7));
        labels.push(MONTH_NAMES[dt.getMonth()] + yy(dt));
        tips.push(MONTH_NAMES[dt.getMonth()] + " " + dt.getFullYear());
      }
    } else {
      for (let dt = new Date(a.getFullYear(), Math.floor(a.getMonth() / 3) * 3, 1); dt <= b; dt.setMonth(dt.getMonth() + 3)) {
        const q = Math.floor(dt.getMonth() / 3) + 1;
        keys.push(dt.getFullYear() + "-Q" + q);
        labels.push("Q" + q + yy(dt));
        tips.push("Q" + q + " " + dt.getFullYear());
      }
    }
    const at = {}; keys.forEach((k, i) => { at[k] = i; });
    const I = keys.map(() => 0), E = keys.map(() => 0);
    sources.forEach(([arr, field, isExpense]) => arr.forEach((r) => {
      const t = String(r.date || "").slice(0, 10);
      if (!t || t < from || t > to) return;
      const i = at[keyOf(t)];
      if (i !== undefined) (isExpense ? E : I)[i] += num(r[field]);
    }));
    return { labels, tips, I, E, P: I.map((v, i) => v - E[i]), gran, from, to };
  }

  /* =====================================================================
     CHART (inline SVG, no libraries)
     ===================================================================== */
  let geo = null;

  function smoothPath(pts) {
    if (pts.length < 2) return "";
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18;
      const lo = Math.min(p1.y, p2.y), hi = Math.max(p1.y, p2.y);
      const c1y = Math.min(hi, Math.max(lo, p1.y + (p2.y - p0.y) * t));
      const c2y = Math.min(hi, Math.max(lo, p2.y - (p3.y - p1.y) * t));
      d += ` C${p1.x + (p2.x - p0.x) * t},${c1y} ${p2.x - (p3.x - p1.x) * t},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  function chartHTML(fin) {
    fin = fin || finSeries();
    const { labels, tips, I, E } = fin, n = labels.length;
    const all = [...I, ...E];
    const empty = !all.some((v) => v !== 0);
    const max = Math.max(0, ...all);
    const step = max <= 0 ? 1000 : niceStep(max / 4);
    const top = max <= 0 ? 5000 : Math.ceil(max / step) * step;
    const bottom = 0;
    const narrow = window.innerWidth <= 640;
    const W = narrow ? Math.max(300, window.innerWidth - 72) : 720;
    const H = narrow ? 230 : 270, L = narrow ? 36 : 48, R = 12, T = 14, B = 30;
    const x = (i) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - bottom) / (top - bottom));
    const pts = (arr) => arr.map((v, i) => ({ x: x(i), y: y(v) }));
    const ptsI = pts(I), ptsE = pts(E);
    geo = { W, L, R, n, I, E, tips, ptsI, ptsE, empty };

    let ticks = "";
    for (let v = bottom; v <= top + step / 1000; v += step) {
      ticks += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${shortNum(v)}</text>`;
    }
    const every = Math.max(1, Math.ceil(n / (narrow ? 6 : 12))); // keep the x labels from crowding each other
    const xlab = labels.map((l, i) => (i % every ? "" : `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`)).join("");
    const note = empty ? `<text class="ax" x="${W / 2}" y="${(H - B + T) / 2}" text-anchor="middle">No sales or expenses in this period</text>` : "";
    const lineI = smoothPath(ptsI), lineE = smoothPath(ptsE);
    const area = ptsI.length > 1 ? `${lineI} L${ptsI[ptsI.length - 1].x},${y(0)} L${ptsI[0].x},${y(0)} Z` : "";
    const dots = (p, c) => (p.length === 1 ? `<circle cx="${p[0].x}" cy="${p[0].y}" r="4" fill="${c}"/>` : "");

    return `<svg id="fin-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and expenses chart">
      <defs><linearGradient id="incFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#147a3a" stop-opacity=".28"/><stop offset="1" stop-color="#147a3a" stop-opacity="0"/></linearGradient></defs>
      ${ticks}${xlab}${note}
      ${!empty && area ? `<path d="${area}" fill="url(#incFill)"/>` : ""}
      ${!empty && lineE ? `<path d="${lineE}" fill="none" stroke="#f3b93a" stroke-width="2"/>` : ""}
      ${!empty && lineI ? `<path d="${lineI}" fill="none" stroke="#147a3a" stroke-width="2"/>` : ""}
      ${empty ? "" : dots(ptsE, "#f3b93a") + dots(ptsI, "#147a3a")}
      <line id="hv-line" y1="${T}" y2="${H - B}" stroke="#9a9a9a" stroke-dasharray="3 3" hidden/>
      <circle id="hv-i" r="4.5" fill="#147a3a" stroke="#fff" stroke-width="2" hidden/>
      <circle id="hv-e" r="4.5" fill="#f3b93a" stroke="#fff" stroke-width="2" hidden/>
    </svg><div class="tip" id="fin-tip" hidden></div>`;
  }

  function bindChart() {
    const svg = $("#fin-svg"), tip = $("#fin-tip");
    if (!svg || !geo || geo.empty) return;
    const marks = ["#hv-line", "#hv-i", "#hv-e"];
    const hide = () => { tip.hidden = true; marks.forEach((s) => $(s).setAttribute("hidden", "")); };
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * geo.W;
      let idx = geo.n === 1 ? 0 : Math.round(((vx - geo.L) / (geo.W - geo.L - geo.R)) * (geo.n - 1));
      idx = Math.max(0, Math.min(geo.n - 1, idx));
      const pi = geo.ptsI[idx], pe = geo.ptsE[idx];
      const line = $("#hv-line"), di = $("#hv-i"), de = $("#hv-e");
      line.setAttribute("x1", pi.x); line.setAttribute("x2", pi.x);
      di.setAttribute("cx", pi.x); di.setAttribute("cy", pi.y);
      de.setAttribute("cx", pe.x); de.setAttribute("cy", pe.y);
      marks.forEach((s) => $(s).removeAttribute("hidden")); // SVG elements have no .hidden property
      tip.innerHTML = `<b>${esc(geo.tips[idx])}</b><br>Income: ${fmtMoney0(geo.I[idx])}<br>Expenses: ${fmtMoney0(geo.E[idx])}`;
      tip.hidden = false;
      tip.style.left = Math.min(Math.max((pi.x / geo.W) * r.width, 70), r.width - 70) + "px";
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", hide);
  }