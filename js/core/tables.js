/* js/core/tables.js - table columns, row actions, tabs, nav */
"use strict";

  /* =====================================================================
     TABLE COLUMNS (records list)
     Each column is [header, getter, isNumber?, shortenOnScreen?].
     The 4th flag only shortens the text on screen (with the full text in a tooltip);
     the CSV export and the search box still use the full text.
     ===================================================================== */
  // A production quantity with its own unit (Egg, Tray, Crate), e.g. "5 Crate". No unit on file = bare number.
  const prodQty = (v, unit) => fmtInt(v) + (unit ? " " + unit : "");
  /* ---------- Farm Activities: reading the form's fields back out of a saved record ----------
     The activity forms save a quantity plus ONE note line: "<summary> | <free notes>", where the summary is built
     from the form fields (see summary() in schemas.js): "Layer mash: 12 Bag", "5 birds: Disease",
     "Vitamin (5ml), next due 12 Nov 2026" ... The table reads that line back into the form's own columns.
     A record whose note doesn't follow these shapes (made elsewhere) simply shows the whole note in Notes. */
  const ACT_PARSE = {
    FEED_CONSUMPTION: /^(.*?):\s*([\d.,]+)\s*(.*)$/,              // item, quantity, unit
    MORTALITY: /^[\d.,]+\s+birds?:\s*(.*)$/,                      // reason
    MEDICATION: /^(.*?)\s+\((.*?)\)(?:,\s*next due\s+(.*))?$/,   // product, dose, next due
    FLOCK_CHANGE: /^(.*?):\s*([\d.,]+)(?:\s+\((.*)\))?$/,       // change type, quantity, reason
    LOSS: /^(.*?):\s*(.*)$/,                                        // affected item/quantity, reason
    OTHER: /^(.*?)(?::\s*(.*))?$/                                   // type/description, reason
  };
  function actParts(r) {
    const raw = String(r.notes || ""), i = raw.indexOf(" | ");
    const head = i < 0 ? raw : raw.slice(0, i), tail = i < 0 ? "" : raw.slice(i + 3);
    const re = ACT_PARSE[r.code], m = re ? re.exec(head) : null;
    return m ? { f: m.slice(1).map((x) => (x || "").trim()), notes: tail.trim() } : { f: null, notes: raw.trim() };
  }
  const actDash = (v) => (v == null || v === "" ? "—" : v);
  const actPart = (k) => (r) => actDash((actParts(r).f || [])[k]);   // the k-th field of the summary
  const actNotes = (r) => actDash(actParts(r).notes);
  const actUnit = (r) => r.unit || (r.code === "FEED_CONSUMPTION" ? (actParts(r).f || [])[2] || "" : "");
  // The quantity with its unit when there is one, for example "12 Bag". Decimals are kept (2.5 Bag stays 2.5 Bag).
  const actQtyText = (r) => (r.quantity == null ? "—" : fmtQty(r.quantity) + (actUnit(r) ? " " + actUnit(r) : ""));
  const COLS = {
    flock: [["Identifier", (r) => r.identifier], ["Breed/Type", (r) => r.breed], ["Arrival date", (r) => fmtDate(r.arrival_date)], ["Starting count", (r) => fmtInt(r.starting_count), 1], ["Current count", (r) => fmtInt(r.current_count), 1], ["Stage", (r) => r.stage], ["Status", (r) => r.status]],
    // The egg counts are numbers of eggs. The packaging (Loose eggs, Trays, Crates) is shown next to the saleable number.
    production: [["Date", (r) => fmtDate(r.date)], ["Flock", (r) => flockName(r.flock)], ["Collected", (r) => prodQty(r.collected, r.unit_collected), 1], ["Damaged", (r) => prodQty(r.damaged || 0, r.unit_damaged), 1], ["Saleable", (r) => prodQty(r.saleable, r.unit_saleable || r.unit_collected), 1], ["Recorded by", (r) => r.recorded_by]],
    sales: [["Date", (r) => fmtDate(r.date)], ["Customer", (r) => r.customer], ["Product", (r) => r.product], ["Quantity", (r) => unitQty(r), 1], ["Total", (r) => fmtMoney(r.total), 1], ["Outstanding", (r) => fmtMoney(r.outstanding_balance || 0), 1]],
    purchase: [["Date", (r) => fmtDate(r.date)], ["Supplier", (r) => r.supplier], ["Item", (r) => r.item], ["Quantity", (r) => unitQty(r), 1], ["Total cost", (r) => fmtMoney(r.total_cost), 1], ["Outstanding", (r) => fmtMoney(r.outstanding_balance || 0), 1]],
    expense: [["Date", (r) => fmtDate(r.date)], ["Supplier", (r) => r.supplier || "—"], ["Description", (r) => r.description, 0, 1], ["Amount", (r) => fmtMoney(r.amount), 1], ["Outstanding", (r) => fmtMoney(r.outstanding_balance || 0), 1]],
    adjustment: [["Date", (r) => (r.date ? fmtWhen(r.date) : "—")], ["Record", (r) => adjRecordLabel(r), 0, 1], ["Reason", (r) => adjReasonLabel(r.reason)], ["Changed field", (r) => adjFieldsText(r), 0, 1], ["Old → New", (r) => adjChangeText(r), 0, 1], ["User", (r) => r.created_by || "—"], ["Notes", (r) => r.notes || "—", 0, 1]],
    activity: [["Date", (r) => fmtDate(r.date)], ["Type", (r) => r.type], ["Flock", (r) => (r.flock ? flockName(r.flock) : "—")], ["Quantity", actQtyText, 1], ["Details", (r) => actDash(r.notes), 0, 1]],
  };
  // Extra per-row buttons. Kept out of COLS on purpose: COLS values are escaped as text and also
  // feed the CSV export and the search box, so button HTML there would show up as literal text.
  const viewBtn = (action) => (r) => `<button class="btn ghost" type="button" style="padding:4px 10px;font-size:12px" data-action="${action}" data-id="${esc(r.id)}">View</button>`;
  // The pencil opens the "Adjust" form for that record (flocks, sales, purchases and expenses).
  const pencilBtn = (type) => (r) => `<button class="btn ghost" type="button" title="Adjust this record" aria-label="Adjust this record" style="padding:4px 8px;font-size:12px" data-action="adjust-record" data-rtype="${type}" data-id="${esc(r.id)}">${icon("edit", 15)}</button>`;
  const rowBtns = (view, type) => (r) => `<span style="display:inline-flex;gap:6px;align-items:center">${view(r)}${pencilBtn(type)(r)}</span>`;
  const ROW_ACTIONS = {
    flock: rowBtns(viewBtn("view-flock"), "flock"),
    production: rowBtns(viewBtn("view-production"), "production"),
    activity: rowBtns(viewBtn("view-activity"), "activity"),
    sales: rowBtns(viewBtn("view-sale"), "sales"),
    purchase: rowBtns(viewBtn("view-purchase"), "purchase"),
    expense: rowBtns(viewBtn("view-expense"), "expense"),
    adjustment: viewBtn("view-adjustment"),
  };
  const TABS = [["flock", "Flock"], ["production", "Production"], ["sales", "Sales"], ["purchase", "Purchase"], ["expense", "Expense"], ["activity", "Farm activities"]];
  // No "Adjustments" tab on purpose. The farm-wide Adjustment Log will be built with the Reports page (SRS 14.2).
  // The data is still loaded (state.data.adjustment) because the per-record "Adjustment history" in the View windows uses it,
  // and COLS.adjustment / openViewAdjustmentModal are kept so the Reports page can reuse them later.
  // ?type=broilers (or layers / both) previews another farm type without changing the farm.
  const farmType = () => String(params.get("type") || (farm() && farm().farm_type) || "layers").toLowerCase();
  const hasEggs = () => farmType() !== "broilers";
  const visibleTabs = () => TABS.filter(([k]) => k !== "production" || hasEggs());
  const NAV = [["dashboard", "Dashboard"], ["records", "Records"], ["inventory", "Inventory"], ["reports", "Reports"], ["users", "Users & Permissions"]];
  const NAV_ICON = { dashboard: "dashboard", records: "records", inventory: "inventory", reports: "reports", users: "users" };