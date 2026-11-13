/* js/views/records.js - recordsView (the tables) + config-driven report layout */
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

  /* ---------- Tabs + "Add Record" bar (shared by every tab) ---------- */
  function recordsToolbar(type) {
    // Permanent entry point for users who skipped the dashboard card
    const addExisting = type === "flock" ? `<button class="btn ghost" data-action="add-existing">${icon("bird", 16)}Add existing flocks</button>` : "";
    return `<div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Record types">${visibleTabs().map(([k, l]) => `<button class="tab" role="tab" aria-selected="${k === type}" data-tab="${k}">${l}</button>`).join("")}</div>
      <div class="toolbar-actions">${addExisting}${type === "adjustment" ? "" : `<button class="btn" data-action="add-record" data-type="${type}">${icon("plus", 14)}Add Record</button>`}</div>
    </div>`;
  }

  /* =====================================================================
     REPORT CONFIG - one entry per tab. The engine below reads only this.
     Fields:
       title, subtitle, icon, tableTitle, emptyTable, emptyChart
       dateRangeAffects : "cards+chart" | "chart-only" | "none"   ("none" hides the Date range control)
       filter           : { field, label, all, kind: "flock" | "distinct" }  (frontend-only dropdown)
       sigKeys          : numeric UI-row fields summed into the auto-refresh signature
       rows             : optional () => rows (default state.data[type])
       ownsTable        : true when the page draws its own table (Inventory)
       cards            : [{ label, summaryKey, trendKey?, format, inverse?, warn?, caption?, note?(summary) }]
       dynamicCards     : optional (summary) => [{ label, value, format }] appended after cards
                          (only while no type is picked in typeFilter)
       typeFilter       : optional { label, all, options: [[value, label], ...] }. A BACKEND dropdown (Farm Activities):
                          the value is sent as activity_type to stats + trend and the table is narrowed to it.
       cardsByType      : optional { [type value]: [cards] } used instead of cards/dynamicCards while that type is picked.
                          A type with no entry falls back to cards.
       minCols          : optional minimum card-grid columns, so a short card set does not stretch across the row
       chartPrimary     : { views: [ view, ... ] }   EXACTLY ONE chart card per tab.
                          With 2+ views a .rep-seg toggle swaps the view inside that same card;
                          with 1 view the toggle is hidden.
     A view:
       id, toggle (button text), title, subject (time series) or sub (breakdowns)
       source : "trend" | "breakdown" | "stats.by_type"
       type   : line | area | bar | groupbar | hbar | donut ; seriesTypes[] overrides per series
       seriesKeys, labels, colors, format ("int" | "money" | "pct")
       ints   : true -> whole-number y axis (counts). Money / weight views leave it off.
       stacked, totalLabel, beginAtZero : optional
       guard  : "series"    -> needs >= 3 points and at least one non-zero value
                "breakdown" -> needs more than one non-zero slice
                null        -> no guard
       allOnly: true -> the view only makes sense for the unfiltered tab; with a typeFilter value picked it shows a note
     ===================================================================== */
  // Turn a tab on by adding its key here. Delete this array (and the includes() check in
  // recordsView) once every tab has been tested.
  const REPORT_ENABLED = ["production", "sales", "purchase", "expense", "activity", "flock"];

  const REP_SVG = (d) => `<svg class="i" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const repPretty = (l) => {
    const t = String(l == null ? "" : l);
    return t.length > 1 && /^[A-Z0-9_]+$/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ") : t;
  };

  // One summary card of a single activity type (Farm Activities). summaryKey is the backend's key for that type.
  const ACT_CARD = (label, summaryKey, format) => ({ label, summaryKey, format, caption: "In the selected period" });

  const TAB_REPORT_CONFIG = {
    production: {
      title: "Production records",
      subtitle: "Egg collection, damaged eggs and saleable output across your flocks.",
      icon: REP_SVG('<path d="M12 3c3.6 0 6.5 5.4 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.4 8.4 3 12 3z"/>'),
      tableTitle: "Production records",
      emptyTable: "No production records yet.",
      dateRangeAffects: "cards+chart",
      filter: { field: "flock", label: "Flock", all: "All flocks", kind: "flock" },
      sigKeys: ["collected", "damaged"],
      cards: [
        { label: "Eggs collected", summaryKey: "eggs_collected", trendKey: "collected", format: "int" },
        { label: "Damaged eggs", summaryKey: "eggs_damaged", trendKey: "damaged", format: "int", inverse: true },
        { label: "Saleable eggs", summaryKey: "eggs_saleable", trendKey: "saleable", format: "int",
          note: (sum) => (sum.saleable_rate != null ? Number(sum.saleable_rate).toFixed(1) + "% saleable rate" : "") },
        { label: "Avg. daily collection", summaryKey: "avg_daily_collection", trendKey: "avg_daily", format: "int" }
      ],
      chartPrimary: {
        views: [
          { id: "line", toggle: "Trend", title: "Saleable eggs trend", subject: "saleable eggs",
            source: "trend", type: "line", seriesKeys: ["saleable"], labels: ["Saleable eggs"], colors: ["green"],
            format: "int", ints: true, beginAtZero: false, guard: "series" },
          { id: "bars", toggle: "Collected vs Damaged", title: "Collected vs damaged eggs", subject: "collected and damaged eggs",
            source: "trend", type: "bar", stacked: true, seriesKeys: ["collected", "damaged"], labels: ["Collected", "Damaged"], colors: ["green", "red"],
            format: "int", ints: true, guard: "series" }
        ]
      }
    },

    sales: {
      title: "Sales records",
      subtitle: "Revenue, payments received and outstanding balances from your customers.",
      icon: REP_SVG('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
      tableTitle: "Sales records",
      emptyTable: "No sales records yet.",
      dateRangeAffects: "cards+chart",
      filter: { field: "customer", label: "Customer", all: "All customers", kind: "distinct" },
      sigKeys: ["total", "amount_paid"],
      cards: [
        { label: "Total Revenue", summaryKey: "total_revenue", trendKey: "revenue", format: "money" },
        { label: "Amount Paid", summaryKey: "amount_paid", trendKey: "paid", format: "money" },
        { label: "Outstanding", summaryKey: "outstanding", trendKey: "outstanding", format: "money", inverse: true },
        { label: "Transactions", summaryKey: "transaction_count", trendKey: "count", format: "int" }
      ],
      chartPrimary: {
        views: [
          { id: "trend", toggle: "Revenue Trend", title: "Revenue over time", subject: "revenue",
            source: "trend", type: "area", seriesKeys: ["revenue"], labels: ["Revenue"], colors: ["green"],
            format: "money", guard: "series" },
          { id: "customer", toggle: "By Customer", title: "Revenue by customer", sub: "Share of revenue in this period",
            source: "breakdown", type: "donut", format: "money", guard: "breakdown" }
        ]
      }
    },

    purchase: {
      title: "Purchase records",
      subtitle: "Spend, payments made and outstanding balances owed to your suppliers.",
      icon: REP_SVG('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2.5l2.4 11h10.2l2-8H7"/>'),
      tableTitle: "Purchase records",
      emptyTable: "No purchase records yet.",
      dateRangeAffects: "cards+chart",
      filter: { field: "supplier", label: "Supplier", all: "All suppliers", kind: "distinct" },
      sigKeys: ["total_cost", "amount_paid"],
      cards: [
        { label: "Total Spend", summaryKey: "total_amount", trendKey: "amount", format: "money" },
        { label: "Paid", summaryKey: "amount_paid", trendKey: "paid", format: "money" },
        { label: "Outstanding", summaryKey: "outstanding", trendKey: "outstanding", format: "money", inverse: true },
        { label: "Transactions", summaryKey: "transaction_count", trendKey: "count", format: "int" }
      ],
      chartPrimary: {
        views: [
          { id: "spend", toggle: "Daily Spend", title: "Purchase spend over time", subject: "purchase spend",
            source: "trend", type: "bar", seriesKeys: ["amount"], labels: ["Spend"], colors: ["green"],
            format: "money", guard: "series" },
          { id: "paid", toggle: "Paid vs Total", title: "Paid vs total spend", subject: "paid and total spend",
            source: "trend", type: "groupbar", seriesKeys: ["paid", "amount"], labels: ["Paid", "Total"], colors: ["blue", "green"],
            format: "money", guard: "series" }
        ]
      }
    },

    expense: {
      title: "Expense records",
      subtitle: "Operating costs, payments made and outstanding balances by category.",
      icon: REP_SVG('<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7V6a2 2 0 0 1 2-2h12"/><circle cx="16.5" cy="13.5" r="1"/>'),
      tableTitle: "Expense records",
      emptyTable: "No expense records yet.",
      dateRangeAffects: "cards+chart",
      filter: { field: "category", label: "Category", all: "All categories", kind: "distinct" },
      sigKeys: ["amount", "amount_paid"],
      cards: [
        { label: "Total", summaryKey: "total_amount", trendKey: "amount", format: "money" },
        { label: "Paid", summaryKey: "amount_paid", trendKey: "paid", format: "money" },
        { label: "Outstanding", summaryKey: "outstanding", trendKey: "outstanding", format: "money", inverse: true },
        { label: "Transactions", summaryKey: "transaction_count", trendKey: "count", format: "int" }
      ],
      chartPrimary: {
        views: [
          { id: "trend", toggle: "Spend Trend", title: "Expenses over time", subject: "expenses",
            source: "trend", type: "line", seriesKeys: ["amount"], labels: ["Expenses"], colors: ["green"],
            format: "money", guard: "series" },
          { id: "category", toggle: "By Category", title: "Expenses by category", sub: "Share of spend in this period",
            source: "breakdown", type: "donut", format: "money", guard: "breakdown" }
        ]
      }
    },

    activity: {
      title: "Farm activities",
      subtitle: "Feeding, vaccinations, mortality and other work logged across your flocks.",
      icon: REP_SVG('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
      tableTitle: "Farm activity records",
      emptyTable: "No farm activities yet.",
      dateRangeAffects: "cards+chart",
      filter: { field: "flock", label: "Flock", all: "All flocks", kind: "flock" },
      sigKeys: [],   // the row count is always part of the signature, and that is the number that matters here
      // "Activity type" dropdown. Values are the backend's activity_type codes (they match each row's `code`).
      typeFilter: {
        label: "Activity type", all: "All activities",
        options: [["FEED_CONSUMPTION", "Feed consumption"], ["MORTALITY", "Mortality"], ["MEDICATION", "Medication"],
                  ["VACCINATION", "Vaccination"], ["FLOCK_CHANGE", "Flock change"], ["LOSS", "Damage/Loss"], ["OTHER", "Others"]]
      },
      minCols: 4,
      // All activities (default): the total plus the top 3 types. Exactly as before.
      cards: [
        { label: "Total Activities", summaryKey: "total_activities", format: "int", caption: "In the selected period" }
      ],
      dynamicCards: (sum) => (Array.isArray(sum.by_type) ? sum.by_type : [])
        .slice().sort((a, b) => b.value - a.value).slice(0, 3)
        .map((t) => ({ label: repPretty(t.label), value: t.value, format: "int", caption: "Activities of this type" })),
      // One type picked: cards for that type. A missing backend key shows "—".
      cardsByType: {
        FEED_CONSUMPTION: [ACT_CARD("Total Feed Used", "total_quantity", "int"), ACT_CARD("Feed Cost", "total_cost", "money"), ACT_CARD("Avg Cost/Unit", "avg_cost_per_unit", "money")],
        MORTALITY:        [ACT_CARD("Birds Lost", "total_birds_lost", "int"), ACT_CARD("Mortality Events", "event_count", "int")],
        MEDICATION:       [ACT_CARD("Total Treatments", "total_treatments", "int"), ACT_CARD("Medication Cost", "total_cost", "money")],
        VACCINATION:      [ACT_CARD("Total Vaccinations", "total_vaccinations", "int")],
        FLOCK_CHANGE:     [ACT_CARD("Total Changes", "total_changes", "int")],
        LOSS:             [ACT_CARD("Total Quantity Lost", "total_quantity", "int"), ACT_CARD("Value Lost", "total_value_lost", "money"), ACT_CARD("Loss Events", "event_count", "int")]
      },
      chartPrimary: {
        views: [
          { id: "day", toggle: "Per Day", title: "Activities per day", subject: "activities",
            source: "trend", type: "bar", seriesKeys: ["count"], labels: ["Activities"], colors: ["green"],
            format: "int", ints: true, guard: "series" },
          { id: "type", toggle: "By Type", title: "Activities by type", sub: "Share of activities in this period",
            source: "stats.by_type", type: "donut", format: "int", guard: "breakdown", allOnly: true }
        ]
      }
    },

    flock: {
      title: "Flock records",
      subtitle: "Current flocks, bird counts and mortality. These figures are point-in-time.",
      icon: REP_SVG('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>'),
      tableTitle: "Flock records",
      emptyTable: "No flocks recorded yet.",
      emptyChart: "No flocks recorded yet.",
      dateRangeAffects: "none",
      filter: null,
      sigKeys: ["current_count", "mortality_rate"],
      cards: [
        { label: "Active Flocks", summaryKey: "active_flocks", format: "int", caption: "Currently active" },
        { label: "Total Birds", summaryKey: "total_birds", format: "int", caption: "Across all flocks" },
        { label: "Total Mortality", summaryKey: "total_mortality", format: "int", caption: "Birds lost" },
        { label: "Avg Mortality Rate", summaryKey: "avg_mortality_rate", format: "pct", caption: "Across all flocks" }
      ],
      chartPrimary: {
        views: [   // a single view, so the toggle is hidden
          { id: "stage", toggle: "Birds by Stage", title: "Birds by stage", sub: "Current birds per growth stage",
            source: "breakdown", type: "hbar", labels: ["Birds"], colors: ["green"], format: "int", ints: true, guard: null }
        ]
      }
    },

    // The Inventory page (js/views/inventory.js) is not a Records tab. Its entry lives here so it
    // shares the engine; it is wired in at the last step.
    inventory: {
      title: "Inventory",
      subtitle: "",
      icon: REP_SVG('<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
      ownsTable: true,
      rows: () => state.inventory.items,
      dateRangeAffects: "chart-only",
      filter: null,
      sigKeys: ["current_stock", "total_stock_value"],
      cards: [
        { label: "Total Items", summaryKey: "total_items", format: "int", caption: "In your inventory" },
        { label: "Stock Tracked", summaryKey: "stock_tracked", format: "int", caption: "Items with tracked stock" },
        { label: "In Stock", summaryKey: "in_stock", format: "int", caption: "Tracked items with stock" },
        { label: "Out of Stock", summaryKey: "out_of_stock", format: "int", warn: true, caption: "Needs restocking" },
        { label: "Total Value", summaryKey: "total_value", format: "money", caption: "Current stock value" }
      ],
      chartPrimary: {
        views: [
          { id: "value", toggle: "Value trend", title: "Stock movement value", subject: "stock value moved in and out",
            source: "trend", type: "groupbar", seriesKeys: ["in_value", "out_value"], labels: ["Stock in", "Stock out"], colors: ["green", "amber"],
            format: "money", guard: "series" },
          { id: "category", toggle: "By category", title: "Stock value by category", sub: "Value per category in this period",
            source: "breakdown", type: "donut", format: "money", guard: "breakdown" }
        ]
      }
    }
  };

  /* =====================================================================
     FARM ACTIVITIES: table columns by selected activity type
     Same shape as COLS: [header, fn, isNumeric, truncate].
     With "All activities" (or any type not listed here, such as Vaccination) the normal
     COLS.activity is used. ROW_ACTIONS still draws the Actions column for every layout.
     ===================================================================== */
  // The flock's identifier. Falls back to whatever is on the row when the flock is not in the loaded list.
  const actFlock = (r) => {
    const f = (state.data.flock || []).find((x) => String(x.id) === String(r.flock));
    return f ? f.identifier : (r.flock || "");
  };
  // The item name. Uses item_name from normActivity, then falls back to the items lookup if only an id came back.
  // Adjust "state.lookups" to wherever you keep the lookup lists.
  const actItem = (r) => {
    if (r.item_name) return r.item_name;
    const list = (state.lookups && state.lookups.items) || [];
    const it = list.find((x) => String(x.id) === String(r.item));
    return it ? it.name : "";
  };
  // Quantity with its unit when there is one, for example "12 Bag".
  const actQty = (r) => (r.quantity == null ? "" : repInt(r.quantity) + (r.unit ? " " + r.unit : ""));
  const A_DATE = ["Date", (r) => fmtDate(r.date)];
  const A_FLOCK = ["Flock", actFlock];

  const ACTIVITY_COLS = {
    FEED_CONSUMPTION: [A_DATE, ["Item", actItem], ["Quantity", actQty, true], A_FLOCK],
    MORTALITY:        [A_DATE, A_FLOCK, ["Quantity Lost", (r) => repInt(r.quantity), true], ["Reason", (r) => r.notes, false, true]],
    FLOCK_CHANGE:     [A_DATE, A_FLOCK, ["Details", (r) => r.notes, false, true]]
  };
  ACTIVITY_COLS.MEDICATION = ACTIVITY_COLS.FEED_CONSUMPTION;
  ACTIVITY_COLS.LOSS = ACTIVITY_COLS.MORTALITY;
  ACTIVITY_COLS.OTHER = ACTIVITY_COLS.FLOCK_CHANGE;

  // The columns the table uses right now. Anything but a picked activity type uses the normal COLS.
  const repTableCols = (type, s) =>
    (type === "activity" && s && ACTIVITY_COLS[s.activityType]) || COLS[type];

  // Which layout a tab uses.
  function recordsView(type) {
    if (TAB_REPORT_CONFIG[type] && !TAB_REPORT_CONFIG[type].ownsTable && REPORT_ENABLED.includes(type)) {
      queueMicrotask(() => mountReport(type)); // runs right after renderView has put the HTML on the page
      return reportPage(type);
    }
    destroyRepChart();
    return plainRecordsView(type);
  }

  /* =====================================================================
     PLAIN TABLE LAYOUT (the original view, unchanged) - used by any tab
     that has no report config (for example Adjustments)
     ===================================================================== */
  function plainRecordsView(type) {
    const rows = newestFirst(state.data[type]);
    const cols = COLS[type];
    const q = state.query.trim().toLowerCase();
    const cells = (r) => cols.map(([, fn]) => String(fn(r) ?? ""));
    const shown = q ? rows.filter((r) => cells(r).join(" ").toLowerCase().includes(q)) : rows;
    const label = TABS.find((t) => t[0] === type)[1];
    const toolbar = recordsToolbar(type);

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
    const body = shown.map((r) => `<tr>${cols.map((c) => cellHTML(r, c)).join("")}${rowAction ? `<td class="num">${rowAction(r)}</td>` : ""}</tr>`).join("");
    return toolbar + `<section class="card table-card">
      <div class="table-head"><h3>${type === "adjustment" ? "Adjustment log" : esc(label) + " records"}</h3><div class="toolbar-actions"><button class="btn ghost" data-action="filter-records" data-type="${type}">${icon("filter", 14)}Filter</button><button class="icon-btn square" data-action="export-records" data-type="${type}" aria-label="Download all records" title="Download all records">${icon("download", 18)}</button></div></div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty-line" style="padding:24px 20px">No records match "${esc(state.query)}".</div>`}
    </section>`;
  }

  /* =====================================================================
     REPORT ENGINE
     Header -> filter bar -> summary cards -> ONE chart card -> table.
       Date range      : BACKEND. Changing it re-fetches stats + trend (+ breakdown) with AgroAPI.getRecordsReport.
                         The table is also limited to the same dates, in JS, with no extra request.
       Search + dropdown : FRONTEND ONLY. They filter the loaded rows in JS and redraw the table.
       Chart toggle    : FRONTEND ONLY. It swaps the view inside the same card and redraws the same canvas.
     ===================================================================== */
  const REP = {};   // per-tab report state, kept while you move between tabs
  const repOf = (type) => REP[type] || (REP[type] = {
    preset: "30d", from: "", to: "",        // date range (what the last fetch used)
    filter: "", page: 0, view: null,        // table dropdown, table page, chart view id (null = first view)
    activityType: "",                       // Farm Activities "Activity type" ("" = all); sent to the backend
    status: "idle",                         // idle | loading | refreshing | ready | error
    data: null, error: null,                // { stats, trend, breakdown, errors } from the API
    farmId: null, sig: "", seq: 0
  });
  const REP_PAGE = 10;
  const REP_PRESETS = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["year", "This year"], ["custom", "Custom"]];
  let repChart = null;

  const repCfg = (type) => TAB_REPORT_CONFIG[type];
  const repData = (type) => { const c = repCfg(type); return (c.rows ? c.rows() : state.data[type]) || []; };
  // The tab that is on screen right now, read from the page itself so handlers never need a literal tab name.
  const repType = () => { const r = $("#rep-root"); return r && TAB_REPORT_CONFIG[r.dataset.type] ? r.dataset.type : null; };
  const repViews = (cfg) => cfg.chartPrimary.views;
  const repView = (type, s) => { const vs = repViews(repCfg(type)); return vs.find((v) => v.id === s.view) || vs[0]; };

  // The data a view draws, by its source. Raw rows; nothing is filtered or folded here.
  function repViewRows(s, v) {
    const d = s.data;
    if (!d) return [];
    const src = v.source || "trend";
    if (src === "stats.by_type") {
      const bt = ((d.stats || {}).summary || {}).by_type;
      return Array.isArray(bt) ? bt : [];
    }
    return Array.isArray(d[src]) ? d[src] : [];
  }
  // The errors object key that belongs to a view's source.
  const repSrcKey = (v) => (v.source === "stats.by_type" ? "stats" : (v.source || "trend"));
  const repViewFailed = (s, v) => !!(s.data && s.data.errors && s.data.errors[repSrcKey(v)]);

  const repInt = (v) => Math.round(Number(v) || 0).toLocaleString("en-US");
  const repBusy = (s) => s.status === "idle" || s.status === "loading" || s.status === "refreshing";
  const repFmt = (format, v) => {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    if (format === "money") return fmtMoney(Number(v));
    if (format === "pct") return Number(v).toFixed(1) + "%";
    return repInt(v);
  };

  // A signature of the rows, so a new or adjusted record triggers a fresh fetch of the stats.
  // The fields summed come from the tab's config (sigKeys).
  function repSig(type) {
    const cfg = repCfg(type), rows = repData(type);
    const sums = (cfg.sigKeys || []).map((k) => rows.reduce((t, r) => t + num(r[k]), 0));
    return [rows.length].concat(sums).join("|");
  }

  // Switching farms starts the report from scratch.
  function repSync(type, s) {
    if (s.farmId !== state.farmId) Object.assign(s, { farmId: state.farmId, filter: "", activityType: "", page: 0, data: null, error: null, status: "idle", sig: "" });
  }

  // The dates the table is limited to. Same rule as the backend: from (today - days) to today.
  function repBounds(s) {
    if (s.preset === "custom") return { from: s.from || "", to: s.to || "" };
    const end = new Date();
    if (s.preset === "year") return { from: localISO(new Date(end.getFullYear(), 0, 1)), to: localISO(end) };
    const start = new Date(end);
    start.setDate(start.getDate() - (parseInt(s.preset, 10) || 30));
    return { from: localISO(start), to: localISO(end) };
  }
  // The date range, plus activity_type when a type is picked (the API only sends it to stats and trend).
  const repRange = (s) => {
    const r = s.preset === "custom" ? { start_date: s.from, end_date: s.to } : AgroAPI.dateRange(s.preset);
    return s.activityType ? Object.assign({}, r, { activity_type: s.activityType }) : r;
  };

  /* ---------- fetching (backend-driven part) ---------- */
  async function loadReport(type) {
    const cfg = repCfg(type), s = repOf(type);
    const seq = ++s.seq;
    s.farmId = state.farmId;
    s.sig = repSig(type);
    s.status = s.data ? "refreshing" : "loading";
    paintReport(type);
    try {
      const rep = await AgroAPI.getRecordsReport(state.farmId, type, repRange(s));
      if (seq !== s.seq || s.farmId !== state.farmId) return; // a newer request or another farm took over
      const keys = repViews(cfg).map(repSrcKey);
      s.data = rep;
      // A tab fails only when the cards AND every one of its chart views failed; a missing piece never crashes it.
      s.error = rep.errors.stats && keys.every((k) => rep.errors[k]) ? rep.errors.stats : null;
      s.status = s.error ? "error" : "ready";
      if (rep.errors.stats || keys.some((k) => rep.errors[k])) console.warn(type + " report: part of the data could not be loaded", rep.errors);
    } catch (err) {
      if (seq !== s.seq) return;
      s.error = err;
      s.status = "error";
    }
    paintReport(type);
  }

  function mountReport(type) {
    const root = $("#rep-root");
    if (!root || root.dataset.type !== type) return;
    const s = repOf(type);
    if (s.status === "idle" || s.sig !== repSig(type)) loadReport(type);
    else drawRepChart(type, s);
  }

  /* ---------- page ---------- */
  function repFilterOpts(type, s) {
    const f = repCfg(type).filter;
    let opts;
    if (f.kind === "flock") {
      opts = state.data.flock.map((x) => [String(x.id), x.identifier]);
    } else {
      const set = new Set();
      repData(type).forEach((r) => { const v = String(r[f.field] || "").trim(); if (v) set.add(v); });
      opts = [...set].sort((a, b) => a.localeCompare(b)).map((v) => [v, v]);
    }
    return opts.map(([v, l]) => `<option value="${esc(v)}"${v === s.filter ? " selected" : ""}>${esc(l)}</option>`).join("");
  }

  function repHeaderHTML(type) {
    const cfg = repCfg(type);
    return `<header class="rep-head">
        <div class="rep-head-ic">${cfg.icon}</div>
        <div>
          <p class="rep-eyebrow">Records</p>
          <h1>${esc(cfg.title)}</h1>
          <p class="rep-sub">${esc(cfg.subtitle)}</p>
        </div>
      </header>`;
  }

  function repFiltersHTML(type, s) {
    const cfg = repCfg(type);
    const dated = cfg.dateRangeAffects !== "none";
    const presetOpts = REP_PRESETS.map(([v, l]) => `<option value="${v}"${v === s.preset ? " selected" : ""}>${l}</option>`).join("");
    const dateHTML = dated ? `<div class="rep-field">
          <label for="rep-preset">Date range</label>
          <div class="rep-sel"><select id="rep-preset">${presetOpts}</select>${icon("chevronDown", 16)}</div>
        </div>
        <div class="rep-custom" id="rep-custom"${s.preset === "custom" ? "" : " hidden"}>
          <div class="rep-field"><label for="rep-from">From</label><input class="rep-input" type="date" id="rep-from" value="${esc(s.from)}"></div>
          <div class="rep-field"><label for="rep-to">To</label><input class="rep-input" type="date" id="rep-to" value="${esc(s.to)}"></div>
        </div>` : "";
    const filterHTML = cfg.filter ? `<div class="rep-field">
          <label for="rep-filter">${esc(cfg.filter.label)}</label>
          <div class="rep-sel"><select id="rep-filter"><option value="">${esc(cfg.filter.all)}</option>${repFilterOpts(type, s)}</select>${icon("chevronDown", 16)}</div>
        </div>` : "";
    const tf = cfg.typeFilter;
    const typeHTML = tf ? `<div class="rep-field">
          <label for="rep-type">${esc(tf.label)}</label>
          <div class="rep-sel"><select id="rep-type"><option value="">${esc(tf.all)}</option>${tf.options.map(([v, l]) => `<option value="${esc(v)}"${v === s.activityType ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>${icon("chevronDown", 16)}</div>
        </div>` : "";
    const searchHTML = cfg.ownsTable ? "" : `<div class="rep-field grow">
          <label for="rep-search">Search</label>
          <div class="rep-search">${icon("search", 16)}<input class="rep-input" type="search" id="rep-search" placeholder="Search records..." autocomplete="off" value="${esc(state.query)}"></div>
        </div>`;
    const applyHTML = dated ? `<button class="btn" type="button" data-action="rep-apply"${repBusy(s) ? " disabled" : ""}>${icon("filter", 14)}Apply filters</button>` : "";
    const exportHTML = cfg.ownsTable ? "" : `<button class="btn ghost" type="button" data-action="export-records" data-type="${type}">${icon("download", 14)}Export</button>`;
    return `<section class="card rep-filters" aria-label="Filters">
        ${dateHTML}${filterHTML}${typeHTML}${searchHTML}
        <div class="rep-actions">${applyHTML}${exportHTML}</div>
      </section>`;
  }

  // ONE chart card per tab. With 2+ views the .rep-seg toggle swaps the view inside this same card.
  function repChartsHTML(type, s) {
    const cfg = repCfg(type);
    const views = repViews(cfg), cur = repView(type, s);
    const seg = views.length > 1 ? `<div class="rep-seg" role="group" aria-label="Chart view">${views.map((v) => `<button type="button" data-action="rep-view" data-view="${v.id}" aria-pressed="${v.id === cur.id}">${esc(v.toggle)}</button>`).join("")}</div>` : "";
    return `<section class="card rep-chart-card">
        <div class="rep-card-head">
          <div><h3 id="rep-chart-title">${esc(cur.title)}</h3><p class="rep-card-sub" id="rep-chart-sub">${esc(chartSub(type, s))}</p></div>
          ${seg}
        </div>
        <div id="rep-chart-body">${chartBodyHTML(type, s)}</div>
      </section>`;
  }

  function reportPage(type) {
    const cfg = repCfg(type), s = repOf(type);
    repSync(type, s);
    return recordsToolbar(type) + `<div class="rep-root${repBusy(s) ? " is-busy" : ""}" id="rep-root" data-type="${type}">
      ${repHeaderHTML(type)}
      ${repFiltersHTML(type, s)}
      <div class="rep-cards" id="rep-cards" style="--cols:${repCols(type, s)}">${cardsHTML(type, s)}</div>
      ${repChartsHTML(type, s)}
      ${cfg.ownsTable ? "" : `<section class="card table-card rep-table" id="rep-table">${tableHTML(type, s)}</section>`}
    </div>`;
  }

  /* ---------- summary cards ---------- */
  function trendBadge(v, inverse) {
    if (v == null || !Number.isFinite(Number(v))) return `<span class="rep-badge flat">No comparison</span>`;
    const x = Number(v);
    // For things like damaged eggs, outstanding money or mortality a fall is the good news, so the colours are swapped.
    const cls = x === 0 ? "flat" : ((x > 0) !== !!inverse ? "good" : "bad");
    return `<span class="rep-badge ${cls}">${x > 0 ? "+" : ""}${x.toFixed(1)}%</span>`;
  }

  // Which cards a tab shows right now. With a type picked (Farm Activities) it is that type's own set;
  // otherwise the normal cards, plus the dynamic ones when the tab has them and no type is picked.
  function repCardSet(cfg, s) {
    const typed = cfg.cardsByType && s.activityType && cfg.cardsByType[s.activityType];
    if (typed) return { cards: typed, dynamic: false };
    return { cards: cfg.cards, dynamic: !!cfg.dynamicCards && !s.activityType };
  }

  function repCardDefs(type, s) {
    const cfg = repCfg(type), set = repCardSet(cfg, s);
    const st = s.data && s.data.stats;
    const sum = (st && st.summary) || {};
    const tr = (st && st.trends) || {};
    const out = set.cards.map((c) => ({
      label: c.label, value: sum[c.summaryKey], format: c.format,
      hasTrend: !!c.trendKey, trend: c.trendKey ? tr[c.trendKey] : null,
      inverse: !!c.inverse, warn: !!c.warn, caption: c.caption || "",
      note: c.note ? c.note(sum) : ""
    }));
    if (set.dynamic && st) {
      cfg.dynamicCards(sum).forEach((d) => out.push({ label: d.label, value: d.value, format: d.format || "int", hasTrend: false, trend: null, inverse: false, warn: false, caption: d.caption || "", note: "" }));
    }
    return out;
  }
  const repCardCount = (cfg, s) => { const set = repCardSet(cfg, s); return set.cards.length + (set.dynamic ? 3 : 0); };
  function repCols(type, s) {
    const cfg = repCfg(type);
    const n = s.data && s.data.stats ? repCardDefs(type, s).length : repCardCount(cfg, s);
    return Math.min(5, Math.max(cfg.minCols || 1, n));
  }

  function cardsHTML(type, s) {
    const cfg = repCfg(type);
    if (!s.data && repBusy(s)) {
      const n = repCardCount(cfg, s);
      return Array.from({ length: n }, () => `<div class="card rep-card"><span class="rep-skel" style="width:46%;height:12px"></span><span class="rep-skel" style="width:62%;height:26px;margin:14px 0"></span><span class="rep-skel" style="width:30%;height:18px"></span></div>`).join("");
    }
    const st = s.data && s.data.stats;
    return repCardDefs(type, s).map((d) => {
      const bad = d.warn && Number(d.value) > 0;
      const foot = !st ? `<span class="rep-badge flat">Unavailable</span>`
        : d.hasTrend ? trendBadge(d.trend, d.inverse) + `<span>vs previous period</span>`
        : (d.caption ? `<span>${esc(d.caption)}</span>` : "");
      return `<div class="card rep-card${bad ? " warn" : ""}">
      <div class="rep-card-lbl">${esc(d.label)}</div>
      <div class="rep-card-val">${st ? repFmt(d.format, d.value) : "—"}</div>
      ${d.note ? `<div class="rep-card-note">${esc(d.note)}</div>` : ""}
      <div class="rep-card-foot">${foot}</div>
    </div>`;
    }).join("");
  }

  /* ---------- chart text + body ---------- */
  function chartSub(type, s) {
    const v = repView(type, s);
    const p = s.data && s.data.stats && s.data.stats.period;
    if (!v.subject) return v.sub || "";   // breakdown views carry a fixed sub-line
    const unit = p && p.group_by === "month" ? "Monthly" : "Daily";
    return unit + " " + v.subject + (p && p.start_date ? " · " + fmtDate(p.start_date) + " – " + fmtDate(p.end_date) : "");
  }

  const REP_SPIN = `<div class="rep-msg"><div class="spinner"></div><span>Loading chart…</span></div>`;

  // Donut rows: positive slices only, biggest first, small slices folded into "Other".
  function repDonutRows(rows) {
    let out = rows.map((r) => ({ label: r.label, value: Number(r.value) || 0 })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    if (out.length > 7) {
      const top = out.slice(0, 6);
      top.push({ label: "Other", value: out.slice(6).reduce((t, r) => t + r.value, 0), other: true });
      out = top;
    }
    return out;
  }

  // DATA GUARD. Returns the message to show instead of a chart, or "" when the chart is fine to draw.
  // Runs before new Chart() is ever called, so a thin dataset never produces a flat line or a one-colour donut.
  function repGuardMsg(v, rows) {
    if (v.guard === "series") {
      const hasValue = rows.some((p) => (v.seriesKeys || []).some((k) => Number(p[k]) > 0));
      return rows.length < 3 || !hasValue ? "Not enough data in this period yet." : "";
    }
    if (v.guard === "breakdown") {
      const live = rows.filter((r) => Number(r.value) > 0).length;
      return live <= 1 ? "Add more records to see the breakdown." : "";
    }
    return "";
  }

  function chartBodyHTML(type, s) {
    const cfg = repCfg(type), v = repView(type, s);
    if (!s.data && repBusy(s)) return REP_SPIN;
    if (s.status === "error" || repViewFailed(s, v)) {
      const why = (s.status === "error" && s.error && s.error.message) || "The chart data could not be loaded.";
      return `<div class="rep-msg"><span>${esc(why)}</span><button class="btn ghost" type="button" data-action="rep-retry">Try again</button></div>`;
    }
    // A breakdown across types means nothing once a single type is picked.
    if (v.allOnly && s.activityType) return `<div class="rep-msg"><span>The breakdown by type isn't shown while a single activity type is selected. Choose “All activities” to see it.</span></div>`;
    const rows = repViewRows(s, v);
    const guard = repGuardMsg(v, rows);
    if (guard) return `<div class="rep-msg"><span>${esc(guard)}</span></div>`;
    if (!rows.length) return `<div class="rep-msg"><span>${esc(cfg.emptyChart || "No records in this period.")}</span></div>`;
    const h = v.type === "hbar" ? ` style="height:${Math.max(220, rows.length * 46 + 70)}px"` : "";
    return `<div class="rep-chart-wrap"${h}><canvas id="rep-canvas" role="img" aria-label="${esc(v.title)}"></canvas></div>`;
  }

  /* ---------- Chart.js drawing ---------- */
  const cssVar = (name, fallback) => (getComputedStyle(document.documentElement).getPropertyValue(name) || "").trim() || fallback;
  const hexA = (hex, a) => {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  };
  // "2026-10-14" -> 14 Oct (daily) or "2026-10" -> Oct 2026 (monthly). Built from the parts so the timezone never shifts the day.
  function repLabel(d, groupBy, full) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(d));
    if (!m) return String(d);
    const dt = new Date(+m[1], +m[2] - 1, +(m[3] || 1));
    if (groupBy === "month") return dt.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    return dt.toLocaleDateString("en-GB", full ? { weekday: "short", day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" });
  }

  function destroyRepChart() {
    if (repChart) { repChart.destroy(); repChart = null; }
  }

  function repTheme() {
    const t = {
      green: cssVar("--green", "#157b3a"), red: cssVar("--error", "#c62828"), muted: cssVar("--muted", "#7b7b7b"),
      line: cssVar("--line", "#e6e6e6"), text: cssVar("--text", "#111"), card: cssVar("--card", "#fff")
    };
    Chart.defaults.font.family = '"Roboto", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
    Chart.defaults.color = t.muted;
    return t;
  }
  const repCompact = (v) => Intl.NumberFormat("en", { notation: "compact" }).format(v);

  // Whole-number axis for counts. precision 0 always; stepSize 1 only while the peak is small
  // (a fixed step of 1 on a peak of 5,000 would draw thousands of grid lines).
  const repIntTicks = (peak) => (peak <= 10 ? { precision: 0, stepSize: 1 } : { precision: 0 });

  // Destroys the old chart and draws the current view into #rep-canvas (the one canvas of the one card).
  function drawRepChart(type, s) {
    destroyRepChart();
    if (!s.data) return;
    const cv = $("#rep-canvas");
    if (!cv) return;   // a message (loading, error, guard) is showing instead of a chart
    if (typeof Chart === "undefined") {
      const b = $("#rep-chart-body");
      if (b) b.innerHTML = `<div class="rep-msg"><span>The chart library did not load. Check that the Chart.js script is in app.html.</span></div>`;
      return;
    }
    repChart = buildPrimary(type, s, cv, repTheme());
  }

  function buildPrimary(type, s, cv, t) {
    const v = repView(type, s), rows = repViewRows(s, v);
    const fmt = (x) => repFmt(v.format || "int", x);

    if (v.type === "donut") return buildDonut(v, rows, cv, t);

    // Horizontal bar: one bar per breakdown row (for example birds by stage)
    if (v.type === "hbar") {
      const peak = rows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);
      return new Chart(cv, {
        type: "bar",
        data: {
          labels: rows.map((r) => repPretty(r.label)),
          datasets: [{ label: (v.labels && v.labels[0]) || "Value", data: rows.map((r) => r.value), backgroundColor: hexA(t.green, 0.85), borderRadius: 4, maxBarThickness: 28 }]
        },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c) => { const r = rows[c.dataIndex]; return " " + fmt(c.parsed.x) + (r && r.pct != null ? " (" + Number(r.pct).toFixed(1) + "%)" : ""); } } }
          },
          scales: {
            x: { beginAtZero: true, grid: { color: t.line }, border: { display: false }, ticks: Object.assign({ color: t.muted, callback: repCompact }, v.ints ? repIntTicks(peak) : {}) },
            y: { grid: { display: false }, ticks: { color: t.text } }
          }
        }
      });
    }

    // Time series: line / area / bar / grouped bar, or a mix (for example bars plus a line)
    const gb = (s.data.stats && s.data.stats.period && s.data.stats.period.group_by) || "day";
    const labels = rows.map((p) => repLabel(p.date, gb));
    const fullLabels = rows.map((p) => repLabel(p.date, gb, true));
    const narrow = window.innerWidth <= 640;
    const stacked = !!v.stacked;
    const col = (c) => ({ green: t.green, red: t.red, blue: "#2563eb", amber: "#f3b93a" })[c] || c;
    const datasets = v.seriesKeys.map((k, i) => {
      const k0 = (v.seriesTypes && v.seriesTypes[i]) || v.type;
      const kind = k0 === "groupbar" ? "bar" : k0;
      const c = col((v.colors && v.colors[i]) || "green");
      const data = rows.map((p) => p[k]);
      if (kind === "bar") return { type: "bar", label: v.labels[i], data, backgroundColor: hexA(c, 0.85), borderRadius: 3, maxBarThickness: 28, stack: stacked ? "s" : undefined, order: 2 };
      return {
        type: "line", label: v.labels[i], data, borderColor: c, backgroundColor: kind === "area" ? hexA(c, 0.15) : c,
        borderWidth: 2.5, tension: 0.4, fill: kind === "area",
        pointRadius: rows.length > 45 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: c, order: 1
      };
    });
    const hasBar = datasets.some((d) => d.type === "bar");
    // Counts start at zero unless the view explicitly opts out (Production's saleable trend keeps its tighter baseline).
    const zero = v.beginAtZero != null ? v.beginAtZero : (!!v.ints || v.type !== "line");
    const peak = rows.reduce((m, p) => {
      const vals = v.seriesKeys.map((k) => Number(p[k]) || 0);
      return Math.max(m, stacked ? vals.reduce((a, b) => a + b, 0) : Math.max.apply(null, vals));
    }, 0);
    const yTicks = Object.assign({ color: t.muted, callback: repCompact }, v.ints ? repIntTicks(peak) : {});

    return new Chart(cv, {
      type: hasBar ? "bar" : "line",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: datasets.length > 1, position: "bottom", labels: { usePointStyle: true, boxWidth: 8, color: t.text } },
          tooltip: {
            callbacks: {
              title: (items) => fullLabels[items[0].dataIndex],
              label: (c) => " " + c.dataset.label + ": " + fmt(c.parsed.y),
              footer: (items) => (v.totalLabel ? v.totalLabel + ": " + fmt(items.reduce((a, i) => a + i.parsed.y, 0)) : "")
            }
          }
        },
        scales: {
          x: { stacked, grid: { display: false }, ticks: { color: t.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: narrow ? 5 : 10 } },
          y: { stacked, beginAtZero: zero, grace: zero ? 0 : "10%", grid: { color: t.line }, border: { display: false }, ticks: yTicks }
        }
      }
    });
  }

  // Doughnut view. Built into the same #rep-canvas as every other view.
  function buildDonut(v, rawRows, cv, t) {
    const rows = repDonutRows(rawRows);
    const fmt = (x) => repFmt(v.format || "int", x);
    const total = rows.reduce((a, r) => a + r.value, 0);
    const pal = [t.green, "#2563eb", "#f3b93a", "#7c3aed", "#0e7490", "#c2570c", "#d97706"];
    return new Chart(cv, {
      type: "doughnut",
      data: {
        labels: rows.map((r) => repPretty(r.label)),
        datasets: [{ data: rows.map((r) => r.value), backgroundColor: rows.map((r, i) => (r.other ? t.muted : pal[i % pal.length])), borderColor: t.card, borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%", animation: { duration: 400 },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 12, color: t.text } },
          tooltip: { callbacks: { label: (c) => " " + c.label + ": " + fmt(c.parsed) + " (" + (total ? (c.parsed / total * 100).toFixed(1) : "0.0") + "%)" } }
        }
      }
    });
  }

  /* ---------- table (frontend-driven filters) ---------- */
  function repRows(type, s) {
    const cfg = repCfg(type);
    let rows = newestFirst(repData(type));
    if (cfg.dateRangeAffects !== "none") {
      const b = repBounds(s);
      rows = rows.filter((r) => (!b.from || String(r.date) >= b.from) && (!b.to || String(r.date) <= b.to));
    }
    if (cfg.filter && s.filter) rows = rows.filter((r) => String(r[cfg.filter.field]) === s.filter);
    if (cfg.typeFilter && s.activityType) rows = rows.filter((r) => String(r.code) === s.activityType);   // rows carry the backend code
    const q = state.query.trim().toLowerCase();
    if (q) {
      // Search what is on screen: for Farm Activities the columns change with the picked type.
      const cols = repTableCols(type, s);
      rows = rows.filter((r) => cols.map(([, fn]) => String(fn(r) ?? "")).join(" ").toLowerCase().includes(q));
    }
    return rows;
  }

  function tableHTML(type, s) {
    const cfg = repCfg(type);
    if (!repData(type).length) {
      return `<div class="table-head"><div><h3>${esc(cfg.tableTitle)}</h3></div></div>
        <div class="rep-msg" style="padding:36px 20px"><span>${esc(cfg.emptyTable)}</span><button class="btn" type="button" data-action="add-record" data-type="${type}">${icon("plus", 14)}Add Record</button></div>`;
    }
    const rows = repRows(type, s);
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / REP_PAGE));
    s.page = Math.min(Math.max(0, s.page), pages - 1);
    const start = s.page * REP_PAGE;
    const slice = rows.slice(start, start + REP_PAGE);
    const from = total ? start + 1 : 0;
    const to = Math.min(total, start + REP_PAGE);
    // For Farm Activities the columns depend on the picked activity type; every other tab uses COLS.
    const cols = repTableCols(type, s);
    const rowAction = ROW_ACTIONS[type];
    const head = cols.map(([h, , n]) => `<th class="${n ? "num" : ""}">${esc(h)}</th>`).join("") + (rowAction ? `<th class="num">Actions</th>` : "");
    const cell = (r, [, fn, n, trunc]) => {
      const txt = fn(r);
      return trunc ? `<td class="trunc" title="${esc(txt)}">${esc(txt)}</td>` : `<td class="${n ? "num" : ""}">${esc(txt)}</td>`;
    };
    const body = slice.map((r) => `<tr>${cols.map((c) => cell(r, c)).join("")}${rowAction ? `<td class="num">${rowAction(r)}</td>` : ""}</tr>`).join("");
    return `<div class="table-head"><div><h3>${esc(cfg.tableTitle)}</h3><p class="sub-line">Showing ${from}–${to} of ${total} records</p></div></div>
      ${total
        ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
        : `<div class="empty-line" style="padding:24px 20px">No records match your filters.</div>`}
      ${pages > 1 ? `<div class="rep-foot"><span>Page ${s.page + 1} of ${pages}</span><div class="rep-pager"><button type="button" data-action="rp-prev"${s.page === 0 ? " disabled" : ""}>Previous</button><button type="button" data-action="rp-next"${s.page >= pages - 1 ? " disabled" : ""}>Next</button></div></div>` : ""}`;
  }

  /* ---------- repainting parts of the page without rebuilding the filter bar ---------- */
  function paintTable(type) {
    const el = $("#rep-table");
    if (el) el.innerHTML = tableHTML(type, repOf(type));
  }

  function paintReport(type) {
    const root = $("#rep-root");
    if (!root || root.dataset.type !== type) return; // the user moved to another tab while this was loading
    const s = repOf(type);
    root.classList.toggle("is-busy", repBusy(s));
    const apply = $('[data-action="rep-apply"]');
    if (apply) apply.disabled = repBusy(s);
    const cards = $("#rep-cards");
    cards.innerHTML = cardsHTML(type, s);
    cards.style.setProperty("--cols", String(repCols(type, s)));
    $("#rep-chart-title").textContent = repView(type, s).title;
    $("#rep-chart-sub").textContent = chartSub(type, s);
    destroyRepChart();   // before the canvas is replaced
    $("#rep-chart-body").innerHTML = chartBodyHTML(type, s);
    drawRepChart(type, s);
    paintTable(type);
  }

  /* ---------- events for the report layout (work for whichever tab is on screen) ---------- */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    const type = repType();
    if (!a || !type) return;
    const s = repOf(type);
    switch (a.dataset.action) {
      case "rep-apply": {
        const sel = $("#rep-preset");
        if (!sel) { s.page = 0; paintTable(type); break; }
        const preset = sel.value;
        if (preset === "custom") {
          const from = $("#rep-from").value, to = $("#rep-to").value;
          if (!from || !to) { toast("Choose both a start and an end date."); return; }
          if (from > to) { toast("The start date can't be after the end date."); return; }
          s.from = from; s.to = to;
        }
        s.preset = preset; s.page = 0;
        loadReport(type);
        break;
      }
      case "rep-retry": loadReport(type); break;
      case "rep-view":
        // Same card, same canvas: only the view changes. Destroy the old chart, then draw the new one.
        s.view = a.dataset.view;
        $$('[data-action="rep-view"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === s.view)));
        $("#rep-chart-title").textContent = repView(type, s).title;
        $("#rep-chart-sub").textContent = chartSub(type, s);
        destroyRepChart();
        $("#rep-chart-body").innerHTML = chartBodyHTML(type, s);
        drawRepChart(type, s);
        break;
      case "rp-prev": s.page = Math.max(0, s.page - 1); paintTable(type); break;
      case "rp-next": s.page += 1; paintTable(type); break;
    }
  });

  document.addEventListener("change", (e) => {
    const type = repType();
    if (!type) return;
    const s = repOf(type);
    if (e.target.id === "rep-preset") {
      const custom = e.target.value === "custom";
      $("#rep-custom").hidden = !custom;
      if (!custom) { s.preset = e.target.value; s.page = 0; loadReport(type); } // a ready-made range fetches straight away
    } else if (e.target.id === "rep-filter") {
      s.filter = e.target.value; s.page = 0; paintTable(type);                 // frontend only: no API call
    } else if (e.target.id === "rep-type") {
      s.activityType = e.target.value; s.page = 0; loadReport(type);           // backend: re-fetches stats + trend for that type
    }
  });

  // Typing in either search box (the one in the page or the one in the top bar) filters the table in place.
  // stopImmediatePropagation keeps the top-bar handler in handlers.js from rebuilding the whole page on every key.
  document.addEventListener("input", (e) => {
    const id = e.target.id;
    const type = repType();
    if ((id !== "rep-search" && id !== "search") || !type || repCfg(type).ownsTable) return;
    const s = repOf(type);
    state.query = e.target.value;
    s.page = 0;
    const other = $(id === "search" ? "#rep-search" : "#search");
    if (other && other.value !== e.target.value) other.value = e.target.value;
    paintTable(type);
    if (id === "search") e.stopImmediatePropagation();
  });