/* js/dashboard/metrics.js - dashboard numbers and the SVG chart */
"use strict";

  /* =====================================================================
     DASHBOARD CALCULATIONS
     Live birds and eggs today come from the server data loaded above.
     Stock value, sales and the chart are still front-end placeholders
     until those endpoints exist.
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

  // True when an activity (or any row with an "at" timestamp) falls inside the chosen period.
  function inDashPeriod(a) {
    const p = periodRange(dashPeriod()[0]);
    if (!p.from) return true;
    const dt = new Date(a.at);
    if (isNaN(dt)) return true;
    const day = localISO(dt);
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

  function monthly() {
    const y = new Date().getFullYear();
    const inc = Array(12).fill(0), exp = Array(12).fill(0);
    const add = (arr, field, target) => arr.forEach((r) => {
      const [yy, mm] = (r.date || "").split("-");
      if (+yy === y && +mm >= 1) target[+mm - 1] += num(r[field]);
    });
    add(state.data.sales, "total", inc);
    add(state.data.purchase, "total_cost", exp);
    add(state.data.expense, "amount", exp);
    return { inc, exp };
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

  function chartHTML() {
    const { inc, exp } = monthly();
    const q = state.range === "quarterly";
    const agg = (a) => [0, 1, 2, 3].map((k) => a.slice(k * 3, k * 3 + 3).reduce((s, v) => s + v, 0));
    const labels = q ? ["Q1", "Q2", "Q3", "Q4"] : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const I = q ? agg(inc) : inc, E = q ? agg(exp) : exp;
    const now = new Date();
    const limit = q ? Math.floor(now.getMonth() / 3) + 1 : now.getMonth() + 1;
    const max = Math.max(0, ...I.slice(0, limit), ...E.slice(0, limit));
    const step = max <= 0 ? 1000 : niceStep(max / 4);
    const top = max <= 0 ? 5000 : Math.ceil(max / step) * step;
    const narrow = window.innerWidth <= 640;
    const W = narrow ? Math.max(300, window.innerWidth - 72) : 720;
    const H = narrow ? 230 : 270, L = narrow ? 36 : 48, R = 12, T = 14, B = 30, n = labels.length;
    const x = (i) => L + (i * (W - L - R)) / (n - 1);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const ptsI = I.slice(0, limit).map((v, i) => ({ x: x(i), y: y(v) }));
    const ptsE = E.slice(0, limit).map((v, i) => ({ x: x(i), y: y(v) }));
    geo = { W, L, R, n, limit, I, E, labels, x, y, ptsI, ptsE };

    let ticks = "";
    for (let v = 0; v <= top + 0.0001; v += step) {
      ticks += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${shortNum(v)}</text>`;
    }
    const xlab = labels.map((l, i) => (narrow && !q && i % 2 ? "" : `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${l}</text>`)).join("");
    const lineI = smoothPath(ptsI), lineE = smoothPath(ptsE);
    const area = ptsI.length > 1 ? `${lineI} L${ptsI[ptsI.length - 1].x},${y(0)} L${ptsI[0].x},${y(0)} Z` : "";
    const dots = (pts, c) => (pts.length === 1 ? `<circle cx="${pts[0].x}" cy="${pts[0].y}" r="4" fill="${c}"/>` : "");

    return `<svg id="fin-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and expenses chart">
      <defs><linearGradient id="incFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#147a3a" stop-opacity=".28"/><stop offset="1" stop-color="#147a3a" stop-opacity="0"/></linearGradient></defs>
      ${ticks}${xlab}
      ${area ? `<path d="${area}" fill="url(#incFill)"/>` : ""}
      ${lineE ? `<path d="${lineE}" fill="none" stroke="#f3b93a" stroke-width="2"/>` : ""}
      ${lineI ? `<path d="${lineI}" fill="none" stroke="#147a3a" stroke-width="2"/>` : ""}
      ${dots(ptsE, "#f3b93a")}${dots(ptsI, "#147a3a")}
      <line id="hv-line" y1="${T}" y2="${H - B}" stroke="#9a9a9a" stroke-dasharray="3 3" hidden/>
      <circle id="hv-i" r="4.5" fill="#147a3a" stroke="#fff" stroke-width="2" hidden/>
      <circle id="hv-e" r="4.5" fill="#f3b93a" stroke="#fff" stroke-width="2" hidden/>
    </svg><div class="tip" id="fin-tip" hidden></div>`;
  }

  function bindChart() {
    const svg = $("#fin-svg"), tip = $("#fin-tip");
    if (!svg || !geo) return;
    const hide = () => { tip.hidden = true; ["#hv-line", "#hv-i", "#hv-e"].forEach((s) => $(s).setAttribute("hidden", "")); };
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * geo.W;
      let idx = Math.round(((vx - geo.L) / (geo.W - geo.L - geo.R)) * (geo.n - 1));
      idx = Math.max(0, Math.min(geo.limit - 1, idx));
      const pi = geo.ptsI[idx], pe = geo.ptsE[idx];
      const line = $("#hv-line"), di = $("#hv-i"), de = $("#hv-e");
      line.setAttribute("x1", pi.x); line.setAttribute("x2", pi.x);
      di.setAttribute("cx", pi.x); di.setAttribute("cy", pi.y);
      de.setAttribute("cx", pe.x); de.setAttribute("cy", pe.y);
      [line, di, de].forEach((el) => el.removeAttribute("hidden")); // SVG elements have no .hidden property
      tip.innerHTML = `<b>${esc(geo.labels[idx])}</b><br>Income: ${fmtMoney0(geo.I[idx])}<br>Expenses: ${fmtMoney0(geo.E[idx])}`;
      tip.hidden = false;
      tip.style.left = Math.min(Math.max((pi.x / geo.W) * r.width, 70), r.width - 70) + "px";
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", hide);
  }

