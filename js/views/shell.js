/* js/views/shell.js - renderShell, renderNav, route, renderView */
"use strict";

  /* =====================================================================
     SHELL RENDERING + ROUTER
     ===================================================================== */
  let lastTab = "flock";
  // A tab that is hidden for this farm type (e.g. Production on a meat-bird farm) falls back to Flock.
  // An unknown tab (for example an old #/records/adjustment link) also falls back to Flock.
  const pickTab = (sub) => {
    const ok = visibleTabs().map(([k]) => k);
    return ok.includes(sub) ? sub : ok.includes(lastTab) ? lastTab : "flock";
  };
  function route() {
    const [, page = "dashboard", sub] = location.hash.split("/");
    const p = NAV.some((n) => n[0] === page) ? page : "dashboard";
    return { page: p, sub };
  }

  function renderShell() {
    const f = farm();
    // No farm yet: no search bar and no green farm button, only the "No farms yet" box in the page.
    $(".farm-wrap").hidden = !f;
    $("#search-box").hidden = !f;
    document.body.classList.toggle("no-farm", !f);
    const btn = $("#farm-btn");
    if (f) {
      btn.setAttribute("data-menu", "farm-menu");
      btn.innerHTML = `<div><b>${esc(f.name)}</b>${f.location ? `<small>${esc(f.location)}</small>` : ""}</div>${icon("chevronDown", 16)}`;
    }
    // Farm switcher: every farm the user belongs to, plus "Add new farm"
    $("#farm-menu").innerHTML =
      `<div class="menu-label">Your farms</div>` +
      state.farms.map((x) => {
        const on = x.id === state.farmId;
        return `<button class="menu-item${on ? " on" : ""}" data-action="switch-farm" data-id="${esc(x.id)}" role="menuitemradio" aria-checked="${on}"><span class="mi-txt"><b>${esc(x.name)}</b>${x.location ? `<small>${esc(x.location)}</small>` : ""}</span>${on ? icon("check", 16) : ""}</button>`;
      }).join("") +
      `<div class="menu-sep"></div><button class="menu-item menu-add" data-action="create-farm">${icon("plus", 16)}<span>Add new farm</span></button>`;
    $("#menu-btn").innerHTML = icon("menu", 20);
    $("#search-box").innerHTML = `${icon("search", 18)}<input id="search" type="search" placeholder="Search" aria-label="Search" autocomplete="off">`;
    $("#bell-btn").innerHTML = icon("bell", 18);
    $("#user-btn").innerHTML = `<span class="avatar" aria-hidden="true">${esc(initials(state.user.name))}</span><div><b>${esc(state.user.name)}</b><small>${esc(state.user.email)}</small></div>${icon("chevronDown", 18)}`;
    $("#user-menu").innerHTML = `<div class="head"><b>${esc(state.user.name)}</b><span>${esc(state.user.email)}</span></div><button data-action="signout">Sign out ${icon("logout", 16)}</button>`;
  }

  function renderNav() {
    const { page } = route();
    $("#nav").innerHTML = NAV.map(([k, l]) =>
      `<a class="nav-link" href="#/${k}" ${k === page ? 'aria-current="page"' : ""}>${icon(NAV_ICON[k], 18)}<span>${esc(l)}</span></a>`).join("");
  }

  function renderView() {
    renderNav();
    const view = $("#view");
    const { page, sub } = route();
    const names = Object.fromEntries(NAV);
    document.title = `${names[page]} | AgroFlow`;
    if (state.status === "loading") { view.innerHTML = loadingView(); return; }
    if (state.status === "error") { view.innerHTML = errorView(); return; }
    if (state.status === "forbidden") { view.innerHTML = restrictedView(); return; }
    if (!state.farms.length) { view.innerHTML = noFarmView(); return; }
    if (params.has("restricted") && page === "dashboard") { view.innerHTML = restrictedView(); return; } // preview of the design
    if (page === "users" && !canManageUsers()) { view.innerHTML = restrictedView(); return; }
    if (page === "dashboard") {
      view.innerHTML = dashboardView();
      bindChart();
    } else if (page === "records") {
      const type = pickTab(sub);
      lastTab = type;
      view.innerHTML = recordsView(type);
    } else if (page === "inventory") {
      if (state.inventory.farmId !== state.farmId) state.inventory = { items: [], units: [], status: "idle", farmId: state.farmId };
      if (state.inventory.status === "idle") loadInventory();
      view.innerHTML = inventoryView();
    } else {
      view.innerHTML = comingSoon(names[page]);
    }
  }

