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

  function exportRecords(type) {
    const rows = newestFirst(state.data[type]);
    if (!rows.length) { toast("There are no records to export yet."); return; }
    downloadCSV(type, [COLS[type].map((c) => c[0]), ...rows.map((r) => COLS[type].map(([, fn]) => fn(r)))]);
  }

  function exportDashboard() {
    const { inc, exp } = monthly();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    downloadCSV("financial-overview", [["Month", "Income", "Expenses"], ...months.map((m, i) => [m, inc[i], exp[i]])]);
  }

