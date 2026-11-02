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
      payments: "/api/farms/{farm}/payments/",
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
      id: p.id, flock: p.flock, date: p.event_date,
      collected: n(p.quantity_collected), damaged: n(p.quantity_damaged), saleable: n(p.quantity_saleable),
      notes: p.notes || "",
      // How the eggs were packed (Loose eggs, Trays, Crates). The server stores it in "unit".
      packaging: unitOf(p.unit != null ? p.unit : (p.packaging != null ? p.packaging : p.packaging_unit)),
      recorded_by: p.created_by_name || "", created_at: p.created_at, created_by: p.created_by_name || ""
    };
  };
  const normActivity = function (a) {
    return {
      id: a.id, flock: a.flock || null, code: a.activity_type,
      type: ACTIVITY_LABELS[a.activity_type] || a.activity_type,
      date: a.event_date, details: a.notes || (a.quantity != null ? String(n(a.quantity)) : ""),
      quantity: a.quantity != null ? n(a.quantity) : null,
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
        quantity: n(l.quantity), unit: unitOf(l.unit), unit_price: n(l.unit_price), total: n(l.total)
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
        quantity: n(l.quantity), unit: unitOf(l.unit), unit_price: n(l.unit_price), total: n(l.total)
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
      unit: (lines.length && lines[0].unit) || unitOf(x.unit),
      unit_cost: lines.length ? lines[0].unit_price : n(x.unit_cost),
      total_cost: totalCost,
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

  async function eggItemId(farmId) {
    if (CONFIG.DEFAULTS.eggItemId) return CONFIG.DEFAULTS.eggItemId;
    const cached = LS.get(K_EGG_ITEM + farmId, null);
    if (cached) return cached;
    try {
      // listAll, so the egg item is found even if it is not on the first page
      const egg = (await listAll(farmUrl("items", farmId))).find(function (i) {
        return i.category === "EGG";
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
      const body = {
        flock: toId(v.flock),
        item: await eggItemId(farmId),
        quantity_collected: Number(v.collected),
        quantity_damaged: v.damaged === "" || v.damaged == null ? 0 : Number(v.damaged),
        quantity_saleable: Number(v.saleable),
        event_date: v.date,
        // How the eggs were packed (Loose eggs, Trays, Crates). Saved on the record as "unit".
        unit: v.packaging || "Loose eggs",
        classification: "LIVE"
      };
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
        party: await customerIdFor(farmId, v.customer),
        // The discount and the amount paid are sent at the top level of the payload, not inside the line.
        discount_type: v.discount_type === "PERCENT" ? "PERCENT" : "FIXED",
        discount_value: money(orZero(v.discount_value)),
        amount_paid: money(orZero(v.amount_paid)),
        notes: v.notes ? String(v.notes).trim() : "",
        lines: [
          {
            item: Number(v.product),
            quantity: money(v.quantity),
            // The unit the goods were sold in (Crate, Tray, Egg, Bag, Kg). It belongs to the line.
            unit: v.unit || "",
            unit_price: money(v.price),
            // The line is the full price before the discount. The discount is sent separately above.
            total: money(orZero(v.quantity) * orZero(v.price))
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
        party: await supplierIdFor(farmId, v.supplier),
        amount_paid: money(orZero(v.amount_paid)),
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
        // The backend works out the outstanding balance from amount and amount_paid.
        amount_paid: money(orZero(v.amount_paid)),
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
    listItems: async function (farmId) {
      return (await listAll(farmUrl("items", farmId)))
        .map(function (i) { return { id: i.id, name: i.name || "", category: i.category || "" }; });
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