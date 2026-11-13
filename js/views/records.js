/* js/views/records.js - recordsView (the tables) */
"use strict";

  // Newest first: by when the record was created, then by its date, then by id.
  const newestFirst = (rows) => rows.slice().sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime() || 0;
    const tb = new Date(b.created_at || 0).getTime() || 0;
    if (tb !== ta) return tb - ta;
    const byDate = String(b.date || "").localeCompare(String(a.date || ""));
    if (byDate) return byDate;
    return num(b.id) - num(a.id);
  });
  const REC_PAGE = 10; // rows per page in every Records table
  const PROD_STAGES = ["Chick", "Grower", "Pullet", "Layer", "Spent hen"];

  /* ---------- Filters for each Records tab ---------- */
  // Every tab has a date range plus the fields listed here. options() returns plain values
  // or [value, label] pairs; test(row, chosenValue) says whether a row passes that filter.
  const distinct = (rows, fn) => [...new Set(rows.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
  const flockPairs = () => state.data.flock.map((f) => [String(f.id), f.identifier]);
  const PAYMENT_OPTS = [["paid", "Paid in full"], ["owing", "Has a balance"]];
  const payTest = (r, v) => (v === "owing" ? num(r.outstanding_balance) > 0 : num(r.outstanding_balance) <= 0);
  const REC_FILTERS = {
    flock: { date: "arrival_date", fields: [
      { key: "stage", label: "Production stage", all: "All stages", options: () => PROD_STAGES, test: (r, v) => r.stage === v },
      { key: "status", label: "Status", all: "All statuses", options: () => ["Active", "Sold out", "Closed"], test: (r, v) => r.status === v },
    ] },
    production: { fields: [
      { key: "flock", label: "Flock", all: "All flocks", options: flockPairs, test: (r, v) => String(r.flock) === v },
      { key: "stage", label: "Production stage", all: "All stages", options: () => PROD_STAGES, test: (r, v) => (findFlock(r.flock) || {}).stage === v },
    ] },
    sales: { fields: [
      { key: "customer", label: "Customer", all: "All customers", options: (rows) => distinct(rows, (r) => r.customer), test: (r, v) => r.customer === v },
      { key: "product", label: "Product", all: "All products", options: (rows) => distinct(rows, (r) => r.product), test: (r, v) => r.product === v },
      { key: "payment", label: "Payment", all: "All payments", options: () => PAYMENT_OPTS, test: payTest },
    ] },
    purchase: { fields: [
      { key: "supplier", label: "Supplier", all: "All suppliers", options: (rows) => distinct(rows, (r) => r.supplier), test: (r, v) => r.supplier === v },
      { key: "status", label: "Receipt", all: "All receipts", options: () => [["RECEIVED", "Received"], ["ORDERED", "Ordered"]], test: (r, v) => String(r.status).toUpperCase() === v },
      { key: "payment", label: "Payment", all: "All payments", options: () => PAYMENT_OPTS, test: payTest },
    ] },
    expense: { fields: [
      { key: "category", label: "Category", all: "All categories", options: (rows) => distinct(rows, (r) => r.category), test: (r, v) => r.category === v },
      { key: "supplier", label: "Supplier", all: "All suppliers", options: (rows) => distinct(rows, (r) => r.supplier), test: (r, v) => r.supplier === v },
      { key: "payment", label: "Payment", all: "All payments", options: () => PAYMENT_OPTS, test: payTest },
    ] },
    activity: { fields: [
      { key: "type", label: "Activity type", all: "All types", options: (rows) => distinct(rows, (r) => r.type), test: (r, v) => r.type === v },
      { key: "flock", label: "Flock", all: "All flocks", options: flockPairs, test: (r, v) => String(r.flock) === v },
    ] },
  };
  const recFilterOf = (type) => (state.recFilters || {})[type] || {};
  const recFilterActive = (type) => Object.values(recFilterOf(type)).some(Boolean);

  function filterRecords(type, rows) {
    const cfg = REC_FILTERS[type];
    if (!cfg) return rows;
    const f = recFilterOf(type), dk = cfg.date || "date";
    return rows.filter((r) => {
      const day = String(r[dk] || "").slice(0, 10);
      return (!f.from || day >= f.from) && (!f.to || day <= f.to) && cfg.fields.every((fd) => !f[fd.key] || fd.test(r, f[fd.key]));
    });
  }

  // The filter panel. It is shown and hidden with the Filter button.
  function recFilterPanel(type, allRows) {
    const cfg = REC_FILTERS[type], f = recFilterOf(type);
    const fields = cfg.fields.map((fd) => {
      const opts = fd.options(allRows).map((o) => (Array.isArray(o) ? o : [o, o]));
      return `<div class="field"><label for="pf-${fd.key}">${esc(fd.label)}</label><div class="control select"><select id="pf-${fd.key}" data-pf="${fd.key}"><option value="">${esc(fd.all)}</option>${opts.map(([v, l]) => `<option value="${esc(v)}"${String(f[fd.key]) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>${icon("chevronDown", 18)}</div></div>`;
    }).join("");
    return `<section class="card filter-card" aria-label="Filters"><div class="filter-grid" style="--n:${cfg.fields.length}">
      <div class="field"><label for="pf-from">Date range</label><div class="date-pair">
        <div class="control date"><input id="pf-from" data-pf="from" type="date" value="${esc(f.from || "")}" aria-label="From date">${icon("calendar", 18)}</div>
        <span class="to">to</span>
        <div class="control date"><input id="pf-to" data-pf="to" type="date" value="${esc(f.to || "")}" aria-label="To date">${icon("calendar", 18)}</div>
      </div></div>
      ${fields}
      <div class="filter-actions"><button class="btn" type="button" data-action="apply-rec-filters" data-type="${type}">${icon("filter", 15)}Apply filters</button>${recFilterActive(type) ? `<button class="link-btn" type="button" data-action="clear-rec-filters" data-type="${type}">Clear</button>` : ""}</div>
    </div></section>`;
  }

  // The four cards above the Production table. They always describe the rows the filters let through.
  function productionCards(rows) {
    const sum = (k) => rows.reduce((t, r) => t + num(r[k]), 0);
    const collected = sum("collected"), damaged = sum("damaged"), saleable = sum("saleable");
    const days = new Set(rows.map((r) => r.date)).size;
    const pct = (a, b) => (b > 0 ? Number(((a / b) * 100).toFixed(2)) + "%" : "—");
    const plural = (n, w) => `${fmtInt(n)} ${w}${n === 1 ? "" : "s"}`;
    const card = (label, value, badge, warn) => `<div class="card pstat"><div class="plbl">${esc(label)}</div><div class="pval">${esc(value)}</div><span class="pbadge${warn ? " warn" : ""}">${esc(badge)}</span></div>`;
    return `<div class="stats">
      ${card("Eggs collected", fmtInt(collected), plural(rows.length, "record"))}
      ${card("Damaged eggs", fmtInt(damaged), pct(damaged, collected), true)}
      ${card("Saleable eggs", fmtInt(saleable), pct(saleable, collected))}
      ${card("Avg. daily collection", fmtInt(days ? Math.round(collected / days) : 0), plural(days, "day"))}
    </div>`;
  }

  function recordsView(type) {
    const rows = newestFirst(state.data[type]);
    const cols = COLS[type];
    const q = state.query.trim().toLowerCase();
    const cells = (r) => cols.map(([, fn]) => String(fn(r) ?? ""));
    const isProd = type === "production";
    const hasFilters = !!REC_FILTERS[type];
    // The filter panel first (date range and the fields of this tab), then the search box.
    const base = filterRecords(type, rows);
    const shown = q ? base.filter((r) => cells(r).join(" ").toLowerCase().includes(q)) : base;
    const label = TABS.find((t) => t[0] === type)[1];
    const filterOpen = hasFilters && !!state.recFilterOpen;

    // One page of rows at a time, with Previous / Next under the table.
    const total = shown.length;
    const pages = Math.max(1, Math.ceil(total / REC_PAGE));
    const page = Math.min(Math.max(0, state.recPage || 0), pages - 1);
    state.recPage = page;
    const pageRows = shown.slice(page * REC_PAGE, (page + 1) * REC_PAGE);

    const prodHeader = `<div class="rep-head"><span class="rep-ic">${icon("egg", 22)}</span><div><p class="rep-kicker">Operational report</p><h1>Production Records</h1><p class="rep-sub">Egg collection, damaged eggs and flock production trends.</p></div></div>`;

    // Permanent entry point for users who skipped the dashboard card
    const addExisting = type === "flock" ? `<button class="btn ghost" data-action="add-existing">${icon("bird", 16)}Add existing flocks</button>` : "";
    const toolbar = `${isProd ? prodHeader : ""}<div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Record types">${visibleTabs().map(([k, l]) => `<button class="tab" role="tab" aria-selected="${k === type}" data-tab="${k}">${l}</button>`).join("")}</div>
      <div class="toolbar-actions">${addExisting}${type === "adjustment" ? "" : `<button class="btn" data-action="add-record" data-type="${type}">${icon("plus", 14)}Add Record</button>`}</div>
    </div>`;

    if (!rows.length) {
      if (type === "adjustment") return toolbar + `<div class="state-card">${icon("inbox", 28)}<h2>No adjustments yet</h2><p>Corrections made with the pencil on a record will be listed here.</p></div>`;
      return toolbar + `<div class="state-card">${icon("inbox", 28)}<h2>No records yet</h2><p>Add your first record to get started</p><button class="btn" data-action="add-record" data-type="${type}">${icon("plus", 14)}Add Record</button></div>`;
    }
    const rowAction = ROW_ACTIONS[type];
    const head = cols.map(([h, , n]) => `<th class="${n ? "num" : ""}">${esc(h)}</th>`).join("") + (rowAction ? `<th class="num">Actions</th>` : "");
    // A column with the 4th flag is shortened on screen with "…" and shows the full text on hover.
    // The data itself (CSV export, search) is never shortened.
    const cellHTML = (r, [, fn, n, trunc]) => {
      const txt = fn(r);
      return trunc
        ? `<td class="trunc" title="${esc(txt)}">${esc(txt)}</td>`
        : `<td class="${n ? "num" : ""}">${esc(txt)}</td>`;
    };
    const body = pageRows.map((r) => `<tr>${cols.map((c) => cellHTML(r, c)).join("")}${rowAction ? `<td class="num">${rowAction(r)}</td>` : ""}</tr>`).join("");
    const pager = `<div class="pager"><span>${total ? page * REC_PAGE + 1 : 0}–${Math.min(total, (page + 1) * REC_PAGE)} of ${fmtInt(total)}</span><div class="pager-btns"><button class="tool-btn" type="button" data-action="rec-prev"${page === 0 ? " disabled" : ""}>Previous</button><button class="tool-btn" type="button" data-action="rec-next"${page >= pages - 1 ? " disabled" : ""}>Next</button></div></div>`;
    const none = q ? `No records match "${esc(state.query)}".` : "No records match these filters.";
    const filterBtn = hasFilters ? `<button class="btn ghost${filterOpen || recFilterActive(type) ? " is-on" : ""}" data-action="filter-records" data-type="${type}" aria-expanded="${filterOpen}">${icon("filter", 14)}Filter</button>` : "";
    return toolbar + (filterOpen ? recFilterPanel(type, rows) : "") + (isProd ? productionCards(base) : "") + `<section class="card table-card">
      <div class="table-head"><h3>${type === "adjustment" ? "Adjustment log" : esc(label) + " records"}</h3><div class="toolbar-actions">${filterBtn}<button class="icon-btn square" data-action="export-records" data-type="${type}" aria-label="Download all records" title="Download all records">${icon("download", 18)}</button></div></div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${pager}` : `<div class="empty-line" style="padding:24px 20px">${none}</div>`}
    </section>`;
  }