/* js/export/csv.js - CSV export */
"use strict";

  /* =====================================================================
     EXPORT (CSV)
     ===================================================================== */
  function downloadCSV(name, rows) {
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${farm().name.toLowerCase().replace(/\s+/g, "-")}-${name}-${localISO(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Exports what the table is showing. Report tabs use the same rows (date range, flock/customer/supplier/category,
  // activity type, search) and the same columns as the on-screen table; other tabs export every record.
  function exportRecords(type) {
    const reportTab = typeof repCfg === "function" && TAB_REPORT_CONFIG[type] && !TAB_REPORT_CONFIG[type].ownsTable && REPORT_ENABLED.includes(type);
    let rows, cols, filtered = false;
    if (reportTab) {
      const s = repOf(type);
      if (!repData(type).length) { toast("There are no records to export yet."); return; }
      rows = repRows(type, s);
      cols = repTableCols(type, s);
      filtered = true;
    } else {
      rows = newestFirst(state.data[type]);
      cols = COLS[type];
      if (!rows.length) { toast("There are no records to export yet."); return; }
    }
    if (!rows.length) { toast(filtered ? "No records match your filters, so there is nothing to export." : "There are no records to export yet."); return; }
    downloadCSV(type, [cols.map((c) => c[0]), ...rows.map((r) => cols.map(([, fn]) => fn(r)))]);
  }

  // Exports what the dashboard is showing for the chosen period: the cards, then the Financial Overview table.
  function exportDashboard() {
    const m = metrics(), fin = finSeries(), per = dashPeriod();
    const pct = (v) => (v == null ? "" : Math.round(v * 10) / 10);
    const sum = (a) => a.reduce((t, v) => t + v, 0);
    const unit = { day: "Day", month: "Month", quarter: "Quarter" }[fin.gran];
    const rows = [
      ["Farm", farm().name],
      ["Period", per[1]],
      ["From", fin.from],
      ["To", fin.to],
      ["Currency", typeof currencyCode === "function" ? currencyCode() : ""],
      ["Exported", new Date().toLocaleString("en-GB")],
      [],
      ["Summary", "Value", "Change vs previous period (%)"],
      ["Live birds (now)", m.live, ""],
      hasEggs()
        ? ["Eggs collected", m.eggsToday, pct(m.eggsDelta)]
        : ["Active flocks (now)", state.data.flock.filter((f) => f.status === "Active").length, ""],
      ["Stock value (now)", m.stockValue == null ? "" : m.stockValue, ""],
      ["Sales", m.sellM, pct(m.sellDelta)],
      [],
      [`Financial overview by ${unit.toLowerCase()}`],
      [unit, "Income", "Expenses", "Profit"],
      ...fin.tips.map((t, i) => [t, fin.I[i], fin.E[i], fin.P[i]]),
      ["Total", sum(fin.I), sum(fin.E), sum(fin.P)],
    ];
    downloadCSV("dashboard", rows);
  }