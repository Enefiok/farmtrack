/* js/modals/adjustments.js - adjust record + adjustment history */
"use strict";

  /* ---------- Adjustments and corrections (the pencil) ---------- */
  const payBtn = (type, id) => `<button class="btn" type="button" data-action="record-payment" data-rtype="${type}" data-id="${esc(id)}">${icon("plus", 14)}Record Payment</button>`;
  // The "Payment history" block shown in the View window of a sale, purchase or expense
  function paymentHistoryHTML(payments) {
    const rows = (payments || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return `<h3 class="dv-h">Payment history</h3>${rows.length
      ? `<div class="table-wrap mini-lines"><table><thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Reference</th></tr></thead><tbody>${
        rows.map((p) => `<tr><td>${esc(fmtDate(p.date))}</td><td class="num">${esc(fmtMoney(p.amount))}</td><td>${esc(methodLabel(p.method))}</td><td>${esc(p.reference || "")}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="empty-line" style="padding:8px 0 0">No payments recorded yet.</p>`}`;
  }
  const adjustBtn = (type, id) => `<button class="btn ghost" type="button" data-action="adjust-record" data-rtype="${type}" data-id="${esc(id)}">${icon("edit", 15)}Adjust</button>`;

  const ADJUST_REASONS = [["MISTAKE", "Mistake"], ["LOSS", "Loss"], ["DISCREPANCY", "Discrepancy"], ["THEFT", "Theft"], ["OTHER", "Other"]];
  // For each record type: the name the backend knows it by, and the fields a user may correct.
  // key = the field name sent to the backend, ui = where the current value lives on the row in this app,
  // kind = int | decimal | money | text | select
  const ADJUST = {
    flock: { model: "Flock", fields: [
      { key: "current_count", ui: "current_count", label: "Current bird count", kind: "int" },
      { key: "initial_count", ui: "starting_count", label: "Starting bird count", kind: "int" },
      { key: "stage", ui: "stage", label: "Production stage", kind: "select", options: ["Chick", "Grower", "Pullet", "Layer", "Spent hen"] },
      { key: "status", ui: "status", label: "Flock status", kind: "select", options: ["Active", "Sold out", "Closed"] },
    ] },
    purchase: { model: "Purchase", fields: [
      { key: "quantity", ui: "quantity", label: "Quantity", kind: "decimal" },
      { key: "unit_price", ui: "unit_cost", label: "Unit price", kind: "money" },
      { key: "total_amount", ui: "total_cost", label: "Total cost", kind: "money" },
    ] },
    sales: { model: "Sale", fields: [
      { key: "quantity", ui: "quantity", label: "Quantity", kind: "decimal" },
      { key: "unit_price", ui: "price", label: "Unit price", kind: "money" },
      { key: "total_amount", ui: "total", label: "Total sale value", kind: "money" },
    ] },
    production: { model: "Production", fields: [
      { key: "quantity_collected", ui: "collected", label: "Eggs collected", kind: "int" },
      { key: "quantity_damaged", ui: "damaged", label: "Damaged/broken eggs", kind: "int" },
      { key: "quantity_saleable", ui: "saleable", label: "Saleable quantity", kind: "int" },
    ] },
    activity: { model: "FarmActivity", fields: [
      { key: "quantity", ui: "quantity", label: "Quantity", kind: "decimal" },
      { key: "notes", ui: "notes", label: "Notes", kind: "text" },
    ] },
    expense: { model: "Expense", fields: [
      { key: "amount", ui: "amount", label: "Amount", kind: "money" },
      { key: "notes", ui: "description", label: "Notes", kind: "text" },
    ] },
  };
  const adjShow = (sp, v) => {
    if (v == null || v === "") return "—";
    return sp.kind === "money" ? fmtMoney(v) : sp.kind === "int" ? fmtInt(v) : sp.kind === "decimal" ? fmtQty(v) : String(v);
  };
  const adjNew = (sp) => {
    const base = { name: "new_value", label: "New value", required: true };
    if (!sp) return { ...base, type: "text", placeholder: "Choose a field first" };
    if (sp.kind === "select") return { ...base, type: "select", placeholder: "Choose the new value", options: sp.options };
    if (sp.kind === "text") return { ...base, type: "text", placeholder: "Enter the corrected text" };
    return { ...base, type: "number", placeholder: "Enter the corrected value", min: 0, integer: sp.kind === "int", step: sp.kind === "int" ? undefined : "0.01" };
  };

  // ----- Adjustment log helpers -----
  // The server may name the record type "Purchase", "purchase" or "app.purchase"; compare on the last part, lower-cased.
  const adjModelKey = (a) => String(a.target_model || "").split(".").pop().toLowerCase();
  const adjTypeOf = (a) => Object.keys(ADJUST).find((k) => ADJUST[k].model.toLowerCase() === adjModelKey(a));
  const adjFieldSpec = (a, key) => { const t = adjTypeOf(a); return t ? ADJUST[t].fields.find((f) => f.key === key) : null; };
  const adjFieldLabel = (a, key) => (adjFieldSpec(a, key) || {}).label || String(key || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const adjValue = (a, key, v) => { const sp = adjFieldSpec(a, key); return sp ? adjShow(sp, v) : (v == null || v === "" ? "—" : String(v)); };
  const adjReasonLabel = (r) => (ADJUST_REASONS.find((x) => x[0] === String(r).toUpperCase()) || [0, r || "—"])[1];
  const adjFieldsText = (a) => (a.changes.length ? a.changes.map((c) => adjFieldLabel(a, c.field)).join(", ") : "—");
  const adjChangeText = (a) => (a.changes.length ? a.changes.map((c) => `${adjValue(a, c.field, c.old_value)} → ${adjValue(a, c.field, c.new_value)}`).join("; ") : "—");
  function adjRecordLabel(a) {
    const t = adjTypeOf(a);
    const rec = t && (state.data[t] || []).find((x) => String(x.id) === String(a.target_id));
    if (t === "flock" && rec && rec.identifier) return `Flock: ${rec.identifier}`;
    return `${a.target_model ? a.target_model.split(".").pop() : "Record"} #${a.target_id ?? "?"}`;
  }

  // The "Adjustment history" block shown at the bottom of a record's View window
  function adjHistoryHTML(type, id) {
    const spec = ADJUST[type];
    if (!spec) return "";
    const rows = (state.data.adjustment || [])
      .filter((a) => adjModelKey(a) === spec.model.toLowerCase() && String(a.target_id) === String(id))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const sentence = (a) => {
      const what = a.changes.length
        ? a.changes.map((c) => `${adjFieldLabel(a, c.field)} from ${adjValue(a, c.field, c.old_value)} to ${adjValue(a, c.field, c.new_value)}`).join(" and ")
        : "this record";
      const why = adjReasonLabel(a.reason) + (a.notes ? ` (${a.notes})` : "");
      return `On ${a.date ? fmtWhen(a.date) : "an earlier date"}, <b>${esc(a.created_by || "someone")}</b> changed ${esc(what)} because: ${esc(why)}.`;
    };
    return `<h3 class="dv-h">Adjustment history</h3>${rows.length
      ? `<ul class="adj-list">${rows.map((a) => `<li>${sentence(a)}</li>`).join("")}</ul>`
      : `<p class="empty-line" style="padding:8px 0 0">No adjustments have been made to this record.</p>`}`;
  }

  // Read-only details for one row of the Adjustments log. No "Adjust" button here
  // (the adjust argument of openDetailModal is left out on purpose).
  function openViewAdjustmentModal(id, trigger) {
    const r = state.data.adjustment.find((x) => String(x.id) === String(id));
    if (!r) return;
    const changeRows = r.changes.flatMap((c) => {
      const sp = adjFieldSpec(r, c.field);
      const oldV = adjValue(r, c.field, c.old_value);
      const newV = adjValue(r, c.field, c.new_value);
      // Text values (for example an expense note) can be long, so they take the full width and wrap.
      const long = (!!sp && sp.kind === "text") || oldV.length > 40 || newV.length > 40;
      return [
        ["Changed field", adjFieldLabel(r, c.field)],
        ["Old value", oldV, long],
        ["New value", newV, long],
      ];
    });
    openDetailModal("Adjustment details", `${adjRecordLabel(r)}: complete record of this correction`, [
      ["Date", r.date ? fmtWhen(r.date) : "—"],
      ["User", r.created_by || "—"],
      ...changeRows,
      ["Notes", r.notes || "—", true],
    ], null, trigger, null, {
      stats: [
        ["Record", adjRecordLabel(r), "records", "neutral"],
        ["Reason", adjReasonLabel(r.reason), "alert", "amber"],
      ],
    });
  }

  function openAdjustModal(type, id, trigger) {
    const spec = ADJUST[type];
    const rec = (state.data[type] || []).find((x) => String(x.id) === String(id));
    if (!spec || !rec) return;
    modalTrigger = trigger || document.activeElement;

    const reasonF = { name: "reason", label: "Reason", type: "select", placeholder: "Choose a reason", required: true, options: ADJUST_REASONS };
    const fieldF = { name: "field", label: "Field to adjust", type: "select", placeholder: "Choose what to correct", required: true, options: spec.fields.map((f) => [f.key, f.label]) };
    const currentF = { name: "current", label: "Current value", type: "readonly", value: () => "" };
    const notesF = { name: "notes", label: "Notes", type: "textarea", placeholder: "Explain what went wrong and why you are correcting it", required: true };

    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <h2 id="modal-title">Adjust record</h2>
          <p class="sub">Correct one value on this ${esc(spec.model.toLowerCase())}. The change is recorded with your reason.</p>
          <form id="adjust-form" novalidate>
            <div class="form-grid" id="form-grid">
              ${fieldHTML(reasonF)}${fieldHTML(fieldF)}${fieldHTML(currentF)}${fieldHTML(adjNew(null))}
              ${fieldHTML(notesF).replace('class="field"', 'class="field" style="grid-column:1/-1"')}
            </div>
            <p class="form-error" id="form-error" role="alert"></p>
            <div class="actions"><button class="btn" id="save-btn" type="submit" data-label="Save adjustment">Save adjustment</button></div>
          </form>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const form = $("#adjust-form");
    const val = (n) => String(field(form, n).value).trim();
    const picked = () => spec.fields.find((f) => f.key === val("field"));
    const oldOf = (sp) => rec[sp.ui];

    form.addEventListener("change", (e) => {
      if (e.target.id !== "f-field") return;
      const sp = picked();
      field(form, "current").value = sp ? adjShow(sp, oldOf(sp)) : "";
      $('[data-name="new_value"]', form).outerHTML = fieldHTML(adjNew(sp)); // new box of the right kind
      setError("new_value", "");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      const sp = picked();
      const defs = [reasonF, fieldF, adjNew(sp), notesF];
      const raw = val("new_value");
      const v = { reason: val("reason"), field: val("field"), notes: val("notes"),
        new_value: sp && ["int", "decimal", "money"].includes(sp.kind) && raw !== "" ? Number(raw) : raw };
      defs.forEach((d) => setError(d.name, ""));
      $("#form-error").textContent = "";
      const errs = validate(v, { fields: defs });
      if (!errs.new_value && sp) {
        const same = typeof v.new_value === "number" ? v.new_value === num(oldOf(sp)) : String(v.new_value) === String(oldOf(sp) ?? "");
        if (same) errs.new_value = "The new value is the same as the current value.";
      }
      const bad = defs.map((d) => d.name).filter((n) => errs[n]);
      if (bad.length) {
        bad.forEach((n) => setError(n, errs[n]));
        const el = $("#f-" + bad[0]); if (el) el.focus();
        return;
      }
      const payload = {
        target_model: spec.model, target_id: rec.id, reason: v.reason, notes: v.notes,
        changes: [{ field: sp.key, old_value: sp.kind === "text" || sp.kind === "select" ? (oldOf(sp) ?? "") : num(oldOf(sp)), new_value: v.new_value }],
      };
      const btn = $("#save-btn"), errEl = $("#form-error");
      saving = true; btn.disabled = true; btn.textContent = "Saving…";
      try {
        await api.adjust(rec, sp, payload);
        closeModal(); toast("Adjustment saved."); renderView();
      } catch (err) {
        let msg = "We couldn't save this adjustment. Please try again.";
        if (err && err.name === "ApiError") {
          const entries = Object.entries(err.fields || {});
          const known = entries.filter(([n]) => n === "reason" || n === "notes");
          known.forEach(([n, m]) => setError(n, m));
          const rest = entries.filter((x) => !known.includes(x));
          msg = rest.length ? rest.map(([n, m]) => `${n}: ${m}`).join(" ") : known.length ? "" : err.message;
        }
        errEl.textContent = msg;
        btn.disabled = false; btn.textContent = btn.dataset.label;
      } finally {
        saving = false;
      }
    });

    const firstEl = $("select", form);
    (firstEl || $(".close")).focus();
  }

