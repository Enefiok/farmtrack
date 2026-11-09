/* js/core/schemas.js - form schemas, farm catalog, Sell Birds */
"use strict";

  /* =====================================================================
     FORM SCHEMAS (one per record type)
     ===================================================================== */
  const flockOptions = () => state.data.flock.map((f) => [f.id, f.identifier]);
  const findFlock = (id) => state.data.flock.find((f) => String(f.id) === String(id));
  const flockName = (id) => (findFlock(id) || {}).identifier || "—";
  const list = (...a) => a;
  const UNITS = list("Egg", "Tray", "Crate", "Bird", "Bag", "Kg", "Litre", "Piece");
  // Units offered on the Sales form (what the goods are sold in) and on the Purchase form (what they are bought in).
  // These are the fallback lists. Once an item is chosen, the Unit dropdown is narrowed to that item's
  // base unit plus the units that have a conversion for it (see unitFor on the schemas below).
  const SALE_UNITS = [["Crate", "Crate"], ["Tray", "Tray"], ["Egg", "Egg"], ["Bag", "Bag"], ["Kg", "Kg"]];
  const PURCHASE_UNITS = [["Bag", "Bag"], ["Bottle", "Bottle"], ["Kg", "Kg"], ["Litre", "Litre"], ["Crate", "Crate"], ["Tray", "Tray"], ["Piece", "Piece"]];
  // Units offered on the Production form for eggs collected and eggs damaged. Fallback only;
  // once an item is chosen, each Unit dropdown follows that item's base unit and conversions.
  const PRODUCTION_UNITS = [["Egg", "Egg"], ["Tray", "Tray"], ["Crate", "Crate"]];
  const fieldOf = (s, name) => allFields(s).find((f) => f.name === name);
  const unitQty = (r) => `${fmtInt(r.quantity)}${r.unit ? " " + r.unit : ""}`;

  // ----- Discounts and payments -----
  // The Sales form works out: subtotal -> discount -> total -> amount still owed.
  // These numbers come from the fields the user typed. The computed boxes are display only,
  // so they are never read back as input (they hold formatted text such as "NGN 1,000.00").
  const saleSubtotal = (v) => num(v.quantity) * num(v.price);
  const saleDiscount = (v) => {
    const sub = saleSubtotal(v);
    const raw = v.discount_type === "PERCENT" ? sub * (num(v.discount_value) / 100) : num(v.discount_value);
    return Math.min(sub, Math.max(0, raw)); // a discount can never be more than the sale itself
  };
  const saleTotal = (v) => Math.max(0, saleSubtotal(v) - saleDiscount(v));
  const discountText = (r) => (num(r.discount_value) > 0 ? (r.discount_type === "PERCENT" ? `${num(r.discount_value)}%` : fmtMoney(r.discount_value)) : "None");
  // Tone for the "Outstanding" card in the View windows: red when money is still owed.
  const owedTone = (v) => (num(v) > 0 ? "red" : "green");
  // Later payments: the record type in this app -> the transaction_type the backend expects.
  const PAYMENT_KIND = { sales: "SALE", purchase: "PURCHASE", expense: "EXPENSE" };
  const PAYMENT_METHODS = [["CASH", "Cash"], ["BANK_TRANSFER", "Bank Transfer"], ["CARD", "Card/POS"], ["MOBILE_MONEY", "Mobile Money"]];
  const methodLabel = (m) => (PAYMENT_METHODS.find((x) => x[0] === String(m).toUpperCase()) || [0, m || "—"])[1];

  // Every farm type the app will offer. Only entries with ready: true can be created today.
  // "value" is what the backend stores in farm_type. To open a new type later: add it to the backend
  // choices, then flip ready to true here. The picker itself needs no other change.
  const FARM_CATALOG = [
    { value: "layers", group: "Poultry", title: "Egg production", desc: "Flocks, daily egg collection and egg sales.", keywords: "poultry chicken eggs layers hens", ready: true },
    { value: "broilers", group: "Poultry", title: "Meat birds", desc: "Broiler flocks raised for meat.", keywords: "poultry chicken broilers meat", ready: false },
    { value: "both", group: "Poultry", title: "Egg and meat birds", desc: "Layers and broilers on the same farm.", keywords: "poultry chicken eggs meat both mixed", ready: false },
    { value: "corn", group: "Crops", title: "Corn (maize)", desc: "Planting, harvest and yield tracking.", keywords: "crop maize corn grain", ready: false },
    { value: "cocoa", group: "Crops", title: "Cocoa", desc: "Plantation, harvest and drying records.", keywords: "crop cocoa cacao plantation", ready: false },
    { value: "cassava", group: "Crops", title: "Cassava", desc: "Planting, harvest and processing records.", keywords: "crop cassava tuber root", ready: false },
    { value: "fish", group: "Fish and livestock", title: "Fish farming", desc: "Ponds, feeding and harvest records.", keywords: "fish catfish tilapia pond aquaculture", ready: false },
    { value: "cattle", group: "Fish and livestock", title: "Cattle and goats", desc: "Herd, health and sales records.", keywords: "livestock cattle cow goat sheep herd", ready: false },
  ];

  const SCHEMAS = {
    farm: {
      title: "Farm Setup", sub: "Tell us about your farm", saved: "Farm created successfully.", button: "Save",
      fields: [
        { name: "name", label: "Farm name", type: "text", placeholder: "Enter name", required: true, max: 100 },
        { name: "location", label: "Farm location", type: "text", placeholder: "Enter location" },
        { name: "currency", label: "Currency", type: "select", placeholder: "Enter currency", required: true, default: "NGN",
          options: [["NGN", "Nigerian Naira (₦)"], ["GHS", "Ghanaian Cedi (GH₵)"], ["KES", "Kenyan Shilling (KSh)"], ["ZAR", "South African Rand (R)"], ["USD", "US Dollar ($)"], ["GBP", "British Pound (£)"], ["EUR", "Euro (€)"]] },
        { name: "contact_info", label: "Farm contact", type: "text", placeholder: "Enter contact", phone: true },
        { name: "timezone", label: "Timezone", type: "select", placeholder: "Enter timezone", required: true, default: "Africa/Lagos",
          options: [["Africa/Lagos", "Africa/Lagos (WAT)"], ["Africa/Accra", "Africa/Accra (GMT)"], ["Africa/Nairobi", "Africa/Nairobi (EAT)"], ["Africa/Johannesburg", "Africa/Johannesburg (SAST)"], ["Europe/London", "Europe/London"], ["America/New_York", "America/New_York"], ["UTC", "UTC"]] },
        { name: "unit_system", label: "Unit preference", type: "select", placeholder: "Enter unit", required: true, default: "metric",
          options: [["metric", "Metric (kg, litres)"], ["imperial", "Imperial (lb, gallons)"]] },
      ],
    },
    opening: {
      title: "Add existing birds", sub: "Enter every group of birds already on your farm so your numbers start correct.", saved: "Existing birds added.", button: "Save flocks",
      // Shared by all flocks in this submission
      fields: [
        { name: "date", label: "Date of Count", type: "date", required: true },
      ],
      // One of these per flock row (built by mountRows, not by fieldHTML)
      rowFields: [
        { name: "identifier", label: "Flock Name", type: "text", placeholder: "Enter flock name", required: true },
        { name: "breed", label: "Breed/Type", type: "select", placeholder: "Enter breed", required: true, options: list("Isa Brown", "Lohmann Brown", "Hy-Line", "Bovans", "Noiler", "Other") },
        { name: "stage", label: "Production Stage", type: "select", placeholder: "Enter production stage", required: true, options: list("Chick", "Grower", "Pullet", "Layer", "Spent hen") },
        { name: "count", label: "Number of birds", type: "number", placeholder: "Enter number of birds", required: true, min: 1, integer: true },
        { name: "arrival_date", label: "Arrival Date", type: "date", placeholder: "When did you get this flock?", required: true },
      ],
    },
    flock: {
      title: "Flock Records", sub: "Add a new flock to your farm", saved: "Flock record saved.",
      errorMap: { initial_count: "starting_count" },
      fields: [
        { name: "identifier", label: "Flock Identifier", type: "text", placeholder: "Enter identifier", required: true },
        { name: "breed", label: "Breed/Type", type: "select", placeholder: "Enter breed", required: true, options: list("Isa Brown", "Lohmann Brown", "Hy-Line", "Bovans", "Noiler", "Other") },
        { name: "arrival_date", label: "Arrival Date", type: "date", placeholder: "Enter date", required: true },
        { name: "age_at_arrival", label: "Age at Arrival", type: "number", placeholder: "Enter age", min: 0, integer: true },
        { name: "starting_count", label: "Starting Bird Count", type: "number", placeholder: "Enter starting", required: true, min: 1, integer: true },
        { name: "current_count", label: "Current Bird Count", type: "computed", fmt: (v) => fmtInt(v) },
        { name: "stage", label: "Production Stage", type: "select", placeholder: "Enter production stage", required: true, options: list("Chick", "Grower", "Pullet", "Layer", "Spent hen") },
        { name: "mortality_rate", label: "Mortality Rate", type: "computed", fmt: (v) => v.toFixed(1) + "%" },
        { name: "status", label: "Flock Status", type: "select", placeholder: "Enter status", required: true, options: list("Active", "Sold out", "Closed") },
      ],
      // Counts are calculated, never typed. A new flock starts with current = starting.
      calc: (v) => ({ current_count: num(v.starting_count), mortality_rate: 0 }),
    },
    production: {
      title: "Production Records", sub: "Record eggs collected from a flock", saved: "Production record saved.",
      errorMap: { quantity_collected: "collected", quantity_damaged: "damaged", event_date: "date" },
      // Each quantity gets its own Unit dropdown, both following the chosen Item.
      unitFor: [
        { item: "item", unit: "unit_collected" },
        { item: "item", unit: "unit_damaged" },
      ],
      fields: [
        { name: "date", label: "Egg Collection Date", type: "date", required: true },
        { name: "flock", label: "Flock", type: "select", placeholder: "Enter flock", emptyText: "Add a flock first", required: true, options: flockOptions },
        // The inventory item the eggs are added to. Only egg items are offered. If no item is categorised
        // as EGG, every item is shown so the user is never stuck with an empty list.
        // isEggItem is declared further down in this file; options runs lazily, so that is safe.
        { name: "item", label: "Item", type: "select", placeholder: "Select item", emptyText: "No egg items yet. Add one in Inventory first.", required: true,
          options: () => {
            const items = state.lookups.items || [];
            const eggs = items.filter(isEggItem);
            return (eggs.length ? eggs : items).map((i) => [i.id, i.name]);
          } },
        // joinUnit: each quantity and its Unit are drawn as one row: [ 5 ] [ Crates v ]
        { name: "collected", label: "Eggs Collected", type: "number", placeholder: "Enter amount", required: true, min: 0, joinUnit: "unit_collected" },
        { name: "unit_collected", label: "Collected unit", type: "select", placeholder: "Select unit", required: true, options: PRODUCTION_UNITS },
        { name: "damaged", label: "Damaged/Broken Eggs", type: "number", placeholder: "Enter amount", min: 0, joinUnit: "unit_damaged" },
        // Only required once a damaged quantity is typed.
        { name: "unit_damaged", label: "Damaged unit", type: "select", placeholder: "Select unit", options: PRODUCTION_UNITS,
          when: (v) => v.damaged !== "" && v.damaged != null },
        { name: "recorded_by", label: "Recorded by", type: "readonly", value: () => state.user.name },
        { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
      ],
      // Saleable Quantity is calculated by the backend, so it is no longer shown or sent from the form.
      // Same-unit sanity check only; mixed units (2 Crates vs 2 Eggs) are validated by the backend.
      check: (v) => (v.unit_collected && v.unit_collected === v.unit_damaged && num(v.damaged) > num(v.collected)
        ? { damaged: "Damaged eggs cannot be more than eggs collected." } : {}),
    },
    sales: {
      title: "Sales Records", sub: "Record a sale", saved: "Sale record saved.",
      errorMap: { event_date: "date", party: "customer", lines: "product" },
      // The Unit dropdown follows the chosen Product: its base unit plus the units that have a conversion.
      unitFor: { item: "product", unit: "unit" },
      fields: [
        { name: "date", label: "Sale Date", type: "date", required: true },
        // Type a new name or pick an existing customer. A new name is saved as a customer automatically.
        { name: "customer", label: "Customer", type: "text", placeholder: "Enter or choose a customer", required: true, suggest: () => state.lookups.customers.map((c) => c.name) },
        { name: "product", label: "Product", type: "select", placeholder: "Enter product", emptyText: "No products yet. Record egg production first.", required: true, options: () => state.lookups.items.map((i) => [i.id, i.name]) },
        // joinUnit: this field and the Unit field below it are drawn as one row: [ 10 ] [ Crate v ]
        { name: "quantity", label: "Quantities", type: "number", placeholder: "Enter quantity", required: true, min: 0.01, joinUnit: "unit" },
        // What the goods are sold in. Sent inside the sale line.
        { name: "unit", label: "Unit", type: "select", placeholder: "Select unit", required: true, options: SALE_UNITS },
        { name: "price", label: "Prices", type: "number", placeholder: "Enter price", required: true, min: 0, step: "0.01" },
        { name: "discount_type", label: "Discount Type", type: "select", default: "FIXED", options: [["FIXED", "Fixed Amount"], ["PERCENT", "Percentage (%)"]] },
        { name: "discount_value", label: "Discount Value", type: "number", placeholder: "0", min: 0, step: "0.01" },
        { name: "total", label: "Total Sale Value", type: "computed", fmt: fmtMoney },
        { name: "amount_paid", label: "Amount Paid Now", type: "number", placeholder: "0.00", min: 0, step: "0.01" },
        { name: "payment_method", label: "Payment Method", type: "select", placeholder: "Select method", default: "CASH", options: PAYMENT_METHODS },
        { name: "reference", label: "Reference (Optional)", type: "text", placeholder: "e.g. Receipt #123 or Bank Ref" },
        { name: "outstanding_balance", label: "Amount Owed", type: "computed", fmt: fmtMoney },
        { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
      ],
      calc: (v) => {
        const total = saleTotal(v);
        return { total, outstanding_balance: Math.max(0, total - num(v.amount_paid)) };
      },
      check: (v) => {
        const errs = {};
        if (v.discount_type === "PERCENT" && num(v.discount_value) > 100) errs.discount_value = "A percentage discount cannot be more than 100.";
        else if (v.discount_type !== "PERCENT" && num(v.discount_value) > saleSubtotal(v)) errs.discount_value = "The discount cannot be more than the sale amount.";
        if (num(v.amount_paid) > saleTotal(v)) errs.amount_paid = "Amount paid cannot be more than the total sale value.";
        return errs;
      },
    },
    purchase: {
      title: "Purchase Records", sub: "Record goods bought for the farm", saved: "Purchase record saved.",
      // The backend names: party = the supplier, lines = the item bought
      errorMap: { event_date: "date", party: "supplier", lines: "item" },
      // The Unit dropdown follows the chosen Item: its base unit plus the units that have a conversion.
      unitFor: { item: "item", unit: "unit" },
      fields: [
        { name: "date", label: "Purchase Date", type: "date", required: true },
        // Type a new name or pick an existing supplier. A new name is saved as a supplier automatically.
        { name: "supplier", label: "Supplier", type: "text", placeholder: "Enter or choose a supplier", required: true, suggest: () => (state.lookups.suppliers || []).map((s) => s.name) },
        // Sent to the backend as receipt_status. New purchases default to Received.
        { name: "receipt_status", label: "Receipt Status", type: "select", placeholder: "Select status", required: true, default: "RECEIVED", options: [["RECEIVED", "Received"], ["ORDERED", "Ordered"]] },
        { name: "item", label: "Item", type: "select", placeholder: "Enter item", emptyText: "No items yet. Add an item on the server first.", required: true, options: () => state.lookups.items.map((i) => [i.id, i.name]) },
        // joinUnit: this field and the Unit field below it are drawn as one row: [ 10 ] [ Bag v ]
        { name: "quantity", label: "Quantity", type: "number", placeholder: "Enter quantity", required: true, min: 0.01, joinUnit: "unit" },
        // What the goods are bought in (for example Bags of feed or Bottles of medicine). Sent inside the purchase line.
        { name: "unit", label: "Unit", type: "select", placeholder: "Select unit", required: true, options: PURCHASE_UNITS },
        { name: "unit_cost", label: "Unit Cost", type: "number", placeholder: "Enter unit cost", required: true, min: 0, step: "0.01" },
        { name: "total_cost", label: "Total Cost", type: "computed", fmt: fmtMoney },
        { name: "amount_paid", label: "Amount Paid Now", type: "number", placeholder: "0.00", min: 0, step: "0.01" },
        { name: "payment_method", label: "Payment Method", type: "select", placeholder: "Select method", default: "CASH", options: PAYMENT_METHODS },
        { name: "reference", label: "Reference (Optional)", type: "text", placeholder: "e.g. Receipt #123 or Bank Ref" },
        { name: "outstanding_balance", label: "Amount Owed", type: "computed", fmt: fmtMoney },
        // Sent to the backend as the purchase notes
        { name: "stock_received", label: "Notes / stock received", type: "text", placeholder: "Enter details" },
      ],
      calc: (v) => {
        const total = Math.max(0, num(v.quantity) * num(v.unit_cost));
        return { total_cost: total, outstanding_balance: Math.max(0, total - num(v.amount_paid)) };
      },
      check: (v) => (num(v.amount_paid) > num(v.quantity) * num(v.unit_cost) ? { amount_paid: "Amount paid cannot be more than the total cost." } : {}),
    },
    expense: {
      title: "Expenses Records", sub: "Record a farm expense", saved: "Expense record saved.",
      // The backend names: party = the supplier, notes = the description
      errorMap: { event_date: "date", party: "supplier", notes: "description" },
      fields: [
        { name: "date", label: "Expense Date", type: "date", required: true },
        // Optional. Type a new name or pick an existing supplier. A new name is saved as a supplier automatically.
        { name: "supplier", label: "Supplier (Optional)", type: "text", placeholder: "Enter or choose a supplier", suggest: () => (state.lookups.suppliers || []).map((x) => x.name) },
        { name: "amount", label: "Amount", type: "number", placeholder: "Enter amount", required: true, min: 0.01, step: "0.01" },
        { name: "payment_details", label: "Payment details", type: "select", placeholder: "Enter details", required: true, options: list("Cash", "Bank transfer", "Card/POS", "Mobile money", "On credit") },
        { name: "amount_paid", label: "Amount Paid Now", type: "number", placeholder: "0.00", min: 0, step: "0.01" },
        { name: "reference", label: "Reference (Optional)", type: "text", placeholder: "e.g. Receipt #123 or Bank Ref" },
        { name: "outstanding_balance", label: "Amount Owed", type: "computed", fmt: fmtMoney },
        { name: "description", label: "Description", type: "textarea", short: true, placeholder: "Enter description", required: true },
        { name: "supporting_note", label: "Supporting Note", type: "textarea", short: true, placeholder: "Write something" },
      ],
      calc: (v) => ({ outstanding_balance: Math.max(0, num(v.amount) - num(v.amount_paid)) }),
      check: (v) => (num(v.amount_paid) > num(v.amount) ? { amount_paid: "Amount paid cannot be more than the amount." } : {}),
    },
    activity: {
      title: "Farm Activities", sub: "Track daily farm operations, treatments, and losses.", saved: "Activity saved.",
      errorMap: { event_date: "date" },
      centered: true,
      tabs: [
        { key: "feed", label: "Feed consumption", code: "FEED_CONSUMPTION",
          // The feed item is a text box, so the Unit dropdown is matched on the typed name (byName).
          // A name that is not an inventory item keeps the full unit list.
          unitFor: { item: "feed_item", unit: "unit", byName: true },
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            // Suggests the farm's own items. Falls back to the common feed names while the item list is empty.
            { name: "feed_item", label: "Feed item", type: "text", placeholder: "Enter feed item", required: true,
              suggest: () => {
                const names = ((state.lookups && state.lookups.items) || []).map((i) => i.name).filter(Boolean);
                return names.length ? names : list("Layer mash", "Grower mash", "Starter feed", "Maize", "Soya");
              } },
            // joinUnit: this field and the Unit field below it are drawn as one row: [ 10 ] [ Bag v ]
            { name: "quantity", label: "Quantity", type: "number", placeholder: "Enter quantity", required: true, min: 0.01, joinUnit: "unit" },
            { name: "unit", label: "Unit", type: "select", placeholder: "Enter unit", required: true, options: UNITS },
            { name: "flock", label: "Flock", type: "select", placeholder: "Enter flock", emptyText: "No flocks yet", options: flockOptions },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.feed_item}: ${v.quantity} ${v.unit}` },
        { key: "mortality", label: "Mortality", code: "MORTALITY", errorMap: { event_date: "date", quantity: "birds" },
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "flock", label: "Flock", type: "select", placeholder: "Enter flock", emptyText: "Add a flock first", required: true, options: flockOptions },
            { name: "birds", label: "Number of birds", type: "number", placeholder: "Enter number of birds", required: true, min: 1, integer: true },
            { name: "reason", label: "Reason/cause", type: "text", placeholder: "Enter reason", required: true },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.birds} bird${num(v.birds) === 1 ? "" : "s"}: ${v.reason}`,
          check: (v) => {
            const fl = findFlock(v.flock);
            return fl && num(v.birds) > num(fl.current_count) ? { birds: `Cannot be more than the flock's current count (${fmtInt(fl.current_count)}).` } : {};
          },
          impact: (v) => {
            const fl = findFlock(v.flock);
            return fl ? `${fl.identifier} will go from ${fmtInt(fl.current_count)} to ${fmtInt(Math.max(0, num(fl.current_count) - num(v.birds)))} birds.` : "";
          } },
        { key: "medication", label: "Medication", code: "MEDICATION",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "flock", label: "Flock", type: "select", placeholder: "Enter flock", emptyText: "Add a flock first", required: true, options: flockOptions },
            { name: "product", label: "Product", type: "text", placeholder: "Enter product", required: true },
            { name: "dose", label: "Quantity/Dose", type: "text", placeholder: "Enter quantity or dose", required: true },
            { name: "next_due", label: "Next due date", type: "date", placeholder: "Enter date", noDefault: true },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.product} (${v.dose})${v.next_due ? ", next due " + fmtDate(v.next_due) : ""}` },
        { key: "flock_change", label: "Flock change", code: "FLOCK_CHANGE",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "change_type", label: "Change type", type: "text", placeholder: "Enter change type", required: true, suggest: list("Culled", "Sold", "Transferred out", "Transferred in", "Added") },
            { name: "quantity", label: "Quantity", type: "number", placeholder: "Enter quantity", required: true, min: 1, integer: true },
            { name: "reason", label: "Reason", type: "text", placeholder: "Enter reason" },
          ],
          summary: (v) => `${v.change_type}: ${v.quantity}${v.reason ? " (" + v.reason + ")" : ""}` },
        { key: "damage", label: "Damage", code: "LOSS",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "affected", label: "Affected Item/Quantity", type: "text", placeholder: "Enter item and quantity", required: true },
            { name: "reason", label: "Reason", type: "text", placeholder: "Enter reason", required: true },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.affected}: ${v.reason}` },
        { key: "others", label: "Others", code: "OTHER",
          fields: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "type_description", label: "Type/Description", type: "text", placeholder: "Enter type or description", required: true },
            { name: "reason", label: "Reason", type: "text", placeholder: "Enter reason" },
            { name: "notes", label: "Notes", type: "textarea", placeholder: "Write Something" },
          ],
          summary: (v) => `${v.type_description}${v.reason ? ": " + v.reason : ""}` },
      ],
    },
  };

  // ----- "Sell Birds" (a sale linked to one specific flock) -----
  // It reuses the Sales form and the sales endpoint. The flock id travels inside the sale line,
  // and the backend lowers that flock's current count (and marks it "Sold out" at 0).
  const BIRD_UNITS = [["Bird", "Bird"], ["Crate", "Crate"], ["Kg", "Kg"]];
  let sellFlock = null; // the flock being sold from while the Sell Birds window is open

  // Items that can be sold from a flock. Eggs are never offered here (they are sold from stock, not from a flock).
  // If the farm has items named like birds (Spent hens, Live birds, Roosters ...), only those are shown.
  // If none are named like that, every item except eggs is shown so the user is never stuck with an empty list.
  const isEggItem = (i) => String(i.category || "").toUpperCase() === "EGG" || /egg/i.test(i.name || "");
  const isLivestockItem = (i) => String(i.category || "").toUpperCase() === "LIVESTOCK";
  const isBirdItem = (i) => isLivestockItem(i) || /hen|bird|rooster|cock|chicken|broiler|layer|pullet|cull/i.test(i.name || "");
  // Items whose category is LIVESTOCK (set on the Inventory page) come first. Otherwise fall back to names, then to everything but eggs.
  const birdItems = () => {
    const all = state.lookups.items.filter((i) => !isEggItem(i));
    const stock = all.filter(isLivestockItem);
    if (stock.length) return stock;
    const birds = all.filter(isBirdItem);
    return birds.length ? birds : all;
  };

  // Sell Birds copies the Sales schema, so it also gets unitFor and joinUnit.
  // BIRD_UNITS is only the fallback list; the Unit dropdown follows the chosen bird item.
  SCHEMAS.sellbirds = {
    ...SCHEMAS.sales,
    title: "Sell Birds",
    sub: "Record a sale of birds from this flock",
    saved: "Bird sale recorded.",
    // No discount fields here. The payload still sends a zero fixed discount.
    fields: SCHEMAS.sales.fields
      .filter((f) => !["discount_type", "discount_value"].includes(f.name))
      .map((f) => {
        if (f.name === "unit") return { ...f, options: BIRD_UNITS };
        if (f.name === "product") {
          return { ...f, label: "Type of Bird", placeholder: "Select type of bird", emptyText: "No bird items yet. Add an item such as Spent hens on the server first.", options: () => birdItems().map((i) => [i.id, i.name]) };
        }
        return f;
      }),
    check: (v) => {
      const errs = {};
      if (sellFlock && num(v.quantity) > num(sellFlock.current_count)) {
        errs.quantity = `Cannot be more than the flock's current count (${fmtInt(sellFlock.current_count)}).`;
      }
      if (num(v.amount_paid) > saleTotal(v)) errs.amount_paid = "Amount paid cannot be more than the total sale value.";
      return errs;
    },
  };