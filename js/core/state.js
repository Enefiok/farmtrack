/* js/core/state.js - state, api data layer, demo data */
"use strict";

  /* =====================================================================
     STATE + DATA LAYER
     Every record type is loaded from and saved to the Django API.
     In DEV mode (?demo=1 / ?dev=1) everything stays local to this browser.
     ===================================================================== */
  const TYPES = ["flock", "production", "sales", "purchase", "expense", "activity"];
  const emptyData = () => Object.fromEntries([...TYPES, "adjustment"].map((t) => [t, []]));

  const state = {
    user: { name: "Jane Doe", email: "jane1122@gmail.com" },
    farms: [],      // filled by api.loadFarms()
    farmId: null,
    settings: { dailyEggTarget: 0 }, // 0 = use number of live birds as the target
    data: emptyData(),
    authed: false,
    status: "loading", // loading | ready | error | forbidden
    query: "",
    range: "monthly",
    // Feeds the forms: customer and supplier suggestions, and the item (product) list
    lookups: { customers: [], suppliers: [], items: [] },
    // The Inventory page: full item rows and the global unit list. status: idle | loading | ready | error
    inventory: { items: [], units: [], status: "idle", farmId: null },
  };
  const farm =() => state.farms.find((f) => f.id === state.farmId) || null;

  const storeKey = () => `agroflow:v1:${state.farmId}`;
  const readStore = () => { try { return JSON.parse(localStorage.getItem(storeKey())); } catch { return null; } };
  const writeStore = () => { try { localStorage.setItem(storeKey(), JSON.stringify(state.data)); } catch { /* storage unavailable */ } };

  const farmsKey = "agroflow:v1:farms";
  const api = {
    // Stand-in for GET /api/farms/
    async loadFarms() {
      if (failNextLoad) { failNextLoad = false; await delay(350); throw new Error("Network error"); }
      if (!DEV) { state.farms = await AgroAPI.listFarms(); return; }
      await delay(350);
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(farmsKey)); } catch { /* ignore */ }
      state.farms = saved || (params.has("demo")
        ? [{ id: "greenfield", name: "Greenfield farm", location: "Ogun state, Nigeria", farm_type: "layers", settings: { currency: "NGN", timezone: "Africa/Lagos", unit_system: "metric" } }]
        : []);
    },
    // Stand-in for POST /api/farms/  ->  { farm: { id, name }, role: "OWNER" }
    async createFarm(v) {
      if (!DEV) { const f = await AgroAPI.createFarm(v); state.farms.push(f); return f; }
      await delay(300);
      const f = { id: uid(), name: v.name, location: v.location, contact_info: v.contact_info, farm_type: v.farm_type || "layers", role: "OWNER",
        settings: { currency: v.currency, timezone: v.timezone, unit_system: v.unit_system } };
      state.farms.push(f);
      try { localStorage.setItem(farmsKey, JSON.stringify(state.farms)); } catch { /* ignore */ }
      return f;
    },
    async load() {
      if (!DEV) {
        const id = state.farmId;
        const [data, lookups] = await Promise.all([AgroAPI.loadFarmData(id, { skipAdjustments: true }), AgroAPI.loadLookups(id)]);
        // Keep the adjustment list already on screen (same farm) so a reload after a save never flashes it empty.
        const keepAdj = state.adjFarmId === id && state.data && Array.isArray(state.data.adjustment) ? state.data.adjustment : [];
        state.data = { ...emptyData(), ...data, adjustment: keepAdj };
        state.lookups = { customers: [], suppliers: [], items: [], ...lookups };
        resolveNames();
        // The audit log loads in the background: the app is usable without it, and the View windows read it when opened.
        AgroAPI.listAdjustments(id).then((list) => {
          if (id !== state.farmId) return;   // the user switched farms meanwhile
          state.data.adjustment = list; state.adjFarmId = id;
        }).catch((err) => console.warn("Could not load adjustments:", err.status, err.data));
        return;
      }
      await delay(150);
      const saved = readStore();
      state.data = { ...emptyData(), ...(saved || {}) };
      if (!saved && params.has("demo")) { state.data = demoData(); state.settings.dailyEggTarget = 4500; }
      state.lookups = devLookups();
    },
    // Re-fetches only the data behind one Records tab (and flocks too for activities,
    // because a mortality changes current_count). Silent: it never shows the loading card.
    async refresh(type) {
      if (DEV) return;
      const id = state.farmId;
      const fresh = {};
      if (type === "flock") fresh.flock = await AgroAPI.listFlocks(id);
      else if (type === "production") fresh.production = await AgroAPI.listProduction(id);
      else if (type === "activity") {
        const r = await Promise.all([AgroAPI.listActivities(id), AgroAPI.listFlocks(id)]);
        fresh.activity = r[0]; fresh.flock = r[1];
      } else if (type === "sales") fresh.sales = await AgroAPI.listSales(id);
      else if (type === "purchase") fresh.purchase = await AgroAPI.listPurchases(id);
      else if (type === "expense") fresh.expense = await AgroAPI.listExpenses(id);
      else if (type === "adjustment") fresh.adjustment = await AgroAPI.listAdjustments(id);
      else return;
      if (id !== state.farmId) return; // user switched farms while this was loading
      Object.assign(state.data, fresh);
      resolveNames();
    },
    async create(type, values) {
      if (!DEV) {
        await AgroAPI.createRecord(type, state.farmId, values);
        await api.load(); // reloads everything, so a mortality or a bird sale also updates the flock's current_count
        return;
      }
      await delay(250);
      const rec = { created_at: new Date().toISOString(), created_by: state.user.name, ...values, id: uid() };
      if (type === "sales") rec.product = (state.lookups.items.find((i) => String(i.id) === String(values.product)) || {}).name || values.product;
      if (type === "purchase") rec.item = (state.lookups.items.find((i) => String(i.id) === String(values.item)) || {}).name || values.item;
      state.data[type].unshift(rec);
      if (values.code === "MORTALITY") { // DEV only: the server calculates counts
        const fl = findFlock(values.flock);
        if (fl) {
          fl.current_count = Math.max(0, num(fl.current_count) - num(values.birds));
          fl.mortality_rate = fl.starting_count ? +(((fl.starting_count - fl.current_count) / fl.starting_count) * 100).toFixed(1) : 0;
        }
      }
      if (type === "sales" && values.flock) { // DEV only: selling birds from a flock lowers its count
        const fl = findFlock(values.flock);
        if (fl) {
          fl.current_count = Math.max(0, num(fl.current_count) - num(values.quantity));
          if (fl.current_count === 0) fl.status = "Sold out";
        }
      }
      writeStore();
      return rec;
    },
    // Adjustments: POST /api/farms/{id}/adjustments/create/ (the server applies the change and keeps the record of it)
    async adjust(rec, sp, payload) {
      if (!DEV) {
        await AgroAPI.createAdjustment(state.farmId, payload);
        await api.load(); // reloads everything so the corrected value shows
        return;
      }
      await delay(250);
      rec[sp.ui] = payload.changes[0].new_value; // DEV only: the server does this for real
      state.data.adjustment.unshift({ id: uid(), date: new Date().toISOString(), target_model: payload.target_model, target_id: rec.id, reason: payload.reason, notes: payload.notes, changes: payload.changes, created_at: new Date().toISOString(), created_by: state.user.name });
      if (rec.starting_count && sp.key === "current_count") rec.mortality_rate = +(((rec.starting_count - rec.current_count) / rec.starting_count) * 100).toFixed(1);
      writeStore();
    },
    // A later payment against an existing sale, purchase or expense: POST /api/farms/{id}/payments/.
    // It never creates a new record. The server links the payment to the original one and lowers
    // its outstanding balance. Only that tab's list is re-fetched afterwards.
    async recordPayment(type, rec, v) {
      if (!DEV) {
        await AgroAPI.recordPayment(state.farmId, {
          transaction_type: PAYMENT_KIND[type],
          transaction_id: rec.id,
          amount: v.amount,
          payment_method: v.method,
          event_date: v.date,
          reference: v.reference,
        });
        await api.refresh(type);
        return;
      }
      await delay(250);
      const pay = { id: uid(), date: v.date, amount: num(v.amount), method: v.method, reference: v.reference || "", created_by: state.user.name };
      rec.payments = [...(rec.payments || []), pay]; // DEV only: the server does this for real
      rec.amount_paid = num(rec.amount_paid) + pay.amount;
      rec.outstanding_balance = Math.max(0, num(rec.outstanding_balance) - pay.amount);
      writeStore();
    },
    // "Add existing birds": POST /api/farms/{id}/opening-position/
    // One request carries every flock row from the modal (flock_lines is a list).
    // Each row has its own arrival date; the top-level "Date of Count" is the fallback.
    async createOpening(v) {
      if (!DEV) {
        await AgroAPI.createOpeningPosition(state.farmId, {
          event_date: v.date,
          flock_lines: v.rows.map((r) => ({
            identifier: r.identifier,
            initial_count: r.count,
            breed: r.breed,
            stage: r.stage,
            arrival_date: r.arrival_date || v.date, // Use individual date, fall back to the global date
          })),
        });
        await api.load();
        return;
      }
      await delay(250);
      const at = new Date().toISOString();
      v.rows.slice().reverse().forEach((r) => {
        state.data.flock.unshift({ id: uid(), identifier: r.identifier, breed: r.breed, arrival_date: r.arrival_date || v.date, starting_count: r.count, current_count: r.count, mortality_rate: 0, stage: r.stage, status: "Active", created_at: at, created_by: state.user.name });
      });
      writeStore();
    },
  };

  // A sale or purchase from the server may carry only ids; fill in the customer, supplier and
  // product/item names from the lookups.
  function resolveNames() {
    const { customers, suppliers = [], items } = state.lookups;
    const itemNames = (lines) => lines.map((l) => (items.find((i) => String(i.id) === String(l.item)) || {}).name).filter(Boolean).join(", ");
    state.data.sales.forEach((r) => {
      if (!r.customer && r.party != null) {
        const c = customers.find((x) => String(x.id) === String(r.party));
        if (c) r.customer = c.name;
      }
      if (!r.product && Array.isArray(r.lines)) r.product = itemNames(r.lines);
    });
    state.data.purchase.forEach((r) => {
      if (!r.supplier && r.party != null) {
        const s = suppliers.find((x) => String(x.id) === String(r.party));
        if (s) r.supplier = s.name;
      }
      if (!r.item && Array.isArray(r.lines)) r.item = itemNames(r.lines);
    });
    state.data.expense.forEach((r) => {
      if (!r.supplier && r.party != null) {
        const s = suppliers.find((x) => String(x.id) === String(r.party));
        if (s) r.supplier = s.name;
      }
    });
  }
  const devLookups = () => ({
    customers: [{ id: "c1", name: "Mama Ngozi" }, { id: "c2", name: "Fresh Mart" }, { id: "c3", name: "Ade Stores" }],
    suppliers: [{ id: "s1", name: "Agro Feeds Ltd" }, { id: "s2", name: "VetCare Supplies" }],
    items: [{ id: "item-eggs", name: "Eggs" }, { id: "item-hens", name: "Spent hens" }, { id: "item-manure", name: "Manure" }, { id: "item-feed", name: "Feed" }],
  });

  function demoData() {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const now = new Date();
    const at = (d, h = 8, m = 42) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); };
    const d = emptyData();
    const A = { id: "fl-a", identifier: "Layers House A", breed: "Isa Brown", arrival_date: `${now.getFullYear()}-01-05`, age_at_arrival: 18, starting_count: 2000, current_count: 2000, stage: "Layer", mortality_rate: 0, status: "Active", created_at: at(new Date(now.getFullYear(), 0, 5)) };
    const B = { id: "fl-b", identifier: "Layers House B", breed: "Lohmann Brown", arrival_date: `${now.getFullYear()}-01-05`, age_at_arrival: 18, starting_count: 1550, current_count: 1550, stage: "Layer", mortality_rate: 0, status: "Active", created_at: at(new Date(now.getFullYear(), 0, 5)) };
    d.flock.push(A, B);
    for (let i = 13; i >= 0; i--) {
      const day = new Date(now); day.setDate(now.getDate() - i);
      [[A, 1900], [B, 1750]].forEach(([f, base]) => {
        const collected = i === 0 ? base : Math.round(base - 120 + rnd() * 200);
        const damaged = Math.round(10 + rnd() * 30);
        d.production.push({ id: uid(), created_at: at(day), created_by: "Jane Doe", date: localISO(day), flock: f.id, collected, damaged, saleable: collected - damaged, packaging: "Loose eggs", recorded_by: "Jane Doe" });
      });
    }
    for (let m = 0; m <= now.getMonth(); m++) {
      for (let k = 0; k < 3; k++) {
        const dt = new Date(now.getFullYear(), m, 5 + k * 8);
        const season = 0.7 + 0.6 * Math.sin((m + 1) / 12 * Math.PI) + rnd() * 0.3;
        const qty = Math.round((120 + rnd() * 100) * season), price = Math.round(1800 + rnd() * 400);
        // Every third sale is only partly paid, so the Outstanding column has something to show.
        const total = qty * price, paid = k === 2 ? Math.round(total * 0.6) : total;
        d.sales.push({ id: uid(), created_at: at(dt, 10), created_by: "Jane Doe", date: localISO(dt), customer: ["Mama Ngozi", "Fresh Mart", "Ade Stores"][k], product: "Eggs", quantity: qty, unit: "Crate", price, discount_type: "FIXED", discount_value: 0, total, amount_paid: paid, outstanding_balance: total - paid });
      }
      for (let k = 0; k < 2; k++) {
        const dt = new Date(now.getFullYear(), m, 3 + k * 12);
        const qty = Math.round(20 + rnd() * 25), cost = Math.round(9000 + rnd() * 2500);
        d.purchase.push({ id: uid(), created_at: at(dt, 9), created_by: "Jane Doe", date: localISO(dt), supplier: "Agro Feeds Ltd", item: "Feed", quantity: qty, unit: "Bag", unit_cost: cost, total_cost: qty * cost, amount_paid: qty * cost, outstanding_balance: 0 });
      }
      const dt = new Date(now.getFullYear(), m, 20);
      const wages = Math.round(60000 + rnd() * 20000);
      d.expense.push({ id: uid(), created_at: at(dt, 11), created_by: "Jane Doe", date: localISO(dt), supplier: "Staff payroll", description: "Monthly wages", amount: wages, payment_details: "Bank transfer", amount_paid: wages, outstanding_balance: 0 });
    }
    return d;
  }