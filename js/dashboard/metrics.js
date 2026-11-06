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

  function metrics() {
    const d = state.data, now = new Date();
    const today = localISO(now);
    const y = new Date(now); y.setDate(now.getDate() - 1);
    const ym = today.slice(0, 7);
    const pm = localISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
    const inMonth = (m) => (r) => (r.date || "").startsWith(m);
    const live = sumBy(d.flock, "current_count", (f) => f.status === "Active");
    const eggsToday = sumBy(d.production, "collected", (p) => p.date === today);
    const eggsYest = sumBy(d.production, "collected", (p) => p.date === localISO(y));
    const buyAll = sumBy(d.purchase, "total_cost");
    const buyM = sumBy(d.purchase, "total_cost", inMonth(ym)), buyP = sumBy(d.purchase, "total_cost", inMonth(pm));
    const sellM = sumBy(d.sales, "total", inMonth(ym)), sellP = sumBy(d.sales, "total", inMonth(pm));
    const target = state.settings.dailyEggTarget || live;
    return { live, eggsToday, target, buyAll, sellM,
      eggsDelta: pct(eggsToday, eggsYest), buyDelta: pct(buyM, buyP), sellDelta: pct(sellM, sellP) };
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

