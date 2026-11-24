/* js/targets/targets.js - Monthly Targets + Forecast cards for the dashboard
   Exposes window.targetsForecastSection() (returns HTML; dashboardView() calls it once).
   - Targets card: this month's progress bars (green on track / amber behind / red missed) + "Set targets" window (add / edit / delete).
   - Forecast card: expected value with its low-high range, confidence, and the assumptions as small print.
   Click handlers use data-tf-action, never data-action. Styles: css/components/targets.css
   With ?demo=1 / ?dev=1 (or mock mode) it runs on sample data and never calls the API. */
(function () {
  "use strict";

  const STALE_MS = 60000;   // quietly re-fetch if the dashboard is shown again after this long
  const FC_DAYS = 30;

  const T = {
    farmId: null, month: "", seq: 0,
    status: "idle", targets: [], asOf: null, loadedAt: 0,          // targets progress
    fc: { status: "idle", list: [], asOf: null, pick: null },       // forecasts
    modal: null
  };

  const local = function () { return !!(DEV || (window.AgroAPI && AgroAPI.mock)); };
  const thisMonth = function () { return localISO(new Date()).slice(0, 7); };
  const monthLabel = function (ym) {
    const d = new Date(ym + "-01T00:00:00");
    return isNaN(d) ? ym : d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };
  const dayLabel = function (iso) {
    const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  const isNum = function (n) { return typeof n === "number" ? isFinite(n) : (n !== null && n !== "" && n !== undefined && isFinite(Number(n))); };
  const humanize = function (t) { const s = String(t || "").toLowerCase().replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
  const delayMs = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------- metrics: label + unit (the server tells us on forecasts; otherwise we infer) ---------- */
  function metricInfo(metric) {
    const f = T.fc.list.find(function (x) { return x.metric === metric; });
    const t = T.targets.find(function (x) { return x.metric === metric; });
    const proj = t && t.month_end_projection;
    const label = (f && f.metric_label) || (proj && proj.metric_label) || humanize(metric);
    let unit = (f && f.unit) || (proj && proj.unit) || "";
    if (!unit) unit = /REVENUE|EXPENSE|SALES|PROFIT|COST|INCOME|PURCHASE|SPEND/i.test(metric) ? "currency" : "count";
    return { label: label, unit: unit };
  }
  const compactMoney = function (n) {
    try { return new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: currencyCode(), notation: "compact", maximumFractionDigits: 1 }).format(n); }
    catch (e) { return fmtMoney0(n); }
  };
  function fmt(n, unit, compact) {
    if (!isNum(n)) return "—";
    n = Number(n);
    if (unit === "currency") return compact ? compactMoney(n) : fmtMoney0(n);
    if (unit === "percent" || unit === "pct") return n.toFixed(1) + "%";
    return compact && Math.abs(n) >= 10000 ? new Intl.NumberFormat(CONFIG.locale, { notation: "compact", maximumFractionDigits: 1 }).format(n) : fmtInt(n);
  }

  /* ---------- status -> look ---------- */
  const STATUS = {
    not_started: { cls: "idle", text: "Not started" },
    on_track: { cls: "ok", text: "On track" },
    behind: { cls: "warn", text: "Behind" },
    achieved: { cls: "ok", text: "Achieved" },
    missed: { cls: "bad", text: "Missed" }
  };
  const statusOf = function (s) { return STATUS[String(s || "").toLowerCase()] || { cls: "idle", text: s ? humanize(s) : "No status" }; };

  /* ---------- demo data (only for ?demo=1) ---------- */
  let DEMO = null;
  function demo() {
    if (DEMO) return DEMO;
    DEMO = {
      nextId: 4,
      targets: [
        { id: 1, metric: "REVENUE", target_value: 100000, actual_so_far: 45000 },
        { id: 2, metric: "EXPENSES", target_value: 60000, actual_so_far: 31000 },
        { id: 3, metric: "EGGS", target_value: 30000, actual_so_far: 31200 }
      ],
      forecasts: [
        { metric: "REVENUE", metric_label: "Revenue", unit: "currency", days_ahead: 30, expected: 50000, range_low: 42000, range_high: 58000, range_confidence_pct: 80, confidence: "medium",
          assumptions: ["Learns from the last 30 days of records.", "Assumes the coming days look like the recent daily average."] },
        { metric: "EXPENSES", metric_label: "Expenses", unit: "currency", days_ahead: 30, expected: 36500, range_low: 30000, range_high: 44000, range_confidence_pct: 80, confidence: "low",
          assumptions: ["Learns from the last 30 days of records.", "Large one-off purchases can make this range wide."] },
        { metric: "EGGS", metric_label: "Eggs collected", unit: "count", days_ahead: 30, expected: 38400, range_low: 36100, range_high: 40800, range_confidence_pct: 80, confidence: "high",
          assumptions: ["Learns from the last 30 days of records."] }
      ]
    };
    return DEMO;
  }
  function demoProgress() {
    const d = new Date(), day = d.getDate(), dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return demo().targets.map(function (t) {
      const pct = t.target_value ? t.actual_so_far / t.target_value * 100 : 0;
      const status = t.actual_so_far <= 0 ? "not_started" : pct >= 100 ? "achieved" : pct >= (day / dim) * 100 * 0.9 ? "on_track" : "behind";
      const f = demo().forecasts.find(function (x) { return x.metric === t.metric; });
      return Object.assign({}, t, { percent_done: Math.round(pct * 10) / 10, status: status, month_end_projection: f || null });
    });
  }

  /* ---------- loading ---------- */
  const listOf = function (d, key) { return Array.isArray(d) ? d : (d && (d[key] || d.results)) || []; };

  async function load(silent) {
    const id = state.farmId;
    if (!id) return;
    const seq = ++T.seq;
    T.month = thisMonth();
    if (!silent || T.status !== "ready") { T.status = "loading"; }
    if (!silent || T.fc.status !== "ready") { T.fc.status = "loading"; }
    paint();
    let prog, fcs;
    if (local()) {
      await delayMs(250);
      prog = { status: "fulfilled", value: { as_of: localISO(new Date()), targets: demoProgress() } };
      fcs = { status: "fulfilled", value: { as_of: localISO(new Date()), forecasts: demo().forecasts } };
    } else {
      const r = await Promise.allSettled([AgroAPI.getTargetProgress(id, T.month), AgroAPI.getForecasts(id, null, FC_DAYS)]);
      prog = r[0]; fcs = r[1];
    }
    if (seq !== T.seq || id !== state.farmId) return;     // farm changed meanwhile
    if (prog.status === "fulfilled") {
      T.targets = listOf(prog.value, "targets"); T.asOf = (prog.value && prog.value.as_of) || null; T.status = "ready"; T.loadedAt = Date.now();
    } else if (T.status !== "ready") T.status = "error";
    if (fcs.status === "fulfilled") {
      T.fc.list = listOf(fcs.value, "forecasts"); T.fc.asOf = (fcs.value && fcs.value.as_of) || null; T.fc.status = "ready";
      if (!T.fc.list.some(function (f) { return f.metric === T.fc.pick; })) T.fc.pick = pickDefault();
    } else if (T.fc.status !== "ready") T.fc.status = "error";
    paint();
  }
  const pickDefault = function () {
    const l = T.fc.list; if (!l.length) return null;
    return (l.find(function (f) { return f.metric === "REVENUE"; }) || l[0]).metric;
  };
  function reset() {
    T.seq++; T.status = "idle"; T.targets = []; T.asOf = null; T.fc = { status: "idle", list: [], asOf: null, pick: null }; T.modal = null;
  }
  function ensure() {
    if (T.farmId !== state.farmId) { reset(); T.farmId = state.farmId; load(false); }
    else if (T.status === "idle") load(false);
    else if (T.status === "ready" && Date.now() - T.loadedAt > STALE_MS) load(true);
  }

  /* ---------- targets card ---------- */
  function targetRow(t) {
    const info = metricInfo(t.metric), st = statusOf(t.status);
    const pct = isNum(t.percent_done) ? Number(t.percent_done) : (isNum(t.target_value) && Number(t.target_value) > 0 && isNum(t.actual_so_far) ? Number(t.actual_so_far) / Number(t.target_value) * 100 : 0);
    const bar = Math.max(0, Math.min(pct, 100));
    const p = t.month_end_projection;
    let proj = "";
    if (p && isNum(p.expected) && t.status !== "achieved") {
      proj = '<p class="tf-proj">Projected by month end: <b>' + esc(fmt(p.expected, info.unit)) + "</b>" +
        (isNum(p.range_low) && isNum(p.range_high) ? " (range " + esc(fmt(p.range_low, info.unit, true)) + " – " + esc(fmt(p.range_high, info.unit, true)) + ")" : "") + "</p>";
    }
    return '<div class="tf-target">' +
      '<div class="tf-t-top"><b>' + esc(info.label) + '</b><span class="tf-pill s-' + st.cls + '">' + esc(st.text) + "</span></div>" +
      '<div class="tf-t-nums"><span>' + esc(fmt(t.actual_so_far, info.unit)) + " <small>of " + esc(fmt(t.target_value, info.unit)) + "</small></span><span>" + Math.round(pct) + "%</span></div>" +
      '<div class="bar tf-bar s-' + st.cls + '" role="progressbar" aria-label="' + esc(info.label) + ' target progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(bar) + '"><i style="width:' + bar + '%"></i></div>' +
      proj + "</div>";
  }

  function targetsCard() {
    const head = '<div class="card-head"><div><h3>Targets</h3><p class="tf-sub">' + esc(monthLabel(T.month || thisMonth())) + (T.asOf ? " · as of " + esc(dayLabel(T.asOf)) : "") + "</p></div>" +
      '<button class="tool-btn" type="button" data-tf-action="open-targets">' + icon("plus", 14) + (T.targets.length ? "Manage targets" : "Set targets") + "</button></div>";
    let body;
    if (T.status === "loading" || T.status === "idle") body = '<div class="tf-state"><div class="spinner"></div><p>Loading targets…</p></div>';
    else if (T.status === "error") body = '<div class="tf-state err" role="alert"><p>We couldn\'t load your targets.</p><button class="tool-btn" type="button" data-tf-action="retry">Try again</button></div>';
    else if (!T.targets.length) body = '<div class="tf-state"><p>No targets set for ' + esc(monthLabel(T.month)) + ". Set a monthly goal to track your progress here.</p></div>";
    else body = T.targets.map(targetRow).join("");
    return '<section class="card tf-card" aria-label="Targets">' + head + body + "</section>";
  }

  /* ---------- forecast card ---------- */
  const CONF = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };
  function rangeBar(f, unit) {
    const lo = Number(f.range_low), hi = Number(f.range_high), ex = Number(f.expected);
    if (!(hi > lo)) return "";
    const pos = isNum(f.expected) ? Math.max(0, Math.min(100, (ex - lo) / (hi - lo) * 100)) : null;
    return '<div class="tf-range" aria-hidden="true"><div class="tf-range-band">' + (pos === null ? "" : '<span class="tf-range-mark" style="left:' + pos + '%"></span>') + "</div>" +
      "<div class=\"tf-range-ends\"><span>" + esc(fmt(lo, unit, true)) + "</span><span>" + esc(fmt(hi, unit, true)) + "</span></div></div>";
  }
  function forecastBody() {
    const f = T.fc.list.find(function (x) { return x.metric === T.fc.pick; });
    if (!f) return "";
    const unit = f.unit || metricInfo(f.metric).unit;
    const hasExp = isNum(f.expected), hasRange = isNum(f.range_low) && isNum(f.range_high);
    const conf = CONF[String(f.confidence || "").toLowerCase()];
    const days = isNum(f.days_ahead) ? Number(f.days_ahead) : FC_DAYS;
    const pct = isNum(f.range_confidence_pct) ? Math.round(Number(f.range_confidence_pct)) : null;
    const assumptions = Array.isArray(f.assumptions) ? f.assumptions.filter(Boolean) : [];
    const tabs = T.fc.list.length > 1 ? '<div class="tf-tabs" role="tablist" aria-label="Forecast metric">' + T.fc.list.map(function (x) {
      return '<button type="button" role="tab" class="tf-tab' + (x.metric === f.metric ? " on" : "") + '" aria-selected="' + (x.metric === f.metric) + '" data-tf-action="pick" data-metric="' + esc(x.metric) + '">' + esc(x.metric_label || humanize(x.metric)) + "</button>";
    }).join("") + "</div>" : "";
    return tabs +
      '<div class="tf-fc-main"><span class="tf-fc-lbl">Expected, next ' + days + " days" + (conf ? ' · <em class="tf-conf c-' + esc(String(f.confidence).toLowerCase()) + '">' + conf + "</em>" : "") + "</span>" +
      '<div class="tf-fc-val">' + (hasExp ? esc(fmt(f.expected, unit)) : '<span class="tf-na">Not enough data yet</span>') + "</div>" +
      (hasRange
        ? '<p class="tf-fc-range">Range: ' + esc(fmt(f.range_low, unit, true)) + " – " + esc(fmt(f.range_high, unit, true)) + (pct ? " (" + pct + "% likely to land in this range)" : "") + "</p>" + rangeBar(f, unit)
        : hasExp ? '<p class="tf-fc-range">Range unavailable for this forecast.</p>' : "") + "</div>" +
      (assumptions.length
        ? '<details class="tf-assume"><summary>How is this worked out?</summary><ul>' + assumptions.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul></details>"
        : "");
  }
  function forecastCard() {
    let body;
    if (T.fc.status === "loading" || T.fc.status === "idle") body = '<div class="tf-state"><div class="spinner"></div><p>Loading forecast…</p></div>';
    else if (T.fc.status === "error") body = '<div class="tf-state err" role="alert"><p>We couldn\'t load the forecast.</p><button class="tool-btn" type="button" data-tf-action="retry">Try again</button></div>';
    else if (!T.fc.list.length) body = '<div class="tf-state"><p>Not enough records yet to forecast. Forecasts learn from the last 30 days of data.</p></div>';
    else body = forecastBody();
    return '<section class="card tf-card" aria-label="Forecast"><div class="card-head"><div><h3>Forecast</h3><p class="tf-sub">An estimate, not a promise' + (T.fc.asOf ? " · as of " + esc(dayLabel(T.fc.asOf)) : "") + "</p></div></div>" + body + "</section>";
  }

  /* ---------- paint ---------- */
  const inner = function () { return targetsCard() + forecastCard(); };
  function paint() { const r = $("#tf-root"); if (r) r.innerHTML = inner(); }
  window.targetsForecastSection = function () {
    if (!state.farmId) return "";
    ensure();
    return '<div class="tf-row" id="tf-root">' + inner() + "</div>";
  };

  /* ---------- "Manage targets" window ---------- */
  function metricOptions() {
    const seen = {}, out = [];
    const add = function (m) { if (m && !seen[m]) { seen[m] = 1; out.push(m); } };
    T.fc.list.forEach(function (f) { add(f.metric); });
    T.targets.forEach(function (t) { add(t.metric); });
    if (!out.length) { add("REVENUE"); add("EXPENSES"); }
    return out;
  }
  const blankForm = function () { return { metric: "", value: "" }; };

  function openTargetsModal(trigger) {
    modalTrigger = trigger || document.activeElement;
    T.modal = { editId: null, confirmId: null, saving: false, error: "", errs: {}, form: blankForm() };
    $("#modal-root").innerHTML =
      '<div class="backdrop" id="backdrop"><div class="modal tf-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
      '<button class="close" type="button" data-close aria-label="Close">' + icon("x", 18) + "</button>" +
      '<h2 id="modal-title">Monthly targets</h2><p class="sub">' + esc(monthLabel(T.month || thisMonth())) + '. Set one goal per measure; progress shows on your dashboard.</p>' +
      '<div id="tf-mbody"></div></div></div>';
    document.body.style.overflow = "hidden";
    paintModal();
    const f = $("#tf-f-metric"); if (f) f.focus();
  }

  function paintModal() {
    const body = $("#tf-mbody"), m = T.modal;
    if (!body || !m) return;
    const rows = T.targets.length ? '<ul class="tf-mlist">' + T.targets.map(function (t) {
      const info = metricInfo(t.metric), confirm = String(m.confirmId) === String(t.id);
      return '<li class="tf-mrow"><div><b>' + esc(info.label) + "</b><span>" + esc(fmt(t.target_value, info.unit)) + "</span></div><div class=\"tf-mact\">" +
        (confirm
          ? '<span class="tf-ask">Delete?</span><button type="button" class="tool-btn danger" data-tf-action="del-yes" data-id="' + esc(t.id) + '">Yes, delete</button><button type="button" class="tool-btn" data-tf-action="del-no">Keep</button>'
          : '<button type="button" class="tool-btn" data-tf-action="edit" data-id="' + esc(t.id) + '" aria-label="Edit ' + esc(info.label) + ' target">' + icon("edit", 14) + 'Edit</button>' +
            '<button type="button" class="tool-btn" data-tf-action="del" data-id="' + esc(t.id) + '" aria-label="Delete ' + esc(info.label) + ' target">Delete</button>') +
        "</div></li>";
    }).join("") + "</ul>" : '<p class="tf-mnone">No targets yet for this month.</p>';
    const editing = m.editId !== null;
    const opts = metricOptions();
    const unit = m.form.metric ? metricInfo(m.form.metric).unit : "";
    const e = m.errs || {};
    body.innerHTML = rows +
      '<form id="tf-form" novalidate><h3 class="tf-fh">' + (editing ? "Edit target" : "Add a target") + "</h3><div class=\"form-grid\">" +
      '<div class="field' + (e.metric ? " invalid" : "") + '"><label for="tf-f-metric">Measure</label><div class="control select"><select id="tf-f-metric" name="metric"' + (editing ? " disabled" : "") + ">" +
      '<option value=""' + (m.form.metric ? "" : " selected") + ' disabled hidden>Choose a measure</option>' +
      opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === m.form.metric ? " selected" : "") + ">" + esc(metricInfo(o).label) + "</option>"; }).join("") + "</select>" + icon("chevronDown", 18) + "</div><p class=\"error\" role=\"alert\">" + esc(e.metric || "") + "</p></div>" +
      '<div class="field' + (e.value ? " invalid" : "") + '"><label for="tf-f-value">Target' + (unit === "currency" ? " amount (" + esc(currencyCode()) + ")" : " value") + '</label><div class="control"><input id="tf-f-value" name="value" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 100000" autocomplete="off" value="' + esc(m.form.value) + '"></div><p class="error" role="alert">' + esc(e.value || "") + "</p></div>" +
      "</div>" + (m.error ? '<p class="form-error" role="alert">' + esc(m.error) + "</p>" : "") +
      '<div class="actions tf-actions">' + (editing ? '<button type="button" class="tool-btn" data-tf-action="cancel-edit">Cancel edit</button>' : "") +
      '<button class="btn" type="submit"' + (m.saving ? " disabled" : "") + ">" + (m.saving ? "Saving…" : editing ? "Save changes" : "Add target") + "</button></div></form>";
  }

  // The month field's exact format isn't in the handoff doc, so try "YYYY-MM" first and, if the server complains about it, "YYYY-MM-01".
  let MONTH_FMT = "ym";
  const monthValue = function (fmtName) { return fmtName === "ym" ? T.month : T.month + "-01"; };
  async function sendTarget(editId, metric, value) {
    const id = state.farmId;
    const call = function (month) {
      const body = { metric: metric, month: month, target_value: value };
      return editId !== null ? AgroAPI.updateTarget(id, editId, body) : AgroAPI.createTarget(id, body);
    };
    try { return await call(monthValue(MONTH_FMT)); }
    catch (err) {
      if (err && err.status === 400 && err.fields && err.fields.month) {
        const alt = MONTH_FMT === "ym" ? "ymd" : "ym";
        const r = await call(monthValue(alt));
        MONTH_FMT = alt;
        return r;
      }
      throw err;
    }
  }
  function errText(err, fallback) {
    if (err && err.status === 403) return "You don't have permission to change targets on this farm.";
    if (err && err.name === "ApiError") {
      const f = err.fields || {};
      const rest = Object.keys(f).map(function (k) { return k + ": " + f[k]; });
      return rest.length ? rest.join(" ") : err.message || fallback;
    }
    return fallback;
  }

  async function saveTarget() {
    const m = T.modal; if (!m || m.saving) return;
    const metric = m.editId !== null ? (T.targets.find(function (t) { return String(t.id) === String(m.editId); }) || {}).metric : m.form.metric;
    const raw = String(m.form.value).trim(), value = Number(raw);
    m.errs = {}; m.error = "";
    if (!metric) m.errs.metric = "Choose a measure.";
    if (raw === "" || !isFinite(value) || value <= 0) m.errs.value = "Enter an amount greater than zero.";
    if (m.editId === null && metric && T.targets.some(function (t) { return t.metric === metric; })) m.errs.metric = metricInfo(metric).label + " already has a target this month. Edit it above.";
    if (m.errs.metric || m.errs.value) { paintModal(); const el = $(m.errs.metric ? "#tf-f-metric" : "#tf-f-value"); if (el) el.focus(); return; }
    const fid = state.farmId, wasEdit = m.editId !== null;
    m.saving = true; paintModal();
    try {
      if (local()) {
        await delayMs(200);
        if (wasEdit) { const t = demo().targets.find(function (x) { return String(x.id) === String(m.editId); }); if (t) t.target_value = value; }
        else demo().targets.push({ id: demo().nextId++, metric: metric, target_value: value, actual_so_far: 0 });
      } else await sendTarget(m.editId, metric, value);
      if (fid !== state.farmId) return;
      m.saving = false; m.editId = null; m.form = blankForm();
      await load(true); paintModal();
      toast(wasEdit ? "Target updated." : "Target added.");
    } catch (err) {
      if (!T.modal) return;
      m.saving = false; m.error = errText(err, "We couldn't save this target. Please try again."); paintModal();
    }
  }

  async function deleteTarget(id) {
    const m = T.modal; if (!m) return;
    const fid = state.farmId;
    m.confirmId = null; m.saving = true; paintModal();
    try {
      if (local()) { await delayMs(150); DEMO.targets = DEMO.targets.filter(function (x) { return String(x.id) !== String(id); }); }
      else await AgroAPI.deleteTarget(fid, id);
      if (fid !== state.farmId) return;
      m.saving = false; if (String(m.editId) === String(id)) { m.editId = null; m.form = blankForm(); }
      await load(true); paintModal();
      toast("Target deleted.");
    } catch (err) {
      if (!T.modal) return;
      m.saving = false; m.error = errText(err, "We couldn't delete this target. Please try again."); paintModal();
    }
  }

  /* ---------- events ---------- */
  document.addEventListener("click", function (e) {
    const a = e.target.closest("[data-tf-action]");
    if (!a) return;
    const m = T.modal;
    switch (a.dataset.tfAction) {
      case "open-targets": openTargetsModal(a); break;
      case "retry": load(false); break;
      case "pick": T.fc.pick = a.dataset.metric; paint(); break;
      case "edit": {
        const t = T.targets.find(function (x) { return String(x.id) === String(a.dataset.id); });
        if (t && m) { m.editId = t.id; m.confirmId = null; m.error = ""; m.errs = {}; m.form = { metric: t.metric, value: String(t.target_value) }; paintModal(); const v = $("#tf-f-value"); if (v) v.focus(); }
        break;
      }
      case "cancel-edit": if (m) { m.editId = null; m.error = ""; m.errs = {}; m.form = blankForm(); paintModal(); } break;
      case "del": if (m) { m.confirmId = a.dataset.id; paintModal(); } break;
      case "del-no": if (m) { m.confirmId = null; paintModal(); } break;
      case "del-yes": deleteTarget(a.dataset.id); break;
    }
    // these buttons repaint the window, which detaches the clicked element; keep the app's outside-click handler out of it
    if (a.closest("#tf-mbody")) e.stopImmediatePropagation();
  }, true);

  document.addEventListener("input", function (e) {
    const m = T.modal; if (!m) return;
    if (e.target.id === "tf-f-value") m.form.value = e.target.value;
  });
  document.addEventListener("change", function (e) {
    const m = T.modal; if (!m) return;
    if (e.target.id === "tf-f-metric") { m.form.metric = e.target.value; paintModal(); const v = $("#tf-f-value"); if (v) v.focus(); }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "tf-form") return;
    e.preventDefault();
    saveTarget();
  }, true);
})();