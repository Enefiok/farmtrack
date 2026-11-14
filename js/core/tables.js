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
  const COLS = {
    flock: [["Identifier", (r) => r.identifier], ["Breed/Type", (r) => r.breed], ["Arrival date", (r) => fmtDate(r.arrival_date)], ["Starting count", (r) => fmtInt(r.starting_count), 1], ["Current count", (r) => fmtInt(r.current_count), 1], ["Stage", (r) => r.stage], ["Status", (r) => r.status]],
    // The egg counts are numbers of eggs. The packaging (Loose eggs, Trays, Crates) is shown next to the saleable number.
    production: [["Date", (r) => fmtDate(r.date)], ["Flock", (r) => flockName(r.flock)], ["Collected", (r) => prodQty(r.collected, r.unit_collected), 1], ["Damaged", (r) => prodQty(r.damaged || 0, r.unit_damaged), 1], ["Saleable", (r) => prodQty(r.saleable, r.unit_saleable || r.unit_collected), 1], ["Recorded by", (r) => r.recorded_by]],
    sales: [["Date", (r) => fmtDate(r.date)], ["Customer", (r) => r.customer], ["Product", (r) => r.product], ["Quantity", (r) => unitQty(r), 1], ["Total", (r) => fmtMoney(r.total), 1], ["Outstanding", (r) => fmtMoney(r.outstanding_balance || 0), 1]],
    purchase: [["Date", (r) => fmtDate(r.date)], ["Supplier", (r) => r.supplier], ["Item", (r) => r.item], ["Quantity", (r) => unitQty(r), 1], ["Total cost", (r) => fmtMoney(r.total_cost), 1], ["Outstanding", (r) => fmtMoney(r.outstanding_balance || 0), 1]],
    expense: [["Date", (r) => fmtDate(r.date)], ["Supplier", (r) => r.supplier || "—"], ["Description", (r) => r.description, 0, 1], ["Amount", (r) => fmtMoney(r.amount), 1], ["Outstanding", (r) => fmtMoney(r.outstanding_balance || 0), 1]],
    adjustment: [["Date", (r) => (r.date ? fmtWhen(r.date) : "—")], ["Record", (r) => adjRecordLabel(r), 0, 1], ["Reason", (r) => adjReasonLabel(r.reason)], ["Changed field", (r) => adjFieldsText(r), 0, 1], ["Old → New", (r) => adjChangeText(r), 0, 1], ["User", (r) => r.created_by || "—"], ["Notes", (r) => r.notes || "—", 0, 1]],
    activity: [["Date", (r) => fmtDate(r.date)], ["Type", (r) => r.type], ["Flock", (r) => (r.flock ? flockName(r.flock) : "—")], ["Details", (r) => r.details || "—", 0, 1]],
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