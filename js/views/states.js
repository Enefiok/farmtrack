/* js/views/states.js - loading, error, restricted, empty views */
"use strict";

  /* =====================================================================
     VIEWS
     ===================================================================== */
  function loadingView() { return `<div class="state-card"><div class="spinner"></div><p>Loading…</p></div>`; }

  function errorView() {
    return `<div class="state-card err" role="alert">${icon("alert", 28)}<h2>Something went wrong</h2><p>We couldn't load these records.</p><button class="btn pill" data-action="retry">Try again</button></div>`;
  }

  function restrictedView() {
    return `<div class="state-card restricted">${icon("shield", 28)}<h2>Access restricted</h2><p>You don't have permission to view this page</p><button class="btn pill" data-action="go-dashboard">Back to Dashboard</button></div>`;
  }
  // Role comes from the farm membership. ?role=staff previews a limited user.
  const userRole = () => String(params.get("role") || (farm() && farm().role) || "OWNER").toUpperCase();
  const canManageUsers = () => ["OWNER", "ADMIN", "ADMINISTRATOR"].includes(userRole());

  function noFarmView() {
    return `<div class="state-card">${icon("inbox", 28)}<h2>No farms yet</h2><p>Create your first farm</p><button class="btn" data-action="create-farm">${icon("plus", 14)}Create Farm</button></div>`;
  }

  function comingSoon(title) {
    return `<div class="state-card">${icon("inbox", 28)}<h2>${esc(title)}</h2><p>This section hasn't been built yet.</p></div>`;
  }

