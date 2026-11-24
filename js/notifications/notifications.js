/* js/notifications/notifications.js - Notification Centre
   Header bell + red badge (polls every 60 s), the bell dropdown,
   #/notifications (history, search, filters) and #/notifications/preferences (toggles).
   Exposes: window.AgroNotif.sync(), window.AgroNotif.paintBell(), window.notificationsView(sub).
   Click handlers use data-notif-action, never data-action. Styles: css/components/notifications.css
   With ?demo=1 / ?dev=1 (or mock mode) it runs on sample data and never calls the API. */
(function () {
  "use strict";

  const POLL_MS = 60000;
  const MENU_LIMIT = 5;

  /* ---------- state (own state; never touches the app's `state` except to read farmId/status) ---------- */
  const N = {
    farmId: null, status: "idle",      // idle | loading | ready | error
    items: [], unread: 0, next: null, page: 1, more: false,
    tab: "all", menuTab: "all", query: "",
    seq: 0, loadedAt: 0, timer: null,
    prefs: { farmId: null, status: "idle", list: [], saving: {} }
  };

  const local = function () { return !!(DEV || (window.AgroAPI && AgroAPI.mock)); };
  const farmName = function () { const f = typeof farm === "function" ? farm() : null; return (f && f.name) || "your farm"; };

  /* ---------- types -> category, icon, tone ---------- */
  const TAB_LIST = [["all", "All"], ["unread", "Unread"], ["inventory", "Inventory"], ["finance", "Finance"], ["flock", "Flock health"]];
  const CAT_LABEL = { inventory: "Inventory", finance: "Finance", flock: "Flock health", production: "Production", other: "General" };

  function catOf(n) {
    const t = String(n.notification_type || "").toUpperCase();
    if (/STOCK|FEED|INVENTORY|ITEM|DELIVER/.test(t)) return "inventory";
    if (/PAY|INVOICE|EXPENSE|SALE|REVENUE|OVERDUE|FINANC|DEBT|PURCHASE/.test(t)) return "finance";
    if (/MORTAL|VACC|FLOCK|HEALTH|DISEASE/.test(t)) return "flock";
    if (/PRODUCT|EGG/.test(t)) return "production";
    return "other";
  }
  const toneOf = function (n) {
    const t = String(n.notification_type || "").toUpperCase();
    if (/LOW|HIGH|OVERDUE|MORTAL|ATTENTION/.test(t)) return "warn";
    const c = catOf(n);
    return c === "flock" ? "info" : c === "production" || c === "other" ? "mute" : "ok";
  };
  // where a notification leads when it is clicked in the dropdown
  const hrefOf = function (n) {
    const t = String(n.notification_type || "").toUpperCase();
    if (/STOCK|INVENTORY/.test(t)) return "#/inventory";
    if (/MORTAL|VACC|FLOCK/.test(t)) return "#/records/flock";
    if (/OVERDUE|PAY|SALE|INVOICE/.test(t)) return "#/records/sales";
    return "#/notifications";
  };

  const PATHS = {
    syringe: '<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M15 9.5c0-1-1.3-1.7-3-1.7s-3 .8-3 1.9 1.3 1.6 3 1.9 3 .8 3 1.9-1.3 1.9-3 1.9-3-.7-3-1.7"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'
  };
  const svg = function (name, size) {
    const p = PATHS[name] || (typeof ICONS !== "undefined" && ICONS[name]) || "";
    return '<svg class="i" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">' + p + "</svg>";
  };
  function iconNameOf(n) {
    const t = String(n.notification_type || "").toUpperCase();
    if (/VACC/.test(t)) return "syringe";
    if (/MORTAL|FLOCK|HEALTH/.test(t)) return "bird";
    if (/EXPENSE|SUMMARY/.test(t)) return "coin";
    if (/PAY|OVERDUE|SALE|INVOICE|REVENUE/.test(t)) return "wallet";
    if (/STOCK|FEED|INVENTORY|ITEM|DELIVER/.test(t)) return "inventory";
    if (/PRODUCT|EGG/.test(t)) return "egg";
    return "bell";
  }

  /* ---------- time ---------- */
  const isToday = function (d) { return localISO(d) === localISO(new Date()); };
  const isYesterday = function (d) { const y = new Date(); y.setDate(y.getDate() - 1); return localISO(d) === localISO(y); };
  function ago(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const mins = Math.floor(Math.max(0, Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + " min ago";
    if (isToday(d)) { const h = Math.floor(mins / 60); return h + (h === 1 ? " hr" : " hrs") + " ago"; }
    if (isYesterday(d)) return "Yesterday";
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  const fullDate = function (iso) { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); };

  /* ---------- data ---------- */
  const listOf = function (d) { return Array.isArray(d) ? d : (d && (d.results || d.notifications || d.items)) || []; };
  const norm = function (x) {
    return {
      id: x.id, notification_type: String(x.notification_type || x.type || ""), title: x.title || "", message: x.message || "",
      data: x.data || {}, is_read: !!x.is_read, read_at: x.read_at || null, created_at: x.created_at || ""
    };
  };
  const byNewest = function (a, b) { return new Date(b.created_at) - new Date(a.created_at); };

  // Sample data for ?demo=1: same notifications as the design, with times relative to now.
  let DEMO = null;
  function demoItems() {
    if (DEMO) return DEMO;
    const now = Date.now(), minsAgo = function (min) { return new Date(now - min * 60000).toISOString(); };
    const f = farmName();
    DEMO = [
      { id: 1, notification_type: "LOW_STOCK", title: "Low feed stock", message: "Layer Mash is below the minimum stock level. There are 18 bags remaining at " + f + ".", is_read: false, created_at: minsAgo(8) },
      { id: 2, notification_type: "PAYMENT_RECEIVED", title: "Payment received", message: "A payment of ₦218,400 was received from FreshMart Uyo for invoice INV-0428.", is_read: false, created_at: minsAgo(32) },
      { id: 3, notification_type: "VACCINATION_DUE", title: "Vaccination due tomorrow", message: "Flock LF-204 is scheduled for its Newcastle booster tomorrow at 9:00 AM.", is_read: false, created_at: minsAgo(120) },
      { id: 4, notification_type: "PRODUCTION_SUBMITTED", title: "Production record submitted", message: "1,286 eggs were recorded for Layer House A with a saleable rate of 98.6%.", is_read: true, created_at: minsAgo(300) },
      { id: 5, notification_type: "FEED_DELIVERED", title: "Feed delivery received", message: "The delivery of 120 bags of Grower Mash from Apex Feeds has been confirmed.", is_read: true, created_at: minsAgo(60 * 27) },
      { id: 6, notification_type: "HIGH_MORTALITY", title: "Mortality rate requires attention", message: "Flock LF-188 recorded a 0.8% mortality rate, above its seven-day average.", is_read: true, created_at: minsAgo(60 * 24 * 5) },
      { id: 7, notification_type: "EXPENSE_SUMMARY", title: "Weekly expense summary ready", message: "Your operating expense summary for the last week is ready to review.", is_read: true, created_at: minsAgo(60 * 24 * 8) }
    ];
    return DEMO;
  }
  const demoUnread = function () { return demoItems().filter(function (i) { return !i.is_read; }).length; };

  function reset() {
    N.seq++;
    N.items = []; N.unread = 0; N.next = null; N.page = 1; N.more = false; N.status = "idle";
    N.tab = "all"; N.menuTab = "all"; N.query = "";
    N.prefs = { farmId: null, status: "idle", list: [], saving: {} };
  }

  async function refresh(silent) {
    const id = state.farmId;
    if (!id) return;
    const seq = ++N.seq;
    if (!silent || N.status !== "ready") { N.status = "loading"; paintAll(); }
    try {
      let items, next = null, unread;
      if (local()) {
        await delay(200);
        items = demoItems().map(norm); unread = demoUnread();
      } else {
        const r = await Promise.all([
          AgroAPI.listNotifications(id),
          AgroAPI.getUnreadNotificationCount(id).catch(function () { return null; })
        ]);
        items = listOf(r[0]).map(norm);
        next = (r[0] && !Array.isArray(r[0]) && r[0].next) || null;
        unread = r[1] && r[1].unread != null ? Number(r[1].unread) || 0 : items.filter(function (i) { return !i.is_read; }).length;
      }
      if (seq !== N.seq || id !== state.farmId) return;   // the farm changed meanwhile
      N.items = items.sort(byNewest); N.next = next; N.page = 1; N.unread = unread; N.status = "ready"; N.loadedAt = Date.now();
    } catch (e) {
      if (seq !== N.seq || id !== state.farmId) return;
      if (N.status === "ready") return;                   // silent refresh failed: keep what is on screen
      N.status = "error";
    }
    paintAll();
  }

  async function loadMore() {
    if (N.more || !N.next) return;
    const id = state.farmId, seq = N.seq;
    N.more = true; paintPage();
    try {
      const d = await AgroAPI.listNotifications(id, { page: N.page + 1 });
      if (seq !== N.seq || id !== state.farmId) return;
      const have = new Set(N.items.map(function (i) { return String(i.id); }));
      listOf(d).map(norm).forEach(function (n) { if (!have.has(String(n.id))) N.items.push(n); });
      N.items.sort(byNewest); N.next = (d && !Array.isArray(d) && d.next) || null; N.page += 1;
    } catch (e) {
      if (seq === N.seq) toast("We couldn't load more notifications. Please try again.");
    }
    N.more = false; paintPage();
  }

  /* ---------- actions ---------- */
  async function markRead(id) {
    const n = N.items.find(function (x) { return String(x.id) === String(id); });
    if (!n || n.is_read) return;
    const fid = state.farmId;
    n.is_read = true; n.read_at = new Date().toISOString(); N.unread = Math.max(0, N.unread - 1);
    paintAll();
    if (local()) { const d = demoItems().find(function (x) { return String(x.id) === String(id); }); if (d) d.is_read = true; return; }
    try { await AgroAPI.markNotificationRead(fid, id); }
    catch (e) {
      if (fid !== state.farmId) return;
      n.is_read = false; n.read_at = null; N.unread += 1; paintAll();
      toast("We couldn't mark that as read. Please try again.");
    }
  }

  async function markAll() {
    if (!N.unread && !N.items.some(function (i) { return !i.is_read; })) return;
    const fid = state.farmId, prevUnread = N.unread, now = new Date().toISOString();
    const changed = N.items.filter(function (i) { return !i.is_read; });
    changed.forEach(function (i) { i.is_read = true; i.read_at = now; });
    N.unread = 0; paintAll();
    if (local()) { demoItems().forEach(function (i) { i.is_read = true; }); toast("All notifications marked as read."); return; }
    try { await AgroAPI.markAllNotificationsRead(fid); toast("All notifications marked as read."); }
    catch (e) {
      if (fid !== state.farmId) return;
      changed.forEach(function (i) { i.is_read = false; i.read_at = null; });
      N.unread = prevUnread; paintAll();
      toast("We couldn't mark all as read. Please try again.");
    }
  }

  /* ---------- polling (unread badge every 60 s) ---------- */
  async function pollCount() {
    if (document.hidden || state.status !== "ready" || !state.farmId || local()) return;
    const id = state.farmId;
    try {
      const d = await AgroAPI.getUnreadNotificationCount(id);
      if (id !== state.farmId) return;
      const n = Number(d && d.unread) || 0;
      const changed = n !== N.unread;
      N.unread = n; paintBell();
      if (changed && N.status === "ready") refresh(true);   // something new (or read elsewhere): refresh the list quietly
    } catch (e) { /* keep showing the last badge */ }
  }
  function startPolling() {
    if (N.timer) return;
    N.timer = setInterval(pollCount, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) pollCount(); });
  }

  /* ---------- the bell ---------- */
  function paintBell() {
    const b = $("#bell-btn");
    if (!b) return;
    const n = N.unread;
    b.innerHTML = icon("bell", 18) + (n > 0 ? '<span class="nt-badge" aria-hidden="true">' + (n > 99 ? "99+" : n) + "</span>" : "");
    b.setAttribute("aria-label", n > 0 ? "Notifications, " + n + " unread" : "Notifications");
    paintMenu();
  }

  function menuRow(n) {
    return '<a class="nt-mrow' + (n.is_read ? "" : " unread") + '" href="' + hrefOf(n) + '" data-notif-action="open" data-id="' + esc(n.id) + '">' +
      '<span class="nt-ico tone-' + toneOf(n) + '">' + svg(iconNameOf(n), 18) + "</span>" +
      '<span class="nt-mtxt"><b>' + esc(n.title) + "</b><span>" + esc(n.message) + "</span><small>" + esc(ago(n.created_at)) + "</small></span>" +
      (n.is_read ? "" : '<span class="nt-dot" aria-label="Unread"></span>') + "</a>";
  }

  function paintMenu() {
    const m = $("#bell-menu");
    if (!m) return;
    m.classList.add("nt-menu");
    const u = N.unread;
    const sub = N.status === "loading" ? "Loading…" : N.status === "error" ? "We couldn't load notifications." :
      u > 0 ? "You have " + u + " unread notification" + (u === 1 ? "" : "s") : "You're all caught up";
    let body;
    if (N.status === "loading" || N.status === "idle") body = '<div class="nt-mempty"><div class="spinner"></div></div>';
    else if (N.status === "error") body = '<div class="nt-mempty"><span>We couldn\'t load your notifications.</span><button type="button" class="nt-link" data-notif-action="retry">Try again</button></div>';
    else {
      const rows = N.items.filter(function (i) { return N.menuTab === "unread" ? !i.is_read : true; }).slice(0, MENU_LIMIT);
      body = rows.length ? rows.map(menuRow).join("") :
        '<div class="nt-mempty"><span>' + (N.menuTab === "unread" ? "No unread notifications." : "No notifications yet.") + "</span></div>";
    }
    m.innerHTML =
      '<div class="nt-mhead"><div><b>Notifications</b><span>' + esc(sub) + '</span></div>' +
      '<button type="button" class="nt-link" data-notif-action="read-all"' + (u > 0 ? "" : " disabled") + ">Mark all as read</button></div>" +
      '<div class="nt-mtabs" role="tablist">' +
      ["all", "unread"].map(function (k) {
        return '<button type="button" role="tab" class="nt-mtab' + (N.menuTab === k ? " on" : "") + '" aria-selected="' + (N.menuTab === k) + '" data-notif-action="menu-tab" data-nt-tab="' + k + '">' +
          (k === "all" ? "All" : "Unread") + (k === "unread" && u > 0 ? '<span class="nt-count">' + (u > 99 ? "99+" : u) + "</span>" : "") + "</button>";
      }).join("") + "</div>" +
      '<div class="nt-mlist">' + body + "</div>" +
      '<a class="nt-mfoot" href="#/notifications" data-notif-action="close-menu">View all notifications ' + svg("arrowRight", 14) + "</a>";
  }

  /* ---------- the page ---------- */
  function filtered() {
    const q = N.query.trim().toLowerCase();
    return N.items.filter(function (n) {
      if (N.tab === "unread" && n.is_read) return false;
      if ((N.tab === "inventory" || N.tab === "finance" || N.tab === "flock") && catOf(n) !== N.tab) return false;
      if (q && (n.title + " " + n.message).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function rowHTML(n) {
    const c = catOf(n);
    return '<article class="nt-row' + (n.is_read ? "" : " unread") + '">' +
      '<span class="nt-ico tone-' + toneOf(n) + '">' + svg(iconNameOf(n), 20) + "</span>" +
      '<div class="nt-body"><div class="nt-meta"><span class="nt-cat">' + esc(CAT_LABEL[c]) + "</span>" + (n.is_read ? "" : '<span class="nt-new">NEW</span>') + "</div>" +
      '<h3 class="nt-title">' + esc(n.title) + '</h3><p class="nt-msg">' + esc(n.message) + "</p></div>" +
      '<div class="nt-side"><time datetime="' + esc(n.created_at) + '" title="' + esc(fullDate(n.created_at)) + '">' + esc(ago(n.created_at)) + "</time>" +
      (n.is_read ? '<span class="nt-readlbl">Read</span>' : '<button type="button" class="nt-btn sm" data-notif-action="read" data-id="' + esc(n.id) + '">Mark as read</button>') +
      "</div></article>";
  }

  function listHTML() {
    if (N.status === "loading" || N.status === "idle") return '<div class="nt-state"><div class="spinner"></div><p>Loading notifications…</p></div>';
    if (N.status === "error") return '<div class="nt-state err" role="alert">' + icon("alert", 28) + "<h3>Something went wrong</h3><p>We couldn't load your notifications.</p>" +
      '<button type="button" class="nt-btn" data-notif-action="retry">Try again</button></div>';
    const rows = filtered();
    if (!rows.length) {
      const q = N.query.trim();
      const title = q ? "No matches" : N.tab === "unread" ? "You're all caught up" : N.items.length ? "Nothing here" : "No notifications yet";
      const text = q ? "No notifications match “" + q + "”." : N.tab === "unread" ? "There are no unread notifications." :
        N.items.length ? "There are no notifications in this category." : "Alerts about low stock, high mortality and overdue payments will show up here.";
      return '<div class="nt-state">' + icon("bell", 28) + "<h3>" + esc(title) + "</h3><p>" + esc(text) + "</p></div>";
    }
    const today = rows.filter(function (n) { return isToday(new Date(n.created_at)); });
    const earlier = rows.filter(function (n) { return !isToday(new Date(n.created_at)); });
    const group = function (label, list) { return list.length ? '<div class="nt-group"><span>' + label + "</span></div>" + list.map(rowHTML).join("") : ""; };
    return group("Today", today) + group("Earlier", earlier) +
      (N.next ? '<div class="nt-more"><button type="button" class="nt-btn" data-notif-action="more"' + (N.more ? " disabled" : "") + ">" + (N.more ? "Loading…" : "Load more") + "</button></div>" : "");
  }

  function pageInner() {
    const u = N.unread;
    const chips = TAB_LIST.map(function (t) {
      return '<button type="button" role="tab" class="nt-chip' + (N.tab === t[0] ? " on" : "") + '" aria-selected="' + (N.tab === t[0]) + '" data-notif-action="tab" data-nt-tab="' + t[0] + '">' +
        t[1] + (t[0] === "unread" && u > 0 ? '<span class="nt-count">' + (u > 99 ? "99+" : u) + "</span>" : "") + "</button>";
    }).join("");
    return '<a class="nt-back" href="#/reports">' + svg("arrowLeft", 14) + "Back to reports</a>" +
      '<header class="nt-head"><div><span class="nt-eyebrow">Activity center</span><h1>Notifications</h1><p>Stay updated on important activity across ' + esc(farmName()) + ".</p></div>" +
      '<div class="nt-head-actions"><a class="nt-btn" href="#/notifications/preferences">' + svg("sliders", 16) + "Preferences</a>" +
      '<button type="button" class="nt-btn" data-notif-action="read-all"' + (u > 0 ? "" : " disabled") + ">" + svg("checkCircle", 16) + "Mark all as read</button></div></header>" +
      '<section class="nt-banner"><span class="nt-bell">' + icon("bell", 22) + (u > 0 ? '<span class="nt-badge" aria-hidden="true">' + (u > 99 ? "99+" : u) + "</span>" : "") + "</span>" +
      "<div><b>" + (u > 0 ? u + " unread notification" + (u === 1 ? "" : "s") : "You're all caught up") + "</b><span>" +
      (u > 0 ? "Review the latest updates that may need your attention." : "New alerts will appear here as they happen.") + "</span></div>" +
      '<span class="nt-farm">' + esc(farmName()) + "</span></section>" +
      '<section class="nt-card"><div class="nt-toolbar">' +
      '<label class="nt-search">' + icon("search", 16) + '<input id="nt-search" type="search" placeholder="Search notifications…" aria-label="Search notifications" autocomplete="off" value="' + esc(N.query) + '"></label>' +
      '<div class="nt-chips" role="tablist" aria-label="Filter notifications">' + chips + "</div></div>" +
      '<div id="nt-list" aria-live="polite">' + listHTML() + "</div></section>";
  }

  /* ---------- preferences page ---------- */
  const PREF_INFO = {
    LOW_STOCK: ["Low stock", "Tell me when an inventory item falls below its minimum stock level."],
    HIGH_MORTALITY: ["High mortality", "Tell me when a flock's mortality rate is higher than normal."],
    OVERDUE_PAYMENT: ["Overdue payments", "Tell me when a customer payment is past its due date."]
  };
  const humanize = function (t) { const s = String(t || "").toLowerCase().replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
  function prefList(d) {
    const a = Array.isArray(d) ? d : (d && (d.preferences || d.results)) || [];
    const list = a.map(function (p) {
      const type = p.notification_type || p.type || "";
      const info = PREF_INFO[type] || [];
      return { type: type, label: p.label || p.notification_type_label || p.display_name || info[0] || humanize(type), text: p.description || info[1] || "", enabled: p.enabled !== false };
    }).filter(function (p) { return p.type; });
    // nothing saved yet: show the known alert types, switched on
    return list.length ? list : Object.keys(PREF_INFO).map(function (t) { return { type: t, label: PREF_INFO[t][0], text: PREF_INFO[t][1], enabled: true }; });
  }
  let DEMO_PREFS = null;

  async function loadPrefs() {
    const id = state.farmId;
    if (!id) return;
    N.prefs.farmId = id; N.prefs.status = "loading"; paintPage();
    try {
      let d;
      if (local()) { await delay(150); d = DEMO_PREFS || []; }
      else d = await AgroAPI.getNotificationPreferences(id);
      if (id !== state.farmId) return;
      N.prefs.list = prefList(d); N.prefs.status = "ready";
    } catch (e) {
      if (id !== state.farmId) return;
      N.prefs.status = "error";
    }
    paintPage();
  }

  async function togglePref(type) {
    const p = N.prefs.list.find(function (x) { return x.type === type; });
    if (!p || N.prefs.saving[type]) return;
    const fid = state.farmId;
    p.enabled = !p.enabled; N.prefs.saving[type] = true; paintPage();
    try {
      if (local()) { DEMO_PREFS = N.prefs.list.map(function (x) { return { notification_type: x.type, enabled: x.enabled }; }); await delay(120); }
      else await AgroAPI.updateNotificationPreferences(fid, [{ notification_type: type, enabled: p.enabled }]);
    } catch (e) {
      if (fid === state.farmId) { p.enabled = !p.enabled; toast("We couldn't save that change. Please try again."); }
    }
    delete N.prefs.saving[type];
    if (fid === state.farmId) paintPage();
  }

  function prefsInner() {
    let body;
    if (N.prefs.status === "loading" || N.prefs.status === "idle") body = '<div class="nt-state"><div class="spinner"></div><p>Loading preferences…</p></div>';
    else if (N.prefs.status === "error") body = '<div class="nt-state err" role="alert">' + icon("alert", 28) + "<h3>Something went wrong</h3><p>We couldn't load your preferences.</p>" +
      '<button type="button" class="nt-btn" data-notif-action="retry-prefs">Try again</button></div>';
    else body = N.prefs.list.map(function (p) {
      const busy = !!N.prefs.saving[p.type];
      return '<div class="nt-pref"><div class="nt-pref-txt"><b id="nt-p-' + esc(p.type) + '">' + esc(p.label) + "</b>" + (p.text ? "<span>" + esc(p.text) + "</span>" : "") + "</div>" +
        '<button type="button" class="nt-switch' + (p.enabled ? " on" : "") + '" role="switch" aria-checked="' + p.enabled + '" aria-labelledby="nt-p-' + esc(p.type) + '"' +
        ' data-notif-action="pref" data-type="' + esc(p.type) + '"' + (busy ? " disabled" : "") + '><span></span></button></div>';
    }).join("");
    return '<a class="nt-back" href="#/notifications">' + svg("arrowLeft", 14) + "Back to notifications</a>" +
      '<header class="nt-head"><div><span class="nt-eyebrow">Activity center</span><h1>Notification preferences</h1><p>Choose which alerts you receive for ' + esc(farmName()) + ".</p></div></header>" +
      '<section class="nt-card nt-prefs">' + body + "</section>";
  }

  /* ---------- painting ---------- */
  function paintPage() {
    const r = $("#nt-root");
    if (!r) return;
    const a = document.activeElement;
    const keep = a && a.id === "nt-search" ? [a.selectionStart, a.selectionEnd] : null;
    r.innerHTML = route().sub === "preferences" ? prefsInner() : pageInner();
    if (keep) { const s = $("#nt-search"); if (s) { s.focus(); try { s.setSelectionRange(keep[0], keep[1]); } catch (e) { /* not supported */ } } }
  }
  function paintList() { const l = $("#nt-list"); if (l) l.innerHTML = listHTML(); }
  function paintAll() { paintBell(); paintPage(); }

  /* ---------- hooks used by the shell ---------- */
  function sync() {
    paintBell();
    if (state.status !== "ready" || !state.farmId) return;
    if (N.farmId !== state.farmId) { reset(); N.farmId = state.farmId; refresh(false); }
    startPolling();
  }

  window.notificationsView = function (sub) {
    if (N.farmId !== state.farmId) sync();
    else if (N.status === "idle") refresh(false);
    if (sub === "preferences" && N.prefs.farmId !== state.farmId) { N.prefs.farmId = state.farmId; setTimeout(loadPrefs, 0); }
    else if (sub !== "preferences" && N.status === "ready" && Date.now() - N.loadedAt > 30000) refresh(true);   // opening the page shows what we have and re-fetches quietly
    return '<div class="nt-page" id="nt-root">' + (sub === "preferences" ? prefsInner() : pageInner()) + "</div>";
  };
  window.AgroNotif = { sync: sync, paintBell: paintBell };

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    const t = e.target;
    if (t.closest("#bell-btn") && N.status === "ready" && Date.now() - N.loadedAt > 15000) refresh(true);   // opening the bell: quiet refresh
    const a = t.closest("[data-notif-action]");
    if (!a) return;
    // Buttons inside the dropdown repaint it, which detaches the clicked element. The app's own outside-click
    // handler would then think the click was outside the menu and close it, so keep this click to ourselves.
    if (a.closest("#bell-menu") && a.dataset.notifAction !== "open" && a.dataset.notifAction !== "close-menu") e.stopImmediatePropagation();
    switch (a.dataset.notifAction) {
      case "read": markRead(a.dataset.id); break;
      case "read-all": markAll(); break;
      case "tab": N.tab = a.dataset.ntTab; paintPage(); break;
      case "menu-tab": N.menuTab = a.dataset.ntTab; paintMenu(); break;
      case "open": markRead(a.dataset.id); closeMenus(); break;   // the link itself then takes you to the related page
      case "close-menu": closeMenus(); break;
      case "retry": refresh(false); break;
      case "more": loadMore(); break;
      case "pref": togglePref(a.dataset.type); break;
      case "retry-prefs": loadPrefs(); break;
    }
  }, true);   // capture: runs before the app's own click handler, whatever the script order
  document.addEventListener("input", function (e) {
    if (e.target.id === "nt-search") { N.query = e.target.value; paintList(); }
  });
})();