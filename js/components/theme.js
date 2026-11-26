/* js/components/theme.js - light / dark toggle for the app.
   Loaded in <head> so the saved choice is applied before the first paint (no flash).
   - No saved choice: the app follows the device setting, exactly as before.
   - After the toggle is used: the choice is saved in localStorage and wins over the device setting.
   It only sets data-theme="light" | "dark" on <html>; the colours live in css/pages/app.css and css/components/theme.css. */
"use strict";

(function () {
  const KEY = "agroflow-theme";
  const root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  const read = () => { try { const v = localStorage.getItem(KEY); return v === "dark" || v === "light" ? v : ""; } catch (e) { return ""; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* storage unavailable */ } };
  const current = () => read() || (mq && mq.matches ? "dark" : "light");
  const apply = (t) => { if (t) root.setAttribute("data-theme", t); else root.removeAttribute("data-theme"); };

  const svg = (d) => `<svg class="i" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const SUN = svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>');
  const MOON = svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>');

  // The button is in pages/app.html; this fills in its icon and label for the current theme.
  function paint() {
    const btn = document.getElementById("theme-btn");
    if (!btn) return;
    const dark = current() === "dark";
    const label = dark ? "Switch to light mode" : "Switch to dark mode";
    btn.innerHTML = dark ? SUN : MOON;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", String(dark));
    btn.title = label;
  }

  // Charts read their colours when they are drawn, so the open page is drawn again after a change.
  function redraw() {
    try { if (state.status === "ready") renderView(); } catch (e) { /* app not ready yet */ }
  }

  function toggle() {
    const next = current() === "dark" ? "light" : "dark";
    write(next);
    apply(next);
    paint();
    redraw();
  }

  apply(read());

  document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("#theme-btn")) toggle(); });
  document.addEventListener("DOMContentLoaded", paint);
  // Only matters while no choice is saved: the device switched between light and dark.
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (!read()) { paint(); redraw(); } });
})();