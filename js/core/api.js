/* =========================================================================
   api.js  (js/core/api.js)
   One place that talks to the Django API.
   ========================================================================= */
(function (global) {
  "use strict";

  const CONFIG = {
    API_BASE: "http://127.0.0.1:8000",
    ENDPOINTS: {
      csrf: "/api/auth/csrf/",
      register: "/api/auth/register/",
      login: "/api/auth/login/",
      logout: "/api/auth/logout/",
      me: "/api/auth/me/",
      farms: "/api/farms/",
    },
    PAGES: (function (r) {
      return {
        signIn: r + "pages/auth/login.html",
        signUp: r + "pages/auth/register.html",
        app: r + "pages/app.html"
      };
    })(new URL("../../", (document.currentScript || {}).src || location.href).href),
    FARM_ENDPOINTS: {
      flocks: "/api/farms/{farm}/flocks/",
      activities: "/api/farms/{farm}/activities/",
      production: "/api/farms/{farm}/production/",
      sales: "/api/farms/{farm}/sales/",
      purchases: "/api/farms/{farm}/purchases/",
      expenses: "/api/farms/{farm}/expenses/",
      parties: "/api/farms/{farm}/parties/",
      items: "/api/farms/{farm}/items/",
      units: "/api/units/",
      openingPosition: "/api/farms/{farm}/opening-position/",
      adjustments: "/api/farms/{farm}/adjustments/",
      adjustmentsCreate: "/api/farms/{farm}/adjustments/create/",
      // Direct stock adjustment (Loss, Theft, Discrepancy). Does not edit the original transaction.
      stockAdjust: "/api/farms/{farm}/stock-adjust/",
      payments: "/api/farms/{farm}/payments/",
      // Financial, operations and alert summary for the Dashboard. Takes ?days=30 (or 7, 90 ...).
      dashboard: "/api/farms/{farm}/dashboard/",
    },
    DEFAULTS: { eggUnitId: 2, eggItemId: null },
  };

  const LS = {
    get: function (k, d) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch {
        return d;
      }
    },
    set: function (k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch { }
    },
    del: function (k) {
      try {
        localStorage.removeItem(k);
      } catch { }
    },
  };

  const wait = function (ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  };

  const cookie = function (n) {
    const m = document.cookie.match(new RegExp("(^|; )" + n + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  };

  const K_MOCK = "agroflow:v1:mock";
  const K_USERS = "agroflow:v1:users";
  const K_SESSION = "agroflow:v1:session";
  const K_FARMS = "agroflow:v1:farms:";
  const K_FARM_CACHE = "agroflow:v1:farmcache:";
  const K_EGG_ITEM = "agroflow:v1:eggitem:";

  const qp = new URLSearchParams(location.search);
  if (qp.get("mock") === "1") LS.set(K_MOCK, true);
  if (qp.get("mock") === "0") LS.del(K_MOCK);
  const isMock = !!LS.get(K_MOCK, false);

  const ALIAS = { password2: "confirm_password", name: "full_name" };
  const MESSAGE_KEYS = ["detail", "message", "non_field_errors", "error"];

  function firstText(v) {
    if (Array.isArray(v)) return firstText(v[0]);
    if (v && typeof v === "object") {
      const k = Object.keys(v)[0];
      return k === undefined ? "" : firstText(v[k]);
    }
    return v == null ? "" : String(v);
  }

  function normalize(data, status, fallback) {
    const fields = {};
    let message = "";
    if (data && typeof data === "object") {
      const src = data.error && typeof data.error === "object" ? data.error : data;
      if (src.fields && typeof src.fields === "object") {
        for (const k in src.fields) fields[ALIAS[k] || k] = firstText(src.fields[k]);
      }
      for (const k in src) {
        if (k === "fields" || k === "code") continue;
        const text = firstText(src[k]);
        if (!text) continue;
        if (MESSAGE_KEYS.includes(k)) message = message || text;
        else if (!fields[ALIAS[k] || k]) fields[ALIAS[k] || k] = text;
      }
      if (typeof data.error === "string") message = message || data.error;
    }
    if (!message) {
      message = fallback
        || (status === 0 ? "Network problem. Check your connection and try again."
          : status === 429 ? "Too many attempts. Wait a few minutes and try again."
          : status >= 500 ? "Something went wrong on our side. Please try again."
          : "We could not complete that request.");
    }
    return { fields: fields, message: message };
  }

  function ApiError(status, data, fallback) {
    const n = normalize(data, status, fallback);
    Error.call(this, n.message);
    // Error.call() does not set the message on "this", so set it explicitly.
    // Without this, err.message was always empty and failed saves showed a blank error.
    this.message = n.message;
    this.name = "ApiError";
    this.status = status;
    this.fields = n.fields;
    this.data = data;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  async function csrfToken(force) {
    const existing = cookie("csrftoken");
    if (existing && !force) return existing;
    try {
      const res = await fetch(CONFIG.API_BASE + CONFIG.ENDPOINTS.csrf, {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      let d = null;
      try { d = await res.json(); } catch { }
      return (d && (d.csrfToken || d.csrf_token)) || cookie("csrftoken") || "";
    } catch {
      return "";
    }
  }

  async function request(method, path, body, retried) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") headers["X-CSRFToken"] = await csrfToken(!!retried);
    let res;
    try {
      res = await fetch(CONFIG.API_BASE + path, {
        method: method,
        credentials: "include",
        headers: headers,
        cache: "no-store",
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, null);
    }
    let data = null;
    try { data = await res.json(); } catch { }
    if (res.status === 403 && method !== "GET" && !retried) {
      return request(method, path, body, true);
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  const mock = {
    session: function () { return LS.get(K_SESSION, null); },
    register: async function (p) {
      await wait(400);
      const email = String(p.email || "").trim().toLowerCase();
      const users = LS.get(K_USERS, {});
      if (users[email]) throw new ApiError(400, { email: ["A user with this email already exists."] });
      if (String(p.password || "").length < 8) throw new ApiError(400, { password: ["This password is too short."] });
      if (p.password !== p.password2) throw new ApiError(400, { password2: ["Passwords do not match."] });
      users[email] = { full_name: p.full_name, password: p.password };
      LS.set(K_USERS, users);
      const user = { full_name: p.full_name, email: email };
      LS.set(K_SESSION, user);
      return { user: user, message: "Account created successfully." };
    },
    login: async function (p) {
      await wait(400);
      const email = String(p.email || "").trim().toLowerCase();
      const u = LS.get(K_USERS, {})[email];
      if (!u || u.password !== p.password) throw new ApiError(400, { non_field_errors: ["Unable to log in with provided credentials."] });
      const user = { full_name: u.full_name, email: email };
      LS.set(K_SESSION, user);
      return { user: user, message: "Login successful." };
    },
    me: async function () {
      await wait(120);
      const s = mock.session();
      if (!s) throw new ApiError(401, { detail: "Authentication credentials were not provided." });
      return s;
    },
    logout: async function () { LS.del(K_SESSION); return {}; },
    listFarms: async function () {
      await wait(250);
      const s = mock.session();
      if (!s) throw new ApiError(401, { detail: "Authentication credentials were not provided." });
      return LS.get(K_FARMS + s.email, []);
    },
    createFarm: async function (v) {
      await wait(300);
      const s = mock.session();
      if (!s) throw new ApiError(401, { detail: "Authentication credentials were not provided." });
      const list = LS.get(K_FARMS + s.email, []);
      const farm = {
        id: Date.now().toString(36),
        name: v.name,
        location: v.location || "",
        contact_info: v.contact_info || "",
        role: "OWNER",
        settings: {
          currency: v.currency || "NGN",
          timezone: v.timezone || "Africa/Lagos",
          unit_system: v.unit_system || "metric"
        }
      };
      list.push(farm);
      LS.set(K_FARMS + s.email, list);
      return farm;
    },
  };

  const farmUrl = function (key, farmId) {
    return CONFIG.FARM_ENDPOINTS[key].replace("{farm}", encodeURIComponent(farmId));
  };

  const toId = function (v) {
    return (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v);
  };

  const listOf = function (d) {
    return (Array.isArray(d) ? d : (d && (d.results || d.items || d.units)) || []);
  };

  const noList = function (err) {
    return err && (err.status === 404 || err.status === 405);
  };

  // ---------- server data: pagination + number parsing ----------
  const n = function (v) { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };

  // DRF gives absolute "next" URLs; request() adds API_BASE itself, so keep only path + query.
  const toPath = function (u) {
    try { const x = new URL(u, CONFIG.API_BASE); return x.pathname + x.search; } catch { return null; }
  };

  // Follows every "next" link so all records load, not just the first page.
  async function listAll(path) {
    let url = path, out = [], guard = 0;
    while (url && guard++ < 200) {
      const d = await request("GET", url);
      if (Array.isArray(d)) return out.concat(d);
      out = out.concat((d && d.results) || []);
      url = d && d.next ? toPath(d.next) : null;
    }
    return out;
  }

  const ACTIVITY_LABELS = {
    FEED_CONSUMPTION: "Feed consumption", MORTALITY: "Mortality", VACCINATION: "Vaccination",
    MEDICATION: "Medication", FLOCK_CHANGE: "Flock change", LOSS: "Damage", OTHER: "Others"
  };

  const normFlock = function (f) {
    return {
      id: f.id, identifier: f.identifier, breed: f.breed || "",
      arrival_date: f.arrival_date, age_at_arrival: f.age_at_arrival,
      starting_count: n(f.initial_count), current_count: n(f.current_count),
      mortality_rate: n(f.mortality_rate), stage: f.stage || "", status: f.status || "",
      created_at: f.created_at, created_by: f.created_by_name || ""
    };
  };
  const normProduction = function (p) {
    return {
      // "item" is kept so a stock adjustment on a production row knows which item to move.
      id: p.id, flock: p.flock, item: idOf(p.item), date: p.event_date,
      collected: n(p.quantity_collected), damaged: n(p.quantity_damaged), saleable: n(p.quantity_saleable),
      notes: p.notes || "",
      // Each quantity now has its own unit (Egg, Tray, Crate). Older records only had a single "unit",
      // so fall back to that when the new fields are missing.
      unit_collected: unitOf(p.unit_collected != null ? p.unit_collected : p.unit),
      unit_damaged: unitOf(p.unit_damaged != null ? p.unit_damaged : p.unit),
      // kept so any existing table column that reads "packaging" still shows something
      packaging: unitOf(p.unit_collected != null ? p.unit_collected : (p.unit != null ? p.unit : p.packaging)),
      recorded_by: p.created_by_name || "", created_at: p.created_at, created_by: p.created_by_name || ""
    };
  };
  const normActivity = function (a) {
    return {
      id: a.id, flock: a.flock || null, code: a.activity_type,
      type: ACTIVITY_LABELS[a.activity_type] || a.activity_type,
      date: a.event_date, details: a.notes || (a.quantity != null ? String(n(a.quantity)) : ""),
      quantity: a.quantity != null ? n(a.quantity) : null,
      // The raw notes, kept apart from "details" (which falls back to the quantity) so Adjust shows the real value.
      notes: a.notes || "",
      created_at: a.created_at, created_by: a.created_by_name || ""
    };
  };

  // Server decimals arrive as strings ("150.00"); the UI works with numbers.
  // The server calls the date "event_date"; the UI calls it "date".
  // A sale on the server is a customer ("party") plus one or more line items, each with an item,
  // quantity, unit, unit price and total. The table shows one row per sale, so lines are summed up here.
  const idOf = function (v) { return v && typeof v === "object" ? v.id : v; };
  const nameOf = function (v) { return v && typeof v === "object" ? (v.name || "") : ""; };
  // A line's unit may arrive as a plain string ("Crate") or, on some backends, as an object with a name.
  const unitOf = function (v) {
    if (v && typeof v === "object") return v.name || v.abbreviation || "";
    return v == null ? "" : String(v);
  };
  // The unit of a sale or purchase line. Servers differ: it may be a plain string, an object, or sent
  // beside a numeric id as unit_name / unit_display / unit_abbreviation. A bare number (an id) is never shown.
  const lineUnit = function (l) {
    const found = [l.unit_name, l.unit_display, l.unit_abbreviation, l.unit_label, l.unit]
      .map(unitOf)
      .find(function (t) { return t && !/^\d+$/.test(t); });
    return found || "";
  };
  // Payment fields shared by sales, purchases and expenses. If the server did not send an
  // outstanding balance, work it out from the total and the amount paid.
  const paymentOf = function (x, total) {
    const paid = n(x.amount_paid);
    const owed = x.outstanding_balance != null
      ? n(x.outstanding_balance)
      : (x.amount_owed != null ? n(x.amount_owed) : Math.max(0, total - paid));
    return { amount_paid: paid, outstanding_balance: owed };
  };
  // One later payment made against a sale, purchase or expense.
  const normPayment = function (p) {
    return {
      id: p.id,
      date: p.event_date || p.date || "",
      amount: n(p.amount),
      method: String(p.payment_method || p.method || "").toUpperCase(),
      reference: p.reference || "",
      created_by: p.created_by_name || ""
    };
  };
  const paymentsOf = function (x) {
    return (Array.isArray(x.payments) ? x.payments : []).map(normPayment);
  };
  const normSale = function (x) {
    const lines = (Array.isArray(x.lines) ? x.lines : []).map(function (l) {
      return {
        item: idOf(l.item), item_name: l.item_name || nameOf(l.item),
        // The flock the birds came from (only set when birds were sold from a specific flock).
        flock: idOf(l.flock),
        quantity: n(l.quantity), unit: lineUnit(l), unit_price: n(l.unit_price), total: n(l.total)
      };
    });
    const sum = function (k) { return lines.reduce(function (t, l) { return t + l[k]; }, 0); };
    // The sale total is the amount after the discount. The server may call it total_amount or total.
    const total = x.total_amount != null ? n(x.total_amount) : (x.total != null ? n(x.total) : sum("total"));
    const pay = paymentOf(x, total);
    return {
      id: x.id, date: x.event_date,
      party: idOf(x.party),
      customer: x.party_name || x.customer_name || nameOf(x.party) || (typeof x.customer === "string" ? x.customer : ""),
      lines: lines,
      product: lines.map(function (l) { return l.item_name; }).filter(Boolean).join(", ") || (typeof x.product === "string" ? x.product : ""),
      quantity: lines.length ? sum("quantity") : n(x.quantity),
      unit: (lines.length && lines[0].unit) || unitOf(x.unit),
      price: lines.length ? lines[0].unit_price : n(x.price),
      discount_type: String(x.discount_type || "FIXED").toUpperCase(),
      discount_value: n(x.discount_value),
      total: total,
      // Calculated by the backend from the weighted average cost. null when the server does not send them.
      total_cost_of_goods: x.total_cost_of_goods != null ? n(x.total_cost_of_goods) : null,
      gross_profit: x.gross_profit != null ? n(x.gross_profit) : null,
      amount_paid: pay.amount_paid,
      outstanding_balance: pay.outstanding_balance,
      payments: paymentsOf(x),
      notes: x.notes || "",
      created_at: x.created_at, created_by: x.created_by_name || ""
    };
  };
  // A purchase on the server has the same shape as a sale: a supplier ("party") plus one or more
  // line items. The table shows one row per purchase, so the lines are summed up here.
  const normPurchase = function (x) {
    const lines = (Array.isArray(x.lines) ? x.lines : []).map(function (l) {
      return {
        item: idOf(l.item), item_name: l.item_name || nameOf(l.item),
        quantity: n(l.quantity), unit: lineUnit(l), unit_price: n(l.unit_price), total: n(l.total)
      };
    });
    const sum = function (k) { return lines.reduce(function (t, l) { return t + l[k]; }, 0); };
    const totalCost = x.total_amount != null ? n(x.total_amount) : (lines.length ? sum("total") : n(x.total_cost));
    const pay = paymentOf(x, totalCost);
    return {
      id: x.id, date: x.event_date,
      party: idOf(x.party),
      supplier: x.party_name || x.supplier_name || nameOf(x.party) || (typeof x.supplier === "string" ? x.supplier : ""),
      lines: lines,
      item: lines.map(function (l) { return l.item_name; }).filter(Boolean).join(", ") || (typeof x.item === "string" ? x.item : ""),
      quantity: lines.length ? sum("quantity") : n(x.quantity),
      unit: (lines.length && lines[0].unit) || lineUnit(x),
      unit_cost: lines.length ? lines[0].unit_price : n(x.unit_cost),
      total_cost: totalCost,
      // Receipt status ("Received" / "Ordered"). Empty when the server does not send one yet.
      status: String(x.receipt_status || x.status || ""),
      amount_paid: pay.amount_paid,
      outstanding_balance: pay.outstanding_balance,
      payments: paymentsOf(x),
      notes: x.notes || "",
      created_at: x.created_at, created_by: x.created_by_name || ""
    };
  };
  // One adjustment (a correction made to a record). "changes" is a list of { field, old_value, new_value };
  // it is parsed here in case the server sends it as a JSON string.
  const normAdjustment = function (x) {
    let changes = x.changes;
    if (typeof changes === "string") { try { changes = JSON.parse(changes); } catch (e) { changes = []; } }
    if (!Array.isArray(changes)) changes = [];
    return {
      id: x.id,
      date: x.entry_timestamp || x.created_at || x.event_date || "",
      target_model: String(x.target_model || ""),
      target_id: idOf(x.target_id),
      reason: String(x.reason || ""),
      notes: x.notes || "",
      changes: changes.map(function (c) { return { field: c.field, old_value: c.old_value, new_value: c.new_value }; }),
      created_at: x.entry_timestamp || x.created_at || "",
      created_by: x.created_by_name || ""
    };
  };
  // An expense can be linked to a supplier ("party"). The backend calls the free text "notes";
  // the UI calls it "description". The supplier name is filled in by the app from the supplier lookup
  // when the server only sends the id.
  const normExpense = function (x) {
    const amount = n(x.amount);
    const pay = paymentOf(x, amount);
    return {
      id: x.id, date: x.event_date,
      party: idOf(x.party),
      supplier: x.party_name || x.supplier_name || nameOf(x.party) || (typeof x.supplier === "string" ? x.supplier : ""),
      category: x.category || "",
      description: x.notes || x.description || "",
      amount: amount, payment_details: x.payment_details || "",
      amount_paid: pay.amount_paid,
      outstanding_balance: pay.outstanding_balance,
      payments: paymentsOf(x),
      created_at: x.created_at, created_by: x.created_by_name || ""
    };
  };

  // ---------- Inventory: units, items and unit conversions ----------
  const normUnit = function (u) {
    return { id: u.id, name: u.name || u.abbreviation || "", abbreviation: u.abbreviation || "" };
  };
  const normInventoryItem = function (i) {
    return {
      id: i.id, name: i.name || "",
      category: String(i.category || "").toUpperCase(),
      base_unit: idOf(i.base_unit),
      base_unit_name: i.base_unit_name || i.base_unit_display || nameOf(i.base_unit) || "",
      is_stock_tracked: !!i.is_stock_tracked,
      // The stock on hand as sent by the server (null when the server does not send it).
      current_stock: i.current_stock != null ? n(i.current_stock) : null,
      // Valuation calculated by the backend (weighted average cost). null when the server does not send them.
      current_average_cost: i.current_average_cost != null ? n(i.current_average_cost) : null,
      total_stock_value: i.total_stock_value != null ? n(i.total_stock_value) : null,
      // false once the item has been archived (soft-deleted) on the server
      is_active: i.is_active !== false,
      // When the item last changed. Falls back to the created time; empty when the server sends neither.
      updated_at: i.updated_at || i.modified_at || i.created_at || ""
    };
  };
  const normConversion = function (c) {
    return {
      id: c.id, unit: idOf(c.unit),
      unit_name: c.unit_name || c.unit_display || nameOf(c.unit) || "",
      factor: n(c.factor), is_base_unit: !!c.is_base_unit
    };
  };

  // One stock movement (a row of the stock ledger). The raw server fields (event_date, source_type,
  // direction, quantity, notes ...) are kept as they are, so the History window keeps working.
  // The money fields become numbers, or null when the server does not send them.
  const normStockMovement = function (m) {
    return Object.assign({}, m, {
      unit_cost: m.unit_cost != null ? n(m.unit_cost) : null,
      total_value: m.total_value != null ? n(m.total_value) : null
    });
  };

  // The dashboard summary from the server. Decimals may arrive as strings ("150.00"), so every number is
  // parsed here and the Dashboard can use the values directly. Field names are kept as the server sends them
  // (for example "party__name" on a recent sale). A missing section becomes an empty one.
  const normDashboard = function (d) {
    d = d || {};
    const nums = function (o) {
      const out = {};
      Object.keys(o || {}).forEach(function (k) { out[k] = n(o[k]); });
      return out;
    };
    const ra = d.recent_activity || {};
    const al = d.alerts || {};
    return {
      financial: nums(d.financial),
      cash_flow: nums(d.cash_flow),
      operations: nums(d.operations),
      recent_activity: {
        recent_sales: (Array.isArray(ra.recent_sales) ? ra.recent_sales : []).map(function (x) {
          return Object.assign({}, x, {
            total_amount: n(x.total_amount),
            // null when the server does not send a profit for this sale
            gross_profit: x.gross_profit != null ? n(x.gross_profit) : null
          });
        }),
        recent_expenses: (Array.isArray(ra.recent_expenses) ? ra.recent_expenses : []).map(function (x) {
          return Object.assign({}, x, { amount: n(x.amount) });
        })
      },
      alerts: {
        low_stock_items: (Array.isArray(al.low_stock_items) ? al.low_stock_items : []).map(function (x) {
          return Object.assign({}, x, { current_stock: n(x.current_stock) });
        })
      },
      period: d.period || {}
    };
  };

  // ---------- Records page: stats, trend and breakdown ----------
  // Each Records tab -> its base endpoint plus the sub-paths the backend exposes.
  // "stats" feeds the summary cards (values + a "trends" object), "trend" feeds the main chart,
  // "breakdown" feeds the donut chart. null means that tab has no such endpoint.
  // breakdownDated: false means the breakdown is a snapshot, so no date range is sent with it.
  // If a path is wrong for your backend, fix it here (one line per tab).
  const REPORT_ENDPOINTS = {
    production: { base: "production", stats: "stats/", trend: "trend/", breakdown: null },
    sales:      { base: "sales",      stats: "stats/", trend: "trend/", breakdown: "by-customer/", breakdownDated: true },
    purchase:   { base: "purchases",  stats: "stats/", trend: "trend/", breakdown: null },
    expense:    { base: "expenses",   stats: "stats/", trend: "trend/", breakdown: "by-category/", breakdownDated: true },
    flock:      { base: "flocks",     stats: "stats/", trend: null,     breakdown: "by-stage/",    breakdownDated: false },
    activity:   { base: "activities", stats: "stats/", trend: "trend/", breakdown: "by-type/",     breakdownDated: true },
    inventory:  { base: "items",      stats: "stats/", trend: "trend/", breakdown: "by-category/", breakdownDated: true }
  };

  // Keys whose values are text labels, so a numeric-looking string there is NOT turned into a number.
  const LABEL_KEYS = ["date", "day", "label", "name", "customer", "category", "stage", "type", "party", "party_name", "period", "unit"];

  // Decimals arrive as strings ("150.00"); the charts and cards need numbers. Works on any nested shape.
  function numDeep(v, key) {
    if (Array.isArray(v)) return v.map(function (x) { return numDeep(x); });
    if (v && typeof v === "object") {
      const o = {};
      Object.keys(v).forEach(function (k) { o[k] = numDeep(v[k], k); });
      return o;
    }
    if (typeof v === "string" && LABEL_KEYS.indexOf(key) === -1 && /^-?\d+(\.\d+)?$/.test(v.trim())) return parseFloat(v);
    return v;
  }

  // A trend or breakdown response may be a bare array or wrapped in an object.
  function unwrapList(d) {
    if (Array.isArray(d)) return d;
    if (!d || typeof d !== "object") return [];
    const inner = d.results || d.data || d.trend || d.series || d.items || d.breakdown;
    return Array.isArray(inner) ? inner : [];
  }

  // Local YYYY-MM-DD (toISOString would shift the day for users ahead of or behind UTC).
  const ymd = function (d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };

  // range is { days: 30 } or { start_date: "2026-01-01", end_date: "2026-11-13" }.
  function reportQuery(range) {
    range = range || {};
    if (range.start_date && range.end_date) {
      return "?start_date=" + encodeURIComponent(range.start_date) + "&end_date=" + encodeURIComponent(range.end_date);
    }
    return "?days=" + Math.max(1, parseInt(range.days, 10) || 30);
  }

  // Turns the date-range dropdown value into a range object.
  // preset: "7d" | "30d" | "90d" | "year". For "custom" the view builds { start_date, end_date } itself.
  function presetRange(preset) {
    if (preset === "year") {
      const now = new Date();
      return { start_date: ymd(new Date(now.getFullYear(), 0, 1)), end_date: ymd(now) };
    }
    return { days: ({ "7d": 7, "30d": 30, "90d": 90 })[preset] || 30 };
  }

  // The server wants the id of a party (customer or supplier), but the form lets the user type a name.
  // Find the party with that name, or create it if it is new.
  async function partyIdFor(farmId, name, type, field) {
    const wanted = String(name || "").trim();
    const label = type === "SUPPLIER" ? "supplier" : "customer";
    const fail = function (status, msg) {
      const d = {};
      d[field] = [msg];
      return new ApiError(status, d);
    };
    let parties;
    try {
      parties = type === "SUPPLIER" ? await AgroAPI.listSuppliers(farmId) : await AgroAPI.listCustomers(farmId);
    } catch (err) {
      throw fail(err.status || 0, label.charAt(0).toUpperCase() + label.slice(1) + "s could not be loaded from the server (" + (err.status || "no response") + ").");
    }
    const found = parties.find(function (c) { return c.name.trim().toLowerCase() === wanted.toLowerCase(); });
    if (found) return found.id;
    try {
      const created = await request("POST", farmUrl("parties", farmId), { name: wanted, party_type: type });
      if (created && created.id) return created.id;
    } catch (err) {
      const why = (err.fields && Object.keys(err.fields).length ? firstText(Object.values(err.fields)) : "") || err.message;
      throw fail(err.status || 0, "This " + label + " could not be saved: " + why);
    }
    throw fail(0, "This " + label + " could not be saved on the server.");
  }
  const customerIdFor = function (farmId, name) { return partyIdFor(farmId, name, "CUSTOMER", "customer"); };
  const supplierIdFor = function (farmId, name) { return partyIdFor(farmId, name, "SUPPLIER", "supplier"); };

  // No longer used by the Production form (the user now picks the item), but kept in case
  // something else still needs a default egg item.
  async function eggItemId(farmId) {
    if (CONFIG.DEFAULTS.eggItemId) return CONFIG.DEFAULTS.eggItemId;
    const cached = LS.get(K_EGG_ITEM + farmId, null);
    if (cached) return cached;
    try {
      // listAll, so the egg item is found even if it is not on the first page
      const egg = (await listAll(farmUrl("items", farmId))).find(function (i) {
        return i.category === "EGG" && i.is_active !== false;
      });
      if (egg) {
        LS.set(K_EGG_ITEM + farmId, egg.id);
        return egg.id;
      }
    } catch (err) {
      if (!noList(err)) throw err;
    }
    let unitId = CONFIG.DEFAULTS.eggUnitId;
    if (!unitId) {
      try {
        const u = listOf(await request("GET", CONFIG.FARM_ENDPOINTS.units)).find(function (x) {
          return String(x.abbreviation).toLowerCase() === "egg";
        });
        if (u) unitId = u.id;
      } catch (err) {
        if (!noList(err)) throw err;
      }
    }
    if (!unitId) {
      const created = await request("POST", CONFIG.FARM_ENDPOINTS.units, {
        name: "Egg",
        abbreviation: "egg"
      });
      unitId = created && created.id;
    }
    const item = await request("POST", farmUrl("items", farmId), {
      name: "Fresh Eggs",
      category: "EGG",
      base_unit: unitId,
      is_stock_tracked: true
    });
    if (!item || !item.id) {
      throw new ApiError(0, null, "The egg item could not be set up on the server.");
    }
    LS.set(K_EGG_ITEM + farmId, item.id);
    return item.id;
  }

  // Maps the form's field names to the names the backend expects.
  async function recordBody(type, farmId, v) {
    if (type === "flock") {
      const body = {
        identifier: String(v.identifier).trim(),
        breed: String(v.breed).trim(),
        arrival_date: v.arrival_date,
        initial_count: Number(v.starting_count),
        stage: v.stage,
        status: v.status
      };
      if (v.age_at_arrival !== "" && v.age_at_arrival != null) body.age_at_arrival = Number(v.age_at_arrival);
      return body;
    }
    if (type === "production") {
      // The item comes from the "Item" dropdown on the Production form.
      // If nothing was chosen, show an error under the field instead of a vague server rejection.
      const itemId = toId(v.item);
      if (itemId === "" || itemId == null || (typeof itemId === "number" && !Number.isFinite(itemId))) {
        throw new ApiError(0, { item: ["Choose an item from the list."] });
      }
      const body = {
        flock: toId(v.flock),
        item: itemId,
        quantity_collected: Number(v.collected),
        unit_collected: v.unit_collected,
        quantity_damaged: v.damaged === "" || v.damaged == null ? 0 : Number(v.damaged),
        // With no damaged quantity the unit is irrelevant; fall back to the collected unit so the field is never empty.
        unit_damaged: v.unit_damaged || v.unit_collected,
        event_date: v.date,
        classification: "LIVE"
      };
      // There is no "unit" and no "quantity_saleable" in the payload anymore: the backend calculates the saleable quantity.
      if (v.notes) body.notes = String(v.notes).trim();
      return body;
    }
    if (type === "activity") {
      const qty = v.birds !== undefined && v.birds !== "" ? v.birds : v.quantity;
      return {
        flock: v.flock ? toId(v.flock) : undefined,
        activity_type: v.code,
        quantity: qty === "" || qty == null ? undefined : Number(qty),
        // v.details is the one-line summary (it already contains the reason), so
        // only add the free-text notes after it. Adding reason again duplicated it.
        notes: [v.details, v.notes].filter(Boolean).join(" | ").trim(),
        event_date: v.date,
        classification: "LIVE"
      };
    }
    const orZero = function (x) { return x === "" || x == null ? 0 : Number(x); };
    // The backend wants decimals as strings with two places ("3.00").
    const money = function (x) { return (Math.round(Number(x) * 100) / 100).toFixed(2); };
    if (type === "sales") {
      return {
        event_date: v.date,
        // v.party_id is used when editing an existing sale (the customer is already known by id).
        // Otherwise the typed customer name is looked up or created.
        party: v.party_id != null && v.party_id !== "" ? toId(v.party_id) : await customerIdFor(farmId, v.customer),
        // The discount and the amount paid are sent at the top level of the payload, not inside the line.
        discount_type: v.discount_type === "PERCENT" ? "PERCENT" : "FIXED",
        discount_value: money(orZero(v.discount_value)),
        amount_paid: money(orZero(v.amount_paid)),
        // How the amount paid now was paid (CASH, BANK_TRANSFER, CARD, MOBILE_MONEY).
        payment_method: v.payment_method || "CASH",
        // Receipt number or bank reference for the amount paid now. Left out when empty.
        reference: String(v.reference || "").trim() || undefined,
        notes: v.notes ? String(v.notes).trim() : "",
        lines: [
          {
            item: Number(v.product),
            quantity: money(v.quantity),
            // The unit the goods were sold in (Crate, Tray, Egg, Bag, Kg, Bird). It belongs to the line.
            unit: v.unit || "",
            unit_price: money(v.price),
            // The line is the full price before the discount. The discount is sent separately above.
            total: money(orZero(v.quantity) * orZero(v.price)),
            // Only set when birds are sold from a specific flock ("Sell Birds"). The backend then
            // lowers that flock's current count and marks it "Sold out" when it reaches 0.
            flock: v.flock ? toId(v.flock) : undefined
          }
        ]
      };
    }
    if (type === "purchase") {
      // Same shape as a sale: a supplier (party) and a list of lines. The backend adds up the total
      // and the outstanding balance itself, so only the amount paid is sent.
      const itemId = toId(v.item);
      if (itemId === "" || itemId == null || (typeof itemId === "number" && !Number.isFinite(itemId))) {
        throw new ApiError(0, { item: ["Choose an item from the list."] });
      }
      return {
        event_date: v.date,
        // v.party_id is used when editing an existing purchase (the supplier is already known by id).
        // Otherwise the typed supplier name is looked up or created.
        party: v.party_id != null && v.party_id !== "" ? toId(v.party_id) : await supplierIdFor(farmId, v.supplier),
        // Whether the goods have arrived yet. The server stores RECEIVED or ORDERED.
        receipt_status: v.receipt_status === "ORDERED" ? "ORDERED" : "RECEIVED",
        amount_paid: money(orZero(v.amount_paid)),
        payment_method: v.payment_method || "CASH",
        // Receipt number or bank reference for the amount paid now. Left out when empty.
        reference: String(v.reference || "").trim() || undefined,
        notes: v.stock_received ? String(v.stock_received).trim() : "",
        lines: [
          {
            item: itemId,
            quantity: money(v.quantity),
            // The unit the goods were bought in (Bag, Bottle, Kg ...). It belongs to the line.
            unit: v.unit || "",
            unit_price: money(v.unit_cost),
            total: money(v.total_cost)
          }
        ]
      };
    }
    if (type === "expense") {
      const notes = [v.description, v.supporting_note].map(function (t) { return String(t || "").trim(); }).filter(Boolean).join(" | ");
      const payload = {
        event_date: v.date,
        amount: money(v.amount),
        notes: notes,
        category: v.category || "General",
        payment_details: v.payment_details,
        // The form offers readable names; the backend wants CASH, BANK_TRANSFER, CARD or MOBILE_MONEY.
        payment_method: ({ "cash": "CASH", "bank transfer": "BANK_TRANSFER", "card/pos": "CARD", "mobile money": "MOBILE_MONEY" })[String(v.payment_details || "").trim().toLowerCase()] || "CASH",
        // The backend works out the outstanding balance from amount and amount_paid.
        amount_paid: money(orZero(v.amount_paid)),
        reference: String(v.reference || "").trim() || undefined,
        classification: "LIVE"
      };
      // The supplier is optional. If one was typed, link it (it is created as a supplier if it is new).
      if (v.supplier && String(v.supplier).trim() !== "") {
        payload.party = await supplierIdFor(farmId, v.supplier);
      }
      return payload;
    }
    throw new Error("Unsupported record type for backend: " + type);
  }

  // UI record type -> key in FARM_ENDPOINTS
  const RECORD_KEYS = {
    flock: "flocks", production: "production", activity: "activities",
    sales: "sales", purchase: "purchases", expense: "expenses"
  };

  let currentEmail = "";

  const normUser = function (u) {
    u = u || {};
    const name = u.full_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || "";
    if (u.email) currentEmail = u.email.toLowerCase();
    return { id: u.id, name: name, email: u.email || "" };
  };

  // Ids are always strings in the UI. DOM data-attributes are strings, so a
  // numeric id from Django would never match with === when switching farms.
  // Settings may sit on the farm or beside it in the response; take either.
  const normFarm = function (item) {
    const f = item.farm || item;
    return {
      id: String(f.id),
      name: f.name,
      location: f.location || "",
      contact_info: f.contact_info || "",
      role: item.role || f.role || "",
      settings: f.settings || item.settings || undefined,
      // "layers" | "broilers" | "both". The app treats a missing value as "layers".
      farm_type: f.farm_type || item.farm_type || undefined
    };
  };

  // If the list endpoint doesn't return settings for a farm, reuse the ones the
  // server confirmed when the farm was created, so the currency doesn't snap
  // back to NGN after a refresh.
  const withCachedSettings = function (farms) {
    const cache = LS.get(K_FARM_CACHE + currentEmail, []);
    return farms.map(function (f) {
      const c = cache.find(function (x) { return String(x.id) === f.id; });
      if (!c) return f;
      const out = Object.assign({}, f);
      if (!out.settings && c.settings) out.settings = c.settings;
      if (!out.farm_type && c.farm_type) out.farm_type = c.farm_type;
      return out;
    });
  };

  const E = CONFIG.ENDPOINTS;

  const AgroAPI = {
    config: CONFIG,
    pages: CONFIG.PAGES,
    mock: isMock,
    ApiError: ApiError,

    register: async function (body) {
      const d = isMock ? await mock.register(body) : await request("POST", E.register, body);
      return { user: normUser(d.user || d), message: d.message || "" };
    },

    login: async function (body) {
      const d = isMock ? await mock.login(body) : await request("POST", E.login, body);
      return { user: normUser(d.user || d), message: d.message || "" };
    },

    logout: async function () {
      if (isMock) return mock.logout();
      let logoutError = null;
      try {
        await request("POST", E.logout, {});
      } catch (err) {
        logoutError = err;
        console.error("Logout request failed:", err.status, err.data);
      }
      try {
        await request("GET", E.me);
      } catch (err) {
        if (err.status === 401 || err.status === 403) return {};
        throw err;
      }
      console.error("Still signed in after logout.", logoutError || "");
      const csrfBlocked = logoutError && logoutError.status === 403 && /csrf/i.test(logoutError.message);
      throw new ApiError(0, null, csrfBlocked
        ? "Sign out was blocked by CSRF: " + logoutError.message
        : "We couldn't sign you out. Please try again.");
    },

    me: async function () {
      const d = isMock ? await mock.me() : await request("GET", E.me);
      return normUser(d.user || d);
    },

    listFarms: async function () {
      let d;
      if (isMock) {
        d = await mock.listFarms();
      } else {
        try {
          d = await request("GET", E.farms);
        } catch (err) {
          if (err.status === 405 || err.status === 404) {
            console.warn("GET " + E.farms + " not available. Using cached farms.");
            d = LS.get(K_FARM_CACHE + currentEmail, []);
          } else {
            throw err;
          }
        }
      }
      const arr = Array.isArray(d) ? d : (d && (d.results || d.farms)) || [];
      return withCachedSettings(arr.map(normFarm));
    },

    // ---------- Records: one list + one create method per backend resource ----------
    // Each list method follows every "next" page and returns UI-shaped rows
    // (string decimals such as "150.00" are already converted to numbers).
    listFlocks: async function (farmId) {
      return (await listAll(farmUrl("flocks", farmId))).map(normFlock);
    },
    listProduction: async function (farmId) {
      return (await listAll(farmUrl("production", farmId))).map(normProduction);
    },
    listActivities: async function (farmId) {
      return (await listAll(farmUrl("activities", farmId))).map(normActivity);
    },
    listSales: async function (farmId) {
      return (await listAll(farmUrl("sales", farmId))).map(normSale);
    },
    listPurchases: async function (farmId) {
      return (await listAll(farmUrl("purchases", farmId))).map(normPurchase);
    },
    listExpenses: async function (farmId) {
      return (await listAll(farmUrl("expenses", farmId))).map(normExpense);
    },
    // Lists used by the Sales and Purchase forms: customers and suppliers (parties) and items.
    listCustomers: async function (farmId) {
      return (await listAll(farmUrl("parties", farmId)))
        .filter(function (p) { return !p.party_type || String(p.party_type).toUpperCase() === "CUSTOMER"; })
        .map(function (p) { return { id: p.id, name: p.name || p.full_name || p.display_name || "" }; });
    },
    listSuppliers: async function (farmId) {
      return (await listAll(farmUrl("parties", farmId)))
        .filter(function (p) { return String(p.party_type || "").toUpperCase() === "SUPPLIER"; })
        .map(function (p) { return { id: p.id, name: p.name || p.full_name || p.display_name || "" }; });
    },
    // Archived items are left out so they no longer appear in the Sales, Purchase and Sell Birds forms.
    // The base unit is included because the Unit dropdown on the Purchase, Sales and Feed forms
    // offers the item's base unit plus the units that have a conversion for it.
    listItems: async function (farmId) {
      return (await listAll(farmUrl("items", farmId)))
        .filter(function (i) { return i.is_active !== false; })
        .map(function (i) {
          return {
            id: i.id, name: i.name || "", category: i.category || "",
            base_unit: idOf(i.base_unit),
            base_unit_name: i.base_unit_name || i.base_unit_display || nameOf(i.base_unit) || ""
          };
        });
    },

    // ---------- Inventory: items, units and unit conversions ----------
    // All global units (kg, bag, egg, bird ...), used by the item and conversion dropdowns.
    listUnits: async function () {
      return (await listAll(CONFIG.FARM_ENDPOINTS.units)).map(normUnit);
    },
    // Full item rows for the Inventory screen (listItems above is the slim list used by the forms).
    // Archived items are left out of the table.
    listInventory: async function (farmId) {
      return (await listAll(farmUrl("items", farmId)))
        .map(normInventoryItem)
        .filter(function (i) { return i.is_active; });
    },
    // v: { name, category, base_unit, is_stock_tracked, initial_stock? }
    // initial_stock is the optional opening stock, counted in the item's base unit.
    createItem: function (farmId, v) {
      const body = {
        name: String(v.name).trim(),
        category: v.category,
        base_unit: toId(v.base_unit),
        is_stock_tracked: !!v.is_stock_tracked
      };
      if (v.initial_stock != null && v.initial_stock !== "" && Number(v.initial_stock) > 0) {
        body.initial_stock = Number(v.initial_stock);
      }
      return request("POST", farmUrl("items", farmId), body);
    },
    // v: { name, category, base_unit, is_stock_tracked }. Only the fields you pass are sent.
    // The backend rejects a base_unit change (400) once the item has been used in transactions.
    updateItem: function (farmId, itemId, v) {
      const body = {};
      if (v.name != null) body.name = String(v.name).trim();
      if (v.category != null) body.category = v.category;
      if (v.base_unit != null) body.base_unit = toId(v.base_unit);
      if (v.is_stock_tracked != null) body.is_stock_tracked = !!v.is_stock_tracked;
      return request("PATCH", farmUrl("items", farmId) + encodeURIComponent(itemId) + "/", body);
    },
    // Soft delete: the backend sets is_active = false and keeps the history.
    archiveItem: function (farmId, itemId) {
      return request("DELETE", farmUrl("items", farmId) + encodeURIComponent(itemId) + "/");
    },
    listConversions: async function (farmId, itemId) {
      return (await listAll(farmUrl("items", farmId) + encodeURIComponent(itemId) + "/conversions/")).map(normConversion);
    },
    // Stock movements for one item (the stock ledger shown in the History window).
    listStockMovements: async function (farmId, itemId) {
      return (await listAll(farmUrl("items", farmId) + encodeURIComponent(itemId) + "/movements/")).map(normStockMovement);
    },
    // v: { unit, factor, is_base_unit }
    createConversion: function (farmId, itemId, v) {
      return request("POST", farmUrl("items", farmId) + encodeURIComponent(itemId) + "/conversions/", {
        unit: toId(v.unit),
        factor: Number(v.factor),
        is_base_unit: !!v.is_base_unit
      });
    },
    // v: { unit, factor, is_base_unit }. Only the fields you pass are sent.
    // PATCH /api/farms/{farm}/items/{item}/conversions/{id}/
    updateConversion: function (farmId, itemId, conversionId, v) {
      const body = {};
      if (v.unit != null) body.unit = toId(v.unit);
      if (v.factor != null) body.factor = Number(v.factor);
      if (v.is_base_unit != null) body.is_base_unit = !!v.is_base_unit;
      return request("PATCH", farmUrl("items", farmId) + encodeURIComponent(itemId) + "/conversions/" + encodeURIComponent(conversionId) + "/", body);
    },
    // DELETE /api/farms/{farm}/items/{item}/conversions/{id}/
    deleteConversion: function (farmId, itemId, conversionId) {
      return request("DELETE", farmUrl("items", farmId) + encodeURIComponent(itemId) + "/conversions/" + encodeURIComponent(conversionId) + "/");
    },

    // Dropdown data must never stop the whole app from loading, so a failed list becomes an empty one.
    loadLookups: async function (farmId) {
      const safe = async function (promise) {
        try { return await promise; } catch (err) { console.warn("Could not load a lookup list:", err.status, err.data); return []; }
      };
      const r = await Promise.all([
        safe(AgroAPI.listCustomers(farmId)),
        safe(AgroAPI.listItems(farmId)),
        safe(AgroAPI.listSuppliers(farmId))
      ]);
      return { customers: r[0], items: r[1], suppliers: r[2] };
    },
    // Create methods take the form values (UI field names) and map them to the backend names.
    createFlock: function (farmId, v) { return AgroAPI.createRecord("flock", farmId, v); },
    createProduction: function (farmId, v) { return AgroAPI.createRecord("production", farmId, v); },
    createActivity: function (farmId, v) { return AgroAPI.createRecord("activity", farmId, v); },

    createRecord: async function (type, farmId, v) {
      const key = RECORD_KEYS[type];
      if (!key) throw new Error("Unsupported record type: " + type);
      if (isMock) {
        await wait(300);
        return { id: "m" + Date.now().toString(36) };
      }

      const body = await recordBody(type, farmId, v);
      const d = await request("POST", farmUrl(key, farmId), body);
      const rec = (d && (d.flock || d.activity || d.production || d)) || {};
      return { id: rec.id };
    },

    // Update an existing sale. The backend reverses the old stock and applies the new one.
    // v: the same form values createRecord("sales", ...) takes.
    updateSale: async function (farmId, saleId, v) {
      if (isMock) { await wait(300); return { id: saleId }; }
      const body = await recordBody("sales", farmId, v);
      return request("PUT", farmUrl("sales", farmId) + encodeURIComponent(saleId) + "/", body);
    },

    // Correct ONE field of an existing sale (used by the Adjust window).
    // rec      : the sale row as the UI holds it (state.data.sales item, shaped by normSale)
    // fieldKey : "quantity" | "unit_price" | "total_amount"
    // newValue : the corrected number
    // It rebuilds the full sale from rec, changes only that field, keeps the sale's own notes,
    // and calls updateSale so the backend reverses the old stock and applies the new one.
    updateSaleField: async function (farmId, rec, fieldKey, newValue) {
      const lines = Array.isArray(rec.lines) ? rec.lines : [];
      if (lines.length > 1) {
        throw new ApiError(0, null, "This sale has several lines, so it can't be adjusted here.");
      }
      const hasParty = rec.party != null && rec.party !== "";
      if (!hasParty && !rec.customer) {
        throw new ApiError(0, null, "This sale has no customer on record, so it can't be adjusted here.");
      }
      const line = lines[0] || {};
      const value = Number(newValue);
      let quantity = rec.quantity;
      let price = line.unit_price != null ? line.unit_price : rec.price;

      if (fieldKey === "quantity") {
        quantity = value;
      } else if (fieldKey === "unit_price") {
        price = value;
      } else if (fieldKey === "total_amount") {
        if (rec.discount_value > 0) {
          throw new ApiError(0, null, "This sale has a discount. Adjust the quantity or unit price instead.");
        }
        if (!quantity) {
          throw new ApiError(0, null, "The quantity is zero, so the total can't be adjusted.");
        }
        price = value / quantity;
      } else {
        throw new ApiError(0, null, "That field can't be adjusted on a sale.");
      }

      return AgroAPI.updateSale(farmId, rec.id, {
        date: rec.date,
        party_id: hasParty ? rec.party : undefined,
        customer: rec.customer,
        product: line.item,
        quantity: quantity,
        price: price,
        unit: line.unit || rec.unit || "",
        flock: line.flock,
        discount_type: rec.discount_type || "FIXED",
        discount_value: rec.discount_value || 0,
        amount_paid: rec.amount_paid || 0,
        payment_method: "CASH",
        notes: rec.notes || ""
      });
    },

    // Update an existing purchase. The backend reverses the old stock and applies the new one.
    // v: the same form values createRecord("purchase", ...) takes (plus party_id to keep the supplier by id).
    updatePurchase: async function (farmId, purchaseId, v) {
      if (isMock) { await wait(300); return { id: purchaseId }; }
      const body = await recordBody("purchase", farmId, v);
      return request("PUT", farmUrl("purchases", farmId) + encodeURIComponent(purchaseId) + "/", body);
    },

    // Correct ONE field of an existing purchase (used by the Adjust window).
    // rec      : the purchase row as the UI holds it (state.data.purchase item, shaped by normPurchase)
    // fieldKey : "quantity" | "unit_price" | "total_amount"
    // newValue : the corrected number
    // It rebuilds the full purchase from rec, changes only that field, and calls updatePurchase.
    updatePurchaseField: async function (farmId, rec, fieldKey, newValue) {
      const lines = Array.isArray(rec.lines) ? rec.lines : [];
      if (lines.length > 1) {
        throw new ApiError(0, null, "This purchase has several lines, so it can't be adjusted here.");
      }
      const hasParty = rec.party != null && rec.party !== "";
      if (!hasParty && !rec.supplier) {
        throw new ApiError(0, null, "This purchase has no supplier on record, so it can't be adjusted here.");
      }
      const line = lines[0] || {};
      if (line.item == null || line.item === "") {
        throw new ApiError(0, null, "This purchase has no item on file, so it can't be adjusted here.");
      }
      const value = Number(newValue);
      let quantity = line.quantity != null ? line.quantity : rec.quantity;
      let price = line.unit_price != null ? line.unit_price : rec.unit_cost;
      let total;

      if (fieldKey === "quantity") {
        quantity = value;
        total = quantity * price;
      } else if (fieldKey === "unit_price") {
        price = value;
        total = quantity * price;
      } else if (fieldKey === "total_amount") {
        if (!quantity) {
          throw new ApiError(0, null, "The quantity is zero, so the total can't be adjusted.");
        }
        total = value;
        price = value / quantity;
      } else {
        throw new ApiError(0, null, "That field can't be adjusted on a purchase.");
      }

      return AgroAPI.updatePurchase(farmId, rec.id, {
        date: rec.date,
        party_id: hasParty ? rec.party : undefined,
        supplier: rec.supplier,
        receipt_status: String(rec.status || "").toUpperCase() === "ORDERED" ? "ORDERED" : "RECEIVED",
        amount_paid: rec.amount_paid || 0,
        payment_method: "CASH",
        // recordBody reads the purchase notes from "stock_received".
        stock_received: rec.notes || "",
        item: line.item,
        quantity: quantity,
        unit: line.unit || rec.unit || "",
        unit_cost: price,
        total_cost: total
      });
    },

    // Update an existing production record. The backend reverses the old stock and applies the new one.
    // v: the same form values createRecord("production", ...) takes.
    updateProduction: async function (farmId, productionId, v) {
      if (isMock) { await wait(300); return { id: productionId }; }
      const body = await recordBody("production", farmId, v);
      return request("PUT", farmUrl("production", farmId) + encodeURIComponent(productionId) + "/", body);
    },

    // Correct ONE field of an existing production record (used by the Adjust window).
    // rec      : the production row as the UI holds it (state.data.production item, shaped by normProduction)
    // fieldKey : "quantity_collected" | "quantity_damaged"
    // newValue : the corrected number
    updateProductionField: async function (farmId, rec, fieldKey, newValue) {
      if (rec.item == null || rec.item === "") {
        throw new ApiError(0, null, "This production record has no item on file, so it can't be adjusted here.");
      }
      const value = Number(newValue);
      let collected = rec.collected;
      let damaged = rec.damaged;

      if (fieldKey === "quantity_collected") {
        collected = value;
      } else if (fieldKey === "quantity_damaged") {
        damaged = value;
      } else if (fieldKey === "quantity_saleable") {
        // The backend works out the saleable quantity itself, so it can't be sent.
        throw new ApiError(0, null, "The saleable quantity is calculated from collected minus damaged. Adjust the eggs collected or the damaged eggs instead.");
      } else {
        throw new ApiError(0, null, "That field can't be adjusted on a production record.");
      }

      return AgroAPI.updateProduction(farmId, rec.id, {
        date: rec.date,
        flock: rec.flock,
        item: rec.item,
        collected: collected,
        unit_collected: rec.unit_collected || "Egg",
        damaged: damaged,
        unit_damaged: rec.unit_damaged || rec.unit_collected || "Egg",
        notes: rec.notes || ""
      });
    },

    // Dashboard summary: financial totals, cash flow, operations, recent sales and expenses, low stock alerts.
    // days: how many days back to look (default 30). The numbers come back already parsed (see normDashboard).
    getDashboardStats: async function (farmId, days) {
      const d = Math.max(1, parseInt(days, 10) || 30);
      if (isMock) { await wait(300); return normDashboard({ period: { days: d } }); }
      return normDashboard(await request("GET", farmUrl("dashboard", farmId) + "?days=" + d));
    },

    // ---------- Records page: summary cards, trend chart and breakdown chart ----------
    // Turns the date-range dropdown value ("7d", "30d", "90d", "year") into { days } or { start_date, end_date }.
    // For a custom range the view passes { start_date, end_date } (YYYY-MM-DD) straight in.
    dateRange: presetRange,

    // One call for a whole tab. The three requests run in parallel and fail independently, so a tab whose
    // backend endpoint is missing still shows its other parts. Returns:
    //   stats     : the stats object with numbers parsed (includes the backend's "trends" object), or null
    //   trend     : array of points for the main chart ([] when none)
    //   breakdown : array of slices for the donut / bar chart ([] when none)
    //   errors    : { stats?, trend?, breakdown? } with the ApiError of any request that failed
    // type: "production" | "sales" | "purchase" | "expense" | "flock" | "activity" | "inventory"
    // range: { days } or { start_date, end_date }  (see AgroAPI.dateRange)
    getRecordsReport: async function (farmId, type, range) {
      const ep = REPORT_ENDPOINTS[type];
      if (!ep) throw new Error("No report endpoints for record type: " + type);
      if (isMock) { await wait(300); return { stats: null, trend: [], breakdown: [], errors: {} }; }

      const base = farmUrl(ep.base, farmId);
      const q = reportQuery(range);
      const get = function (suffix, dated) {
        return suffix ? request("GET", base + suffix + (dated ? q : "")) : Promise.resolve(null);
      };
      const r = await Promise.allSettled([
        get(ep.stats, true),
        get(ep.trend, true),
        get(ep.breakdown, ep.breakdownDated !== false)
      ]);

      const out = { stats: null, trend: [], breakdown: [], errors: {} };
      if (r[0].status === "fulfilled" && r[0].value) {
        const s = numDeep(r[0].value);
        s.trends = s.trends && typeof s.trends === "object" ? s.trends : {};
        out.stats = s;
      } else if (r[0].status === "rejected") out.errors.stats = r[0].reason;
      if (r[1].status === "fulfilled") out.trend = numDeep(unwrapList(r[1].value));
      else out.errors.trend = r[1].reason;
      if (r[2].status === "fulfilled") out.breakdown = numDeep(unwrapList(r[2].value));
      else out.errors.breakdown = r[2].reason;
      return out;
    },

    // Single-purpose versions, for when only one part needs refreshing.
    getRecordStats: async function (farmId, type, range) { return (await AgroAPI.getRecordsReport(farmId, type, range)).stats; },
    getRecordTrend: async function (farmId, type, range) { return (await AgroAPI.getRecordsReport(farmId, type, range)).trend; },
    getRecordBreakdown: async function (farmId, type, range) { return (await AgroAPI.getRecordsReport(farmId, type, range)).breakdown; },

    // Loads every page of every record type for a farm.
    loadFarmData: async function (farmId) {
      const r = await Promise.all([
        AgroAPI.listFlocks(farmId),
        AgroAPI.listProduction(farmId),
        AgroAPI.listActivities(farmId),
        AgroAPI.listSales(farmId),
        AgroAPI.listPurchases(farmId),
        AgroAPI.listExpenses(farmId),
        // The audit log must never stop the app from loading, so a failed list becomes an empty one.
        AgroAPI.listAdjustments(farmId).catch(function (err) { console.warn("Could not load adjustments:", err.status, err.data); return []; }),
      ]);
      return { flock: r[0], production: r[1], activity: r[2], sales: r[3], purchase: r[4], expense: r[5], adjustment: r[6] };
    },

    // ---------- Adjustments and corrections ----------
    listAdjustments: async function (farmId) {
      return (await listAll(farmUrl("adjustments", farmId))).map(normAdjustment);
    },
    // payload: { target_model, target_id, reason, notes, changes: [{ field, old_value, new_value }] }
    createAdjustment: async function (farmId, payload) {
      if (isMock) { await wait(300); return { id: "m" + Date.now().toString(36) }; }
      const body = Object.assign({}, payload, { target_id: toId(payload.target_id) });
      return request("POST", farmUrl("adjustmentsCreate", farmId), body);
    },

    // Records a direct stock adjustment (Loss, Theft, Discrepancy) without editing the original transaction.
    // The backend converts the unit and writes the Adjustment log entry itself, in one atomic step,
    // so the caller must NOT also call createAdjustment.
    // payload: { target_model, target_id, item_id, quantity, unit, reason, notes, event_date, direction }
    // direction is "OUT" (stock goes down) or "IN" (stock goes up).
    recordStockAdjustment: async function (farmId, payload) {
      if (isMock) { await wait(300); return { id: "m" + Date.now().toString(36) }; }
      const body = Object.assign({}, payload, { item_id: toId(payload.item_id) });
      if (body.target_id != null) body.target_id = toId(body.target_id);
      return request("POST", farmUrl("stockAdjust", farmId), body);
    },

    // A later payment against an existing sale, purchase or expense. It never creates a new record:
    // the server links it to the original one and lowers that record's outstanding balance.
    // payload: { transaction_type: "SALE" | "PURCHASE" | "EXPENSE", transaction_id, amount, payment_method, event_date, reference? }
    recordPayment: async function (farmId, payload) {
      if (isMock) { await wait(300); return { id: "m" + Date.now().toString(36) }; }
      const body = {
        transaction_type: payload.transaction_type,
        transaction_id: toId(payload.transaction_id),
        amount: (Math.round(Number(payload.amount) * 100) / 100).toFixed(2),
        payment_method: payload.payment_method,
        event_date: payload.event_date
      };
      if (payload.reference && String(payload.reference).trim() !== "") body.reference = String(payload.reference).trim();
      return request("POST", farmUrl("payments", farmId), body);
    },

    // The backend creates the real Flock records for every flock line, atomically.
    createOpeningPosition: async function (farmId, v) {
      return request("POST", farmUrl("openingPosition", farmId), {
        event_date: v.event_date,
        status: "CONFIRMED",
        flock_lines: v.flock_lines,
        stock_lines: [],
      });
    },

    createFarm: async function (v) {
      if (isMock) return normFarm(await mock.createFarm(v));

      const payload = {
        name: String(v.name).trim(),
        location: String(v.location || "").trim(),
        contact_info: String(v.contact_info || "").trim(),
        // the backend validates these (ISO currency, IANA timezone, metric/imperial)
        currency: v.currency,
        timezone: v.timezone,
        unit_system: v.unit_system,
        farm_type: v.farm_type || "layers"
      };

      const d = await request("POST", E.farms, payload);
      const created = (d && d.farm) || d || {};

      const farm = normFarm({
        ...created,
        role: (d && d.role) || "OWNER",
        farm_type: created.farm_type || (d && d.farm_type) || v.farm_type || "layers",
        // trust what the server saved; fall back to what the user picked,
        // never to hardcoded defaults
        settings: created.settings || (d && d.settings) || {
          currency: v.currency || "NGN",
          timezone: v.timezone || "Africa/Lagos",
          unit_system: v.unit_system || "metric"
        }
      });

      const cache = LS.get(K_FARM_CACHE + currentEmail, []).filter(function (x) {
        return String(x.id) !== farm.id;
      });
      cache.push(farm);
      LS.set(K_FARM_CACHE + currentEmail, cache);

      return farm;
    },
  };

  global.AgroAPI = AgroAPI;
})(window);