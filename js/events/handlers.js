/* js/events/handlers.js - all event listeners */
"use strict";

  /* =====================================================================
     EVENTS
     ===================================================================== */
  function closeMenus(except) {
    $$(".menu").forEach((m) => { if (m !== except) m.hidden = true; });
  }
    // Menus inside the table sit in a box that clips overflow, so they are placed on screen next to their button.
  function placeMenu(menu, btn) {
    const r = btn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = "auto";
    menu.style.right = Math.max(8, window.innerWidth - r.right) + "px";
    menu.style.top = (r.bottom + 6) + "px";
    const h = menu.offsetHeight;
    if (r.bottom + 6 + h > window.innerHeight - 8) menu.style.top = Math.max(8, r.top - 6 - h) + "px";
  }
  window.addEventListener("scroll", () => closeMenus(), true);
  const closeNav = () => document.body.classList.remove("nav-open");

  document.addEventListener("click", (e) => {
    const t = e.target;

    const menuBtn = t.closest("[data-menu]");
    if (menuBtn) {
      const menu = document.getElementById(menuBtn.dataset.menu);
      const willOpen = menu.hidden;
      closeMenus();
      menu.hidden = !willOpen;
      if (willOpen && menuBtn.hasAttribute("data-fixed")) placeMenu(menu, menuBtn);
      return;
    }
    if (!t.closest(".menu")) closeMenus();

    if (t.closest("#menu-btn")) { document.body.classList.toggle("nav-open"); return; }
    if (t.closest("#scrim") || t.closest(".nav-link")) closeNav();

    if (t.id === "backdrop" || t.closest("[data-close]")) { closeModal(); return; }

    const tab = t.closest("[data-tab]");
    if (tab) { location.hash = "#/records/" + tab.dataset.tab; return; }

    const act = t.closest("[data-action]");
    if (!act) return;
        if (act.closest(".tbl-menu")) closeMenus();
    switch (act.dataset.action) {
      case "add-record": openModal(act.dataset.type, act); break;
      case "add-existing": openModal("opening", act); break;
      case "view-flock": openViewFlockModal(act.dataset.id, act); break;
      case "sell-flock": openSellFlockModal(act.dataset.id, act); break;
      case "adjust-record": openAdjustModal(act.dataset.rtype, act.dataset.id, act); break;
      case "record-payment": openPaymentModal(act.dataset.id, act.dataset.rtype, act); break;
      case "view-production": openViewProductionModal(act.dataset.id, act); break;
      case "view-activity": openViewActivityModal(act.dataset.id, act); break;
      case "view-purchase": openViewPurchaseModal(act.dataset.id, act); break;
      case "view-sale": openViewSaleModal(act.dataset.id, act); break;
      case "view-expense": openViewExpenseModal(act.dataset.id, act); break;
      case "add-item": openItemModal(null, act); break;
      case "edit-item": openEditItemModal(findItem(act.dataset.id), act); break;
      case "archive-item": archiveItemAction(findItem(act.dataset.id)); break;
      case "manage-conversions": openConversionsModal(act.dataset.id, act); break;
      case "stock-history": openStockHistoryModal(act.dataset.id, act); break;
      case "export-inventory": exportInventory(); break;
      case "inv-chart-view": state.invChartView = act.dataset.view; renderView(); break;
      case "inv-stock-filter": state.invStock = act.dataset.value; renderView(); break;
      case "retry-inventory": state.inventory.status = "idle"; renderView(); break;
      case "toggle-note": {
        const dd = act.previousElementSibling; // the note text sits just before the button
        const open = dd.classList.toggle("dv-open");
        act.textContent = open ? "Show less" : "Show more";
        act.setAttribute("aria-expanded", String(open));
        break;
      }
      case "view-adjustment": openViewAdjustmentModal(act.dataset.id, act); break;
      case "skip-opening":
        // Only hides the card for this farm; no data is deleted or locked.
        try { localStorage.setItem(skipKey(), "1"); } catch { /* storage unavailable */ }
        renderView();
        break;
      case "create-farm": {
        // opened from the farm dropdown: close it first and return focus to the farm button
        const fromMenu = act.closest(".menu");
        closeMenus();
        openFarmTypeStep(fromMenu ? $("#farm-btn") : act);
        break;
      }
      case "go-dashboard": location.hash = "#/dashboard"; break;
      case "retry": boot(); break;
      case "export-records": exportRecords(act.dataset.type); break;
      case "export-dashboard": exportDashboard(); break;
      case "review-flock": location.hash = "#/records/flock"; break;
      case "act-prev": state.actPage = Math.max(0, (state.actPage || 0) - 1); renderView(); break;
      case "act-next": state.actPage = (state.actPage || 0) + 1; renderView(); break;
      case "filter-records": state.recFilterOpen = !state.recFilterOpen; renderView(); break;
          case "apply-rec-filters": {
        const f = {};
        $$("[data-pf]").forEach((el) => { f[el.dataset.pf] = el.value; });
        if (f.from && f.to && f.from > f.to) { toast("The start date can't be after the end date."); break; }
        state.recFilters = { ...(state.recFilters || {}), [act.dataset.type]: f };
        state.recPage = 0; renderView(); break;
      }
      case "clear-rec-filters":
        state.recFilters = { ...(state.recFilters || {}), [act.dataset.type]: {} };
        state.recPage = 0; renderView(); break;
      case "rec-prev": state.recPage = Math.max(0, (state.recPage || 0) - 1); renderView(); break;
      case "rec-next": state.recPage = (state.recPage || 0) + 1; renderView(); break;
      case "switch-farm":
        closeMenus();
        if (act.dataset.id !== state.farmId) { state.farmId = act.dataset.id; boot(); }
        break;
      case "signout":
        (async () => {
          act.disabled = true;
          try {
            await AgroAPI.logout();
            location.assign(AgroAPI.pages.signIn);
          } catch (err) {
            act.disabled = false;
            toast(err.message || "We couldn't sign you out. Please try again.");
          }
        })();
        break;
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "range") {
      state.range = e.target.value;
      $("#chart").innerHTML = chartHTML();
      bindChart();
    }
        if (e.target.id === "inv-category") { state.invCategory = e.target.value; renderView(); }
        if (e.target.id === "dash-period") { state.dashPeriod = e.target.value; state.actPage = 0; renderView(); }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "search") {
      state.recPage = 0;
      state.query = e.target.value;
      if ((route().page === "records" || route().page === "inventory") && state.status === "ready") renderView();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("#backdrop")) closeModal();
      else { closeMenus(); closeNav(); }
      return;
    }
    if (e.key === "Tab" && $("#backdrop")) { // keep focus inside the modal
      const items = $$("button, input:not([readonly]), select:not([disabled]), textarea", $(".modal")).filter((el) => !el.closest("[hidden]"));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  let wasNarrow = window.innerWidth <= 640, resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      const nowNarrow = window.innerWidth <= 640;
      if (nowNarrow !== wasNarrow || nowNarrow) {
        wasNarrow = nowNarrow;
        if ($("#chart") && state.status === "ready") { $("#chart").innerHTML = chartHTML(); bindChart(); }
      }
    }, 150);
  });

  window.addEventListener("hashchange", () => {
    state.query = ""; const s = $("#search"); if (s) s.value = "";
    state.recPage = 0;
    renderView(); window.scrollTo(0, 0);
    // Opening a Records tab pulls fresh rows for that tab from the server
    const { page, sub } = route();
    // Opening Inventory shows what we have and quietly re-fetches the item list
       if ((page === "inventory" || page === "dashboard") && state.status === "ready" && state.inventory.status === "ready") loadInventory(true);
    if (page === "records" && state.status === "ready" && !DEV) {
      const type = pickTab(sub);
      api.refresh(type)
        .then(() => { if (route().page === "records" && state.status === "ready") renderView(); })
        .catch(() => { /* keep showing what we already have */ });
    }

  });