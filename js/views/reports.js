/* js/views/reports.js - Reports & Analytics
   #/reports       overview: KPI strip, two charts, search + group tabs, report cards
   #/reports/:key  one report: frame (back, title, period, print) + the renderer from js/reports/views.js
   Period Comparison (#/reports/period-comparison) has its own panel: Period A vs Period B, each with a
   preset or custom From/To dates, a Swap button and a Compare button.
   Needs js/reports/charts.js and js/reports/views.js loaded first (window.RPT).
   Only one global is exposed: reportsView(sub). Click/change handlers use data-rpt-action, never data-action. */
(function () {
  "use strict";

  const R = window.RPT;
  if (!R || !R.views) {
    window.reportsView = function () {
      return '<div class="ra-page"><div class="ra-state error"><b>The Reports scripts did not load.</b><span>Check that js/reports/charts.js and js/reports/views.js come before js/views/reports.js in app.html.</span></div></div>';
    };
    console.error("reports.js: window.RPT is missing.");
    return;
  }

  const esc = R.esc;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ---------- catalog ---------- */
  const GROUP_ORDER = ["Financial", "Production", "Predictive", "Operational"];
  const TABS = ["all"].concat(GROUP_ORDER);
  const TITLES = {
    "pl": "Income Statement", "cash-flow": "Cash Flow Statement", "inventory-valuation": "Inventory Valuation",
    "audit": "Adjustment Audit", "fcr": "Feed Conversion Ratio", "hhep": "Hen-Housed Egg Production",
    "cost-per-crate": "True Cost Per Crate", "flock-roi": "Flock ROI", "feed-forecast": "Feed Runout Forecast",
    "customer-lifecycle": "Customer Churn & Loyalty", "traceability": "Batch Traceability", "period-comparison": "Period Comparison"
  };
  // Used only if the index endpoint answers 404/405, so the overview is never empty.
  const FALLBACK_INDEX = [
    ["pl", "Financial", "Revenue, costs and net profit for the period."],
    ["cash-flow", "Financial", "Money in and money out."],
    ["inventory-valuation", "Financial", "What your stock is worth today."],
    ["period-comparison", "Financial", "Compare any two date ranges."],
    ["fcr", "Production", "How much feed each crate of eggs costs you."],
    ["hhep", "Production", "Eggs produced per bird housed."],
    ["cost-per-crate", "Production", "The true cost of producing one crate."],
    ["flock-roi", "Production", "Costs, revenue and return for each flock."],
    ["feed-forecast", "Predictive", "When each feed item will run out."],
    ["customer-lifecycle", "Predictive", "Loyal, at-risk and dormant customers."],
    ["audit", "Operational", "Every correction made to your records."],
    ["traceability", "Operational", "Follow a day's eggs back to the flock."]
  ].map(function (a) { return { key: a[0], group: a[1], icon: "", title: TITLES[a[0]], desc: a[2] }; });
  // Reports that take the single period dropdown. The others are a snapshot (inventory, feed forecast),
  // take a date (traceability) or have their own Period A / Period B panel (period-comparison).
  const DATED = new Set(["pl", "cash-flow", "fcr", "hhep", "cost-per-crate", "flock-roi", "audit", "customer-lifecycle"]);
  const PRESETS = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"], ["year", "This year"], ["all", "All time"]];

  /* ---------- state (own state, never state.dashPeriod) ---------- */
  const S = {
    preset: "30d", date: "", tab: "all", search: "", seq: 0,
    rev: "line", egg: "saleable",
    index: { farmId: null, status: "idle", list: [] },
    t: { sales: null, expense: null, production: null, gb: "day", pgb: "day" },
    c: { rev: null, egg: null }
  };

  /* ---------- helpers ---------- */
  const root = function () { return $("#ra-root"); };
  const farmName = function () { const f = typeof farm === "function" ? farm() : null; return f && f.name ? f.name : ""; };
  const todayISO = function () { return localISO(new Date()); };
  const mny = function (v) { return v === null || v === undefined ? "—" : R.money(v); };
  const unavailable = function (icon, label) { return R.kpiCard({ icon: icon, label: label, unavailable: true }); };
  const emptyState = function (title, text) { return '<div class="ra-state"><b>' + esc(title) + "</b>" + (text ? "<span>" + esc(text) + "</span>" : "") + "</div>"; };
  const errBox = function (msg) { return '<div class="ra-state error"><b>' + esc(msg || "This could not be loaded.") + '</b><button class="ra-btn" type="button" data-rpt-action="retry">Try again</button></div>'; };

  // Same rules as repBounds in records.js (copied, not called). Always explicit start_date + end_date.
  function bounds() {
    const P = S.preset, now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    if (P === "all") {
      // oldest record date across the loaded records, or today when there are none
      let oldest = "";
      ["sales", "expense", "production", "purchase"].forEach(function (t) {
        ((state.data && state.data[t]) || []).forEach(function (r) {
          const x = String(r.date || "");
          if (x && (!oldest || x < oldest)) oldest = x;
        });
      });
      return { start_date: oldest || todayISO(), end_date: todayISO() };
    }
    let from = new Date(y, m, d), to = new Date(y, m, d);
    if (P === "month") from = new Date(y, m, 1);
    else if (P === "lastmonth") { from = new Date(y, m - 1, 1); to = new Date(y, m, 0); }
    else if (P === "year") from = new Date(y, 0, 1);
    else if (P !== "today") from = new Date(y, m, d - ((parseInt(P, 10) || 30) - 1));
    return { start_date: localISO(from), end_date: localISO(to) };
  }
  const rangeText = function () { const b = bounds(); return R.fmtDate(b.start_date) + " – " + R.fmtDate(b.end_date); };
  const periodSelect = function () {
    return '<select class="ra-select" id="ra-period" aria-label="Period">' +
      PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === S.preset ? " selected" : "") + ">" + p[1] + "</option>"; }).join("") + "</select>";
  };
  // "2026-10-14" -> "14 Oct", "2026-10" -> "Oct 2026"
  function lab(d, gb) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(d));
    if (!m) return String(d);
    const dt = new Date(+m[1], +m[2] - 1, +(m[3] || 1));
    return gb === "month" ? MONTHS[dt.getMonth()] + " " + dt.getFullYear() : dt.getDate() + " " + MONTHS[dt.getMonth()];
  }
  const byDate = function (a, b) { return String(a.date).localeCompare(String(b.date)); };
  function killChart(k) {
    const c = S.c[k];
    if (!c) return;
    try { c.destroy(); } catch (e) { /* already gone */ }
    const i = R.charts.indexOf(c);
    if (i >= 0) R.charts.splice(i, 1);
    S.c[k] = null;
  }
  const segHTML = function (id, opts, cur) {
    return '<div class="ra-seg" role="group">' + opts.map(function (o) {
      return '<button type="button" data-rpt-action="seg" data-seg="' + id + '" data-val="' + o[0] + '" aria-pressed="' + (o[0] === cur) + '">' + o[1] + "</button>";
    }).join("") + "</div>";
  };

  /* ---------- report index ---------- */
  function normIndex(d) {
    let list = Array.isArray(d) ? d : d && (d.reports || d.results || d.items || d.catalog);
    if (!Array.isArray(list) && d && typeof d === "object") {
      list = [];
      Object.keys(d).forEach(function (g) { if (Array.isArray(d[g])) d[g].forEach(function (r) { list.push(Object.assign({ group: g }, r)); }); });
    }
    return (list || []).map(function (r) {
      return { key: r.key || r.id || r.slug, group: R.human(r.group || r.category || "Other"), icon: r.icon || "",
        title: r.title || r.name || TITLES[r.key] || R.human(r.key || ""), desc: r.desc || r.description || "" };
    }).filter(function (r) { return r.key; });
  }
  async function loadIndex(farmId) {
    const ix = S.index;
    if (ix.farmId === farmId && ix.status === "ready") return ix.list;
    let list;
    try { list = normIndex(await AgroAPI.getReportIndex(farmId)); }
    catch (e) { if (e && (e.status === 404 || e.status === 405)) list = FALLBACK_INDEX; else throw e; }
    if (!list.length) list = FALLBACK_INDEX;
    Object.assign(ix, { farmId: farmId, status: "ready", list: list });
    return list;
  }
  const hubIcon = function (name) { return R.icon(name && typeof ICONS !== "undefined" && ICONS[name] ? name : "reports", 20); };

  /* ---------- overview: search, tabs, cards (repainted in place) ---------- */
  function visible(list) {
    const q = S.search.trim().toLowerCase();
    return list.filter(function (r) { return !q || (r.title + " " + r.desc + " " + r.group).toLowerCase().indexOf(q) !== -1; });
  }
  function tabsHTML(list) {
    const vis = visible(list);
    return TABS.map(function (t) {
      const n = t === "all" ? vis.length : vis.filter(function (r) { return r.group === t; }).length;
      return '<button class="ra-tab" type="button" role="tab" data-rpt-action="tab" data-rpt-tab="' + t + '" aria-selected="' + (t === S.tab) + '">' +
        (t === "all" ? "All" : t) + '<span class="ra-tab-count">' + n + "</span></button>";
    }).join("");
  }
  function cardsHTML(list) {
    const vis = visible(list).filter(function (r) { return S.tab === "all" || r.group === S.tab; });
    if (!vis.length) return emptyState("No reports match", "Try a different word or choose another group.");
    const groups = {};
    vis.forEach(function (r) { (groups[r.group] = groups[r.group] || []).push(r); });
    const names = Object.keys(groups).sort(function (a, b) {
      const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return names.map(function (g) {
      return '<section><h2 class="ra-group-title">' + esc(g) + '</h2><div class="ra-rgrid">' + groups[g].map(function (r) {
        return '<a class="ra-rcard" href="#/reports/' + encodeURIComponent(r.key) + '"><div class="ra-rcard-top"><span class="ra-rcard-ico">' + hubIcon(r.icon) +
          '</span><span class="ra-rcard-group">' + esc(r.group) + "</span></div><h3>" + esc(r.title) + "</h3><p>" + esc(r.desc) + '</p><span class="ra-rcard-go">View report →</span></a>';
      }).join("") + "</div></section>";
    }).join("");
  }
  function paintBrowse() {
    const tabs = $("#ra-tabs"), cards = $("#ra-cards");
    if (!tabs || !cards) return;
    tabs.innerHTML = tabsHTML(S.index.list);
    cards.innerHTML = cardsHTML(S.index.list);
  }

  /* ---------- overview: charts ---------- */
  function mergeTrend(sales, expense, gb) {
    const map = {};
    (sales || []).forEach(function (p) { if (p && p.date) { map[p.date] = map[p.date] || { r: 0, e: 0 }; map[p.date].r += R.toNum(p.revenue) || 0; } });
    (expense || []).forEach(function (p) { if (p && p.date) { map[p.date] = map[p.date] || { r: 0, e: 0 }; map[p.date].e += R.toNum(p.amount) || 0; } });
    const dates = Object.keys(map).sort();
    return { labels: dates.map(function (d) { return lab(d, gb); }), revenue: dates.map(function (d) { return map[d].r; }), expenses: dates.map(function (d) { return map[d].e; }) };
  }
  function drawRev() {
    const t = S.t, body = $("#ra-rev-body");
    if (!body || !t.sales || !t.expense) return;   // wait until both have answered
    killChart("rev");
    if (t.sales.err && t.expense.err) { body.innerHTML = errBox("The trend could not be loaded."); return; }
    const m = mergeTrend(t.sales.rows, t.expense.rows, t.gb);
    if (!m.labels.length) { body.innerHTML = R.chartBox("", { empty: true, emptyText: "No data in this period yet" }); return; }
    body.innerHTML = R.chartBox("ra-rev-cv");
    const th = R.theme(), el = $("#ra-rev-cv");
    const sets = [{ label: "Revenue", data: m.revenue, color: th.income, fill: S.rev === "line" }, { label: "Operating expenses", data: m.expenses, color: th.expense }];
    S.c.rev = S.rev === "bar" ? R.bar(el, { labels: m.labels, datasets: sets, money: true }) : R.line(el, { labels: m.labels, datasets: sets, money: true });
  }
  function drawEgg() {
    const t = S.t.production, body = $("#ra-egg-body");
    if (!body || !t) return;
    killChart("egg");
    if (t.err) { body.innerHTML = errBox("The egg trend could not be loaded."); return; }
    const rows = t.rows.slice().sort(byDate);
    const vals = rows.map(function (p) { return R.toNum(p[S.egg]) || 0; });
    if (!rows.length || !vals.some(function (v) { return v > 0; })) { body.innerHTML = R.chartBox("", { empty: true, emptyText: "No eggs recorded in this period yet" }); return; }
    body.innerHTML = R.chartBox("ra-egg-cv");
    S.c.egg = R.line($("#ra-egg-cv"), {
      labels: rows.map(function (p) { return lab(p.date, S.t.pgb); }),
      datasets: [{ label: S.egg === "saleable" ? "Saleable eggs" : "Eggs collected", data: vals, color: R.theme().green, fill: true }]
    });
  }

  /* ---------- overview: page ---------- */
  function hubHTML() {
    const skelKpis = [0, 1, 2, 3, 4].map(function (i) { return '<div class="ra-skel kpi" id="ra-k' + i + '"></div>'; }).join("");
    const skel = '<div class="ra-skel chart"></div>';
    return '<header class="ra-head"><div><h1>Reports &amp; Analytics</h1><p>' + (farmName() ? esc(farmName()) + " · " : "") + esc(rangeText()) + "</p></div>" +
      '<div class="ra-head-tools">' + periodSelect() + '<button class="ra-btn" type="button" data-rpt-action="print">' + R.icon("download", 16) + "Print</button></div></header>" +
      '<div class="ra-kpis" id="ra-kpis">' + skelKpis + "</div>" +
      '<div class="ra-grid two">' +
        R.chartCard({ title: "Revenue vs expenses", sub: "Expense records only; feed and medicine costs are in the P&L", tools: segHTML("rev", [["line", "Line"], ["bar", "Bars"]], S.rev), body: '<div id="ra-rev-body">' + skel + "</div>" }) +
        R.chartCard({ title: "Egg production", sub: "Eggs per day in the selected period", tools: segHTML("egg", [["saleable", "Saleable"], ["collected", "Collected"]], S.egg), body: '<div id="ra-egg-body">' + skel + "</div>" }) +
      "</div>" +
      '<div class="ra-toolbar"><div class="ra-search">' + R.icon("search", 16) + '<input id="ra-search" type="search" placeholder="Search reports..." aria-label="Search reports" autocomplete="off" value="' + esc(S.search) + '"></div>' +
      '<div class="ra-tabs" id="ra-tabs" role="tablist"></div></div>' +
      '<div id="ra-cards">' + skel + "</div>";
  }

  // The previous value is only known as a percentage change, so rebuild it: prev = cur / (1 + pct/100).
  function prevFromPct(cur, pct) {
    const c = R.toNum(cur), p = R.toNum(pct);
    return c === null || p === null || p <= -100 ? null : c / (1 + p / 100);
  }
  function plFig(d) {
    if (typeof R.plFigures === "function") return R.plFigures(d || {});
    // fallback if views.js was not updated: top-level keys only
    const prevObj = (d && (d.previous || d.prev || d.previous_period)) || {};
    const f = function (k) { return { cur: R.toNum(d && d[k]), prev: R.toNum(prevObj[k]) }; };
    const rev = f("revenue"), net = f("net_profit");
    const sub = function (a, b) { return a === null || b === null ? null : a - b; };
    return { revenue: rev, net: net, costs: { cur: sub(rev.cur, net.cur), prev: sub(rev.prev, net.prev) } };
  }

  // Feed days left: the most urgent feed item from GET /reports/feed-forecast/.
  // The server sends { items: [{ name, days_left, severity, ... }] }. The smallest days_left wins.
  // A few alternative field names are accepted so a renamed field does not blank the card.
  function feedKpi(d) {
    const all = Array.isArray(d) ? d
      : Array.isArray(d && d.items) ? d.items
      : Array.isArray(d && d.results) ? d.results
      : Array.isArray(d && d.forecast) ? d.forecast : [];
    const pick = function (o) {
      for (let i = 1; i < arguments.length; i++) {
        const v = R.toNum(o[arguments[i]]);
        if (v !== null && isFinite(v)) return v;
      }
      return null;
    };
    const items = all.map(function (i) {
      return { name: i.name || i.item_name || i.item || "", days: pick(i, "days_left", "days_remaining", "days_to_runout", "days"), sev: String(i.severity || "").toLowerCase() };
    }).filter(function (i) { return i.days !== null; })
      .sort(function (a, b) { return a.days - b.days; });

    if (!items.length) {
      return R.kpiCard({ icon: "clock", label: "Feed days left", value: "—", note: all.length ? "No usage data yet" : "No stock-tracked feed items" });
    }
    const s = items[0], days = Math.max(0, Math.round(s.days * 10) / 10);
    // Colour follows the days left: red at 3 days or fewer, amber at 7 or fewer, otherwise normal.
    const tone = days <= 3 ? "red" : days <= 7 ? "amber" : "";
    const status = tone === "red" ? "Critical" : tone === "amber" ? "Running low" : "OK";
    return R.kpiCard({
      icon: "clock", label: "Feed days left", value: days + (days === 1 ? " day" : " days"),
      tone: tone, neg: tone === "red", note: (s.name ? s.name + " · " : "") + status
    });
  }

  function loadHub() {
    const r = root();
    if (!r) return;
    const seq = ++S.seq, farmId = state.farmId, range = bounds();
    R.destroyAll();
    S.c = { rev: null, egg: null };
    S.t = { sales: null, expense: null, production: null, gb: "day", pgb: "day" };
    r.dataset.frame = "";
    r.innerHTML = hubHTML();
    const alive = function () { const x = root(); return seq === S.seq && x && x.dataset.key === "" && state.farmId === farmId; };
    const setKpi = function (i, html) { const el = $("#ra-k" + i); if (el) el.outerHTML = html; };

    // Report cards
    loadIndex(farmId).then(function () { if (alive()) paintBrowse(); }, function (e) {
      if (!alive()) return;
      $("#ra-cards").innerHTML = errBox((e && e.message) || "The reports could not be loaded.");
    });

    // KPI 1-3: Revenue, Total costs, Net profit (P&L, with previous period)
    AgroAPI.getReport(farmId, "pl", range).then(function (d) {
      if (!alive()) return;
      try {
        const f = plFig(d), n = f.net.cur;
        setKpi(0, R.kpiCard({ icon: "wallet", label: "Revenue", value: mny(f.revenue.cur), cur: f.revenue.cur, prev: f.revenue.prev }));
        setKpi(1, R.kpiCard({ icon: "chart", label: "Total costs", value: mny(f.costs.cur), cur: f.costs.cur, prev: f.costs.prev, inverse: true, tone: "amber" }));
        setKpi(2, R.kpiCard({ icon: "trend", label: "Net profit", value: mny(n), cur: n, prev: f.net.prev, neg: n !== null && n < 0, tone: n !== null && n < 0 ? "red" : "" }));
      } catch (err) {
        console.error("Reports overview: P&L cards failed", err);
        setKpi(0, unavailable("wallet", "Revenue")); setKpi(1, unavailable("chart", "Total costs")); setKpi(2, unavailable("trend", "Net profit"));
      }
    }, function () {
      if (!alive()) return;
      setKpi(0, unavailable("wallet", "Revenue")); setKpi(1, unavailable("chart", "Total costs")); setKpi(2, unavailable("trend", "Net profit"));
    });

    // KPI 4 + egg chart: production stats and trend
    AgroAPI.getRecordsReport(farmId, "production", range).then(function (rep) {
      if (!alive()) return;
      const sum = rep && rep.stats && rep.stats.summary;
      if (sum) {
        const eggs = sum.eggs_collected, tr = rep.stats.trends || {};
        setKpi(3, R.kpiCard({ icon: "egg", label: "Eggs collected", value: eggs == null ? "—" : R.num(eggs), cur: eggs, prev: prevFromPct(eggs, tr.collected) }));
      } else setKpi(3, unavailable("egg", "Eggs collected"));
      S.t.production = { rows: (rep && rep.trend) || [], err: !!(rep && rep.errors && rep.errors.trend) };
      S.t.pgb = (rep && rep.stats && rep.stats.period && rep.stats.period.group_by) || "day";
      drawEgg();
    }, function () {
      if (!alive()) return;
      setKpi(3, unavailable("egg", "Eggs collected"));
      S.t.production = { rows: [], err: true }; drawEgg();
    });

    // KPI 5: soonest feed runout (smallest days_left across all feed items)
    AgroAPI.getReport(farmId, "feed-forecast").then(function (d) {
      if (!alive()) return;
      try { setKpi(4, feedKpi(d)); }
      catch (err) { console.error("Reports overview: feed card failed", err); setKpi(4, unavailable("clock", "Feed days left")); }
    }, function () { if (alive()) setKpi(4, unavailable("clock", "Feed days left")); });

    // Revenue vs expenses chart: sales + expense trends (drawn once both have answered)
    const trendDone = function (slot, rep, failed) {
      if (!alive()) return;
      S.t[slot] = { rows: failed ? [] : ((rep && rep.trend) || []), err: failed || !!(rep && rep.errors && rep.errors.trend) };
      const p = rep && rep.stats && rep.stats.period;
      if (p && p.group_by) S.t.gb = p.group_by;
      drawRev();
    };
    AgroAPI.getRecordsReport(farmId, "sales", range).then(function (rep) { trendDone("sales", rep, false); }, function () { trendDone("sales", null, true); });
    AgroAPI.getRecordsReport(farmId, "expense", range).then(function (rep) { trendDone("expense", rep, false); }, function () { trendDone("expense", null, true); });
  }


  /* ---------- table pagination (same look as Records: "Page 1 of n" + Previous / Next) ---------- */
  const TABLE_PAGE = 10;
  function paginateTables(scope) {
    if (!scope) return;
    scope.querySelectorAll(".ra-table-wrap").forEach(function (wrap) {
      const tbl = wrap.querySelector("table.ra-table");
      if (!tbl || tbl.classList.contains("ra-pl") || wrap.dataset.paged) return;   // the income statement stays whole
      const body = tbl.tBodies[0];
      if (!body) return;
      const rows = Array.prototype.slice.call(body.rows);
      const pages = Math.ceil(rows.length / TABLE_PAGE);
      if (pages < 2) return;
      wrap.dataset.paged = "1";
      let page = 0;
      const foot = document.createElement("div");
      foot.className = "ra-foot";
      foot.innerHTML = '<span class="ra-foot-info"></span><div class="ra-pager"><button type="button" data-pg="prev">Previous</button><button type="button" data-pg="next">Next</button></div>';
      wrap.parentNode.insertBefore(foot, wrap.nextSibling);
      const info = foot.querySelector(".ra-foot-info"), prev = foot.querySelector('[data-pg="prev"]'), next = foot.querySelector('[data-pg="next"]');
      function show() {
        rows.forEach(function (r, i) { r.hidden = Math.floor(i / TABLE_PAGE) !== page; });
        const from = page * TABLE_PAGE + 1, to = Math.min(rows.length, (page + 1) * TABLE_PAGE);
        info.textContent = "Page " + (page + 1) + " of " + pages + " · Showing " + from + "–" + to + " of " + rows.length;
        prev.disabled = page === 0;
        next.disabled = page >= pages - 1;
      }
      prev.addEventListener("click", function () { page = Math.max(0, page - 1); show(); });
      next.addEventListener("click", function () { page = Math.min(pages - 1, page + 1); show(); });
      show();
    });
  }

  /* ---------- Period Comparison: Period A vs Period B ---------- */
  const CMP_PRESETS = [["7d", "Last 7 days"], ["week", "This week"], ["lastweek", "Last week"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"],
    ["year", "This year"], ["lastyear", "Last year"], ["custom", "Custom"]];
  S.cmp = { ready: false, a: { preset: "30d", from: "", to: "" }, b: { preset: "custom", from: "", to: "" } };

  const addDaysISO = function (iso, n) { const p = String(iso).split("-"); return localISO(new Date(+p[0], +p[1] - 1, +p[2] + n)); };

  // Turns a block ({preset, from, to}) into { start, end } ISO dates.
  function cmpResolve(b) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const dow = (now.getDay() + 6) % 7;          // days since Monday (Mon = 0 ... Sun = 6)
    switch (b.preset) {
      case "7d": return { start: localISO(new Date(y, m, d - 6)), end: todayISO() };
      case "week": return { start: localISO(new Date(y, m, d - dow)), end: todayISO() };                    // Monday to today
      case "lastweek": return { start: localISO(new Date(y, m, d - dow - 7)), end: localISO(new Date(y, m, d - dow - 1)) };   // last Monday to last Sunday
      case "30d": return { start: localISO(new Date(y, m, d - 29)), end: todayISO() };
      case "month": return { start: localISO(new Date(y, m, 1)), end: todayISO() };
      case "lastmonth": return { start: localISO(new Date(y, m - 1, 1)), end: localISO(new Date(y, m, 0)) };
      case "year": return { start: localISO(new Date(y, 0, 1)), end: todayISO() };
      case "lastyear": return { start: localISO(new Date(y - 1, 0, 1)), end: localISO(new Date(y - 1, 11, 31)) };
      default: return { start: b.from || "", end: b.to || "" };
    }
  }

  // Smart default: when Period A changes, suggest Period B.
  function cmpSuggestB() {
    const a = S.cmp.a, r = cmpResolve(a), now = new Date(), y = now.getFullYear(), m = now.getMonth();
    let b = null;
    if (a.preset === "7d" || a.preset === "30d") {
      const n = a.preset === "7d" ? 7 : 30, end = addDaysISO(r.start, -1);
      b = { preset: "custom", from: addDaysISO(end, -(n - 1)), to: end };          // the same number of days right before A
    } else if (a.preset === "week") b = { preset: "lastweek" };
    else if (a.preset === "lastweek") {
      const d = now.getDate(), dow = (now.getDay() + 6) % 7;
      b = { preset: "custom", from: localISO(new Date(y, m, d - dow - 14)), to: localISO(new Date(y, m, d - dow - 8)) };   // the week before last week
    } else if (a.preset === "month") b = { preset: "lastmonth" };
    else if (a.preset === "year") b = { preset: "lastyear" };
    else if (a.preset === "lastmonth") b = { preset: "custom", from: localISO(new Date(y, m - 2, 1)), to: localISO(new Date(y, m - 1, 0)) };
    else if (a.preset === "lastyear") b = { preset: "custom", from: localISO(new Date(y - 2, 0, 1)), to: localISO(new Date(y - 2, 11, 31)) };
    if (b) S.cmp.b = Object.assign({ from: "", to: "" }, b);                       // "custom" on A leaves B alone
  }

  // Validates both blocks and builds the query params the backend expects.
  function cmpParams() {
    const A = cmpResolve(S.cmp.a), B = cmpResolve(S.cmp.b);
    const bad = function (x, label) {
      if (!x.start || !x.end) return label + ": choose both a From and a To date.";
      if (x.start > x.end) return label + ": the From date is after the To date.";
      return "";
    };
    const error = bad(A, "Period A") || bad(B, "Period B");
    if (error) return { error: error };
    return {
      params: { start_date_a: A.start, end_date_a: A.end, start_date_b: B.start, end_date_b: B.end },
      a: { start_date: A.start, end_date: A.end }, b: { start_date: B.start, end_date: B.end }
    };
  }

  function cmpRangeText(blk) {
    const r = cmpResolve(blk);
    if (!r.start || !r.end) return "Pick both dates";
    return r.start > r.end ? "The From date is after the To date" : R.fmtDate(r.start) + " – " + R.fmtDate(r.end);
  }
  function cmpBlockHTML(w, title, blk) {
    const custom = blk.preset === "custom", id = "ra-cmp-" + w;
    return '<div class="ra-cmp-block"><h3 class="ra-cmp-title">' + title + "</h3>" +
      '<label class="ra-cmp-lbl" for="' + id + '-preset">Range</label>' +
      '<select class="ra-select" id="' + id + '-preset">' + CMP_PRESETS.map(function (p) {
        return '<option value="' + p[0] + '"' + (p[0] === blk.preset ? " selected" : "") + ">" + p[1] + "</option>";
      }).join("") + "</select>" +
      '<div class="ra-cmp-custom"' + (custom ? "" : " hidden") + ">" +
        '<label class="ra-cmp-lbl">From<input class="ra-date" type="date" id="' + id + '-from" value="' + esc(blk.from) + '"></label>' +
        '<label class="ra-cmp-lbl">To<input class="ra-date" type="date" id="' + id + '-to" value="' + esc(blk.to) + '"></label>' +
      "</div>" +
      '<p class="ra-cmp-range" id="' + id + '-range">' + esc(cmpRangeText(blk)) + "</p></div>";
  }
  function cmpBlocksHTML() {
    return cmpBlockHTML("a", "Period A", S.cmp.a) +
      '<button class="ra-btn ra-cmp-swap" type="button" data-rpt-action="cmp-swap" aria-label="Swap Period A and Period B"><span class="ra-cmp-swap-ico" aria-hidden="true">⇄</span>Swap</button>' +
      cmpBlockHTML("b", "Period B", S.cmp.b);
  }
  function cmpPanelHTML() {
    if (!S.cmp.ready) { cmpSuggestB(); S.cmp.ready = true; }   // first visit: B = the 30 days before A
    return '<section class="ra-cmp" aria-label="Compare two periods"><div class="ra-cmp-blocks" id="ra-cmp-blocks">' + cmpBlocksHTML() + "</div>" +
      '<p class="ra-cmp-err" id="ra-cmp-err" role="alert"></p>' +
      '<div class="ra-cmp-actions"><button class="ra-btn ra-cmp-go" type="button" data-rpt-action="cmp-run">Compare</button></div></section>';
  }
  const paintCmp = function () { const el = $("#ra-cmp-blocks"); if (el) el.innerHTML = cmpBlocksHTML(); };
  function cmpChange(which, field, val) {
    const blk = S.cmp[which], err = $("#ra-cmp-err");
    if (err) err.textContent = "";
    if (field === "preset") {
      if (val === "custom") { const cur = cmpResolve(blk); blk.from = cur.start; blk.to = cur.end; }   // start from the dates already shown
      blk.preset = val;
      if (which === "a") cmpSuggestB();
      paintCmp();
    } else {
      blk[field] = val;                                   // typing in a date field: no repaint, so focus is kept
      const rg = $("#ra-cmp-" + which + "-range");
      if (rg) rg.textContent = cmpRangeText(blk);
    }
  }

  /* ---------- report page ---------- */
  const subText = function (key) {
    if (key === "period-comparison") return (farmName() ? farmName() + " · " : "") + "Compare any two date ranges";
    if (key === "traceability") return "Date: " + R.fmtDate(S.date);
    if (DATED.has(key)) return (farmName() ? farmName() + " · " : "") + "Period: " + rangeText();
    return (farmName() ? farmName() + " · " : "") + "As of " + R.fmtDate(todayISO());
  };
  const bodySkeleton = function () {
    return '<div class="ra-kpis four">' + [0, 1, 2, 3].map(function () { return '<div class="ra-skel kpi"></div>'; }).join("") + '</div><div class="ra-skel chart"></div>';
  };
  function frameHTML(key) {
    let ctl = "";
    if (key === "traceability") ctl = '<input class="ra-date" type="date" id="ra-date" aria-label="Date" value="' + esc(S.date) + '" max="' + esc(todayISO()) + '">';
    else if (DATED.has(key)) ctl = periodSelect();
    return '<a class="ra-back" href="#/reports">← All reports</a>' +
      '<header class="ra-frame-head"><div><h1>' + esc(TITLES[key] || R.human(key)) + '</h1><p id="ra-sub">' + esc(subText(key)) + "</p></div>" +
      '<div class="ra-frame-tools ra-head-tools">' + ctl + '<button class="ra-btn" type="button" data-rpt-action="print">' + R.icon("download", 16) + "Print</button></div></header>" +
      (key === "period-comparison" ? cmpPanelHTML() : "") +
      '<div id="ra-body">' + bodySkeleton() + "</div>";
  }

  async function loadReport(key) {
    const r = root();
    if (!r) return;
    const seq = ++S.seq, farmId = state.farmId;
    R.destroyAll();
    if (key === "traceability" && !S.date) S.date = todayISO();
    // Build the frame once per report; a period change only refreshes the subtitle and the body.
    if (!$("#ra-body") || r.dataset.frame !== key) { r.innerHTML = frameHTML(key); r.dataset.frame = key; }
    else { $("#ra-body").innerHTML = bodySkeleton(); $("#ra-sub").textContent = subText(key); }
    const stale = function () { const x = root(); return seq !== S.seq || !x || x.dataset.key !== key || state.farmId !== farmId; };
    const v = R.views[key];
    if (!v) { $("#ra-body").innerHTML = emptyState("This report isn't available yet", "It has no layout in this version of the app."); return; }
    const range = bounds();
    let params, cmp = null;
    if (key === "traceability") params = { date: S.date };
    else if (key === "period-comparison") {
      const p = cmpParams(), eb = $("#ra-cmp-err");
      if (p.error) { if (eb) eb.textContent = p.error; $("#ra-body").innerHTML = ""; return; }
      if (eb) eb.textContent = "";
      cmp = { a: p.a, b: p.b };
      params = p.params;                       // start_date_a, end_date_a, start_date_b, end_date_b
    } else params = DATED.has(key) ? range : {};
    try {
      const data = (await AgroAPI.getReport(farmId, key, params)) || {};
      if (stale()) return;
      let extra = null;
      if (v.extra) {
        try { extra = await v.extra({ farmId: farmId, range: range }); } catch (e) { console.warn("Report extra data failed:", key, e); }
        if (stale()) return;
      }
      R.destroyAll();
      let out;
      try { out = v.render(data, { farmId: farmId, range: range, extra: extra, cmp: cmp }); }
      catch (err) { console.error("Report render failed:", key, err); out = { html: emptyState("This report could not be displayed", "Open it with ?debug=1 in the address bar to see the raw response.") }; }
      const body = $("#ra-body");
      const debug = new URLSearchParams(location.search).get("debug") === "1"
        ? '<details class="ra-debug"><summary>Raw response</summary><pre>' + esc(JSON.stringify(data, null, 2)) + "</pre></details>" : "";
      body.innerHTML = R.insights(data.insights) + out.html + debug;
      paginateTables(body);
      if (out.post) { try { out.post(body); } catch (err) { console.error("Report charts failed:", key, err); } }
    } catch (e) {
      if (stale()) return;
      $("#ra-body").innerHTML = errBox(e && e.status === 404 ? "This report isn't available on the server yet." : (e && e.message) || "The report could not be loaded.");
    }
  }

  /* ---------- entry point (called from renderView in shell.js) ---------- */
  function reportsView(sub) {
    R.destroyAll();
    S.seq++;
    let key = "";
    try { key = sub ? decodeURIComponent(sub) : ""; } catch (e) { key = ""; }
    S.search = key ? S.search : (state.query || "");
    queueMicrotask(function () {
      const r = root();
      if (!r || r.dataset.key !== key || !state.farmId) return;
      if (key) loadReport(key); else loadHub();
    });
    return '<div class="ra-page" id="ra-root" data-key="' + esc(key) + '"></div>';
  }
  window.reportsView = reportsView;

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    const a = e.target.closest("[data-rpt-action]"), r = root();
    if (!a || !r) return;
    const act = a.dataset.rptAction;
    if (act === "print") window.print();
    else if (act === "retry") { if (r.dataset.key) loadReport(r.dataset.key); else loadHub(); }
    else if (act === "tab") { S.tab = a.dataset.rptTab; paintBrowse(); }
    else if (act === "seg") {
      const id = a.dataset.seg;
      S[id] = a.dataset.val;
      $$('[data-rpt-action="seg"][data-seg="' + id + '"]').forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.val === S[id])); });
      if (id === "rev") drawRev(); else drawEgg();
    }
    else if (act === "cmp-swap") { const t = S.cmp.a; S.cmp.a = S.cmp.b; S.cmp.b = t; paintCmp(); }
    else if (act === "cmp-run") {
      const p = cmpParams(), eb = $("#ra-cmp-err");
      if (p.error) { if (eb) eb.textContent = p.error; return; }
      if (eb) eb.textContent = "";
      loadReport("period-comparison");
    }
  });

  document.addEventListener("change", function (e) {
    const r = root();
    if (!r) return;
    const cm = /^ra-cmp-([ab])-(preset|from|to)$/.exec(e.target.id || "");
    if (cm) { cmpChange(cm[1], cm[2], e.target.value); return; }
    if (e.target.id === "ra-period") {
      S.preset = e.target.value;
      if (r.dataset.key) loadReport(r.dataset.key); else loadHub();
    } else if (e.target.id === "ra-date" && e.target.value) {
      S.date = e.target.value;
      loadReport(r.dataset.key);
    }
  });

  // The page search box and the top-bar search both filter the report cards in place.
  // handlers.js does not re-render on the reports page, so nothing wipes the page while typing.
  document.addEventListener("input", function (e) {
    const id = e.target.id, r = root();
    if ((id !== "ra-search" && id !== "search") || !r || r.dataset.key) return;
    S.search = e.target.value;
    const other = $(id === "search" ? "#ra-search" : "#search");
    if (other && other.value !== e.target.value) other.value = e.target.value;
    paintBrowse();
  });

  // Leaving Reports: cancel in-flight loads and destroy every chart.
  window.addEventListener("hashchange", function () {
    if (location.hash.split("/")[1] !== "reports") { S.seq++; R.destroyAll(); S.c = { rev: null, egg: null }; }
  });
})();