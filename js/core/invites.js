/* js/core/invites.js - accept-invitation call and the pending-invite token.
   Loaded right after api.js. It adds to AgroAPI and changes nothing in api.js. */
(function (global) {
  "use strict";

  const AgroAPI = global.AgroAPI;
  if (!AgroAPI) return;

  const KEY = "agroflow:v1:pendingInvite";
  const ACCEPT_PATH = "/api/invitations/accept/";

  // ---- Pending token: survives the redirect to the sign-in page and back ----
  AgroAPI.pendingInvite = {
    get: function () {
      try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
    },
    set: function (token) {
      try { localStorage.setItem(KEY, String(token)); } catch (e) { /* storage unavailable */ }
    },
    clear: function () {
      try { localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ }
    },
  };

  // ---- CSRF (same approach as api.js) ----
  function cookie(name) {
    const m = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }

  async function csrfToken(force) {
    const existing = cookie("csrftoken");
    if (existing && !force) return existing;
    try {
      const res = await fetch(AgroAPI.config.API_BASE + AgroAPI.config.ENDPOINTS.csrf, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      let d = null;
      try { d = await res.json(); } catch (e) { /* no body */ }
      return (d && (d.csrfToken || d.csrf_token)) || cookie("csrftoken") || "";
    } catch (e) {
      return "";
    }
  }

  // POST /api/invitations/accept/  with { token }
  // Resolves with the server's JSON (for example { message: "Successfully joined the farm!" }).
  // Rejects with an AgroAPI.ApiError whose .message is the server's message
  // (for example the "different email address" error) and whose .status is the HTTP status.
  AgroAPI.acceptInvitation = async function (token) {
    if (AgroAPI.mock) return { message: "Successfully joined the farm!" };
    const clean = String(token || "").trim();
    if (!clean) throw new AgroAPI.ApiError(0, null, "This invitation link is missing its token.");

    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await fetch(AgroAPI.config.API_BASE + ACCEPT_PATH, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-CSRFToken": await csrfToken(attempt > 0),
          },
          body: JSON.stringify({ token: clean }),
        });
      } catch (e) {
        throw new AgroAPI.ApiError(0, null);
      }
      let data = null;
      try { data = await res.json(); } catch (e) { /* no body */ }

      // A 403 can be a stale CSRF token. Retry once with a fresh one.
      // A real "wrong email" 403 comes back again and is thrown below.
      if (res.status === 403 && attempt === 0 && !(data && (data.detail || data.error || data.message) && !/csrf/i.test(JSON.stringify(data)))) {
        continue;
      }
      if (!res.ok) throw new AgroAPI.ApiError(res.status, data);
      return data || {};
    }
    throw new AgroAPI.ApiError(0, null, "We could not accept this invitation. Please try again.");
  };
})(window);