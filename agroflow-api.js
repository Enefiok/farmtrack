/* =========================================================================
   agroflow-api.js
   One place that talks to the Django API. signup.html, signin.html and
   agroflow-app.html all load this file, so keep them in the same folder.

   Two modes:
   - Real mode (default): calls the Django API at CONFIG.API_BASE.
   - Mock mode: no server needed. Accounts and farms live in this browser.
       turn on:  open any page with ?mock=1     turn off: ?mock=0
   ========================================================================= */
(function (global) {
  "use strict";

  /* ---------------- CONFIG: edit these to match the backend ---------------- */
  const CONFIG = {
    // Use the same host name for pages and API (127.0.0.1 or localhost, not a mix),
    // so the session and CSRF cookies are shared.
    // API_BASE: "http://127.0.0.1:8000",
     API_BASE: "",
    ENDPOINTS: {
      csrf: "/api/auth/csrf/",       // assumed: GET sets the csrftoken cookie (and may return {csrfToken})
      register: "/api/auth/register/",
      login: "/api/auth/login/",
      logout: "/api/auth/logout/",
      me: "/api/auth/me/",           // assumed: GET returns the signed-in user, 401 if signed out
      farms: "/api/farms/",          // GET lists the user's farms, POST creates one
    },
    PAGES: { signIn: "signin.html", signUp: "signup.html", app: "agroflow-app.html" },
    // {farm} is replaced with the farm id. From the Sprint 2-3 test report.
    FARM_ENDPOINTS: {
      flocks: "/api/farms/{farm}/flocks/",
      activities: "/api/farms/{farm}/activities/",
      production: "/api/farms/{farm}/production/",
      items: "/api/farms/{farm}/items/",
      units: "/api/units/",
    },
    // Production records need the id of the farm's egg item. If the backend has no list endpoint yet,
    // the client creates "Fresh Eggs" once per farm. eggUnitId = the global "Egg" unit (id 2 in the test report).
    DEFAULTS: { eggUnitId: 2, eggItemId: null },
  };

  /* ---------------- helpers ---------------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cookie = (n) => {
    const m = document.cookie.match(new RegExp("(^|; )" + n + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  };

  const K_MOCK = "agroflow:v1:mock";
  const K_USERS = "agroflow:v1:users";
  const K_SESSION = "agroflow:v1:session";
  const K_FARMS = "agroflow:v1:farms:";
  const K_FARM_CACHE = "agroflow:v1:farmcache:"; // TEMPORARY: see listFarms()
  const K_EGG_ITEM = "agroflow:v1:eggitem:";

  const qp = new URLSearchParams(location.search);
  if (qp.get("mock") === "1") LS.set(K_MOCK, true);
  if (qp.get("mock") === "0") LS.del(K_MOCK);
  const isMock = !!LS.get(K_MOCK, false);

  /* ---------------- errors ---------------- */
  // Accepts Django REST shapes: {email:["..."]}, {detail:"..."}, {non_field_errors:["..."]},
  // and the playbook shape {error:{code,message,fields:{...}}}.
  const ALIAS = { password2: "confirm_password", name: "full_name" };
  const MESSAGE_KEYS = ["detail", "message", "non_field_errors", "error"];

  function firstText(v) {
    if (Array.isArray(v)) return firstText(v[0]);
    if (v && typeof v === "object") return "";
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
    return { fields, message };
  }

  class ApiError extends Error {
    constructor(status, data, fallback) {
      const n = normalize(data, status, fallback);
      super(n.message);
      this.name = "ApiError";
      this.status = status;   // 0 means the request never reached the server
      this.fields = n.fields; // { email: "...", confirm_password: "..." }
      this.data = data;
    }
  }

  /* ---------------- real requests ---------------- */
  async function csrfToken(force) {
    const existing = cookie("csrftoken");
    if (existing && !force) return existing;
    try {
      const res = await fetch(CONFIG.API_BASE + CONFIG.ENDPOINTS.csrf, { credentials: "include", headers: { Accept: "application/json" } });
      let d = null;
      try { d = await res.json(); } catch { /* the endpoint may return no body */ }
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
        method, credentials: "include", headers, cache: "no-store",
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, null);
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    if (res.status === 403 && method !== "GET" && !retried) return request(method, path, body, true); // stale CSRF token: retry once
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  /* ---------------- mock server (mock mode only) ---------------- */
  const mock = {
    session() { return LS.get(K_SESSION, null); },
    async register(p) {
      await wait(400);
      const email = String(p.email || "").trim().toLowerCase();
      const users = LS.get(K_USERS, {});
      if (users[email]) throw new ApiError(400, { email: ["A user with this email already exists."] });
      if (String(p.password || "").length < 8) throw new ApiError(400, { password: ["This password is too short. It must contain at least 8 characters."] });
      if (p.password !== p.password2) throw new ApiError(400, { password2: ["Passwords do not match."] });
      users[email] = { full_name: p.full_name, password: p.password };
      LS.set(K_USERS, users);
      const user = { full_name: p.full_name, email };
      LS.set(K_SESSION, user);
      return { user, message: "Account created successfully." };
    },
    async login(p) {
      await wait(400);
      const email = String(p.email || "").trim().toLowerCase();
      const u = LS.get(K_USERS, {})[email];
      if (!u || u.password !== p.password) throw new ApiError(400, { non_field_errors: ["Unable to log in with provided credentials."] });
      const user = { full_name: u.full_name, email };
      LS.set(K_SESSION, user);
      return { user, message: "Login successful." };
    },
    async me() {
      await wait(120);
      const s = mock.session();
      if (!s) throw new ApiError(401, { detail: "Authentication credentials were not provided." });
      return s;
    },
    async logout() { LS.del(K_SESSION); return {}; },
    async listFarms() {
      await wait(250);
      const s = mock.session();
      if (!s) throw new ApiError(401, { detail: "Authentication credentials were not provided." });
      return LS.get(K_FARMS + s.email, []);
    },
    async createFarm(v) {
      await wait(300);
      const s = mock.session();
      if (!s) throw new ApiError(401, { detail: "Authentication credentials were not provided." });
      const list = LS.get(K_FARMS + s.email, []);
      const farm = { id: Date.now().toString(36), name: v.name, location: v.location || "", contact_info: v.contact_info || "", role: "OWNER",
        settings: { currency: v.currency, timezone: v.timezone, unit_system: v.unit_system } };
      list.push(farm);
      LS.set(K_FARMS + s.email, list);
      return farm;
    },
  };

  /* ---------------- flock / activity / production ---------------- */
  const farmUrl = (key, farmId) => CONFIG.FARM_ENDPOINTS[key].replace("{farm}", encodeURIComponent(farmId));
  const toId = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v); // select boxes give strings; the API wants numbers
  const listOf = (d) => (Array.isArray(d) ? d : (d && (d.results || d.items || d.units)) || []);
  const noList = (err) => err && (err.status === 404 || err.status === 405);

  // Finds (or creates once) the farm's egg item. Needed by production records.
  async function eggItemId(farmId) {
    if (CONFIG.DEFAULTS.eggItemId) return CONFIG.DEFAULTS.eggItemId;
    const cached = LS.get(K_EGG_ITEM + farmId, null);
    if (cached) return cached;
    try { // 1. an egg item may already exist (works once the backend has GET /items/)
      const egg = listOf(await request("GET", farmUrl("items", farmId))).find((i) => i.category === "EGG");
      if (egg) { LS.set(K_EGG_ITEM + farmId, egg.id); return egg.id; }
    } catch (err) { if (!noList(err)) throw err; }
    let unitId = CONFIG.DEFAULTS.eggUnitId; // 2. otherwise create it
    if (!unitId) {
      try {
        const u = listOf(await request("GET", CONFIG.FARM_ENDPOINTS.units)).find((x) => String(x.abbreviation).toLowerCase() === "egg");
        if (u) unitId = u.id;
      } catch (err) { if (!noList(err)) throw err; }
    }
    if (!unitId) {
      const created = await request("POST", CONFIG.FARM_ENDPOINTS.units, { name: "Egg", abbreviation: "egg" });
      unitId = created && created.id;
    }
    const item = await request("POST", farmUrl("items", farmId), { name: "Fresh Eggs", category: "EGG", base_unit: unitId, is_stock_tracked: true });
    if (!item || !item.id) throw new ApiError(0, null, "The egg item could not be set up on the server. Ask the backend developer to add GET /api/farms/{id}/items/.");
    LS.set(K_EGG_ITEM + farmId, item.id);
    return item.id;
  }

  // Turns a form record into the exact body the API expects.
  async function recordBody(type, farmId, v) {
    if (type === "flock") {
      return { identifier: v.identifier, breed: v.breed, arrival_date: v.arrival_date, initial_count: v.starting_count };
    }
    if (type === "production") {
      return { flock: toId(v.flock), item: await eggItemId(farmId), quantity_collected: v.collected, quantity_damaged: v.damaged === "" ? 0 : v.damaged,
        quantity_saleable: v.saleable, event_date: v.date, classification: "LIVE" };
    }
    // activity: the API only has quantity + notes, so the details go into notes
    const qty = v.birds !== undefined && v.birds !== "" ? v.birds : v.quantity;
    return { flock: v.flock ? toId(v.flock) : undefined, activity_type: v.code,
      quantity: qty === "" ? undefined : qty,
      notes: [v.details, v.notes].filter(Boolean).join(" | "), event_date: v.date, classification: "LIVE" };
  }

  /* ---------------- public API ---------------- */
  let currentEmail = "";
  const normUser = (u) => {
    u = u || {};
    const name = u.full_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || "";
    if (u.email) currentEmail = u.email.toLowerCase();
    return { id: u.id, name, email: u.email || "" };
  };
  const normFarm = (item) => {
    const f = item.farm || item;
    return { id: f.id, name: f.name, location: f.location || "", contact_info: f.contact_info || "",
      role: item.role || f.role || "", settings: f.settings || undefined };
  };

  const E = CONFIG.ENDPOINTS;
  const AgroAPI = {
    config: CONFIG,
    pages: CONFIG.PAGES,
    mock: isMock,
    ApiError,

    // body: { full_name, email, password, password2 }  -> { user, message }
    async register(body) {
      const d = isMock ? await mock.register(body) : await request("POST", E.register, body);
      return { user: normUser(d.user || d), message: d.message || "" };
    },
    // body: { email, password }  -> { user, message }
    async login(body) {
      const d = isMock ? await mock.login(body) : await request("POST", E.login, body);
      return { user: normUser(d.user || d), message: d.message || "" };
    },
    // Ends the session, then CHECKS that it really ended. If the server still says we are
    // signed in, this throws so the app can tell the user instead of bouncing back to the dashboard.
    async logout() {
      if (isMock) return mock.logout();
      let logoutError = null;
      try { await request("POST", E.logout, {}); }
      catch (err) { logoutError = err; console.error("Logout request failed:", err.status, err.data); }
      try {
        await request("GET", E.me);
      } catch (err) {
        if (err.status === 401 || err.status === 403) return {}; // signed out: good
        throw err;                                              // network/server problem: cannot confirm
      }
      console.error("Still signed in after logout. Backend logout is not clearing the session.", logoutError || "");
      const csrfBlocked = logoutError && logoutError.status === 403 && /csrf/i.test(logoutError.message);
      throw new ApiError(0, null, csrfBlocked
        ? "Sign out was blocked by the server's CSRF check: " + logoutError.message
        : "We couldn't sign you out. Please try again.");
    },
    // Throws ApiError with status 401/403 when nobody is signed in.
    async me() {
      const d = isMock ? await mock.me() : await request("GET", E.me);
      return normUser(d.user || d);
    },
    async listFarms() {
      let d;
      if (isMock) d = await mock.listFarms();
      else {
        try { d = await request("GET", E.farms); }
        catch (err) {
          // TEMPORARY WORKAROUND: the backend has no GET /api/farms/ yet (405/404).
          // Use the farms created in this browser until the backend adds a list endpoint.
          if (err.status === 405 || err.status === 404) {
            console.warn("GET " + E.farms + " is not available (" + err.status + "). Using farms saved in this browser. Ask the backend to add a farm list endpoint.");
            d = LS.get(K_FARM_CACHE + currentEmail, []);
          } else throw err;
        }
      }
      const arr = Array.isArray(d) ? d : (d && (d.results || d.farms)) || [];
      return arr.map(normFarm);
    },
    // type: "flock" | "production" | "activity". Returns { id } of the new record.
    async createRecord(type, farmId, v) {
      const key = type === "activity" ? "activities" : type === "flock" ? "flocks" : "production";
      if (isMock) { await wait(300); return { id: "m" + Date.now().toString(36) }; }
      const body = await recordBody(type, farmId, v);
      const d = await request("POST", farmUrl(key, farmId), body);
      const rec = (d && (d.flock || d.activity || d.production || d)) || {};
      return { id: rec.id };
    },
    // v: { name, location, contact_info, currency, timezone, unit_system }
    async createFarm(v) {
      if (isMock) return normFarm(await mock.createFarm(v));
      const d = await request("POST", E.farms, { ...v, settings: { currency: v.currency, timezone: v.timezone, unit_system: v.unit_system } });
      const created = (d && d.farm) || d || {};
      const farm = normFarm({ ...v, ...created, role: (d && d.role) || "OWNER",
        settings: { currency: v.currency, timezone: v.timezone, unit_system: v.unit_system } });
      // remembered for the temporary workaround in listFarms()
      const cache = LS.get(K_FARM_CACHE + currentEmail, []);
      cache.push(farm);
      LS.set(K_FARM_CACHE + currentEmail, cache);
      return farm;
    },
  };

  global.AgroAPI = AgroAPI;
})(window);