/* js/modals/forms.js - form engine, openModal, validate, save */
"use strict";

  /* =====================================================================
     MODAL FORMS
     ===================================================================== */
  let modalTrigger = null, saving = false;

  // Looks a form control up by its name. Do not use form.elements[name] for this: that collection has its own
  // methods (item, namedItem, length), so a field called "item" would return the item() function instead
  // of the input, and its value would be read as "undefined".
  function field(form, name) { return form.elements.namedItem(name); }

  function optsOf(f) { return typeof f.options === "function" ? f.options() : f.options || []; }

  // The input itself (no label and no error line), so it can also be reused inside a grouped row.
  function controlHTML(f) {
    const id = "f-" + f.name;
    if (f.type === "select") {
      const opts = optsOf(f);
      const ph = opts.length ? f.placeholder : f.emptyText || "No options";
      return `<div class="control select"><select id="${id}" name="${f.name}" ${opts.length ? "" : "disabled"}><option value="" selected disabled hidden>${esc(ph)}</option>${opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}">${esc(l)}</option>`; }).join("")}</select>${icon("chevronDown", 18)}</div>`;
    }
    if (f.type === "date") return `<div class="control date"><input id="${id}" name="${f.name}" type="date">${icon("calendar", 18)}</div>`;
    if (f.type === "textarea") return `<div class="control${f.short ? " short" : ""}"><textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || "")}"></textarea></div>`;
    if (f.type === "computed") return `<div class="control"><input id="${id}" name="${f.name}" class="ro" readonly tabindex="-1" aria-readonly="true"></div>`;
    if (f.type === "readonly") return `<div class="control"><input id="${id}" name="${f.name}" class="ro" readonly tabindex="-1" value="${esc(f.value ? f.value() : "")}"></div>`;
    const sugg = typeof f.suggest === "function" ? f.suggest() : f.suggest;
    const list = sugg ? `list="dl-${f.name}"` : "";
    const dl = sugg ? `<datalist id="dl-${f.name}">${sugg.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>` : "";
    return `<div class="control"><input id="${id}" name="${f.name}" type="${f.type}" ${list} ${f.type === "number" ? `inputmode="decimal" min="${f.min ?? ""}" step="${f.step || (f.integer ? 1 : "any")}"` : ""} placeholder="${esc(f.placeholder || "")}" autocomplete="off">${dl}</div>`;
  }

  function fieldHTML(f) {
    const r = f.reveal;
    const reveal = r ? `<div class="reveal" id="r-${r.name}" hidden><div class="field"><label for="f-${r.name}">${esc(r.label)}</label><div class="control"><input id="f-${r.name}" name="${r.name}" type="number" inputmode="numeric" min="${r.min}" step="1" placeholder="${esc(r.placeholder)}"></div><p class="error" id="e-${r.name}" role="alert"></p></div></div>` : "";
    return `<div class="field" data-name="${f.name}"><label for="f-${f.name}">${esc(f.label)}</label>${controlHTML(f)}<p class="error" id="e-${f.name}" role="alert"></p>${reveal}</div>`;
  }

  // Quantity and Unit in one row: [ 10 ] [ Crate v ]. They stay two separate controls named
  // "quantity" and "unit", so readValues, validation and the payload are unchanged.
  function qtyUnitHTML(q, u) {
    return `<div class="field qty-unit" data-name="${q.name}"><label for="f-${q.name}">${esc(q.label)}</label><div class="qty-row input-group">${controlHTML(q)}${controlHTML(u)}</div><p class="error" id="e-${q.name}" role="alert"></p><p class="error" id="e-${u.name}" role="alert"></p></div>`;
  }

  // All fields of a schema as HTML. A field with joinUnit swallows the unit field it points to.
  function fieldsHTML(s) {
    const joined = new Set(s.fields.filter((f) => f.joinUnit).map((f) => f.joinUnit));
    return s.fields.filter((f) => !joined.has(f.name)).map((f) => {
      const u = f.joinUnit && s.fields.find((x) => x.name === f.joinUnit);
      return u ? qtyUnitHTML(f, u) : fieldHTML(f);
    }).join("");
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

  /* ---------- Step 1 of "Create farm": choose the farm type ---------- */
  function openFarmTypeStep(trigger) {
    modalTrigger = trigger || document.activeElement;
    const origin = modalTrigger;
    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <h2 id="modal-title">What do you farm?</h2>
          <p class="sub">Choose your farm type. We set up your records to match it.</p>
          <div class="control type-search"><input id="type-search" type="search" placeholder="Search farm types, for example poultry or cocoa" aria-label="Search farm types" autocomplete="off"></div>
          <div id="type-list"></div>
          <p class="type-note" id="type-note" role="status" hidden></p>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const listEl = $("#type-list"), noteEl = $("#type-note"), search = $("#type-search");
    let picked = "";
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const hits = FARM_CATALOG.filter((t) => !q || `${t.title} ${t.group} ${t.keywords}`.toLowerCase().includes(q));
      if (!hits.length) { listEl.innerHTML = `<div class="empty-line">No farm type matches "${esc(search.value.trim())}". More types are on the way.</div>`; return; }
      const groups = [...new Set(hits.map((t) => t.group))];
      listEl.innerHTML = groups.map((g) => `<p class="type-group">${esc(g)}</p><div class="type-cards">${hits.filter((t) => t.group === g).map((t) =>
        `<button type="button" class="type-card${t.ready ? "" : " soon"}${t.value === picked ? " on" : ""}" data-type="${esc(t.value)}"><b>${esc(t.title)}</b><small>${esc(t.desc)}</small><span class="type-badge">${t.ready ? "Available now" : "Coming soon"}</span></button>`).join("")}</div>`).join("");
    };
    draw();
    search.addEventListener("input", draw);
    listEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-type]");
      const t = b && FARM_CATALOG.find((x) => x.value === b.dataset.type);
      if (!t) return;
      if (t.ready) { openModal("farm", origin, { farm_type: t.value, farm_type_label: t.title }); return; }
      picked = t.value;
      draw();
      const again = $(`[data-type="${t.value}"]`, listEl);
      if (again) again.focus();
      noteEl.textContent = `${t.title} is coming soon. AgroFlow starts with egg production farms, so choose Egg production to get set up today. We will open ${t.title.toLowerCase()} in a future update.`;
      noteEl.hidden = false;
    });
    search.focus();
  }

  /* ---------- Unit dropdown that follows the chosen item ---------- */
  // On the Sales, Purchase, Sell Birds and Feed forms, the Unit dropdown offers only the chosen item's
  // base unit plus the units that have a conversion for it. A schema opts in with:
  //   unitFor: { item: <name of the item control>, unit: <name of the unit select>, byName?: true }
  // byName is for a text box (the feed item), where the typed name is matched against the item names.
  const unitCache = new Map();           // "farmId:itemId" -> list of unit names
  function clearUnitCache() { unitCache.clear(); }
  const unitSeqs = new Map();            // unit select name -> latest request number (ignores stale answers)

  // Finds the item the user picked: by id for a dropdown, by name for a text box.
  function lookupItem(ref, byName) {
    const items = (state.lookups && state.lookups.items) || [];
    if (byName) {
      const q = String(ref || "").trim().toLowerCase();
      return q ? items.find((i) => String(i.name).trim().toLowerCase() === q) || null : null;
    }
    return items.find((i) => String(i.id) === String(ref)) || null;
  }

  // The unit names allowed for an item: its base unit first, then every unit with a conversion.
  async function unitsForItem(item) {
    const key = state.farmId + ":" + item.id;
    if (unitCache.has(key)) return unitCache.get(key);
    const names = [];
    const add = (n) => { n = String(n || "").trim(); if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n); };
    const inv = findItem(item.id) || {};
    const baseId = item.base_unit != null ? item.base_unit : inv.base_unit;
    const unitRow = ((state.inventory && state.inventory.units) || []).find((u) => String(u.id) === String(baseId)) || {};
    add(item.base_unit_name || inv.base_unit_name || unitRow.name);
    const convs = DEV ? ((state.inventory.devConv || {})[`dev-conv-${item.id}`] || []) : await AgroAPI.listConversions(state.farmId, item.id);
    convs.forEach((c) => add(c.unit_name));
    unitCache.set(key, names);
    return names;
  }

  // Rebuilds the Unit options. keep = the unit that was selected before (kept when still allowed).
  function setUnitOptions(sel, opts, placeholder, keep) {
    const key = opts.map((o) => o[0]).join("|") + "#" + placeholder;
    if (sel.dataset.unitKey === key) return; // same choices as before: leave the selection alone
    sel.dataset.unitKey = key;
    const wanted = keep !== undefined ? keep : sel.value;
    sel.innerHTML = `<option value="" selected disabled hidden>${esc(placeholder || "Select unit")}</option>` + opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    sel.disabled = !opts.length;
    if (wanted && opts.some(([v]) => v === wanted)) sel.value = wanted;
    else if (opts.length === 1) sel.value = opts[0][0]; // only one choice, so pick it
  }

  async function syncUnits(form, s) {
    const cfgs = [].concat(s.unitFor || []);
    await Promise.all(cfgs.map((cfg) => syncOneUnit(form, s, cfg)));
  }

  async function syncOneUnit(form, s, cfg) {
    const sel = field(form, cfg.unit), src = field(form, cfg.item), uf = fieldOf(s, cfg.unit);
    if (!sel || !src || !uf) return;
    const seq = (unitSeqs.get(cfg.unit) || 0) + 1;
    unitSeqs.set(cfg.unit, seq);
    const all = optsOf(uf).map((o) => (Array.isArray(o) ? o : [o, o]));
    const item = lookupItem(src.value, cfg.byName);
    if (!item) {
      // A typed feed name that is not an inventory item keeps the full list; dropdowns wait for an item.
      if (cfg.byName) setUnitOptions(sel, all, uf.placeholder);
      else setUnitOptions(sel, [], "Select an item first");
      return;
    }
    const keep = sel.value;
    let names = null;
    try { names = await unitsForItem(item); } catch { /* fall back to the full list below */ }
    if (seq !== unitSeqs.get(cfg.unit)) return; // the user picked another item while this was loading
    setUnitOptions(sel, names && names.length ? names.map((n) => [n, n]) : all, uf.placeholder, keep);
    setError(cfg.unit, "");
  }

  // preset (optional):
  //   { farm_type, farm_type_label } chosen in step 1 of "Create farm"
  //   { title, extra, defaults } used by "Sell Birds": a custom title, values merged into what is saved
  //   (extra), and values filled into the form when it opens (defaults)
  function openModal(type, trigger, preset) {
    const base = SCHEMAS[type];
    let tabKey = base.tabs ? base.tabs[0].key : null;
    const cur = () => effective(base, tabKey);
    modalTrigger = trigger || document.activeElement;

    const tabsHTML = base.tabs ? `<div class="modal-tabs" id="modal-tabs"><div class="tabs" role="tablist" aria-label="Activity type">${base.tabs.map((t) => `<button type="button" class="tab" role="tab" data-mtab="${t.key}" aria-selected="${t.key === tabKey}">${esc(t.label)}</button>`).join("")}</div></div>` : "";
    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal${base.centered ? " center" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <h2 id="modal-title">${esc((preset && preset.title) || base.title)}</h2><p class="sub">${esc(base.sub)}</p>
          ${preset && preset.farm_type_label ? `<p class="type-chip">Farm type: <b>${esc(preset.farm_type_label)}</b><button type="button" class="link-btn" data-change-type>Change</button></p>` : ""}
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
    const origin = modalTrigger;
    const changeBtn = $("[data-change-type]");
    if (changeBtn) changeBtn.addEventListener("click", () => openFarmTypeStep(origin)); // back to step 1

    function mountFields(keepDate) {
      const s = cur();
      // fieldsHTML draws a Quantity field and its Unit field as one row where the schema asks for it (joinUnit)
      $("#form-grid").innerHTML = fieldsHTML(s);
      const today = localISO(new Date());
      $$('input[type="date"]', form).forEach((i) => {
        const def = fieldOf(s, i.name);
        i.value = keepDate !== undefined && i.name === "date" ? keepDate : def && def.noDefault ? "" : today;
      });
      allFields(s).forEach((f) => { if (f.default && field(form, f.name)) field(form, f.name).value = f.default; });
      $("#form-error").textContent = "";
      refreshComputed(form, s);
    }
    mountFields();
    if (base.rowFields) mountRows(base.rowFields); // "Add existing birds": one or more flock rows

    // "Sell Birds": fill in the starting values (quantity, unit, item) and recalculate the totals
    if (preset && preset.defaults) {
      Object.entries(preset.defaults).forEach(([n, val]) => {
        const el = field(form, n);
        if (el && val != null && val !== "") el.value = val;
      });
      refreshComputed(form, cur());
    }

    // Set the first Unit choices once the starting values are in. A preset unit (Sell Birds) is kept when the item allows it.
    syncUnits(form, cur());

    form.addEventListener("input", () => refreshComputed(form, cur()));
    form.addEventListener("change", () => refreshComputed(form, cur()));
    // The item changed: refresh the Unit choices. Sales and Purchase use a dropdown (change event);
    // the feed form is a text box, so it also reacts while the user types or picks a suggestion.
    const watches = (name, byNameOnly) => [].concat(cur().unitFor || []).some((u) => u.item === name && (!byNameOnly || u.byName));
    const onItemEvent = (e) => { if (watches(e.target.name)) syncUnits(form, cur()); };
    form.addEventListener("change", onItemEvent);
    form.addEventListener("input", (e) => { if (watches(e.target.name, true)) onItemEvent(e); });
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
      const clean = { ...res.clean, ...(preset && preset.farm_type ? { farm_type: preset.farm_type } : {}), ...(preset && preset.extra ? preset.extra : {}), ...(rr ? { rows: rr.rows } : {}) };
      save(type, clean, s, $("#save-btn"), $("#form-error"));
    });

    if (tabsEl) {
      tabsEl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-mtab]");
        if (!b || b.dataset.mtab === tabKey) return;
        const date = field(form, "date") ? field(form, "date").value : undefined;
        tabKey = b.dataset.mtab;
        $$("[data-mtab]", tabsEl).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        mountFields(date);
        syncUnits(form, cur()); // the new tab may have its own Unit rules (Feed consumption)
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
    sellFlock = null; // the Sell Birds window is closed, so forget which flock it was for
    if (modalTrigger && document.contains(modalTrigger)) modalTrigger.focus();
    modalTrigger = null;
  }

  function readValues(form, s) {
    const v = {};
    allFields(s).forEach((f) => {
      const el = field(form, f.name);
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
      if (f.type === "computed" && field(form, f.name)) field(form, f.name).value = f.fmt(calc[f.name] ?? 0);
      if (f.reveal) $("#r-" + f.reveal.name).hidden = !f.reveal.when(v);
    });
  }

  // Shows or clears the error under a field. A Quantity + Unit row has two error lines in one .field,
  // so the field stays red while either of them has text.
  function setError(name, msg) {
    const p = $("#e-" + name);
    if (p) p.textContent = msg || "";
    const box = p && p.closest(".field");
    if (box) box.classList.toggle("invalid", [...box.querySelectorAll(":scope > .error")].some((el) => el.textContent));
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
        // "Sell Birds" is a normal sale (with the flock id on the line), so it goes to the sales endpoint.
        // api.create reloads every list afterwards, so the flock's new count and any "Sold out" status show at once.
        await api.create(type === "sellbirds" ? "sales" : type, payload);
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