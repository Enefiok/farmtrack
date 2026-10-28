(() => {
  "use strict";

  /* =====================================================================
     CONFIG
     ===================================================================== */
  const CONFIG = {
    currency: "NGN",
    locale: "en-NG",
    signInUrl: "/sign-in",
    logoutUrl: "/api/auth/logout/",
  };
  const params = new URLSearchParams(location.search);
  // ?demo=1  -> fills the app with sample data so you can see the populated dashboard
  // ?error=1 -> makes the first load fail so you can see the error state (Try again works)
  let failNextLoad = params.has("error");
  // ?demo=1 or ?dev=1 skips the sign-in check, for looking at the screens without an account
  const DEV = params.has("demo") || params.has("dev");

  /* =====================================================================
     SMALL HELPERS
     ===================================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtInt = (n) => new Intl.NumberFormat(CONFIG.locale).format(Math.round(n));
  const currencyCode = () => (farm() && farm().settings && farm().settings.currency) || CONFIG.currency;
  const fmtMoney = (n) => new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: currencyCode(), maximumFractionDigits: 2 }).format(n);
  const fmtMoney0 = (n) => new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: currencyCode(), maximumFractionDigits: 0 }).format(n);
  const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtDate = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  const fmtWhen = (iso) => {
    const d = new Date(iso), now = new Date();
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (localISO(d) === localISO(now)) return `Today, ${time}`;
    if (localISO(d) === localISO(yest)) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
  };
  const getCookie = (name) => {
    const m = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  };
  const shortNum = (v) => {
    if (v >= 1e6) return +(v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return +(v / 1e3).toFixed(1) + "k";
    return String(v);
  };
  // Initials for the profile circle: "Science_Prince" -> "SP", "Enefiok" -> "EN"
  const initials = (s) => {
    const parts = String(s || "").split("@")[0].split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  };

  /* =====================================================================
     ICONS
     ===================================================================== */
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="2.5"/><rect x="14" y="3" width="7" height="7" rx="2.5"/><rect x="3" y="14" width="7" height="7" rx="2.5"/><rect x="14" y="14" width="7" height="7" rx="2.5"/>',
    records: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
    inventory: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    reports: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 17v-5M12 17V8M16 17v-3"/>',
    users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2"/><circle cx="18" cy="18" r="3"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
    bird: '<path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/>',
    egg: '<path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    trend: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4M12 16h.01"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  };
  const icon = (name, size = 18) =>
    `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;

  /* =====================================================================
     STATE + DATA LAYER
     Flocks, production and activities are loaded from the Django API.
     Sales, purchase and expense have no endpoints yet, so they stay in
     this browser's localStorage. In DEV mode (?demo=1 / ?dev=1) everything
     is local.
     ===================================================================== */
  const TYPES = ["flock", "production", "sales", "purchase", "expense", "activity"];
  const emptyData = () => Object.fromEntries(TYPES.map((t) => [t, []]));

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
  };
  const farm = () => state.farms.find((f) => f.id === state.farmId) || null;

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
        ? [{ id: "greenfield", name: "Greenfield farm", location: "Ogun state, Nigeria", settings: { currency: "NGN", timezone: "Africa/Lagos", unit_system: "metric" } }]
        : []);
    },
    // Stand-in for POST /api/farms/  ->  { farm: { id, name }, role: "OWNER" }
    async createFarm(v) {
      if (!DEV) { const f = await AgroAPI.createFarm(v); state.farms.push(f); return f; }
      await delay(300);
      const f = { id: uid(), name: v.name, location: v.location, contact_info: v.contact_info, role: "OWNER",
        settings: { currency: v.currency, timezone: v.timezone, unit_system: v.unit_system } };
      state.farms.push(f);
      try { localStorage.setItem(farmsKey, JSON.stringify(state.farms)); } catch { /* ignore */ }
      return f;
    },
    async load() {
      if (!DEV) {
        // sales/purchase/expense have no endpoints yet, so they stay local
        const saved = readStore() || {};
        const server = await AgroAPI.loadFarmData(state.farmId);
        state.data = { ...emptyData(), sales: saved.sales || [], purchase: saved.purchase || [], expense: saved.expense || [], ...server };
        return;
      }
      await delay(150);
      const saved = readStore();
      state.data = { ...emptyData(), ...(saved || {}) };
      if (!saved && params.has("demo")) { state.data = demoData(); state.settings.dailyEggTarget = 4500; }
    },
    async create(type, values) {
      if (!DEV && (type === "flock" || type === "activity" || type === "production")) {
        await AgroAPI.createRecord(type, state.farmId, values);
        await api.load(); // reloads flocks too, so a mortality updates current_count
        return;
      }
      await delay(250);
      const rec = { created_at: new Date().toISOString(), created_by: state.user.name, ...values, id: uid() };
      state.data[type].unshift(rec);
      if (values.code === "MORTALITY") { // DEV only: the server calculates counts
        const fl = findFlock(values.flock);
        if (fl) {
          fl.current_count = Math.max(0, num(fl.current_count) - num(values.birds));
          fl.mortality_rate = fl.starting_count ? +(((fl.starting_count - fl.current_count) / fl.starting_count) * 100).toFixed(1) : 0;
        }
      }
      writeStore();
      return rec;
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
        d.sales.push({ id: uid(), created_at: at(dt, 10), created_by: "Jane Doe", date: localISO(dt), customer: ["Mama Ngozi", "Fresh Mart", "Ade Stores"][k], product: "Eggs", quantity: qty, unit: "Crate", price, discount: 0, total: qty * price });
      }
      for (let k = 0; k < 2; k++) {
        const dt = new Date(now.getFullYear(), m, 3 + k * 12);
        const qty = Math.round(20 + rnd() * 25), cost = Math.round(9000 + rnd() * 2500);
        d.purchase.push({ id: uid(), created_at: at(dt, 9), created_by: "Jane Doe", date: localISO(dt), supplier: "Agro Feeds Ltd", item: "Feed", quantity: qty, unit: "Bag", unit_cost: cost, total_cost: qty * cost, amount_paid: qty * cost, outstanding_balance: 0 });
      }
      const dt = new Date(now.getFullYear(), m, 20);
      d.expense.push({ id: uid(), created_at: at(dt, 11), created_by: "Jane Doe", date: localISO(dt), supplier: "Staff payroll", description: "Monthly wages", amount: Math.round(60000 + rnd() * 20000), payment_details: "Bank transfer", amount_paid: 0, amount_owed: 0 });
    }
    return d;
  }

  /* =====================================================================
     FORM SCHEMAS (one per record type)
     ===================================================================== */
  const flockOptions = () => state.data.flock.map((f) => [f.id, f.identifier]);
  const findFlock = (id) => state.data.flock.find((f) => String(f.id) === String(id));
  const flockName = (id) => (findFlock(id) || {}).identifier || "—";
  const list = (...a) => a;
  const UNITS = list("Egg", "Tray", "Crate", "Bird", "Bag", "Kg", "Litre", "Piece");
  const fieldOf = (s, name) => allFields(s).find((f) => f.name === name);
  const unitQty = (r) => `${fmtInt(r.quantity)}${r.unit ? " " + r.unit : ""}`;

  const SCHEMAS = {
    farm: {
      title: "Farm Setup", sub: "Tell us about your farm", saved: "Farm created successfully.", button: "Save",
      fields: [
        { name: "name", label: "Farm name", type: "text", placeholder: "Enter name", required: true, max: 100 },
        { name: "location", label: "Farm location", type: "text", placeholder: "Enter location" },
        { name: "currency", label: "Currency", type: "select", placeholder: "Enter currency", required: true, default: "NGN",
          options: [["NGN", "Nigerian Naira (₦)"], ["GHS", "Ghanaian Cedi (GH₵)"], ["KES", "Kenyan Shilling (KSh)"], ["ZAR", "South African Rand (R)"], ["USD", "US Dollar ($)"], ["GBP", "British Pound (£)"], ["EUR", "Euro (€)"]] },
        { name: "contact_info", label: "Farm contact", type: "text", placeholder: "Enter contact", phone: true },
        { name: "timezone", label: "Timezone", type: "select", placeholder: "Enter timezone", required: true, default: "Africa/Lagos",
          options: [["Africa/Lagos", "Africa/Lagos (WAT)"], ["Africa/Accra", "Africa/Accra (GMT)"], ["Africa/Nairobi", "Africa/Nairobi (EAT)"], ["Africa/Johannesburg", "Africa/Johannesburg (SAST)"], ["Europe/London", "Europe/London"], ["America/New_York", "America/New_York"], ["UTC", "UTC"]] },
        { name: "unit_system", label: "Unit preference", type: "select", placeholder: "Enter unit", required: true, default: "metric",
          options: [["metric", "Metric (kg, litres)"], ["imperial", "Imperial (lb, gallons)"]] },
      ],
    },
    opening: {
      title: "Add existing birds", sub: "Enter every group of birds already on your farm so your numbers start correct.", saved: "Existing birds added.", button: "Save flocks",
      // Shared by all flocks in this submission
      fields: [
        { name: "date", label: "Date of Count", type: "date", required: true },
      ],
      // One of these per flock row (built by mountRows, not by fieldHTML)
      rowFields: [
        { name: "identifier", label: "Flock Name", type: "text", placeholder: "Enter flock name", required: true },
        { name: "breed", label: "Breed/Type", type: "select", placeholder: "Enter breed", required: true, options: list("Isa Brown", "Lohmann Brown", "Hy-Line", "Bovans", "Noiler", "Other") },
        { name: "stage", label: "Production Stage", type: "select", placeholder: "Enter production stage", required: true, options: list("Chick", "Grower", "Pullet", "Layer", "Spent hen") },
        { name: "count", label: "Number of birds", type: "number", placeholder: "Enter number of birds", required: true, min: 1, integer: true },
        { name: "arrival_date", label: "Arrival Date", type: "date", placeholder: "When did you get this flock?", required: true },
      ],
    },
    flock: {
      title: "Flock Records", sub: "Add a new flock to your farm", saved: "Flock record saved.",
      errorMap: { initial_count: "starting_count" },
      fields: [
        { name: "identifier", label: "Flock Identifier", type: "text", placeholder: "Enter identifier", required: true },
        { name: "breed", label: "Breed/Type", type: "select", placeholder: "Enter breed", required: true, options: list("Isa Brown", "Lohmann Brown", "Hy-Line", "Bovans", "Noiler", "Other") },
        { name: "arrival_date", label: "Arrival Date", type: "date", placeholder: "Enter date", required: true },
        { name: "age_at_arrival", label: "Age at Arrival", type: "number", placeholder: "Enter age", min: 0, integer: true },
        { name: "starting_count", label: "Starting Bird Count", type: "number", placeholder: "Enter starting", required: true, min: 1, integer: true },
        { name: "current_count", label: "Current Bird Count", type: "computed", fmt: (v) => fmtInt(v) },
        { name: "stage", label: "Production Stage", type: "select", placeholder: "Enter production stage", required: true, options: list("Chick", "Grower", "Pullet", "Layer", "Spent hen") },
        { name: "mortality_rate", label: "Mortality Rate", type: "computed", fmt: (v) => v.toFixed(1) + "%" },
        { name: "status", label: "Flock Status", type: "select", placeholder: "Enter status", required: true, options: list("Active", "Sold out", "Closed") },
      ],
      // Counts are calculated, never typed. A new flock starts with current = starting.
      calc: (v) => ({ current_count: num(v.starting_count), mortality_rate: 0 }),
    },
    production: {
      title: "Production Records", sub: "Record eggs collected from a flock", saved: "Production record saved.",
      errorMap: { quantity_collected: "collected", quantity_damaged: "damaged", quantity_saleable: "saleable", event_date: "date" },
      fields: [
        { name: "date", label: "Egg Collection Date", type: "date", required: true },
        { name: "flock", label: "Flock", type: "select", placeholder: "Enter flock", emptyText: "Add a flock first", required: true, options: flockOptions },
        { name: "collected", label: "Eggs Collected", type: "number", placeholder: "Enter amount of eggs", required: true, min: 0, integer: true },
        { name: "damaged", label: "Damaged/Broken Eggs", type: "number", placeholder: "Enter broken eggs", min: 0, integer: true },
        { name: "saleable", label: "Saleable Quantity", type: "computed", fmt: (v) => fmtInt(v) },
        { name: "packaging", label: "Packaging/Unit Conversions", type: "select", placeholder: "Enter unit", required: true, options: list("Loose eggs", "Trays", "Crates"),
          reveal: { name: "eggs_per_unit", label: "Eggs per tray/crate", type: "number", placeholder: "Enter your own count", min: 1, integer: true, required: true, when: (v) => v.packaging === "Trays" || v.packaging === "Crates" } },
        { name: "recorded_by", label: "Recorded by", type: "readonly", value: () => state.user.name },
        { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
      ],
      calc: (v) => ({ saleable: Math.max(0, num(v.collected) - num(v.damaged)) }),
      check: (v) => (num(v.damaged) > num(v.collected) ? { damaged: "Damaged eggs cannot be more than eggs collected." } : {}),
    },
    sales: {
      title: "Sales Records", sub: "Record a sale", saved: "Sale record saved.",
      fields: [
        { name: "date", label: "Sale Date", type: "date", required: true },
        { name: "customer", label: "Customer", type: "text", placeholder: "Enter customer", required: true },
        { name: "product", label: "Product", type: "text", placeholder: "Enter product", required: true, suggest: list("Eggs", "Spent hens", "Manure") },
        { name: "quantity", label: "Quantities", type: "number", placeholder: "Enter quantity", required: true, min: 0.01 },
        { name: "unit", label: "Unit", type: "select", placeholder: "Enter unit", required: true, options: UNITS },
        { name: "price", label: "Prices", type: "number", placeholder: "Enter price", required: true, min: 0, step: "0.01" },
        { name: "total", label: "Total Sale Value", type: "computed", fmt: fmtMoney },
        { name: "discount", label: "Discount", type: "number", placeholder: "Enter discount", min: 0, step: "0.01" },
      ],
      calc: (v) => ({ total: Math.max(0, num(v.quantity) * num(v.price) - num(v.discount)) }),
      check: (v) => (num(v.discount) > num(v.quantity) * num(v.price) ? { discount: "Discount cannot be more than the sale amount." } : {}),
    },
    purchase: {
      title: "Purchase Records", sub: "Record goods bought for the farm", saved: "Purchase record saved.",
      fields: [
        { name: "date", label: "Purchase Date", type: "date", required: true },
        { name: "supplier", label: "Supplier", type: "text", placeholder: "Enter supplier", required: true },
        { name: "item", label: "Item", type: "text", placeholder: "Enter item", required: true, suggest: list("Feed", "Medication", "Vaccine", "Packaging", "Equipment") },
        { name: "quantity", label: "Quantity", type: "number", placeholder: "Enter quantity", required: true, min: 0.01 },
        { name: "unit", label: "Unit", type: "select", placeholder: "Enter unit", required: true, options: UNITS },
        { name: "unit_cost", label: "Unit Cost", type: "number", placeholder: "Enter unit cost", required: true, min: 0, step: "0.01" },
        { name: "total_cost", label: "Total Cost", type: "computed", fmt: fmtMoney },
        { name: "stock_received", label: "Stock Received details", type: "text", placeholder: "Enter details" },
        { name: "amount_paid", label: "Amount paid", type: "number", placeholder: "Enter amount", min: 0, step: "0.01" },
        { name: "outstanding_balance", label: "Outstanding balance", type: "computed", fmt: fmtMoney },
        { name: "payment_history", label: "Payment history", type: "text", placeholder: "Enter payment history" },
      ],
      calc: (v) => {
        const total = Math.max(0, num(v.quantity) * num(v.unit_cost));
        return { total_cost: total, outstanding_balance: Math.max(0, total - num(v.amount_paid)) };
      },
      check: (v) => (num(v.amount_paid) > num(v.quantity) * num(v.unit_cost) ? { amount_paid: "Amount paid cannot be more than the total cost." } : {}),
    },
    expense: {
      title: "Expenses Records", sub: "Record a farm expense", saved: "Expense record saved.",
      fields: [
        { name: "date", label: "Expense Date", type: "date", required: true },
        { name: "supplier", label: "Supplier", type: "text", placeholder: "Enter supplier" },
        { name: "amount", label: "Amount", type: "number", placeholder: "Enter amount", required: true, min: 0.01, step: "0.01" },
        { name: "payment_details", label: "Payment details", type: "select", placeholder: "Enter details", required: true, options: list("Cash", "Bank transfer", "Card/POS", "Mobile money", "On credit") },
        { name: "amount_paid", label: "Amount paid", type: "number", placeholder: "Enter amount", min: 0, step: "0.01" },
        { name: "amount_owed", label: "Amount owed", type: "computed", fmt: fmtMoney },
        { name: "description", label: "Description", type: "textarea", short: true, placeholder: "Enter description", required: true },
        { name: "supporting_note", label: "Supporting Note", type: "textarea", short: true, placeholder: "Write something" },
      ],
      calc: (v) => ({ amount_owed: Math.max(0, num(v.amount) - num(v.amount_paid)) }),
      check: (v) => (num(v.amount_paid) > num(v.amount) ? { amount_paid: "Amount paid cannot be more than the amount." } : {}),
    },
    activity: {
      title: "Farm Activities", sub: "Track daily farm operations, treatments, and losses.", saved: "Activity saved.",
      errorMap: { event_date: "date" },
      button: "Next", centered: true,
      tabs: [
        { key: "feed", label: "Feed consumption", code: "FEED_CONSUMPTION",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "feed_item", label: "Feed item", type: "text", placeholder: "Enter feed item", required: true, suggest: list("Layer mash", "Grower mash", "Starter feed", "Maize", "Soya") },
            { name: "quantity", label: "Quantity", type: "number", placeholder: "Enter quantity", required: true, min: 0.01 },
            { name: "unit", label: "Unit", type: "select", placeholder: "Enter unit", required: true, options: UNITS },
            { name: "flock", label: "Flock", type: "select", placeholder: "Enter flock", emptyText: "No flocks yet", options: flockOptions },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.feed_item}: ${v.quantity} ${v.unit}` },
        { key: "mortality", label: "Mortality", code: "MORTALITY", errorMap: { event_date: "date", quantity: "birds" },
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "flock", label: "Flock", type: "select", placeholder: "Enter flock", emptyText: "Add a flock first", required: true, options: flockOptions },
            { name: "birds", label: "Number of birds", type: "number", placeholder: "Enter number of birds", required: true, min: 1, integer: true },
            { name: "reason", label: "Reason/cause", type: "text", placeholder: "Enter reason", required: true },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.birds} bird${num(v.birds) === 1 ? "" : "s"}: ${v.reason}`,
          check: (v) => {
            const fl = findFlock(v.flock);
            return fl && num(v.birds) > num(fl.current_count) ? { birds: `Cannot be more than the flock's current count (${fmtInt(fl.current_count)}).` } : {};
          },
          impact: (v) => {
            const fl = findFlock(v.flock);
            return fl ? `${fl.identifier} will go from ${fmtInt(fl.current_count)} to ${fmtInt(Math.max(0, num(fl.current_count) - num(v.birds)))} birds.` : "";
          } },
        { key: "medication", label: "Medication", code: "MEDICATION",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "flock", label: "Flock", type: "select", placeholder: "Enter flock", emptyText: "Add a flock first", required: true, options: flockOptions },
            { name: "product", label: "Product", type: "text", placeholder: "Enter product", required: true },
            { name: "dose", label: "Quantity/Dose", type: "text", placeholder: "Enter quantity or dose", required: true },
            { name: "next_due", label: "Next due date", type: "date", placeholder: "Enter date", noDefault: true },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.product} (${v.dose})${v.next_due ? ", next due " + fmtDate(v.next_due) : ""}` },
        { key: "flock_change", label: "Flock change", code: "FLOCK_CHANGE",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "change_type", label: "Change type", type: "text", placeholder: "Enter change type", required: true, suggest: list("Culled", "Sold", "Transferred out", "Transferred in", "Added") },
            { name: "quantity", label: "Quantity", type: "number", placeholder: "Enter quantity", required: true, min: 1, integer: true },
            { name: "reason", label: "Reason", type: "text", placeholder: "Enter reason" },
          ],
          summary: (v) => `${v.change_type}: ${v.quantity}${v.reason ? " (" + v.reason + ")" : ""}` },
        { key: "damage", label: "Damage", code: "LOSS",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "affected", label: "Affected Item/Quantity", type: "text", placeholder: "Enter item and quantity", required: true },
            { name: "reason", label: "Reason", type: "text", placeholder: "Enter reason", required: true },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.affected}: ${v.reason}` },
        { key: "others", label: "Others", code: "OTHER",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "type_description", label: "Type/Description", type: "text", placeholder: "Enter type or description", required: true },
            { name: "reason", label: "Reason", type: "text", placeholder: "Enter reason" },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.type_description}${v.reason ? ": " + v.reason : ""}` },
      ],
    },
  };

  /* =====================================================================
     TABLE COLUMNS (records list)
     ===================================================================== */
  const COLS = {
    flock: [["Identifier", (r) => r.identifier], ["Breed/Type", (r) => r.breed], ["Arrival date", (r) => fmtDate(r.arrival_date)], ["Starting count", (r) => fmtInt(r.starting_count), 1], ["Current count", (r) => fmtInt(r.current_count), 1], ["Stage", (r) => r.stage], ["Status", (r) => r.status]],
    production: [["Date", (r) => fmtDate(r.date)], ["Flock", (r) => flockName(r.flock)], ["Collected", (r) => fmtInt(r.collected), 1], ["Damaged", (r) => fmtInt(r.damaged || 0), 1], ["Saleable", (r) => fmtInt(r.saleable), 1], ["Recorded by", (r) => r.recorded_by]],
    sales: [["Date", (r) => fmtDate(r.date)], ["Customer", (r) => r.customer], ["Product", (r) => r.product], ["Quantity", (r) => unitQty(r), 1], ["Total", (r) => fmtMoney(r.total), 1]],
    purchase: [["Date", (r) => fmtDate(r.date)], ["Supplier", (r) => r.supplier], ["Item", (r) => r.item], ["Quantity", (r) => unitQty(r), 1], ["Total cost", (r) => fmtMoney(r.total_cost), 1], ["Outstanding", (r) => fmtMoney(r.outstanding_balance || 0), 1]],
    expense: [["Date", (r) => fmtDate(r.date)], ["Supplier", (r) => r.supplier || "—"], ["Description", (r) => r.description], ["Amount", (r) => fmtMoney(r.amount), 1], ["Owed", (r) => fmtMoney(r.amount_owed || 0), 1]],
    activity: [["Date", (r) => fmtDate(r.date)], ["Type", (r) => r.type], ["Flock", (r) => (r.flock ? flockName(r.flock) : "—")], ["Details", (r) => r.details || "—"]],
  };
  const TABS = [["flock", "Flock"], ["production", "Production"], ["sales", "Sales"], ["purchase", "Purchase"], ["expense", "Expense"], ["activity", "Farm activities"]];
  const NAV = [["dashboard", "Dashboard"], ["records", "Records"], ["inventory", "Inventory"], ["reports", "Reports"], ["users", "Users & Permissions"]];
  const NAV_ICON = { dashboard: "dashboard", records: "records", inventory: "inventory", reports: "reports", users: "users" };

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

  /* =====================================================================
     VIEWS
     ===================================================================== */
  function loadingView() { return `<div class="state-card"><div class="spinner"></div><p>Loading…</p></div>`; }

  function errorView() {
    return `<div class="state-card err" role="alert">${icon("alert", 28)}<h2>Something went wrong</h2><p>We couldn't load these records.</p><button class="btn pill" data-action="retry">Try again</button></div>`;
  }

  function restrictedView() {
    return `<div class="state-card restricted">${icon("shield", 28)}<h2>Access restricted</h2><p>You don't have permission to view this page</p><button class="btn pill" data-action="go-dashboard">Back to Dashboard</button></div>`;
  }
  // Role comes from the farm membership. ?role=staff previews a limited user.
  const userRole = () => String(params.get("role") || (farm() && farm().role) || "OWNER").toUpperCase();
  const canManageUsers = () => ["OWNER", "ADMIN", "ADMINISTRATOR"].includes(userRole());

  function noFarmView() {
    return `<div class="state-card">${icon("inbox", 28)}<h2>No farms yet</h2><p>Create your first farm</p><button class="btn" data-action="create-farm">${icon("plus", 14)}Create Farm</button></div>`;
  }

  function comingSoon(title) {
    return `<div class="state-card">${icon("inbox", 28)}<h2>${esc(title)}</h2><p>This section hasn't been built yet.</p></div>`;
  }

  function statCard(ic, label, value, delta, since) {
    const badge = delta == null ? "" : `<span class="badge ${delta < 0 ? "neg" : ""}">${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%</span><span>${since}</span>`;
    return `<div class="card stat"><div class="lbl">${icon(ic, 16)}${esc(label)}</div><div class="val">${value}</div><div class="delta">${badge}</div></div>`;
  }

  function activityItems() {
    const d = state.data;
    const mk = (type, r) => {
      switch (type) {
        case "production": return { ic: "egg", t: "Egg production recorded", s: `${fmtInt(r.collected)} eggs • ${flockName(r.flock)}` };
        case "sales": return { ic: "wallet", t: "Sale recorded", s: `${unitQty(r)} ${r.product} • ${r.customer}` };
        case "purchase": return { ic: "wallet", t: "Purchase recorded", s: `${unitQty(r)} ${r.item} • ${r.supplier}` };
        case "flock": return { ic: "bird", t: "Flock added", s: `${fmtInt(r.starting_count)} birds • ${r.identifier}` };
        case "expense": return { ic: "wallet", t: "Expense recorded", s: `${r.supplier || r.description} • ${fmtMoney0(r.amount)}` };
        default: return { ic: "records", t: `${r.type} recorded`, s: r.details || (r.flock ? flockName(r.flock) : "Farm activity") };
      }
    };
    return TYPES.flatMap((t) => d[t].map((r) => ({ ...mk(t, r), at: r.created_at })))
      .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 5);
  }

  /* ---------- "Add existing birds" setup card ---------- */
  const skipKey = () => `agroflow:v1:skip-opening:${state.farmId}`;
  const openingSkipped = () => { try { return localStorage.getItem(skipKey()) === "1"; } catch { return false; } };
  // Shown only while the farm has no flocks and the user hasn't skipped it.
  // As soon as any flock exists it disappears by itself.
  const showSetupCard = () => state.data.flock.length === 0 && !openingSkipped();

  function setupCard() {
    return `<section class="card setup-card">
      <div class="setup-ic">${icon("bird", 22)}</div>
      <div class="setup-txt"><h3>Already have birds on your farm?</h3><p>Add them now so your numbers start correct.</p></div>
      <div class="setup-actions">
        <button class="btn" data-action="add-existing">${icon("plus", 14)}Add existing birds</button>
        <button class="link-btn" data-action="skip-opening">Skip, I'm starting fresh</button>
      </div>
    </section>`;
  }

  function dashboardView() {
    const m = metrics();
    const h = new Date().getHours();
    const greet = h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
    const rate = m.target > 0 ? (m.eggsToday / m.target) * 100 : 0;
    const C = 2 * Math.PI * 52;
    const below = Math.max(0, m.target - m.eggsToday);
    const acts = activityItems();

    return `
      <div class="page-head">
        <div><h1>${greet}!</h1><p>Here's what's happening at ${esc(farm().name)} today.</p></div>
        <button class="btn" data-action="export-dashboard">${icon("upload", 16)}Export</button>
      </div>

      ${showSetupCard() ? setupCard() : ""}

      <div class="stats">
        ${statCard("bird", "Live birds", fmtInt(m.live), null)}
        ${statCard("egg", "Eggs collected today", fmtInt(m.eggsToday), m.eggsDelta, "From yesterday")}
        ${statCard("wallet", "Stock Value", fmtMoney0(m.buyAll), m.buyDelta, "From last month")}
        ${statCard("trend", "Sales this month", fmtMoney0(m.sellM), m.sellDelta, "From last month")}
      </div>

      <div class="dash-grid">
        <section class="card area-chart">
          <div class="card-head">
            <h3>Financial Overview</h3>
            <div class="legend">
              <span>Income <i style="background:#147a3a"></i></span>
              <span>Expenses <i style="background:#f3b93a"></i></span>
              <select class="range" id="range" aria-label="Chart view">
                <option value="monthly" ${state.range === "monthly" ? "selected" : ""}>Monthly View</option>
                <option value="quarterly" ${state.range === "quarterly" ? "selected" : ""}>Quarterly View</option>
              </select>
            </div>
          </div>
          <div class="chart" id="chart">${chartHTML()}</div>
        </section>

        <section class="card perf area-perf">
          <h3>Production performance</h3>
          <p class="sub">Today's laying target</p>
          <div class="donut">
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="9"/>${rate > 0 ? `<circle cx="60" cy="60" r="52" fill="none" stroke="#4f9a67" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * Math.min(rate, 100)) / 100} ${C}"/>` : ""}</svg>
            <div class="mid"><b>${rate.toFixed(1)}%</b><span>Laying rate</span></div>
          </div>
          <div class="split"><div><small>Collected</small><b>${fmtInt(m.eggsToday)}</b></div><div class="vr"></div><div><small>Target</small><b>${fmtInt(m.target)}</b></div></div>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(rate, 100).toFixed(0)}"><i style="width:${Math.min(rate, 100)}%"></i></div>
          <div class="below"><span>${fmtInt(below)} eggs below target</span>${below > 0 && m.target > 0 ? `<button class="chip" data-action="review-flock">Review flock</button>` : ""}</div>
        </section>

        <section class="card recent area-recent">
          <div class="card-head"><h3>Recent Activity</h3><button class="link-btn" data-action="view-all">View all ${icon("chevronRight", 14)}</button></div>
          <p class="sub">Latest records from your team</p>
          ${acts.length ? acts.map((a) => `<div class="act">${icon(a.ic, 18)}<div class="txt"><b>${esc(a.t)}</b><small>${esc(a.s)}</small></div><time>${esc(fmtWhen(a.at))}</time></div>`).join("") : `<div class="empty-line">No activity yet. Records you add will show up here.</div>`}
        </section>
      </div>`;
  }

  function recordsView(type) {
    const rows = state.data[type];
    const cols = COLS[type];
    const q = state.query.trim().toLowerCase();
    const cells = (r) => cols.map(([, fn]) => String(fn(r) ?? ""));
    const shown = q ? rows.filter((r) => cells(r).join(" ").toLowerCase().includes(q)) : rows;
    const label = TABS.find((t) => t[0] === type)[1];

    // Permanent entry point for users who skipped the dashboard card
    const addExisting = type === "flock" ? `<button class="btn ghost" data-action="add-existing">${icon("bird", 16)}Add existing flocks</button>` : "";
    const toolbar = `<div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Record types">${TABS.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${k === type}" data-tab="${k}">${l}</button>`).join("")}</div>
      <div class="toolbar-actions">${addExisting}<button class="btn" data-action="export-records" data-type="${type}">${icon("upload", 16)}Export</button></div>
    </div>`;

    if (!rows.length) {
      return toolbar + `<div class="state-card">${icon("inbox", 28)}<h2>No records yet</h2><p>Add your first record to get started</p><button class="btn" data-action="add-record" data-type="${type}">${icon("plus", 14)}Add Record</button></div>`;
    }
    const head = cols.map(([h, , n]) => `<th class="${n ? "num" : ""}">${esc(h)}</th>`).join("");
    const body = shown.map((r) => `<tr>${cols.map(([, fn, n]) => `<td class="${n ? "num" : ""}">${esc(fn(r))}</td>`).join("")}</tr>`).join("");
    return toolbar + `<section class="card table-card">
      <div class="table-head"><h3>${esc(label)} records</h3><button class="btn" data-action="add-record" data-type="${type}">${icon("plus", 14)}Add Record</button></div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty-line" style="padding:24px 20px">No records match "${esc(state.query)}".</div>`}
    </section>`;
  }

  /* =====================================================================
     SHELL RENDERING + ROUTER
     ===================================================================== */
  let lastTab = "flock";
  function route() {
    const [, page = "dashboard", sub] = location.hash.split("/");
    const p = NAV.some((n) => n[0] === page) ? page : "dashboard";
    return { page: p, sub };
  }

  function renderShell() {
    const f = farm();
    // No farm yet: no search bar and no green farm button, only the "No farms yet" box in the page.
    $(".farm-wrap").hidden = !f;
    $("#search-box").hidden = !f;
    document.body.classList.toggle("no-farm", !f);
    const btn = $("#farm-btn");
    if (f) {
      btn.setAttribute("data-menu", "farm-menu");
      btn.innerHTML = `<div><b>${esc(f.name)}</b>${f.location ? `<small>${esc(f.location)}</small>` : ""}</div>${icon("chevronDown", 16)}`;
    }
    // Farm switcher: every farm the user belongs to, plus "Add new farm"
    $("#farm-menu").innerHTML =
      `<div class="menu-label">Your farms</div>` +
      state.farms.map((x) => {
        const on = x.id === state.farmId;
        return `<button class="menu-item${on ? " on" : ""}" data-action="switch-farm" data-id="${esc(x.id)}" role="menuitemradio" aria-checked="${on}"><span class="mi-txt"><b>${esc(x.name)}</b>${x.location ? `<small>${esc(x.location)}</small>` : ""}</span>${on ? icon("check", 16) : ""}</button>`;
      }).join("") +
      `<div class="menu-sep"></div><button class="menu-item menu-add" data-action="create-farm">${icon("plus", 16)}<span>Add new farm</span></button>`;
    $("#menu-btn").innerHTML = icon("menu", 20);
    $("#search-box").innerHTML = `${icon("search", 18)}<input id="search" type="search" placeholder="Search" aria-label="Search" autocomplete="off">`;
    $("#bell-btn").innerHTML = icon("bell", 18);
    $("#user-btn").innerHTML = `<span class="avatar" aria-hidden="true">${esc(initials(state.user.name))}</span><div><b>${esc(state.user.name)}</b><small>${esc(state.user.email)}</small></div>${icon("chevronDown", 18)}`;
    $("#user-menu").innerHTML = `<div class="head"><b>${esc(state.user.name)}</b><span>${esc(state.user.email)}</span></div><button data-action="signout">Sign out ${icon("logout", 16)}</button>`;
  }

  function renderNav() {
    const { page } = route();
    $("#nav").innerHTML = NAV.map(([k, l]) =>
      `<a class="nav-link" href="#/${k}" ${k === page ? 'aria-current="page"' : ""}>${icon(NAV_ICON[k], 18)}<span>${esc(l)}</span></a>`).join("");
  }

  function renderView() {
    renderNav();
    const view = $("#view");
    const { page, sub } = route();
    const names = Object.fromEntries(NAV);
    document.title = `${names[page]} | AgroFlow`;
    if (state.status === "loading") { view.innerHTML = loadingView(); return; }
    if (state.status === "error") { view.innerHTML = errorView(); return; }
    if (state.status === "forbidden") { view.innerHTML = restrictedView(); return; }
    if (!state.farms.length) { view.innerHTML = noFarmView(); return; }
    if (params.has("restricted") && page === "dashboard") { view.innerHTML = restrictedView(); return; } // preview of the design
    if (page === "users" && !canManageUsers()) { view.innerHTML = restrictedView(); return; }
    if (page === "dashboard") {
      view.innerHTML = dashboardView();
      bindChart();
    } else if (page === "records") {
      const type = TABS.some((t) => t[0] === sub) ? sub : lastTab;
      lastTab = type;
      view.innerHTML = recordsView(type);
    } else {
      view.innerHTML = comingSoon(names[page]);
    }
  }

  async function boot() {
    state.status = "loading"; renderView();
    try {
      if (!DEV && !state.authed) { state.user = await AgroAPI.me(); state.authed = true; }
      await api.loadFarms();
      if (state.farms.length) {
        if (!state.farms.some((f) => f.id === state.farmId)) state.farmId = state.farms[0].id;
        await api.load();
      } else {
        state.farmId = null; state.data = emptyData();
      }
      state.status = "ready";
    } catch (e) {
      // not signed in (or the session expired): back to the sign-in page
      if (e && (e.status === 401 || (e.status === 403 && !state.authed))) { location.replace(AgroAPI.pages.signIn); return; }
      state.status = e && e.status === 403 ? "forbidden" : "error";
    }
    renderShell();
    renderView();
  }

  /* =====================================================================
     MODAL FORMS
     ===================================================================== */
  let modalTrigger = null, saving = false;

  function optsOf(f) { return typeof f.options === "function" ? f.options() : f.options || []; }

  function fieldHTML(f) {
    const id = "f-" + f.name;
    let ctl;
    if (f.type === "select") {
      const opts = optsOf(f);
      const ph = opts.length ? f.placeholder : f.emptyText || "No options";
      ctl = `<div class="control select"><select id="${id}" name="${f.name}" ${opts.length ? "" : "disabled"}><option value="" selected disabled hidden>${esc(ph)}</option>${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}">${esc(l)}</option>`; }).join("")}</select>${icon("chevronDown", 18)}</div>`;
    } else if (f.type === "date") {
      ctl = `<div class="control date"><input id="${id}" name="${f.name}" type="date">${icon("calendar", 18)}</div>`;
    } else if (f.type === "textarea") {
      ctl = `<div class="control${f.short ? " short" : ""}"><textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || "")}"></textarea></div>`;
    } else if (f.type === "computed") {
      ctl = `<div class="control"><input id="${id}" name="${f.name}" class="ro" readonly tabindex="-1" aria-readonly="true"></div>`;
    } else if (f.type === "readonly") {
      ctl = `<div class="control"><input id="${id}" name="${f.name}" class="ro" readonly tabindex="-1" value="${esc(f.value ? f.value() : "")}"></div>`;
    } else {
      const list = f.suggest ? `list="dl-${f.name}"` : "";
      const dl = f.suggest ? `<datalist id="dl-${f.name}">${f.suggest.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>` : "";
      ctl = `<div class="control"><input id="${id}" name="${f.name}" type="${f.type}" ${list} ${f.type === "number" ? `inputmode="decimal" min="${f.min ?? ""}" step="${f.step || (f.integer ? 1 : "any")}"` : ""} placeholder="${esc(f.placeholder || "")}" autocomplete="off">${dl}</div>`;
    }
    const r = f.reveal;
    const reveal = r ? `<div class="reveal" id="r-${r.name}" hidden><div class="field"><label for="f-${r.name}">${esc(r.label)}</label><div class="control"><input id="f-${r.name}" name="${r.name}" type="number" inputmode="numeric" min="${r.min}" step="1" placeholder="${esc(r.placeholder)}"></div><p class="error" id="e-${r.name}" role="alert"></p></div></div>` : "";
    return `<div class="field" data-name="${f.name}"><label for="${id}">${esc(f.label)}</label>${ctl}<p class="error" id="e-${f.name}" role="alert"></p>${reveal}</div>`;
  }

  const allFields = (s) => s.fields.flatMap((f) => (f.reveal ? [f, f.reveal] : [f]));
  // A schema with tabs (Farm Activities) is merged with the selected tab's fields and rules.
  const effective = (base, key) => (base.tabs ? { ...base, ...(base.tabs.find((t) => t.key === key) || base.tabs[0]) } : base);

  /* ---------- Multi-row flock entry (Add existing birds) ---------- */
  let rowSeq = 0;

  function rowHTML(rf) {
    const k = ++rowSeq;
    const cells = rf.map((f) => {
      const id = `r${k}-${f.name}`;
      let ctl;
      if (f.type === "select") {
        ctl = `<div class="control select"><select id="${id}" data-f="${f.name}"><option value="" selected disabled hidden>${esc(f.placeholder)}</option>${f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>${icon("chevronDown", 18)}</div>`;
      } else if (f.type === "date") {
        // Same look as the other date fields; starts empty because existing flocks arrived in the past
        ctl = `<div class="control date"><input id="${id}" data-f="${f.name}" type="date" max="${localISO(new Date())}">${icon("calendar", 18)}</div>`;
      } else {
        ctl = `<div class="control"><input id="${id}" data-f="${f.name}" type="${f.type}" ${f.type === "number" ? `inputmode="numeric" min="${f.min}" step="1"` : ""} placeholder="${esc(f.placeholder || "")}" autocomplete="off"></div>`;
      }
      return `<div class="field" data-cell="${f.name}"><label for="${id}">${esc(f.label)}</label>${ctl}<p class="error" role="alert"></p></div>`;
    }).join("");
    return `<div class="flock-row"><div class="flock-row-head"><b></b><button type="button" class="link-btn" data-remove-row>Remove</button></div><div class="form-grid">${cells}</div></div>`;
  }

  // Renumbers the rows, hides "Remove" when only one is left, and updates the live total.
  function refreshRows() {
    const rows = $$(".flock-row");
    let birds = 0;
    rows.forEach((r, i) => {
      $("b", r).textContent = `Flock ${i + 1}`;
      const rm = $("[data-remove-row]", r);
      rm.hidden = rows.length === 1;
      rm.setAttribute("aria-label", `Remove flock ${i + 1}`);
      birds += num($('[data-f="count"]', r).value);
    });
    const total = $("#rows-total");
    if (total) total.textContent = birds ? `${fmtInt(birds)} birds across ${rows.length} flock${rows.length === 1 ? "" : "s"}` : "";
  }

  function mountRows(rf) {
    $("#form-grid").insertAdjacentHTML("beforeend",
      `<div class="flock-rows-wrap"><div id="flock-rows"></div><button type="button" class="btn ghost" id="add-row">${icon("plus", 14)}Add another flock</button><p class="rows-total" id="rows-total" aria-live="polite"></p></div>`);
    const box = $("#flock-rows");
    const add = (focus) => {
      box.insertAdjacentHTML("beforeend", rowHTML(rf));
      refreshRows();
      if (focus) { const rows = $$(".flock-row"); $("input", rows[rows.length - 1]).focus(); }
    };
    add(false);
    $("#add-row").addEventListener("click", () => add(true));
    box.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove-row]");
      if (!rm || $$(".flock-row").length === 1) return;
      rm.closest(".flock-row").remove();
      refreshRows();
    });
    box.addEventListener("input", refreshRows);
  }

  // Validates every row. Returns the cleaned rows and the first invalid control (if any).
  // Also blocks the same flock name twice: inside this batch, or against flocks the farm already has.
  function collectRows(rf) {
    const existing = new Set(state.data.flock.map((f) => String(f.identifier).trim().toLowerCase()));
    const seen = new Set();
    let firstBad = null;
    const rows = $$(".flock-row").map((row) => {
      const v = {};
      rf.forEach((f) => {
        let val = $(`[data-f="${f.name}"]`, row).value.trim();
        if (f.type === "number") val = val === "" ? "" : Number(val);
        v[f.name] = val;
      });
      const errs = validate(v, { fields: rf });
      const key = String(v.identifier).toLowerCase();
      if (key && !errs.identifier) {
        if (seen.has(key)) errs.identifier = "Another flock above already uses this name.";
        else if (existing.has(key)) errs.identifier = "A flock with this name already exists on this farm.";
        seen.add(key);
      }
      rf.forEach((f) => {
        const cell = $(`[data-cell="${f.name}"]`, row), el = $(`[data-f="${f.name}"]`, row);
        $(".error", cell).textContent = errs[f.name] || "";
        cell.classList.toggle("invalid", !!errs[f.name]);
        el.setAttribute("aria-invalid", errs[f.name] ? "true" : "false");
        if (errs[f.name] && !firstBad) firstBad = el;
      });
      return v;
    });
    return { rows, firstBad };
  }

  function openModal(type, trigger) {
    const base = SCHEMAS[type];
    let tabKey = base.tabs ? base.tabs[0].key : null;
    const cur = () => effective(base, tabKey);
    modalTrigger = trigger || document.activeElement;

    const tabsHTML = base.tabs ? `<div class="modal-tabs" id="modal-tabs"><div class="tabs" role="tablist" aria-label="Activity type">${base.tabs.map((t) => `<button type="button" class="tab" role="tab" data-mtab="${t.key}" aria-selected="${t.key === tabKey}">${esc(t.label)}</button>`).join("")}</div></div>` : "";
    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal${base.centered ? " center" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <h2 id="modal-title">${esc(base.title)}</h2><p class="sub">${esc(base.sub)}</p>
          ${tabsHTML}
          <form id="record-form" novalidate>
            <div class="form-grid" id="form-grid"></div>
            <p class="form-error" id="form-error" role="alert"></p>
            <div class="actions"><button class="btn" id="save-btn" type="submit" data-label="${esc(base.button || "Save")}">${esc(base.button || "Save")}</button></div>
          </form>
          <div id="review" hidden></div>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const form = $("#record-form");
    const tabsEl = $("#modal-tabs");

    function mountFields(keepDate) {
      const s = cur();
      $("#form-grid").innerHTML = s.fields.map(fieldHTML).join("");
      const today = localISO(new Date());
      $$('input[type="date"]', form).forEach((i) => {
        const def = fieldOf(s, i.name);
        i.value = keepDate !== undefined && i.name === "date" ? keepDate : def && def.noDefault ? "" : today;
      });
      allFields(s).forEach((f) => { if (f.default && form.elements[f.name]) form.elements[f.name].value = f.default; });
      $("#form-error").textContent = "";
      refreshComputed(form, s);
    }
    mountFields();
    if (base.rowFields) mountRows(base.rowFields); // "Add existing birds": one or more flock rows

    form.addEventListener("input", () => refreshComputed(form, cur()));
    form.addEventListener("change", () => refreshComputed(form, cur()));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (saving) return;
      const s = cur();
      const res = collect(form, s);
      const rr = base.rowFields ? collectRows(base.rowFields) : null;
      if (res.names.length || (rr && rr.firstBad)) {
        res.names.forEach((n) => setError(n, res.errs[n]));
        const el = res.names.length ? $("#f-" + res.names[0]) : rr.firstBad;
        if (el) el.focus();
        return;
      }
      const clean = rr ? { ...res.clean, rows: rr.rows } : res.clean;
      if (base.tabs) showReview(clean, s); // "Next" -> review step
      else save(type, clean, s, $("#save-btn"), $("#form-error"));
    });

    if (tabsEl) {
      tabsEl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-mtab]");
        if (!b || b.dataset.mtab === tabKey) return;
        const date = form.elements.date ? form.elements.date.value : undefined;
        tabKey = b.dataset.mtab;
        $$("[data-mtab]", tabsEl).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        mountFields(date);
      });
    }

    function showReview(clean, s) {
      const rows = s.fields.map((f) => `<div class="rv-row"><dt>${esc(f.label)}</dt><dd>${esc(displayValue(f, clean))}</dd></div>`).join("");
      const impact = s.impact ? s.impact(clean) : "";
      $("#review").innerHTML = `<h3 class="rv-title">Review ${esc(s.label.toLowerCase())}</h3><dl class="rv">${rows}</dl>${impact ? `<p class="rv-impact">${esc(impact)}</p>` : ""}
        <p class="form-error" id="rv-error" role="alert"></p>
        <div class="actions two"><button class="btn ghost" type="button" id="rv-back">Back</button><button class="btn" type="button" id="rv-save" data-label="Save">Save</button></div>`;
      form.hidden = true; if (tabsEl) tabsEl.hidden = true; $("#review").hidden = false;
      $("#rv-back").addEventListener("click", () => { $("#review").hidden = true; form.hidden = false; if (tabsEl) tabsEl.hidden = false; });
      $("#rv-save").addEventListener("click", () => save(type, clean, s, $("#rv-save"), $("#rv-error")));
      $("#rv-save").focus();
    }

    const first = $("input:not([readonly]):not([type=date]), select:not([disabled])", form);
    (first || $(".close")).focus();
  }

  function closeModal() {
    $("#modal-root").innerHTML = "";
    document.body.style.overflow = "";
    if (modalTrigger && document.contains(modalTrigger)) modalTrigger.focus();
    modalTrigger = null;
  }

  function readValues(form, s) {
    const v = {};
    allFields(s).forEach((f) => {
      const el = form.elements[f.name];
      if (!el) return;
      let val = String(el.value).trim();
      if (f.type === "number") val = val === "" ? "" : Number(val);
      v[f.name] = val;
    });
    return v;
  }

  function refreshComputed(form, s) {
    const v = readValues(form, s);
    const calc = s.calc ? s.calc(v) : {};
    s.fields.forEach((f) => {
      if (f.type === "computed" && form.elements[f.name]) form.elements[f.name].value = f.fmt(calc[f.name] ?? 0);
      if (f.reveal) $("#r-" + f.reveal.name).hidden = !f.reveal.when(v);
    });
  }

  function setError(name, msg) {
    const p = $("#e-" + name);
    if (p) p.textContent = msg || "";
    const field = p && p.closest(".field");
    if (field) field.classList.toggle("invalid", !!msg);
    const input = $("#f-" + name);
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  function validate(v, s) {
    const errs = {};
    allFields(s).forEach((f) => {
      if (f.type === "computed" || f.type === "readonly") return;
      if (f.when && !f.when(v)) return;
      const val = v[f.name];
      const empty = val === "" || val == null;
      if (f.required && empty) { errs[f.name] = f.type === "select" ? `Select ${f.label.toLowerCase()}.` : `${f.label} is required.`; return; }
      if (f.max && !empty && String(val).length > f.max) errs[f.name] = `${f.label} must be ${f.max} characters or fewer.`;
      if (f.phone && !empty && !/^[+\d][\d\s\-()]{6,19}$/.test(String(val))) errs[f.name] = "Enter a valid phone number.";
      if (f.type === "number" && !empty) {
        if (!Number.isFinite(val)) errs[f.name] = `${f.label} must be a number.`;
        else if (f.integer && !Number.isInteger(val)) errs[f.name] = `${f.label} must be a whole number.`;
        else if (f.min != null && val < f.min) errs[f.name] = f.min === 0 ? `${f.label} cannot be negative.` : `${f.label} must be at least ${f.min}.`;
      }
    });
    if (s.check) Object.assign(errs, s.check(v)); // cross-field rules
    return errs;
  }

  // Reads the form, runs the checks, and returns the cleaned values plus any errors.
  function collect(form, s) {
    const v = readValues(form, s);
    const clean = { ...v, ...(s.calc ? s.calc(v) : {}) };
    s.fields.forEach((f) => { if (f.reveal && !f.reveal.when(v)) delete clean[f.reveal.name]; }); // hidden optional box
    allFields(s).forEach((f) => setError(f.name, ""));
    $("#form-error").textContent = "";
    const errs = validate(v, s);
    s.fields.forEach((f) => { if (f.reveal && !f.reveal.when(v)) delete errs[f.reveal.name]; });
    const names = allFields(s).map((f) => f.name).filter((n) => errs[n]);
    return { v, clean, errs, names };
  }

  function displayValue(f, c) {
    const v = c[f.name];
    if (f.type === "computed") return f.fmt(v ?? 0);
    if (v === "" || v == null) return "—";
    if (f.type === "date") return fmtDate(v);
    if (f.type === "select") {
      const o = optsOf(f).find((x) => (Array.isArray(x) ? x[0] : x) === v);
      return o ? (Array.isArray(o) ? o[1] : o) : String(v);
    }
    if (f.type === "number") return Number.isInteger(v) ? fmtInt(v) : String(v);
    return String(v);
  }

  async function save(type, clean, s, btn, errEl) {
    if (saving) return;
    saving = true;
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (type === "farm") {
        const f = await api.createFarm(clean);
        state.farmId = f.id; state.data = emptyData();
        closeModal(); toast(s.saved);
        boot(); // reload the shell and open the new farm's dashboard
        location.hash = "#/dashboard";
      } else if (type === "opening") {
        await api.createOpening(clean);
        closeModal(); toast(s.saved); renderView();
      } else {
        const payload = s.summary ? { ...clean, type: s.label, code: s.code, details: s.summary(clean) } : clean;
        await api.create(type, payload);
        closeModal(); toast(s.saved); renderView();
      }
    } catch (err) {
      let msg = "We couldn't save this record. Please try again.";
      if (err && err.name === "ApiError") {
        const map = s.errorMap || {};
        const entries = Object.entries(err.fields || {}).map(([k, m]) => [map[k] || k, m]);
        const inForm = errEl.id === "form-error";
        const known = inForm ? entries.filter(([n]) => allFields(s).some((f) => f.name === n)) : [];
        const rest = entries.filter((e) => !known.includes(e));
        known.forEach(([n, m]) => setError(n, m));
        if (known.length) { const el = $("#f-" + known[0][0]); if (el) el.focus(); }
        msg = rest.length ? rest.map(([n, m]) => `${(fieldOf(s, n) || {}).label || n}: ${m}`).join(" ") : known.length ? "" : err.message;
      }
      errEl.textContent = msg;
      btn.disabled = false; btn.textContent = btn.dataset.label || "Save";
    } finally {
      saving = false;
    }
  }

  function toast(msg) {
    const root = $("#toast-root");
    root.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (root.innerHTML = ""), 3000);
  }

  /* =====================================================================
     EXPORT (CSV)
     ===================================================================== */
  function downloadCSV(name, rows) {
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${farm().name.toLowerCase().replace(/\s+/g, "-")}-${name}-${localISO(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportRecords(type) {
    const rows = state.data[type];
    if (!rows.length) { toast("There are no records to export yet."); return; }
    downloadCSV(type, [COLS[type].map((c) => c[0]), ...rows.map((r) => COLS[type].map(([, fn]) => fn(r)))]);
  }

  function exportDashboard() {
    const { inc, exp } = monthly();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    downloadCSV("financial-overview", [["Month", "Income", "Expenses"], ...months.map((m, i) => [m, inc[i], exp[i]])]);
  }

  /* =====================================================================
     EVENTS
     ===================================================================== */
  function closeMenus(except) {
    $$(".menu").forEach((m) => { if (m !== except) m.hidden = true; });
  }
  const closeNav = () => document.body.classList.remove("nav-open");

  document.addEventListener("click", (e) => {
    const t = e.target;

    const menuBtn = t.closest("[data-menu]");
    if (menuBtn) {
      const menu = document.getElementById(menuBtn.dataset.menu);
      const willOpen = menu.hidden;
      closeMenus();
      menu.hidden = !willOpen;
      return;
    }
    if (!t.closest(".menu")) closeMenus();

    if (t.closest("#menu-btn")) { document.body.classList.toggle("nav-open"); return; }
    if (t.closest("#scrim") || t.closest(".nav-link")) closeNav();

    if (t.id === "backdrop" || t.closest("[data-close]")) { closeModal(); return; }

    const tab = t.closest("[data-tab]");
    if (tab) { location.hash = "#/records/" + tab.dataset.tab; return; }

    const act = t.closest("[data-action]");
    if (!act) return;
    switch (act.dataset.action) {
      case "add-record": openModal(act.dataset.type, act); break;
      case "add-existing": openModal("opening", act); break;
      case "skip-opening":
        // Only hides the card for this farm; no data is deleted or locked.
        try { localStorage.setItem(skipKey(), "1"); } catch { /* storage unavailable */ }
        renderView();
        break;
      case "create-farm": {
        // opened from the farm dropdown: close it first and return focus to the farm button
        const fromMenu = act.closest(".menu");
        closeMenus();
        openModal("farm", fromMenu ? $("#farm-btn") : act);
        break;
      }
      case "go-dashboard": location.hash = "#/dashboard"; break;
      case "retry": boot(); break;
      case "export-records": exportRecords(act.dataset.type); break;
      case "export-dashboard": exportDashboard(); break;
      case "review-flock": location.hash = "#/records/flock"; break;
      case "view-all": location.hash = "#/records/production"; break;
      case "switch-farm":
        closeMenus();
        if (act.dataset.id !== state.farmId) { state.farmId = act.dataset.id; boot(); }
        break;
      case "signout":
        (async () => {
          act.disabled = true;
          try {
            await AgroAPI.logout();
            location.assign(AgroAPI.pages.signIn);
          } catch (err) {
            act.disabled = false;
            toast(err.message || "We couldn't sign you out. Please try again.");
          }
        })();
        break;
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "range") {
      state.range = e.target.value;
      $("#chart").innerHTML = chartHTML();
      bindChart();
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "search") {
      state.query = e.target.value;
      if (route().page === "records" && state.status === "ready") renderView();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("#backdrop")) closeModal();
      else { closeMenus(); closeNav(); }
      return;
    }
    if (e.key === "Tab" && $("#backdrop")) { // keep focus inside the modal
      const items = $$("button, input:not([readonly]), select:not([disabled]), textarea", $(".modal")).filter((el) => !el.closest("[hidden]"));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  let wasNarrow = window.innerWidth <= 640, resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const nowNarrow = window.innerWidth <= 640;
      if (nowNarrow !== wasNarrow || nowNarrow) {
        wasNarrow = nowNarrow;
        if ($("#chart") && state.status === "ready") { $("#chart").innerHTML = chartHTML(); bindChart(); }
      }
    }, 150);
  });

  window.addEventListener("hashchange", () => { state.query = ""; const s = $("#search"); if (s) s.value = ""; renderView(); window.scrollTo(0, 0); });

  /* =====================================================================
     START
     ===================================================================== */
  renderShell();
  boot();
})();