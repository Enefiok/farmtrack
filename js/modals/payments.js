/* js/modals/payments.js - record payment window */
"use strict";

  /* ---------- Record a later payment (the "Record Payment" button) ---------- */
  function openPaymentModal(id, type, trigger) {
    const kind = PAYMENT_KIND[type];
    const rec = (state.data[type] || []).find((x) => String(x.id) === String(id));
    if (!kind || !rec) return;
    modalTrigger = trigger || document.activeElement;
    const owed = num(rec.outstanding_balance);
    const who = rec.customer || rec.supplier || "";
    const defs = [
      { name: "amount", label: "Amount", type: "number", placeholder: "Enter amount", required: true, min: 0.01, step: "0.01" },
      { name: "date", label: "Date", type: "date", required: true },
      { name: "method", label: "Method", type: "select", placeholder: "Choose a method", required: true, default: "CASH", options: PAYMENT_METHODS },
      { name: "reference", label: "Reference (optional)", type: "text", placeholder: "Receipt or bank reference" },
    ];
    const schema = {
      fields: defs,
      errorMap: { payment_method: "method", event_date: "date" },
      check: (v) => (Math.round(num(v.amount) * 100) > Math.round(owed * 100) ? { amount: `Cannot be more than the amount still owed (${fmtMoney(owed)}).` } : {}),
    };
    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <h2 id="modal-title">Record payment</h2>
          <p class="sub">${esc(who ? who + ": " : "")}${esc(fmtMoney(owed))} still owed. This adds a payment to the original record. It does not create a new one.</p>
          <form id="payment-form" novalidate>
            <div class="form-grid" id="form-grid">${defs.map(fieldHTML).join("")}</div>
            <p class="form-error" id="form-error" role="alert"></p>
            <div class="actions"><button class="btn" id="save-btn" type="submit" data-label="Save payment">Save payment</button></div>
          </form>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const form = $("#payment-form");
    field(form, "date").value = localISO(new Date());
    field(form, "method").value = "CASH";
    const reopen = { sales: openViewSaleModal, purchase: openViewPurchaseModal, expense: openViewExpenseModal }[type];

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      const v = readValues(form, schema);
      defs.forEach((d) => setError(d.name, ""));
      $("#form-error").textContent = "";
      const errs = validate(v, schema);
      const bad = defs.map((d) => d.name).filter((n) => errs[n]);
      if (bad.length) {
        bad.forEach((n) => setError(n, errs[n]));
        const el = $("#f-" + bad[0]); if (el) el.focus();
        return;
      }
      const btn = $("#save-btn"), errEl = $("#form-error");
      saving = true; btn.disabled = true; btn.textContent = "Saving…";
      try {
        await api.recordPayment(type, rec, v);
        closeModal(); toast("Payment recorded successfully."); renderView();
        if (reopen) reopen(rec.id, null); // show the record again, now with the new payment in its history
      } catch (err) {
        let msg = "We couldn't save this payment. Please try again.";
        if (err && err.name === "ApiError") {
          const map = schema.errorMap;
          const entries = Object.entries(err.fields || {}).map(([k, m]) => [map[k] || k, m]);
          const known = entries.filter(([n]) => defs.some((d) => d.name === n));
          const rest = entries.filter((x) => !known.includes(x));
          known.forEach(([n, m]) => setError(n, m));
          msg = rest.length ? rest.map(([n, m]) => `${n}: ${m}`).join(" ") : known.length ? "" : err.message;
        }
        errEl.textContent = msg;
        btn.disabled = false; btn.textContent = btn.dataset.label;
      } finally {
        saving = false;
      }
    });

    const firstEl = $("input:not([readonly]):not([type=date])", form);
    (firstEl || $(".close")).focus();
  }

