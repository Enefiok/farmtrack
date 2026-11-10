/* js/views/inventory.js - inventory view, item and conversion modals, stock history */
"use strict";

  /* =====================================================================
     INVENTORY (items, units and unit conversions)
     ===================================================================== */
  const ITEM_CATEGORIES = [["FEED", "Feed"], ["MEDICINE", "Medicine/Vaccine"], ["EGG", "Egg Product"], ["LIVESTOCK", "Livestock/Birds"], ["SUPPLY", "General Supply"], ["EQUIPMENT", "Equipment"]];
  const categoryLabel = (c) => (ITEM_CATEGORIES.find((x) => x[0] === String(c).toUpperCase()) || [0, c || "—"])[1];
  const DEV_UNITS = [{ id: 1, name: "Kg", abbreviation: "kg" }, { id: 2, name: "Egg", abbreviation: "egg" }, { id: 3, name: "Bag", abbreviation: "bag" }, { id: 4, name: "Bird", abbreviation: "bird" }, { id: 5, name: "Crate", abbreviation: "crate" }, { id: 6, name: "Tray", abbreviation: "tray" }];
  const unitLabel = (u) => (u.abbreviation && u.abbreviation.toLowerCase() !== String(u.name).toLowerCase() ? `${u.name} (${u.abbreviation})` : u.name);
  const findItem = (id) => state.inventory.items.find((i) => String(i.id) === String(id));
  // The API may return a field error as a list of messages or as one string; show it as one line of text.
  const errText = (m) => (Array.isArray(m) ? m.join(" ") : String(m));

  // Loads the full item list and the unit list. silent = keep showing the table while it refreshes.
  async function loadInventory(silent) {
    const farmId = state.farmId;
    if (!silent) state.inventory.status = "loading";
    try {
      let items, units;
      if (DEV) {
        units = DEV_UNITS;
        items = state.inventory.items.length ? state.inventory.items : state.lookups.items.map((i) => ({ id: i.id, name: i.name, category: String(i.category || "").toUpperCase(), base_unit: null, base_unit_name: "", is_stock_tracked: true }));
      } else {
        [items, units] = await Promise.all([AgroAPI.listInventory(farmId), AgroAPI.listUnits()]);
      }
      if (farmId !== state.farmId) return;
      // Spread the old state so the DEV-only conversions list (devConv) is not lost on reload.
      state.inventory = { ...state.inventory, items, units, status: "ready", farmId };
    } catch (err) {
      if (farmId !== state.farmId) return;
      if (silent && state.inventory.status === "ready") return;
      state.inventory.status = "error";
    }
    if (route().page === "inventory" && state.status === "ready") renderView();
  }

  // The farm-wide item list that feeds the Sales, Purchase and Sell Birds forms comes from lookups, so refresh it too.
  async function refreshLookups() {
    // The Unit dropdown on the forms caches each item's units. Items or conversions just changed, so drop that cache.
    // (clearUnitCache lives in forms.js; the typeof check keeps this working until that file is updated.)
    if (typeof clearUnitCache === "function") clearUnitCache();
    if (DEV) {
      state.lookups.items = state.inventory.items.map((i) => ({ id: i.id, name: i.name, category: i.category, base_unit_name: i.base_unit_name }));
      return;
    }
    try {
      const l = await AgroAPI.loadLookups(state.farmId);
      state.lookups = { customers: [], suppliers: [], items: [], ...l };
    } catch { /* keep the old lists */ }
  }

    // Small summary card used at the top of the Inventory page (reuses the dashboard .stat look).
  function invStatCard(ic, label, value, caption, warn) {
    return `<div class="card stat${warn ? " warn" : ""}"><div class="lbl">${icon(ic, 16)}${esc(label)}</div><div class="val">${esc(String(value))}</div><div class="delta"><span>${esc(caption)}</span></div></div>`;
  }

  function inventoryStats(items) {
    const total = items.length;
    const tracked = items.filter((i) => i.is_stock_tracked);
    // current_stock can be null when the server doesn't send it yet; then we can't count in/out of stock.
    const known = tracked.filter((i) => i.current_stock != null);
    const inStock = known.filter((i) => i.current_stock > 0).length;
    const out = known.filter((i) => i.current_stock <= 0).length;
    const dash = known.length ? null : "—";
    return `<div class="stats">
      ${invStatCard("inventory", "Total items", fmtInt(total), "In your inventory")}
      ${invStatCard("check", "Stock tracked", fmtInt(tracked.length), `of ${fmtInt(total)} items`)}
      ${invStatCard("egg", "In stock", dash || fmtInt(inStock), "Tracked items with stock")}
      ${invStatCard("alert", "Out of stock", dash || fmtInt(out), out ? "Needs restocking" : "Nothing to restock", out > 0)}
    </div>`;
  }

    const invUnitName = (i) => i.base_unit_name || (state.inventory.units.find((u) => String(u.id) === String(i.base_unit)) || {}).name || "—";
  // "Nov 4, 2026 • 10:24am"
  const fmtStamp = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return "—";
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
    return `${date} • ${time}`;
  };
  const STOCK_FILTERS = [["", "All stock"], ["in", "In stock"], ["out", "Out of stock"], ["untracked", "Not tracked"]];

  // Items after the search box, the category select and the stock filter are all applied.
  function inventoryShown() {
    const q = state.query.trim().toLowerCase();
    const cat = state.invCategory || "", stk = state.invStock || "";
    const stockOk = (i) => stk === "in" ? i.is_stock_tracked && i.current_stock > 0
      : stk === "out" ? i.is_stock_tracked && i.current_stock != null && i.current_stock <= 0
      : stk === "untracked" ? !i.is_stock_tracked : true;
    return state.inventory.items.filter((i) =>
      (!q || `${i.name} ${categoryLabel(i.category)} ${i.base_unit_name}`.toLowerCase().includes(q)) &&
      (!cat || String(i.category).toUpperCase() === cat) && stockOk(i));
  }

  function exportInventory() {
    const rows = inventoryShown();
    if (!rows.length) { toast("There are no items to export."); return; }
    downloadCSV("inventory", [
      ["Name", "Category", "Base unit", "Stock tracked", "Current stock", "Last updated"],
      ...rows.map((i) => [i.name, categoryLabel(i.category), invUnitName(i), i.is_stock_tracked ? "Yes" : "No",
        i.is_stock_tracked && i.current_stock != null ? fmtQty(i.current_stock) : "", fmtStamp(i.updated_at)]),
    ]);
  }

  function inventoryView() {
    const inv = state.inventory;
    const head = `<div class="page-head"><div><h1>Inventory</h1><p>Items you buy, produce and sell, and the units they come in.</p></div><button class="btn" data-action="add-item">${icon("plus", 14)}Add Item</button></div>`;
    if (inv.status === "idle" || inv.status === "loading") return head + loadingView();
    if (inv.status === "error") return head + `<div class="state-card err" role="alert">${icon("alert", 28)}<h2>Something went wrong</h2><p>We couldn't load your inventory.</p><button class="btn pill" data-action="retry-inventory">Try again</button></div>`;
    if (!inv.items.length) {
      return head + `<div class="state-card">${icon("inventory", 28)}<h2>No items yet</h2><p>Add items such as Fresh Eggs, Layer Feed or Spent Hens, then set their unit conversions.</p><button class="btn" data-action="add-item">${icon("plus", 14)}Add Item</button></div>`;
    }
    // const q = state.query.trim().toLowerCase();
    // const shown = q ? inv.items.filter((i) => `${i.name} ${categoryLabel(i.category)} ${i.base_unit_name}`.toLowerCase().includes(q)) : inv.items;
    // const unitName = (i) => i.base_unit_name || (inv.units.find((u) => String(u.id) === String(i.base_unit)) || {}).name || "—";
    // const btn = (action, id, label) => `<button class="btn ghost" type="button" style="padding:4px 10px;font-size:12px" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
    // const rows = shown.map((i) => {
    //   // Only items that track stock have a stock figure. The server may not send one yet, so show a dash then.
    //   const stockVal = i.is_stock_tracked && i.current_stock != null ? fmtQty(i.current_stock) : "—";
    //   return `<tr>
    //   <td class="item-name">${esc(i.name)}</td><td><span class="chip cat-${esc(String(i.category).toLowerCase())}">${esc(categoryLabel(i.category))}</span></td><td>${esc(unitName(i))}</td><td><span class="pill ${i.is_stock_tracked ? "on" : "off"}">${i.is_stock_tracked ? "Yes" : "No"}</span></td>      <td class="num">${esc(stockVal)}</td>
    //   <td class="num"><span style="display:inline-flex;gap:6px;align-items:center">${btn("edit-item", i.id, "Edit")}${btn("archive-item", i.id, "Archive")}${btn("manage-conversions", i.id, "Conversions")}${btn("stock-history", i.id, "History")}</span></td></tr>`;
    // }).join("");
    //   return head + inventoryStats(inv.items) + `<section class="card table-card">
    //   <div class="table-head"><h3>Items</h3></div>
    //   ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Base unit</th><th>Stock tracked</th><th class="num">Current Stock</th><th class="num">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-line" style="padding:24px 20px">No items match "${esc(state.query)}".</div>`}
    // </section>`;


    
     const shown = inventoryShown();
    const menuItem = (action, id, ic, label, cls) => `<button type="button" role="menuitem"${cls ? ` class="${cls}"` : ""} data-action="${action}" data-id="${esc(id)}">${icon(ic, 15)}${label}</button>`;
    const rows = shown.map((i) => {
      // Only items that track stock have a stock figure. The server may not send one yet, so show a dash then.
      const stockVal = i.is_stock_tracked && i.current_stock != null ? fmtQty(i.current_stock) : "—";
      const mid = `inv-menu-${i.id}`;
      return `<tr>
      <td class="item-name">${esc(i.name)}</td><td><span class="cat-chip cat-${esc(String(i.category).toLowerCase())}">${esc(categoryLabel(i.category))}</span></td><td>${esc(invUnitName(i))}</td><td><span class="stock-pill ${i.is_stock_tracked ? "on" : "off"}">${i.is_stock_tracked ? "Yes" : "No"}</span></td>
      <td class="num">${esc(stockVal)}</td>
      <td>${esc(fmtStamp(i.updated_at))}</td>
      <td class="num"><div class="menu-wrap" style="display:inline-block"><button class="icon-btn square row-btn" type="button" data-menu="${mid}" data-fixed aria-haspopup="true" aria-label="Actions for ${esc(i.name)}">${icon("more", 16)}</button>
        <div class="menu tbl-menu" id="${mid}" role="menu" hidden>${menuItem("edit-item", i.id, "edit", "Edit")}${menuItem("manage-conversions", i.id, "convert", "Conversions")}${menuItem("stock-history", i.id, "history", "History")}${menuItem("archive-item", i.id, "archive", "Archive", "danger")}</div></div></td></tr>`;
    }).join("");

    const cat = state.invCategory || "", stk = state.invStock || "";
    const tools = `<div class="head-tools">
      <div class="sel"><select id="inv-category" aria-label="Filter by category"><option value=""${cat ? "" : " selected"}>All categories</option>${ITEM_CATEGORIES.map(([v, l]) => `<option value="${v}"${cat === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>${icon("chevronDown", 16)}</div>
      <div class="menu-wrap"><button class="tool-btn${stk ? " on" : ""}" type="button" data-menu="inv-filter-menu" data-fixed aria-haspopup="true">${icon("filter", 15)}Filter</button>
        <div class="menu tbl-menu" id="inv-filter-menu" role="menu" hidden>${STOCK_FILTERS.map(([v, l]) => `<button type="button" role="menuitem"${stk === v ? ' class="on"' : ""} data-action="inv-stock-filter" data-value="${v}">${l}</button>`).join("")}</div></div>
      <button class="tool-btn" type="button" data-action="export-inventory" aria-label="Download as CSV">${icon("download", 16)}</button>
    </div>`;
    const empty = state.query.trim() ? `No items match "${esc(state.query)}".` : "No items match these filters.";
    return head + inventoryStats(inv.items) + `<section class="card table-card inv-table">
      <div class="table-head"><div><h3>Inventory items</h3><p class="sub-line">Showing the latest records for ${esc((farm() || {}).name || "your farm")}</p></div>${tools}</div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Base unit</th><th>Stock tracked</th><th class="num">Current Stock</th><th>Last updated</th><th class="num">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-line" style="padding:24px 20px">${empty}</div>`}
    </section>`;
  }

  /* ---------- Add / Edit Item ---------- */
  // One window for both. openItemModal(null) adds an item; openItemModal(item) edits that item.
  function openEditItemModal(item, trigger) { if (item) openItemModal(item, trigger); }

  function openItemModal(itemToEdit = null, trigger) {
    const editing = !!itemToEdit;
    modalTrigger = trigger || document.activeElement;
    const units = state.inventory.units;
    const defs = [
      { name: "name", label: "Name", type: "text", placeholder: "e.g. Fresh Eggs, Layer Feed, Spent Hen", required: true, max: 100 },
      { name: "category", label: "Category", type: "select", placeholder: "Select category", required: true, options: ITEM_CATEGORIES },
      { name: "base_unit", label: "Base Unit", type: "select", placeholder: "Select base unit", emptyText: "No units on the server yet", required: true, options: units.map((u) => [u.id, unitLabel(u)]) },
    ];
    // Only when adding: the opening stock, counted in the item's base unit.
    const stockDef = { name: "initial_stock", label: "Initial Stock (Optional)", type: "number", placeholder: "0", min: 0, step: "any" };
    const allDefs = editing ? defs : [...defs, stockDef];
    const schema = { fields: allDefs };
    const saveLabel = editing ? "Save changes" : "Save item";
    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <h2 id="modal-title">${editing ? "Edit Item" : "Add Item"}</h2>
          <p class="sub">${editing ? "Update this item's details." : "Create an item you can buy, produce or sell. Set its unit conversions afterwards."}</p>
          <form id="item-form" novalidate>
            <div class="form-grid" id="form-grid">
              ${defs.map(fieldHTML).join("")}
              <div class="field" data-name="is_stock_tracked" style="grid-column:1/-1">
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer"><input type="checkbox" id="f-is_stock_tracked" name="is_stock_tracked" checked style="width:18px;height:18px;accent-color:#147a3a"><span>Track stock for this item</span></label>
                <p class="error" id="e-is_stock_tracked" role="alert"></p>
              </div>
              ${editing ? "" : fieldHTML(stockDef)}
            </div>
            <p class="form-error" id="form-error" role="alert"></p>
            <div class="actions"><button class="btn" id="save-btn" type="submit" data-label="${saveLabel}">${saveLabel}</button></div>
          </form>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const form = $("#item-form");

    // Editing: fill the form with the item's current values
    if (editing) {
      field(form, "name").value = itemToEdit.name || "";
      field(form, "category").value = String(itemToEdit.category || "").toUpperCase();
      if (itemToEdit.base_unit != null) field(form, "base_unit").value = String(itemToEdit.base_unit);
      field(form, "is_stock_tracked").checked = !!itemToEdit.is_stock_tracked;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      const v = readValues(form, schema);
      const tracked = field(form, "is_stock_tracked").checked;
      [...allDefs.map((d) => d.name), "is_stock_tracked"].forEach((n) => setError(n, ""));
      $("#form-error").textContent = "";
      const errs = validate(v, schema);
      const dupe = state.inventory.items.some((i) => (!editing || String(i.id) !== String(itemToEdit.id)) && i.name.trim().toLowerCase() === String(v.name).trim().toLowerCase());
      if (!errs.name && dupe) errs.name = "An item with this name already exists.";
      // An opening stock only makes sense for an item whose stock is tracked.
      const wantsStock = !editing && v.initial_stock !== "" && num(v.initial_stock) > 0;
      if (wantsStock && !tracked && !errs.initial_stock) errs.initial_stock = "Turn on stock tracking to set an opening stock.";
      const bad = allDefs.map((d) => d.name).filter((n) => errs[n]);
      if (bad.length) {
        bad.forEach((n) => setError(n, errs[n]));
        const el = $("#f-" + bad[0]); if (el) el.focus();
        return;
      }
      const payload = { name: v.name, category: v.category, base_unit: v.base_unit, is_stock_tracked: tracked };
      if (wantsStock) payload.initial_stock = v.initial_stock;
      const btn = $("#save-btn"), errEl = $("#form-error");
      saving = true; btn.disabled = true; btn.textContent = "Saving…";
      try {
        if (DEV) {
          const u = units.find((x) => String(x.id) === String(v.base_unit));
          const local = { ...payload, base_unit_name: u ? u.name : "" };
          if (editing) Object.assign(itemToEdit, local);
          else state.inventory.items.unshift({ id: uid(), ...local, current_stock: payload.initial_stock || 0 });
        } else if (editing) {
          await AgroAPI.updateItem(state.farmId, itemToEdit.id, payload);
        } else {
          await AgroAPI.createItem(state.farmId, payload);
        }
        await loadInventory(true);
        await refreshLookups();
        closeModal(); toast(editing ? "Item updated." : "Item saved."); renderView();
      } catch (err) {
        // On any error the window stays open. A base_unit error (for example changing the base unit of an item
        // that already has stock or conversions) is shown in red right under the Base Unit dropdown.
        let msg = "We couldn't save this item. Please try again.";
        if (err && err.name === "ApiError") {
          const entries = Object.entries(err.fields || {}).map(([n, m]) => [n, errText(m)]);
          const known = entries.filter(([n]) => allDefs.some((d) => d.name === n) || n === "is_stock_tracked");
          const rest = entries.filter((x) => !known.includes(x));
          known.forEach(([n, m]) => setError(n, m));
          if (known.length) { const el = $("#f-" + known[0][0]); if (el) el.focus(); }
          msg = rest.length ? rest.map(([n, m]) => `${n}: ${m}`).join(" ") : known.length ? "" : err.message;
        }
        errEl.textContent = msg;
        btn.disabled = false; btn.textContent = btn.dataset.label;
      } finally {
        saving = false;
      }
    });
    (field(form, "name") || $(".close")).focus();
  }

  /* ---------- Archive an item ---------- */
  async function archiveItemAction(item) {
    if (!item) return;
    if (!confirm(`Are you sure you want to archive ${item.name}? It will be hidden from active lists.`)) return;
    try {
      if (DEV) state.inventory.items = state.inventory.items.filter((i) => i !== item);
      else await AgroAPI.archiveItem(state.farmId, item.id);
      await loadInventory(true);
      await refreshLookups();
      toast("Item archived.");
      renderView();
    } catch (err) {
      toast((err && err.message) || "We couldn't archive this item. Please try again.");
    }
  }

  /* ---------- Unit conversions for one item ---------- */
  async function openConversionsModal(itemId, trigger) {
    const item = state.inventory.items.find((i) => String(i.id) === String(itemId));
    if (!item) return;
    modalTrigger = trigger || document.activeElement;
    const units = state.inventory.units;
    const baseName = item.base_unit_name || (units.find((u) => String(u.id) === String(item.base_unit)) || {}).name || "base unit";
    let convs = [], loadErr = "", editing = null; // editing = the conversion being edited, or null when adding
    const devKey = `dev-conv-${item.id}`;
    state.inventory.devConv = state.inventory.devConv || {};

    const defs = [
      { name: "unit", label: "Unit", type: "select", placeholder: "Select unit", emptyText: "No units on the server yet", required: true, options: units.map((u) => [u.id, unitLabel(u)]) },
      { name: "factor", label: `Factor (how many ${baseName}?)`, type: "number", placeholder: "e.g. 30", required: true, min: 0.0001, step: "any" },
    ];
    const schema = { fields: defs };

    const listHTML = () => {
      if (loadErr) return `<p class="empty-line" style="padding:8px 0 0" role="alert">${esc(loadErr)}</p>`;
      if (convs === null) return `<div class="empty-line" style="padding:8px 0 0">Loading…</div>`;
      if (!convs.length) return `<p class="empty-line" style="padding:8px 0 0">No conversions yet. Without one, you cannot record this item in anything but its base unit.</p>`;
      // If your icon set has no "trash", the word "Delete" is shown instead of an empty button.
      const trash = icon("trash", 15) || "Delete";
      return `<div class="table-wrap mini-lines"><table><thead><tr><th>Conversion</th><th>Unit</th><th class="num">Factor</th><th>Base unit</th><th class="num">Actions</th></tr></thead><tbody>${convs.map((c) => {
        const mine = editing && String(editing.id) === String(c.id);
        const nm = esc(c.unit_name || "unit");
        return `<tr${mine ? ' class="is-editing" style="background:rgba(20,122,58,.08)"' : ""}><td>1 ${nm} = ${esc(fmtQty(c.factor))} ${esc(baseName)}</td><td>${esc(c.unit_name || "—")}</td><td class="num">${esc(fmtQty(c.factor))}</td><td>${c.is_base_unit ? "Yes" : "No"}</td>
          <td class="num"><span style="display:inline-flex;gap:6px;align-items:center">
            <button class="icon-btn square row-btn" type="button" data-conv-edit="${esc(c.id)}" title="Edit" aria-label="Edit the ${nm} conversion">${icon("edit", 15)}</button>
            <button class="icon-btn square row-btn" type="button" data-conv-delete="${esc(c.id)}" title="Delete" aria-label="Delete the ${nm} conversion">${trash}</button>
          </span></td></tr>`;
      }).join("")}</tbody></table></div>`;
    };
    const paintList = () => { const el = $("#conv-list"); if (el) el.innerHTML = listHTML(); };

    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <div class="dv-head"><h2 id="modal-title">Unit conversions</h2><span class="dv-badge">${esc(categoryLabel(item.category))}</span></div>
          <p class="sub">${esc(item.name)}: base unit is ${esc(baseName)}. Set how many ${esc(baseName)} each unit holds. Nothing is assumed, so a crate is only as big as you say it is.</p>
          <h3 class="dv-h">Existing conversions</h3>
          <div id="conv-list">${listHTML()}</div>
          <h3 class="dv-h" id="conv-form-title">Add new conversion</h3>
          <form id="conv-form" novalidate>
            <div class="form-grid" id="form-grid">
              ${defs.map(fieldHTML).join("")}
              <div class="field" data-name="is_base_unit" style="grid-column:1/-1">
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer"><input type="checkbox" id="f-is_base_unit" name="is_base_unit" style="width:18px;height:18px;accent-color:#147a3a"><span>This is the base unit (factor is 1)</span></label>
                <p class="error" id="e-is_base_unit" role="alert"></p>
              </div>
            </div>
            <p class="form-error" id="form-error" role="alert"></p>
            <div class="actions"><button class="btn" id="save-btn" type="submit" data-label="Add conversion">Add conversion</button><button class="btn ghost" type="button" id="cancel-edit" hidden>Cancel edit</button><button class="btn ghost" type="button" data-close>Close</button></div>
          </form>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const form = $("#conv-form");

    // Switches the form between "add" (conv = null) and "edit this conversion".
    const setMode = (conv) => {
      editing = conv || null;
      form.reset();
      const fac = field(form, "factor");
      fac.readOnly = false;
      defs.forEach((d) => setError(d.name, ""));
      setError("is_base_unit", "");
      $("#form-error").textContent = "";
      if (conv) {
        field(form, "unit").value = String(conv.unit);
        fac.value = String(conv.factor);
        field(form, "is_base_unit").checked = !!conv.is_base_unit;
        fac.readOnly = !!conv.is_base_unit;
      }
      $("#conv-form-title").textContent = conv ? "Edit conversion" : "Add new conversion";
      const sb = $("#save-btn");
      sb.dataset.label = conv ? "Save changes" : "Add conversion";
      sb.textContent = sb.dataset.label;
      $("#cancel-edit").hidden = !conv;
      paintList();
      if (conv) { fac.focus(); form.scrollIntoView({ block: "nearest" }); }
    };
    $("#cancel-edit").addEventListener("click", () => setMode(null));

    // Ticking "base unit" fixes the factor at 1 and picks the item's own base unit when it is known.
    form.addEventListener("change", (e) => {
      if (e.target.id !== "f-is_base_unit") return;
      const on = e.target.checked, fac = field(form, "factor");
      fac.value = on ? "1" : "";
      fac.readOnly = on;
      if (on && item.base_unit != null && field(form, "unit")) field(form, "unit").value = String(item.base_unit);
    });

    const fetchList = async () => {
      if (DEV) { convs = state.inventory.devConv[devKey] || []; paintList(); return; }
      try { convs = await AgroAPI.listConversions(state.farmId, item.id); loadErr = ""; }
      catch (err) { convs = []; loadErr = "We couldn't load the conversions for this item."; }
      paintList();
    };
    convs = null;
    paintList();
    fetchList();

    // Delete: confirm, call the API, then refresh this list, the Inventory table and the form dropdowns.
    const removeConversion = async (c) => {
      if (!confirm(`Are you sure you want to delete the conversion 1 ${c.unit_name || "unit"} = ${fmtQty(c.factor)} ${baseName}?`)) return;
      try {
        if (DEV) state.inventory.devConv[devKey] = (state.inventory.devConv[devKey] || []).filter((x) => String(x.id) !== String(c.id));
        else await AgroAPI.deleteConversion(state.farmId, item.id, c.id);
        if (editing && String(editing.id) === String(c.id)) setMode(null);
        await fetchList();
        await loadInventory(true);
        await refreshLookups();
        renderView();
        toast("Conversion deleted.");
      } catch (err) {
        toast((err && err.message) || "We couldn't delete this conversion. Please try again.");
      }
    };

    // The Edit and Delete buttons sit inside #conv-list, which is repainted, so listen on the container.
    $("#conv-list").addEventListener("click", (e) => {
      const ed = e.target.closest("[data-conv-edit]"), del = e.target.closest("[data-conv-delete]");
      const find = (id) => (convs || []).find((c) => String(c.id) === String(id));
      if (ed) { const c = find(ed.dataset.convEdit); if (c) setMode(c); }
      else if (del) { const c = find(del.dataset.convDelete); if (c) removeConversion(c); }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      const v = readValues(form, schema);
      const isBase = field(form, "is_base_unit").checked;
      defs.forEach((d) => setError(d.name, ""));
      setError("is_base_unit", "");
      $("#form-error").textContent = "";
      const errs = validate(v, schema);
      if (!errs.unit && Array.isArray(convs) && convs.some((c) => String(c.unit) === String(v.unit) && (!editing || String(c.id) !== String(editing.id)))) errs.unit = "This unit already has a conversion for this item.";
      const bad = defs.map((d) => d.name).filter((n) => errs[n]);
      if (bad.length) {
        bad.forEach((n) => setError(n, errs[n]));
        const el = $("#f-" + bad[0]); if (el) el.focus();
        return;
      }
      const btn = $("#save-btn"), errEl = $("#form-error");
      const wasEditing = !!editing;
      saving = true; btn.disabled = true; btn.textContent = "Saving…";
      try {
        const body = { unit: v.unit, factor: isBase ? 1 : v.factor, is_base_unit: isBase };
        if (DEV) {
          const u = units.find((x) => String(x.id) === String(v.unit));
          const row = { unit: v.unit, unit_name: u ? u.name : "", factor: body.factor, is_base_unit: isBase };
          const list = state.inventory.devConv[devKey] || [];
          state.inventory.devConv[devKey] = wasEditing
            ? list.map((c) => (String(c.id) === String(editing.id) ? { ...c, ...row } : c))
            : [...list, { id: uid(), ...row }];
        } else if (wasEditing) {
          await AgroAPI.updateConversion(state.farmId, item.id, editing.id, body);
        } else {
          await AgroAPI.createConversion(state.farmId, item.id, body);
        }
        await fetchList();          // update the table of conversions inside this window
        setMode(null);              // back to "add" mode with an empty form
        await loadInventory(true);  // silent reload, the Inventory table stays visible
        await refreshLookups();     // update the dropdowns in the Sales, Purchase and Sell Birds forms
        renderView();
        toast(wasEditing ? "Conversion updated." : "Conversion added.");
        const first = field(form, "unit"); if (first) first.focus();
      } catch (err) {
        let msg = "We couldn't save this conversion. Please try again.";
        if (err && err.name === "ApiError") {
          const entries = Object.entries(err.fields || {}).map(([n, m]) => [n, errText(m)]);
          const known = entries.filter(([n]) => defs.some((d) => d.name === n) || n === "is_base_unit");
          const rest = entries.filter((x) => !known.includes(x));
          known.forEach(([n, m]) => setError(n, m));
          msg = rest.length ? rest.map(([n, m]) => `${n}: ${m}`).join(" ") : known.length ? "" : err.message;
        }
        errEl.textContent = msg;
      } finally {
        saving = false;
        btn.disabled = false; btn.textContent = btn.dataset.label;
      }
    });
    const firstEl = $("select:not([disabled])", form);
    (firstEl || $(".close")).focus();
  }

  /* ---------- Stock history (the stock ledger for one item) ---------- */
  async function openStockHistoryModal(itemId, trigger) {
    const item = findItem(itemId);
    if (!item) return;
    modalTrigger = trigger || document.activeElement;
    const baseName = item.base_unit_name || (state.inventory.units.find((u) => String(u.id) === String(item.base_unit)) || {}).name || "";

    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <div class="dv-head"><h2 id="modal-title">Stock history</h2><span class="dv-badge">${esc(categoryLabel(item.category))}</span></div>
          <p class="sub">${esc(item.name)}: every recorded stock movement${baseName ? ", counted in " + esc(baseName) : ""}.</p>
          <div id="history-list"><div class="empty-line" style="padding:8px 0 0">Loading…</div></div>
          <div class="actions" style="margin-top:24px"><button class="btn" type="button" data-close>Close</button></div>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const closeBtn = $(".actions [data-close]");
    if (closeBtn) closeBtn.focus();

    try {
      const movements = DEV ? [] : await AgroAPI.listStockMovements(state.farmId, item.id);
      const listEl = $("#history-list");
      if (!listEl) return; // the window was closed while this was loading
      if (!movements.length) {
        listEl.innerHTML = `<p class="empty-line" style="padding:8px 0 0">No stock movements recorded yet. Record a purchase or production to see history here.</p>`;
        return;
      }
      listEl.innerHTML = `<div class="table-wrap mini-lines"><table><thead><tr><th>Date</th><th>Source</th><th>Direction</th><th class="num">Quantity</th><th>Notes</th></tr></thead><tbody>${movements.map((m) => {
        const inbound = String(m.direction || "").toUpperCase() === "IN";
        return `<tr><td>${esc(fmtDate(String(m.event_date || "").slice(0, 10)))}</td><td>${esc(m.source_type || "—")}</td><td><b style="color:${inbound ? "#147a3a" : "#c0392b"}">${esc(m.direction || "—")}</b></td><td class="num">${esc(fmtQty(num(m.quantity)))}</td><td>${esc(m.notes || "—")}</td></tr>`;
      }).join("")}</tbody></table></div>`;
    } catch (err) {
      const listEl = $("#history-list");
      if (listEl) listEl.innerHTML = `<p class="empty-line" style="padding:8px 0 0" role="alert">We couldn't load the stock history for this item.</p>`;
    }
  }