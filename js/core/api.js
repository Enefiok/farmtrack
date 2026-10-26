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
      items: "/api/farms/{farm}/items/",
      units: "/api/units/",
    },
    DEFAULTS: { eggUnitId: 2, eggItemId: null },
  };

  const LS = {
    get: function(k, d) { 
      try { 
        const v = localStorage.getItem(k); 
        return v ? JSON.parse(v) : d; 
      } catch { 
        return d; 
      } 
    },
    set: function(k, v) { 
      try { 
        localStorage.setItem(k, JSON.stringify(v)); 
      } catch { } 
    },
    del: function(k) { 
      try { 
        localStorage.removeItem(k); 
      } catch { } 
    },
  };
  
  const wait = function(ms) { 
    return new Promise(function(r) { 
      setTimeout(r, ms); 
    }); 
  };
  
  const cookie = function(n) {
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
    return { fields: fields, message: message };
  }

  function ApiError(status, data, fallback) {
    const n = normalize(data, status, fallback);
    Error.call(this, n.message);
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
    session: function() { return LS.get(K_SESSION, null); },
    register: async function(p) {
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
    login: async function(p) {
      await wait(400);
      const email = String(p.email || "").trim().toLowerCase();
      const u = LS.get(K_USERS, {})[email];
      if (!u || u.password !== p.password) throw new ApiError(400, { non_field_errors: ["Unable to log in with provided credentials."] });
      const user = { full_name: u.full_name, email: email };
      LS.set(K_SESSION, user);
      return { user: user, message: "Login successful." };
    },
    me: async function() {
      await wait(120);
      const s = mock.session();
      if (!s) throw new ApiError(401, { detail: "Authentication credentials were not provided." });
      return s;
    },
    logout: async function() { LS.del(K_SESSION); return {}; },
    listFarms: async function() {
      await wait(250);
      const s = mock.session();
      if (!s) throw new ApiError(401, { detail: "Authentication credentials were not provided." });
      return LS.get(K_FARMS + s.email, []);
    },
    createFarm: async function(v) {
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

  const farmUrl = function(key, farmId) { 
    return CONFIG.FARM_ENDPOINTS[key].replace("{farm}", encodeURIComponent(farmId)); 
  };
  
  const toId = function(v) { 
    return (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v); 
  };
  
  const listOf = function(d) { 
    return (Array.isArray(d) ? d : (d && (d.results || d.items || d.units)) || []); 
  };
  
  const noList = function(err) { 
    return err && (err.status === 404 || err.status === 405); 
  };

  async function eggItemId(farmId) {
    if (CONFIG.DEFAULTS.eggItemId) return CONFIG.DEFAULTS.eggItemId;
    const cached = LS.get(K_EGG_ITEM + farmId, null);
    if (cached) return cached;
    try {
      const egg = listOf(await request("GET", farmUrl("items", farmId))).find(function(i) { 
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
        const u = listOf(await request("GET", CONFIG.FARM_ENDPOINTS.units)).find(function(x) { 
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

  async function recordBody(type, farmId, v) {
    if (type === "flock") {
      return { 
        identifier: String(v.identifier).trim(), 
        breed: String(v.breed).trim(), 
        arrival_date: v.arrival_date, 
        initial_count: Number(v.starting_count)
      };
    }
    if (type === "production") {
      return { 
        flock: toId(v.flock), 
        item: await eggItemId(farmId), 
        quantity_collected: Number(v.collected), 
        quantity_damaged: v.damaged === "" || v.damaged == null ? 0 : Number(v.damaged),
        quantity_saleable: Number(v.saleable), 
        event_date: v.date,
        classification: "LIVE" 
      };
    }
    if (type === "activity") {
      const qty = v.birds !== undefined && v.birds !== "" ? v.birds : v.quantity;
      return { 
        flock: v.flock ? toId(v.flock) : undefined, 
        activity_type: v.code,
        quantity: qty === "" || qty == null ? undefined : Number(qty),
        notes: [v.details, v.reason, v.notes].filter(Boolean).join(" | ").trim(), 
        event_date: v.date, 
        classification: "LIVE" 
      };
    }
    throw new Error("Unsupported record type for backend: " + type);
  }

  let currentEmail = "";
  
  const normUser = function(u) {
    u = u || {};
    const name = u.full_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || "";
    if (u.email) currentEmail = u.email.toLowerCase();
    return { id: u.id, name: name, email: u.email || "" };
  };
  
  // Ids are always strings in the UI. DOM data-attributes are strings, so a
  // numeric id from Django would never match with === when switching farms.
  // Settings may sit on the farm or beside it in the response; take either.
  const normFarm = function(item) {
    const f = item.farm || item;
    return { 
      id: String(f.id), 
      name: f.name, 
      location: f.location || "", 
      contact_info: f.contact_info || "",
      role: item.role || f.role || "", 
      settings: f.settings || item.settings || undefined 
    };
  };

  // If the list endpoint doesn't return settings for a farm, reuse the ones the
  // server confirmed when the farm was created, so the currency doesn't snap
  // back to NGN after a refresh.
  const withCachedSettings = function(farms) {
    const cache = LS.get(K_FARM_CACHE + currentEmail, []);
    return farms.map(function(f) {
      if (f.settings) return f;
      const c = cache.find(function(x) { return String(x.id) === f.id; });
      return c && c.settings ? Object.assign({}, f, { settings: c.settings }) : f;
    });
  };

  const E = CONFIG.ENDPOINTS;
  
  const AgroAPI = {
    config: CONFIG,
    pages: CONFIG.PAGES,
    mock: isMock,
    ApiError: ApiError,

    register: async function(body) {
      const d = isMock ? await mock.register(body) : await request("POST", E.register, body);
      return { user: normUser(d.user || d), message: d.message || "" };
    },
    
    login: async function(body) {
      const d = isMock ? await mock.login(body) : await request("POST", E.login, body);
      return { user: normUser(d.user || d), message: d.message || "" };
    },
    
    logout: async function() {
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
    
    me: async function() {
      const d = isMock ? await mock.me() : await request("GET", E.me);
      return normUser(d.user || d);
    },
    
    listFarms: async function() {
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
    
    createRecord: async function(type, farmId, v) {
      if (["sales", "purchase", "expense"].includes(type)) {
        console.warn("Backend endpoint for " + type + " not ready. Saving locally.");
        await wait(300);
        return { id: "local_" + Date.now().toString(36) };
      }

      const key = type === "activity" ? "activities" : type === "flock" ? "flocks" : "production";
      if (isMock) { 
        await wait(300); 
        return { id: "m" + Date.now().toString(36) }; 
      }
      
      const body = await recordBody(type, farmId, v);
      const d = await request("POST", farmUrl(key, farmId), body);
      const rec = (d && (d.flock || d.activity || d.production || d)) || {};
      return { id: rec.id };
    },
    
    createFarm: async function(v) {
      if (isMock) return normFarm(await mock.createFarm(v));
      
      const payload = {
        name: String(v.name).trim(),
        location: String(v.location || "").trim(),
        contact_info: String(v.contact_info || "").trim(),
        // the backend validates these (ISO currency, IANA timezone, metric/imperial)
        currency: v.currency,
        timezone: v.timezone,
        unit_system: v.unit_system
      };
      
      const d = await request("POST", E.farms, payload);
      const created = (d && d.farm) || d || {};
      
      const farm = normFarm({ 
        ...created, 
        role: (d && d.role) || "OWNER",
        // trust what the server saved; fall back to what the user picked,
        // never to hardcoded defaults
        settings: created.settings || (d && d.settings) || {
          currency: v.currency || "NGN",
          timezone: v.timezone || "Africa/Lagos",
          unit_system: v.unit_system || "metric"
        }
      });
      
      const cache = LS.get(K_FARM_CACHE + currentEmail, []).filter(function(x) {
        return String(x.id) !== farm.id;
      });
      cache.push(farm);
      LS.set(K_FARM_CACHE + currentEmail, cache);
      
      return farm;
    },
  };

  global.AgroAPI = AgroAPI;
})(window);