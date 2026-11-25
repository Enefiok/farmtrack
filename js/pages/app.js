/* js/pages/app.js - entry point, loaded last */
"use strict";

  /* =====================================================================
     INVITE LINK CAPTURE
     An invite email opens  app.html#/accept-invite?token=XYZ
     This runs once, before the first render, and does two things:
       1. saves the token (so it survives the trip to the sign-in page and back)
       2. removes it from the address bar (so it is not left in history or re-read)
     boot() then accepts the saved token as soon as the user is signed in.
     ===================================================================== */
  (function captureInviteToken() {
    const h = location.hash || "";
    if (h.indexOf("#/accept-invite") !== 0) return;
    const q = h.indexOf("?") === -1 ? "" : h.slice(h.indexOf("?") + 1);
    const token = new URLSearchParams(q).get("token");
    if (token) AgroAPI.pendingInvite.set(token);
    try {
      history.replaceState(null, "", location.pathname + location.search + "#/dashboard");
    } catch (e) {
      location.hash = "#/dashboard";
    }
  })();

  // Picks the joined farm's id out of the accept response, whatever shape the server uses.
  function joinedFarmId(r) {
    if (!r || typeof r !== "object") return "";
    const f = r.farm;
    if (f != null && typeof f === "object" && f.id != null) return String(f.id);
    if (f != null && typeof f !== "object") return String(f);
    if (r.farm_id != null) return String(r.farm_id);
    const m = r.membership;
    if (m && m.farm != null) return String(typeof m.farm === "object" ? m.farm.id : m.farm);
    return "";
  }
  function joinedFarmName(r) {
    if (!r || typeof r !== "object") return "";
    return String(r.farm_name || (r.farm && typeof r.farm === "object" && r.farm.name) || "").trim().toLowerCase();
  }

  async function boot() {
    state.status = "loading"; renderView();
    let inviteResult = null;    // the server's answer when an invitation was accepted
    let inviteError = "";       // the server's message when it was refused
    try {
      if (!DEV && !state.authed) { state.user = await AgroAPI.me(); state.authed = true; }

      // Signed in and holding an invitation token: accept it before the farms are loaded,
      // so the joined farm is already in the list below.
      const token = !DEV ? AgroAPI.pendingInvite.get() : "";
      if (token) {
        try {
          inviteResult = await AgroAPI.acceptInvitation(token);
          AgroAPI.pendingInvite.clear();
        } catch (err) {
          // A network problem or a server error keeps the token so a reload can try again.
          // Anything else (wrong email, expired, already used) is final, so the token is dropped.
          const retryable = !err || err.status === 0 || err.status === 401 || err.status >= 500;
          if (!retryable) AgroAPI.pendingInvite.clear();
          if (err && (err.status === 401)) throw err;   // session ended: handled below, token is kept
          inviteError = (err && err.message) || "We could not accept this invitation.";
        }
      }

      await api.loadFarms();
      if (state.farms.length) {
        let target = "";
        if (inviteResult) {
          const id = joinedFarmId(inviteResult), name = joinedFarmName(inviteResult);
          const hit = state.farms.find((f) => (id && f.id === id) || (name && String(f.name).trim().toLowerCase() === name));
          if (hit) target = hit.id;
        }
        if (target) state.farmId = target;
        else if (!state.farms.some((f) => f.id === state.farmId)) state.farmId = state.farms[0].id;
        await api.load();
      } else {
        state.farmId = null; state.data = emptyData();
      }
      state.status = "ready";
    } catch (e) {
      // not signed in (or the session expired): back to the sign-in page.
      // A pending invitation token stays in storage and is accepted after the user signs in.
      if (e && (e.status === 401 || (e.status === 403 && !state.authed))) { location.replace(AgroAPI.pages.signIn); return; }
      state.status = e && e.status === 403 ? "forbidden" : "error";
    }
    renderShell();
    renderView();

    if (inviteResult) {
      location.hash = "#/dashboard";
      toast((inviteResult.message || "You have joined the farm.").replace(/!$/, "."));
    } else if (inviteError) {
      toast(inviteError);
    }
  }


renderShell();
boot();