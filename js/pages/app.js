/* js/pages/app.js - entry point, loaded last */
"use strict";

  async function boot() {
    state.status = "loading"; renderView();
    try {
      if (!DEV && !state.authed) { state.user = await AgroAPI.me(); state.authed = true; }
      await api.loadFarms();
      if (state.farms.length) {
        if (!state.farms.some((f) => f.id === state.farmId)) state.farmId = state.farms[0].id;
        await api.load();
      } else {
        state.farmId = null; state.data = emptyData();
      }
      state.status = "ready";
    } catch (e) {
      // not signed in (or the session expired): back to the sign-in page
      if (e && (e.status === 401 || (e.status === 403 && !state.authed))) { location.replace(AgroAPI.pages.signIn); return; }
      state.status = e && e.status === 403 ? "forbidden" : "error";
    }
    renderShell();
    renderView();
  }


renderShell();
boot();
