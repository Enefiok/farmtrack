/* js/modals/details.js - read-only View windows */
"use strict";

  /* ---------- Read-only record details (one layout shared by every View window) ---------- */
  const fmtQty = (n) => new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: 2 }).format(n);

  // Read-only data is shown as plain text (label above value), not as greyed-out input boxes.
  // rows: [[label, value, long?]]. "long" items take the full width and wrap (notes, long old/new values).
  // lines (optional): [{ name, quantity, unit, unit_price, total }]
  // adjust (optional): { type, id, extra? } adds the "Adjustment history" block and the Adjust button.
  //   "extra" is optional button HTML shown before the Adjust button (for example "Sell Birds" on a flock).
  // summary (optional): { badge: [text, tone], stats: [[label, value], ...] } is a headline strip at the top.
  // pay (optional): { type, id, payments, outstanding } adds the "Payment history" block and the "Record Payment" button.
  function openDetailModal(title, sub, rows, lines, trigger, adjust, summary, pay) {
    modalTrigger = trigger || document.activeElement;
    const hasVal = (v) => v != null && v !== "" && v !== "—";
    // "Created By" and "Created At" become one small line at the bottom instead of two full items.
    const meta = {};
    const main = rows.filter(([label, value]) => {
      if (label === "Created By" || label === "Created At") { meta[label] = value; return false; }
      return true;
    });
    const items = main
      .filter(([label, value, long]) => !(long && !hasVal(value) && (label === "Notes" || label === "Details")))
      .map(([label, value, long]) => {
        const has = hasVal(value);
        // Long text (notes, details) is cut to a few lines, with a "Show more" button.
        const clamp = long && has && (String(value).length > 140 || String(value).split("\n").length > 3);
        return `<div class="dv-item${long ? " dv-long" : ""}"><dt>${esc(label)}</dt><dd class="${has ? "" : "dv-empty"}${clamp ? " dv-clamp" : ""}">${esc(has ? value : "—")}</dd>${clamp ? `<button type="button" class="link-btn dv-more" data-action="toggle-note" aria-expanded="false">Show more</button>` : ""}</div>`;
      })
      .join("");
    const badge = summary && summary.badge ? `<span class="dv-badge ${esc(summary.badge[1] || "")}">${esc(summary.badge[0])}</span>` : "";
    // Each KPI card is [label, value, iconName, tone]. Tones: green | amber | red | neutral.
    const stats = summary && summary.stats ? summary.stats.map(([l, v, ic, tone]) => `<div class="dv-stat ${esc(tone || "neutral")}"><div class="dv-st"><small>${esc(l)}</small><b>${esc(v)}</b></div></div>`).join("") : "";
    const strip = stats ? `<div class="dv-stats">${stats}</div>` : "";
    const by = hasVal(meta["Created By"]) ? meta["Created By"] : "";
    const at = hasVal(meta["Created At"]) ? meta["Created At"] : "";
    const footer = by || at ? `<p class="dv-meta">Created${by ? " by " + esc(by) : ""}${at ? " · " + esc(at) : ""}</p>` : "";
    // The quantity is shown with its unit next to it, for example "67 Crate".
    const linesHTML = lines ? `<h3 class="dv-h">Items</h3>
      <div class="table-wrap mini-lines"><table><thead><tr><th>Item</th><th class="num">Quantity</th><th class="num">Unit price</th><th class="num">Total</th></tr></thead><tbody>${
        lines.length
          ? lines.map((l) => `<tr><td>${esc(l.name || "—")}</td><td class="num">${esc(fmtQty(l.quantity) + (l.unit ? " " + l.unit : ""))}</td><td class="num">${esc(fmtMoney(l.unit_price))}</td><td class="num">${esc(fmtMoney(l.total))}</td></tr>`).join("")
          : `<tr><td colspan="4">No items recorded.</td></tr>`}</tbody></table></div>` : "";
    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <div class="dv-head"><h2 id="modal-title">${esc(title)}</h2>${badge}</div>
          <p class="sub">${esc(sub)}</p>
          ${strip}
          ${items ? `<h3 class="dv-h">Details</h3><dl class="dv-grid">${items}</dl>` : ""}
          ${linesHTML}${pay ? paymentHistoryHTML(pay.payments) : ""}${adjust ? adjHistoryHTML(adjust.type, adjust.id) : ""}
          ${footer}
          <div class="actions" style="margin-top:24px">${pay && pay.outstanding > 0 ? payBtn(pay.type, pay.id) : ""}${adjust && adjust.extra ? adjust.extra : ""}${adjust ? adjustBtn(adjust.type, adjust.id) : ""}<button class="btn" type="button" data-close>Close</button></div>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const closeBtn = $(".actions [data-close]");
    if (closeBtn) closeBtn.focus();
  }

  const itemNameOf = (l) => l.item_name || (state.lookups.items.find((i) => String(i.id) === String(l.item)) || {}).name || "";
  const createdRows = (r) => [["Created By", r.created_by || "—"], ["Created At", r.created_at ? fmtWhen(r.created_at) : "—"]];

  function openViewFlockModal(flockId, trigger) {
    const f = state.data.flock.find((x) => String(x.id) === String(flockId));
    if (!f) return;
    // The "Sell Birds" button only appears while the flock still has birds to sell.
    const sellBtn = num(f.current_count) > 0
      ? `<button class="btn" type="button" data-action="sell-flock" data-id="${esc(f.id)}">${icon("wallet", 15)}Sell Birds</button>`
      : "";
    openDetailModal("Flock details", `${f.identifier}: complete record for this flock`, [
      ["Flock Identifier", f.identifier],
      ["Breed/Type", f.breed || "—"],
      ["Production Stage", f.stage || "—"],
      ["Arrival Date", fmtDate(f.arrival_date)],
      ["Age at Arrival", f.age_at_arrival != null && f.age_at_arrival !== "" ? f.age_at_arrival : "—"],
      ...createdRows(f),
    ], null, trigger, { type: "flock", id: f.id, extra: sellBtn }, {
      badge: f.status ? [f.status, String(f.status).toLowerCase() === "active" ? "ok" : ""] : null,
      stats: [
        ["Current birds", fmtInt(f.current_count), "bird", "green"],
        ["Starting birds", fmtInt(f.starting_count), "inventory", "neutral"],
        ["Mortality", num(f.mortality_rate).toFixed(1) + "%", "alert", num(f.mortality_rate) > 0 ? "red" : "green"],
      ],
    });
  }

  // Opens the Sales form pre-filled for selling birds from one flock.
  // On save, the sale is posted to the sales endpoint with the flock id inside the sale line.
  function openSellFlockModal(flockId, trigger) {
    const f = findFlock(flockId);
    if (!f) return;
    if (num(f.current_count) <= 0) { toast("This flock has no birds left to sell."); return; }
    sellFlock = f;
    // Default the item to "Spent hen" or "Bird" when the farm has one; otherwise the first bird item.
    const choices = birdItems();
    const item = choices.find((i) => /spent hen|bird/i.test(i.name)) || choices[0];
    openModal("sellbirds", trigger, {
      title: `Sell Birds from ${f.identifier}`,
      extra: { flock: f.id },
      defaults: { quantity: f.current_count, unit: "Bird", product: item ? item.id : "" },
    });
  }

  function openViewProductionModal(id, trigger) {
    const r = state.data.production.find((x) => String(x.id) === String(id));
    if (!r) return;
    openDetailModal("Production details", `${flockName(r.flock)}: complete record for this egg collection`, [
      ["Egg Collection Date", fmtDate(r.date)],
      ["Flock", flockName(r.flock)],
      ["Packaging/Unit", r.packaging || "—"],
      ["Recorded by", r.recorded_by || "—"],
      ["Created At", r.created_at ? fmtWhen(r.created_at) : "—"],
      ["Notes", r.notes || "—", true],
    ], null, trigger, { type: "production", id: r.id }, {
      stats: [
        ["Collected", fmtInt(r.collected), "egg", "green"],
        ["Damaged", fmtInt(r.damaged || 0), "alert", num(r.damaged) > 0 ? "amber" : "neutral"],
        ["Saleable", fmtInt(r.saleable), "check", "green"],
      ],
    });
  }

  function openViewActivityModal(id, trigger) {
    const r = state.data.activity.find((x) => String(x.id) === String(id));
    if (!r) return;
    openDetailModal("Activity details", `${r.type || "Farm activity"}: complete record`, [
      ["Date", fmtDate(r.date)],
      ["Type", r.type || "—"],
      ["Flock", r.flock ? flockName(r.flock) : "—"],
      ...(r.quantity != null && r.quantity !== "" ? [["Quantity", fmtQty(r.quantity)]] : []),
      ...createdRows(r),
      ["Details", r.details || "—", true],
    ], null, trigger, { type: "activity", id: r.id });
  }

  function openViewPurchaseModal(id, trigger) {
    const r = state.data.purchase.find((x) => String(x.id) === String(id));
    if (!r) return;
    // Records without lines (demo data) show one line built from the row itself
    const lines = (Array.isArray(r.lines) && r.lines.length ? r.lines : [{ item_name: r.item, quantity: r.quantity, unit: r.unit, unit_price: r.unit_cost, total: r.total_cost }])
      .map((l) => ({ name: itemNameOf(l), quantity: l.quantity, unit: l.unit || "", unit_price: l.unit_price, total: l.total }));
    openDetailModal("Purchase details", `${r.supplier || "Purchase"}: complete record for this purchase`, [
      ["Supplier", r.supplier || "—"],
      ["Date", fmtDate(r.date)],
      ...createdRows(r),
      ["Notes", r.notes || "—", true],
    ], lines, trigger, { type: "purchase", id: r.id }, {
      // Receipt status badge. Only shown when the server sends a status.
      badge: r.status ? [String(r.status).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), /received/i.test(r.status) ? "ok" : "warn"] : null,
      stats: [
        ["Total cost", fmtMoney(r.total_cost), "wallet", "amber"],
        ["Amount paid", fmtMoney(r.amount_paid || 0), "check", "green"],
        ["Outstanding", fmtMoney(r.outstanding_balance || 0), "alert", owedTone(r.outstanding_balance)],
      ],
    }, { type: "purchase", id: r.id, payments: r.payments || [], outstanding: num(r.outstanding_balance) });
  }

  function openViewSaleModal(id, trigger) {
    const r = state.data.sales.find((x) => String(x.id) === String(id));
    if (!r) return;
    const lines = (Array.isArray(r.lines) && r.lines.length ? r.lines : [{ item_name: r.product, quantity: r.quantity, unit: r.unit, unit_price: r.price, total: r.total }])
      .map((l) => ({ name: itemNameOf(l), quantity: l.quantity, unit: l.unit || "", unit_price: l.unit_price, total: l.total }));
    openDetailModal("Sale details", `${r.customer || "Sale"}: complete record for this sale`, [
      ["Customer", r.customer || "—"],
      ["Date", fmtDate(r.date)],
      ["Discount", discountText(r)],
      ...createdRows(r),
      ["Notes", r.notes || "—", true],
    ], lines, trigger, { type: "sales", id: r.id }, {
      stats: [
        ["Total sale value", fmtMoney(r.total), "trend", "green"],
        ["Amount paid", fmtMoney(r.amount_paid || 0), "check", "green"],
        ["Outstanding", fmtMoney(r.outstanding_balance || 0), "alert", owedTone(r.outstanding_balance)],
      ],
    }, { type: "sales", id: r.id, payments: r.payments || [], outstanding: num(r.outstanding_balance) });
  }

  function openViewExpenseModal(id, trigger) {
    const r = state.data.expense.find((x) => String(x.id) === String(id));
    if (!r) return;
    openDetailModal("Expense details", "Complete record for this expense", [
      ["Supplier", r.supplier || "—"],
      ["Category", r.category || "—"],
      ["Date", fmtDate(r.date)],
      ...createdRows(r),
      ["Notes", r.description || "—", true],
    ], null, trigger, { type: "expense", id: r.id }, {
      stats: [
        ["Amount", fmtMoney(r.amount), "wallet", "amber"],
        ["Amount paid", fmtMoney(r.amount_paid || 0), "check", "green"],
        ["Outstanding", fmtMoney(r.outstanding_balance || 0), "alert", owedTone(r.outstanding_balance)],
      ],
    }, { type: "expense", id: r.id, payments: r.payments || [], outstanding: num(r.outstanding_balance) });
  }

