/* js/core/styles.js - injected CSS */
"use strict";

  /* =====================================================================
     START
     ===================================================================== */
  // Styles for the farm type step. They live here so this feature works without touching the CSS file;
  // move them into your stylesheet whenever you like.
  (function injectStyles() {
    const st = document.createElement("style");
    st.textContent = `
      .type-search { margin: 16px 0 0; }
      .modal .type-group { margin: 20px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #6b6b6b; }
      .type-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
      button.type-card { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; padding: 14px; font: inherit; color: inherit; background: #fff; border: 1.5px solid var(--line, #e3e3e3); border-radius: 12px; cursor: pointer; transition: border-color .15s, background .15s; }
      .type-card b { font-size: 14px; font-weight: 600; }
      .type-card small { font-size: 12px; line-height: 1.4; color: #6b6b6b; font-weight: 400; }
      .type-card:hover { border-color: #9fc9ad; }
      .type-card:focus-visible { outline: 2px solid #147a3a; outline-offset: 2px; }
      .type-card.soon { background: #fafafa; }
      .type-card.soon b { color: #5f5f5f; }
      .type-card.on { border-color: #147a3a; background: #eef7f1; }
      .type-badge { margin-top: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600; border-radius: 999px; background: #e3f2e8; color: #147a3a; }
      .type-card.soon .type-badge { background: #efefef; color: #666; }
      .modal .type-note { margin: 16px 0 0; padding: 12px 14px; font-size: 13px; line-height: 1.5; color: #5c4a12; background: #fff8e6; border: 1px solid #f3dca0; border-radius: 10px; }
      .type-chip { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; font-size: 13px; color: #555; }
      .type-chip b { color: #147a3a; font-weight: 600; }
      .adj-list { margin: 8px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.6; color: #444; }
      .adj-list li + li { margin-top: 6px; }
      .mini-lines { margin-top: 8px; border: 1px solid var(--line, #e3e3e3); border-radius: 10px; overflow-x: auto; }
      .mini-lines table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .mini-lines th, .mini-lines td { padding: 8px 12px; text-align: left; white-space: nowrap; }
      .mini-lines th.num, .mini-lines td.num { text-align: right; }
      .mini-lines thead th { font-weight: 600; color: #6b6b6b; border-bottom: 1px solid var(--line, #e3e3e3); }
      .modal .dv-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding-right: 36px; }
      .modal .dv-head h2 { margin: 0; }
      .dv-badge { padding: 3px 11px; font-size: 12px; font-weight: 600; border-radius: 999px; background: #efefef; color: #555; }
      .dv-badge.ok { background: #e3f2e8; color: #147a3a; }
      .dv-badge.warn { background: #fff4d6; color: #8a6100; }
      .dv-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0 0; }
      .dv-stat { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 14px; background: #fff; border: 1px solid var(--line, #e3e3e3); border-radius: 14px; }
      .dv-stat { border-left: 4px solid #d6d9d6; }
      .dv-stat.green { border-left-color: #147a3a; }
      .dv-stat.amber { border-left-color: #f3b93a; }
      .dv-stat.red { border-left-color: #c0392b; }
      .dv-st { min-width: 0; }
      .dv-st small { display: block; font-size: 12px; color: #6b6b6b; }
      .dv-st b { display: block; margin-top: 2px; font-size: 18px; font-weight: 600; line-height: 1.25; color: #1a1a1a; overflow-wrap: anywhere; }
      .modal .dv-h { margin: 24px 0 10px; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #6b6b6b; text-align: left; }
      .dv-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 24px; margin: 0; padding: 16px 18px; background: #fafcfa; border: 1px solid var(--line, #e3e3e3); border-radius: 14px; }
      .dv-item dt { font-size: 12px; font-weight: 500; color: #6b6b6b; }
      .dv-item dd { margin: 3px 0 0; font-size: 14px; font-weight: 500; line-height: 1.45; color: #1a1a1a; overflow-wrap: anywhere; }
      .dv-item dd.dv-empty { font-weight: 400; color: #a3a3a3; }
      .dv-item.dv-long { grid-column: 1 / -1; }
      .dv-item dd.dv-clamp:not(.dv-open) { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .dv-more { margin-top: 4px; padding: 0; font-size: 12px; font-weight: 600; color: #147a3a; }
      .dv-item.dv-long dd { white-space: pre-wrap; font-weight: 400; }
      .modal .adj-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
      .modal .adj-list li { margin: 0; padding: 10px 14px; font-size: 13px; line-height: 1.55; color: #3d3d3d; background: #f6faf7; border-left: 3px solid #147a3a; border-radius: 8px; }
      .dv-meta { margin: 20px 0 0; font-size: 12px; color: #8a8a8a; }
      @media (max-width: 640px) { .dv-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 420px) { .dv-grid { grid-template-columns: minmax(0, 1fr); } }
      td.trunc { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    `;
    document.head.appendChild(st);
  })();

