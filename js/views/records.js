/* js/views/records.js - recordsView (the tables) */
"use strict";

  // Newest first: by when the record was created, then by its date, then by id.
  const newestFirst = (rows) => rows.slice().sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime() || 0;
    const tb = new Date(b.created_at || 0).getTime() || 0;
    if (tb !== ta) return tb - ta;
    const byDate = String(b.date || "").localeCompare(String(a.date || ""));
    if (byDate) return byDate;
    return num(b.id) - num(a.id);
  });

  function recordsView(type) {
    const rows = newestFirst(state.data[type]);
    const cols = COLS[type];
    const q = state.query.trim().toLowerCase();
    const cells = (r) => cols.map(([, fn]) => String(fn(r) ?? ""));
    const shown = q ? rows.filter((r) => cells(r).join(" ").toLowerCase().includes(q)) : rows;
    const label = TABS.find((t) => t[0] === type)[1];

    // Permanent entry point for users who skipped the dashboard card
    const addExisting = type === "flock" ? `<button class="btn ghost" data-action="add-existing">${icon("bird", 16)}Add existing flocks</button>` : "";
    const toolbar = `<div class="toolbar">
      <div class="tabs" role="tablist" aria-label="Record types">${visibleTabs().map(([k, l]) => `<button class="tab" role="tab" aria-selected="${k === type}" data-tab="${k}">${l}</button>`).join("")}</div>
      <div class="toolbar-actions">${addExisting}${type === "adjustment" ? "" : `<button class="btn" data-action="add-record" data-type="${type}">${icon("plus", 14)}Add Record</button>`}</div>
    </div>`;

    if (!rows.length) {
      if (type === "adjustment") return toolbar + `<div class="state-card">${icon("inbox", 28)}<h2>No adjustments yet</h2><p>Corrections made with the pencil on a record will be listed here.</p></div>`;
      return toolbar + `<div class="state-card">${icon("inbox", 28)}<h2>No records yet</h2><p>Add your first record to get started</p><button class="btn" data-action="add-record" data-type="${type}">${icon("plus", 14)}Add Record</button></div>`;
    }
    const rowAction = ROW_ACTIONS[type];
    const head = cols.map(([h, , n]) => `<th class="${n ? "num" : ""}">${esc(h)}</th>`).join("") + (rowAction ? `<th class="num">Actions</th>` : "");
    // A column with the 4th flag is shortened on screen with "…" and shows the full text on hover.
    // The data itself (CSV export, search) is never shortened.
    const cellHTML = (r, [, fn, n, trunc]) => {
      const txt = fn(r);
      return trunc
        ? `<td class="trunc" title="${esc(txt)}">${esc(txt)}</td>`
        : `<td class="${n ? "num" : ""}">${esc(txt)}</td>`;
    };
    const body = shown.map((r) => `<tr>${cols.map((c) => cellHTML(r, c)).join("")}${rowAction ? `<td class="num">${rowAction(r)}</td>` : ""}</tr>`).join("");
    return toolbar + `<section class="card table-card">
      <div class="table-head"><h3>${type === "adjustment" ? "Adjustment log" : esc(label) + " records"}</h3><div class="toolbar-actions"><button class="btn ghost" data-action="filter-records" data-type="${type}">${icon("filter", 14)}Filter</button><button class="icon-btn square" data-action="export-records" data-type="${type}" aria-label="Download all records" title="Download all records">${icon("download", 18)}</button></div></div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty-line" style="padding:24px 20px">No records match "${esc(state.query)}".</div>`}
    </section>`;
  }

