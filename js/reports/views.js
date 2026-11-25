/* =========================================================================
   views.js  (js/reports/views.js)
   The 12 report renderers. Registers RPT.views[reportKey].

   Contract (what js/views/reports.js will call):
     const v = RPT.views[key];                          // { extra?, render }
     const extra = v.extra ? await v.extra(ctx) : null; // only P&L uses this
     RPT.destroyAll();
     const out = v.render(data, Object.assign({}, ctx, { extra }));
     root.innerHTML = RPT.insights(data.insights) + out.html;
     if (out.post) out.post(root);                      // draws the charts

   ctx: { farmId, range: { start_date, end_date }, cmp: { a, b } (period-comparison only) }

   Every field read is tolerant: the confirmed backend key first, then
   alternates, then "—". Reports with no sample yet (cash-flow, hhep,
   inventory-valuation) also fall back to a generic table of whatever came back.
   ========================================================================= */
(function (global) {
  "use strict";

  const R = global.RPT;
  if (!R) { console.error("reports/views.js: load js/reports/charts.js first."); return; }

  const esc = R.esc, money = R.money, num = R.num, pctText = R.pctText, human = R.human;
  const fmtDate = R.fmtDate, fmtDateTime = R.fmtDateTime, addDays = R.addDays, toNum = R.toNum;
  const delta = R.delta, badge = R.badge, kpiCard = R.kpiCard, uid = R.uid, theme = R.theme;

  /* ---------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------- */
  const arr = function (v) { return Array.isArray(v) ? v : []; };
  const first = function (o, keys) {
    if (!o || typeof o !== "object") return undefined;
    for (let i = 0; i < keys.length; i++) {
      const v = o[keys[i]];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  const numOf = function (o, keys) { const v = first(o, keys); return v === undefined ? null : toNum(v); };
  const sum = function (list, fn) { return list.reduce(function (t, x) { return t + (toNum(fn(x)) || 0); }, 0); };
  const textOf = function (o, keys) { const v = first(o, keys); return v === undefined ? "" : String(v); };

  const emptyState = function (text) { return '<div class="ra-state"><b>' + esc(text || "No data in this period yet") + "</b></div>"; };
  const th = function (t, right) { return "<th" + (right ? ' class="num"' : "") + ">" + esc(t) + "</th>"; };
  const table = function (head, rows, cls) {
    return '<div class="ra-table-wrap"><table class="ra-table ' + (cls || "") + '"><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  };
  const moneyCell = function (v) { const x = toNum(v); return '<td class="num' + (x !== null && x < 0 ? " neg" : "") + '">' + (x === null ? "—" : money(x)) + "</td>"; };
  const numCell = function (v) { return '<td class="num">' + num(v) + "</td>"; };
  const kpiGrid = function (cards) {
    const cls = cards.length === 3 ? " three" : cards.length === 4 ? " four" : "";
    return '<div class="ra-kpis' + cls + '">' + cards.join("") + "</div>";
  };
  const gridOf = function (cls, cards) { return '<div class="ra-grid ' + cls + '">' + cards.join("") + "</div>"; };
  const heroBlock = function (value, unit, extra) {
    return '<div class="ra-hero"><span class="ra-hero-value">' + esc(value) + '</span><span class="ra-hero-unit">' + esc(unit || "") + "</span>" + (extra || "") + "</div>";
  };
  // Previous column is only drawn when something has a previous value; chart draws "previous" only if any is non-zero.
  const hasPrevious = function (list) { return list.some(function (v) { const x = toNum(v); return x !== null && x !== 0; }); };
  const canvasOf = function (root, id) { return root.querySelector("#" + id); };

  /* Generic fallback: turn any unknown response into Section | Item | Amount rows. */
  const SKIP_KEYS = ["insights", "previous", "prev", "previous_period", "period", "as_of", "date"];
  function flattenRows(data, skip) {
    const out = [];
    const skipKeys = SKIP_KEYS.concat(skip || []);
    const pushScalar = function (section, label, v) { const x = toNum(v); if (x !== null) out.push({ section: section, label: label, value: x }); };
    const pushList = function (section, list) {
      list.forEach(function (it) {
        if (!it || typeof it !== "object") return;
        const label = textOf(it, ["label", "name", "category", "party", "item", "description", "source", "reason", "metric"]);
        const value = numOf(it, ["amount", "total", "value", "paid", "balance", "outstanding_balance", "count"]);
        if (value !== null) out.push({ section: section, label: label || "—", value: value });
      });
    };
    Object.keys(data || {}).forEach(function (k) {
      if (skipKeys.indexOf(k) !== -1) return;
      const v = data[k];
      if (Array.isArray(v)) pushList(human(k), v);
      else if (v && typeof v === "object") {
        Object.keys(v).forEach(function (k2) {
          const v2 = v[k2];
          if (Array.isArray(v2)) pushList(human(k) + " / " + human(k2), v2);
          else pushScalar(human(k), human(k2), v2);
        });
      } else pushScalar("", human(k), v);
    });
    return out;
  }
  function genericTable(data, skip) {
    const rows = flattenRows(data, skip);
    if (!rows.length) return emptyState("Nothing to show for this period yet");
    return table(th("Section") + th("Item") + th("Amount", true),
      rows.map(function (r) { return "<tr><td>" + esc(r.section) + "</td><td>" + esc(r.label) + "</td>" + moneyCell(r.value) + "</tr>"; }).join(""));
  }

  /* Reads a number or { total | amount | value } or a list of rows and gives one total. */
  function totalOf(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number" || typeof v === "string") return toNum(v);
    if (Array.isArray(v)) { return v.length ? sum(v, function (x) { return typeof x === "object" ? first(x, ["amount", "total", "value", "paid"]) : x; }) : 0; }
    if (typeof v === "object") {
      const t = numOf(v, ["total", "amount", "value", "cur", "current"]);
      return t;
    }
    return null;
  }
  function prevTotalOf(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) return numOf(v, ["prev", "previous", "previous_total", "previous_amount"]);
    return null;
  }

  /* =====================================================================
     1. PROFIT & LOSS  (key: pl)
     ===================================================================== */
  function plRows(data) {
    const rows = arr(first(data, ["statement", "rows", "lines"]));
    return rows.map(function (r) {
      const label = textOf(r, ["label", "name", "line", "title", "item", "account", "description"]);
      const cur = numOf(r, ["amount", "current", "value", "total", "cur", "this_period"]);
      const prev = numOf(r, ["prev", "previous", "previous_amount", "prev_amount"]);
      const kind = textOf(r, ["type", "kind", "style", "row_type"]).toLowerCase();
      const indent = Number(first(r, ["indent", "level", "depth"])) || 0;
      const isHeader = r.is_header === true || r.header === true || /header|section|heading/.test(kind) || (cur === null && prev === null);
      const isTotal = r.is_total === true || kind === "total" || /^net (profit|income|loss)/i.test(label);
      const isSub = r.is_subtotal === true || r.bold === true || /^sub/.test(kind) || /^(total |gross profit)/i.test(label);
      return { label: label, cur: cur, prev: prev, isHeader: isHeader, isTotal: isTotal, isSub: isSub, ind: indent > 0 || r.is_child === true, section: textOf(r, ["section", "group"]) };
    });
  }

  // The new "Direct Production Costs (Feed/Meds)" section: its total, or the sum of its rows.
  function directCosts(rows) {
    const re = /direct production|feed\/?\s*meds|feed and med/i;
    let inSec = false, total = null, totalPrev = null, sumCur = 0, sumPrev = 0, any = false, anyPrev = false;
    rows.forEach(function (r) {
      if (r.isHeader) { inSec = re.test(r.label); return; }
      if (!(inSec || re.test(r.label) || re.test(r.section))) return;
      if (r.isSub || r.isTotal || /^total/i.test(r.label) || re.test(r.label)) {
        if (r.cur !== null) { total = r.cur; totalPrev = r.prev; }
      } else {
        if (r.cur !== null) { sumCur += r.cur; any = true; }
        if (r.prev !== null) { sumPrev += r.prev; anyPrev = true; }
      }
    });
    if (total === null && !any) return null;
    return { cur: total !== null ? total : sumCur, prev: total !== null ? totalPrev : (anyPrev ? sumPrev : null) };
  }

  function plFigures(data, rows) {
    const prevObj = first(data, ["previous", "prev", "previous_period"]) || {};
    const fig = function (keys, re) {
      let cur = numOf(data, keys), prev = numOf(prevObj, keys);
      if (cur === null) {
        const r = rows.filter(function (x) { return !x.isHeader && re.test(x.label); })[0];
        if (r) { cur = r.cur; if (prev === null) prev = r.prev; }
      }
      return { cur: cur, prev: prev };
    };
    const revenue = fig(["revenue", "total_revenue", "sales"], /^(total )?(revenue|sales|income)\b/i);
    const gross = fig(["gross_profit"], /gross profit/i);
    const net = fig(["net_profit", "net_income"], /net (profit|income|loss)|profit (for|after)/i);
    const expenses = fig(["total_expenses"], /^total (operating )?expenses/i);
    const dc = directCosts(rows);
    const sub = function (a, b) { return a === null || b === null ? null : a - b; };
    let costs = { cur: sub(revenue.cur, net.cur), prev: sub(revenue.prev, net.prev) };
    if (costs.cur === null && expenses.cur !== null) {
      costs = { cur: expenses.cur + (dc ? dc.cur : 0), prev: expenses.prev === null ? null : expenses.prev + (dc && dc.prev !== null ? dc.prev : 0) };
    }
    const margin = {
      cur: revenue.cur ? (net.cur === null ? null : (net.cur / revenue.cur) * 100) : null,
      prev: revenue.prev ? (net.prev === null ? null : (net.prev / revenue.prev) * 100) : null
    };
    return { revenue: revenue, gross: gross, net: net, costs: costs, margin: margin, direct: dc };
  }

  function mergeTrend(sales, expense) {
    const pt = function (p, keys) { return numOf(p, keys) || 0; };
    const map = {};
    arr(sales).forEach(function (p) { const d = textOf(p, ["date", "day", "label", "period"]); if (d) { map[d] = map[d] || { r: 0, e: 0 }; map[d].r += pt(p, ["revenue", "total", "amount", "value", "sales"]); } });
    arr(expense).forEach(function (p) { const d = textOf(p, ["date", "day", "label", "period"]); if (d) { map[d] = map[d] || { r: 0, e: 0 }; map[d].e += pt(p, ["amount", "total", "value", "expenses", "expense"]); } });
    const dates = Object.keys(map).sort();
    return { labels: dates.map(function (d) { return /^\d{4}-\d{2}-\d{2}/.test(d) ? fmtDate(d).replace(/ \d{4}$/, "") : d; }), revenue: dates.map(function (d) { return map[d].r; }), expenses: dates.map(function (d) { return map[d].e; }) };
  }

  const pl = {
    // Trends come from the Records endpoints (the P&L has no time series).
    extra: async function (ctx) {
      if (typeof AgroAPI === "undefined" || !ctx || !ctx.farmId) return { sales: [], expense: [] };
      const r = await Promise.allSettled([
        AgroAPI.getRecordsReport(ctx.farmId, "sales", ctx.range),
        AgroAPI.getRecordsReport(ctx.farmId, "expense", ctx.range)
      ]);
      return {
        sales: r[0].status === "fulfilled" ? arr(r[0].value && r[0].value.trend) : [],
        expense: r[1].status === "fulfilled" ? arr(r[1].value && r[1].value.trend) : []
      };
    },
    render: function (data, ctx) {
      data = data || {};
      const rows = plRows(data);
      const f = plFigures(data, rows);
      const t = theme();
      const extra = (ctx && ctx.extra) || {};
      const trend = mergeTrend(extra.sales, extra.expense);
      const trendId = uid("pl-trend"), cmpId = uid("pl-cmp"), donutId = uid("pl-donut");

      const kpis = kpiGrid([
        kpiCard({ icon: "wallet", label: "Revenue", value: f.revenue.cur === null ? "—" : money(f.revenue.cur), cur: f.revenue.cur, prev: f.revenue.prev }),
        kpiCard({ icon: "trend", label: "Gross profit", value: f.gross.cur === null ? "—" : money(f.gross.cur), cur: f.gross.cur, prev: f.gross.prev, neg: f.gross.cur !== null && f.gross.cur < 0 }),
        kpiCard({ icon: "trend", label: "Net profit", value: f.net.cur === null ? "—" : money(f.net.cur), cur: f.net.cur, prev: f.net.prev, neg: f.net.cur !== null && f.net.cur < 0, tone: f.net.cur !== null && f.net.cur < 0 ? "red" : "" }),
        kpiCard({ icon: "chart", label: "Net margin", value: f.margin.cur === null ? "—" : pctText(f.margin.cur), cur: f.margin.cur, prev: f.margin.prev })
      ]);

      // Current vs previous
      const cmpLabels = ["Revenue", "Total costs", "Net profit"];
      const cmpCur = [f.revenue.cur || 0, f.costs.cur || 0, f.net.cur || 0];
      const cmpPrev = [f.revenue.prev || 0, f.costs.prev || 0, f.net.prev || 0];
      const showPrevSeries = hasPrevious(cmpPrev);
      const noCmp = f.revenue.cur === null && f.net.cur === null;

      // Expenses by category, plus the direct production costs slice when it is not already a category.
      const cats = arr(data.expenses_by_category).map(function (c) { return { label: textOf(c, ["category", "name", "label"]) || "Other", value: numOf(c, ["amount", "total", "value"]) || 0 }; });
      if (f.direct && f.direct.cur > 0 && !cats.some(function (c) { return /direct production|feed|medic/i.test(c.label); })) {
        cats.push({ label: "Direct production costs", value: f.direct.cur });
      }
      const catTotal = cats.reduce(function (s, c) { return s + c.value; }, 0);

      // Statement table
      const showPrev = rows.some(function (r) { return r.prev !== null; });
      let curHeader = "";
      const body = rows.map(function (r) {
        if (r.isHeader) { curHeader = r.label; return '<tr class="sec"><td colspan="' + (showPrev ? 4 : 2) + '">' + esc(r.label) + "</td></tr>"; }
        const cls = [r.ind ? "ind" : "", r.isTotal ? "total" : "", r.isSub && !r.isTotal ? "sub" : "", r.isTotal && r.cur !== null && r.cur < 0 ? "loss" : ""].filter(Boolean).join(" ");
        const inverse = /cost|expense|cogs/i.test(curHeader + " " + r.label) && !/profit|income|revenue/i.test(r.label);
        return '<tr class="' + cls + '"><td>' + esc(r.label) + "</td>" + moneyCell(r.cur) +
          (showPrev ? '<td class="num prev">' + (r.prev === null ? "—" : money(r.prev)) + '</td><td class="num">' + badge(delta(r.cur, r.prev), inverse) + "</td>" : "") + "</tr>";
      }).join("");
      const statement = rows.length
        ? table(th("Line item") + th("Current period", true) + (showPrev ? th("Previous period", true) + th("Change", true) : ""), body, "ra-pl")
        : emptyState("No statement lines for this period yet");

      const html = kpis +
        gridOf("two", [
          R.chartCard({ title: "Revenue vs operating expenses", sub: "Daily trend for the selected period", body: R.chartBox(trendId, { empty: !trend.labels.length }) }),
          R.chartCard({ title: "Current vs previous period", sub: showPrevSeries ? "Revenue, total costs and net profit" : "No previous period to compare yet", body: R.chartBox(cmpId, { empty: noCmp }) })
        ]) +
        gridOf("", [
          R.chartCard({
            title: "Where the money goes", sub: "Expenses by category",
            body: cats.length && catTotal > 0 ? R.donutHTML(donutId, cats, { money: true, centreValue: money(catTotal), centreLabel: "Total" }) : emptyState("No expenses in this period")
          })
        ]) +
        statement;

      return {
        html: html,
        post: function (root) {
          const trendEl = canvasOf(root, trendId);
          if (trendEl) R.line(trendEl, { labels: trend.labels, money: true, datasets: [
            { label: "Revenue", data: trend.revenue, color: t.income, fill: true },
            { label: "Operating expenses", data: trend.expenses, color: t.expense }
          ] });
          const cmpEl = canvasOf(root, cmpId);
          if (cmpEl) {
            const sets = [{ label: "Current", data: cmpCur, color: t.income }];
            if (showPrevSeries) sets.push({ label: "Previous", data: cmpPrev, color: "#94a3b8" });
            R.bar(cmpEl, { labels: cmpLabels, datasets: sets, money: true });
          }
          const dEl = canvasOf(root, donutId);
          if (dEl) R.donut(dEl, cats, { money: true });
        }
      };
    }
  };

  /* =====================================================================
     2. CASH FLOW  (key: cash-flow)   shape not confirmed yet, tolerant
     ===================================================================== */
  function cfFigure(data, keys) {
    const prevObj = first(data, ["previous", "prev", "previous_period"]) || {};
    const sources = [data, data && data.summary, data && data.totals].filter(Boolean);
    let cur = null, prev = null;
    sources.forEach(function (src) {
      keys.forEach(function (k) {
        if (cur === null && src[k] !== undefined) {
          cur = totalOf(src[k]);
          const embedded = prevTotalOf(src[k]);
          if (embedded !== null) prev = embedded;
        }
      });
    });
    if (prev === null) keys.forEach(function (k) { if (prev === null && prevObj[k] !== undefined) prev = totalOf(prevObj[k]); });
    return { cur: cur, prev: prev };
  }

  const cashFlow = {
    render: function (data) {
      data = data || {};
      const t = theme();
      const cin = cfFigure(data, ["cash_in", "inflows", "inflow", "total_inflows", "total_in", "cash_inflow", "money_in"]);
      const cout = cfFigure(data, ["cash_out", "outflows", "outflow", "total_outflows", "total_out", "cash_outflow", "money_out"]);
      let net = cfFigure(data, ["net_cash_flow", "net_cash", "net", "net_flow"]);
      if (net.cur === null && cin.cur !== null && cout.cur !== null) net = { cur: cin.cur - cout.cur, prev: cin.prev !== null && cout.prev !== null ? cin.prev - cout.prev : null };
      const recv = cfFigure(data, ["receivables", "total_receivables", "accounts_receivable", "owed_to_you"]);
      const pay = cfFigure(data, ["payables", "total_payables", "accounts_payable", "you_owe"]);
      const cmpId = uid("cf-cmp");
      const labels = ["Cash in", "Cash out", "Net cash flow"];
      const cur = [cin.cur || 0, cout.cur || 0, net.cur || 0];
      const prev = [cin.prev || 0, cout.prev || 0, net.prev || 0];
      const showPrev = hasPrevious(prev);
      const noChart = cin.cur === null && cout.cur === null;
      const m = function (v) { return v === null ? "—" : money(v); };

      const html = kpiGrid([
        kpiCard({ icon: "wallet", label: "Cash in", value: m(cin.cur), cur: cin.cur, prev: cin.prev }),
        kpiCard({ icon: "wallet", label: "Cash out", value: m(cout.cur), cur: cout.cur, prev: cout.prev, inverse: true, tone: "amber" }),
        kpiCard({ icon: "trend", label: "Net cash flow", value: m(net.cur), cur: net.cur, prev: net.prev, neg: net.cur !== null && net.cur < 0, tone: net.cur !== null && net.cur < 0 ? "red" : "" }),
        kpiCard({ icon: "clock", label: "Receivables", value: m(recv.cur), note: "Customers still owe you", tone: "amber" }),
        kpiCard({ icon: "clock", label: "Payables", value: m(pay.cur), note: "You still owe suppliers", tone: "amber" })
      ]) +
        gridOf("", [R.chartCard({ title: "Cash in vs cash out", sub: showPrev ? "Current vs previous period" : "Cash basis: only money actually paid", body: R.chartBox(cmpId, { empty: noChart, short: true }) })]) +
        genericTable(data);

      return {
        html: html,
        post: function (root) {
          const el = canvasOf(root, cmpId);
          if (!el) return;
          const sets = [{ label: "Current", data: cur, color: t.income }];
          if (showPrev) sets.push({ label: "Previous", data: prev, color: "#94a3b8" });
          R.bar(el, { labels: labels, datasets: sets, money: true });
        }
      };
    }
  };

  /* =====================================================================
     3. INVENTORY VALUATION  (key: inventory-valuation)   tolerant
     ===================================================================== */
  const inventoryValuation = {
    render: function (data) {
      data = data || {};
      const items = arr(first(data, ["items", "rows", "inventory", "stock", "valuation"])).map(function (i) {
        return {
          name: textOf(i, ["name", "item", "item_name"]) || "—",
          category: human(textOf(i, ["category"])) || "Other",
          stock: numOf(i, ["current_stock", "stock", "quantity"]),
          unit: textOf(i, ["unit", "base_unit_name", "unit_name"]),
          cost: numOf(i, ["current_average_cost", "avg_cost", "average_cost", "unit_cost"]),
          value: numOf(i, ["total_stock_value", "value", "total_value", "stock_value"])
        };
      });
      const restock = arr(data.restock_list);
      const total = numOf(data, ["total_value", "total_stock_value", "grand_total"]);
      const totalValue = total !== null ? total : sum(items, function (i) { return i.value; });
      const byCat = {};
      items.forEach(function (i) { if (i.value > 0) byCat[i.category] = (byCat[i.category] || 0) + i.value; });
      const cats = Object.keys(byCat).map(function (k) { return { label: k, value: byCat[k] }; });
      const donutId = uid("iv-donut");

      const restockHtml = restock.length
        ? '<section class="ra-card" style="border-color:rgba(192,57,43,.4)"><div class="ra-card-head"><div><h3 class="ra-card-title">Needs restocking</h3><p class="ra-card-sub">' + restock.length + ' item(s) at or below their minimum</p></div></div><div class="ra-chips">' +
          restock.map(function (r) {
            const stock = numOf(r, ["current_stock", "stock", "quantity"]);
            return '<span class="ra-chip">' + esc(textOf(r, ["name", "item", "item_name"]) || "—") + (stock !== null ? " — " + num(stock) + " " + esc(textOf(r, ["unit", "base_unit_name"])) + " left" : "") + "</span>";
          }).join("") + "</div></section>"
        : "";

      const tableHtml = items.length
        ? table(th("Item") + th("Category") + th("In stock", true) + th("Average cost", true) + th("Value", true),
            items.map(function (i) { return "<tr><td>" + esc(i.name) + "</td><td>" + esc(i.category) + "</td><td class=\"num\">" + (i.stock === null ? "—" : num(i.stock) + " " + esc(i.unit)) + "</td>" + moneyCell(i.cost) + moneyCell(i.value) + "</tr>"; }).join(""))
        : genericTable(data, ["restock_list"]);

      const html = kpiGrid([
        kpiCard({ icon: "inventory", label: "Total stock value", value: money(totalValue), note: "At weighted average cost" }),
        kpiCard({ icon: "package", label: "Items tracked", value: num(items.length) }),
        kpiCard({ icon: "alert", label: "Items to restock", value: num(restock.length), tone: restock.length ? "red" : "", neg: restock.length > 0 })
      ]) + restockHtml +
        gridOf("", [R.chartCard({ title: "Stock value by category", body: cats.length ? R.donutHTML(donutId, cats, { money: true, centreValue: money(totalValue), centreLabel: "Total" }) : emptyState("No stock value to chart yet") })]) +
        tableHtml;

      return { html: html, post: function (root) { const el = canvasOf(root, donutId); if (el) R.donut(el, cats, { money: true }); } };
    }
  };

  /* =====================================================================
     4. AUDIT  (key: audit)
     ===================================================================== */
  const fmtChangeValue = function (v) { return v === null || v === undefined || v === "" ? "empty" : String(v); };
  const changeText = function (changes) {
    return arr(changes).map(function (c) { return "Changed " + human(c.field).toLowerCase() + " from " + fmtChangeValue(c.old_value) + " to " + fmtChangeValue(c.new_value); }).join("; ");
  };

  const audit = {
    render: function (data) {
      data = data || {};
      const byReason = arr(data.by_reason).map(function (x) { return { label: human(textOf(x, ["reason", "label"])) || "Other", value: numOf(x, ["count", "total"]) || 0 }; });
      const byActor = arr(data.by_actor).map(function (x) { return { label: textOf(x, ["name", "actor"]) || "Unknown", value: numOf(x, ["count", "total"]) || 0 }; });
      const recent = arr(data.recent);
      const total = numOf(data, ["total"]) !== null ? numOf(data, ["total"]) : recent.length;
      const topReason = byReason.slice().sort(function (a, b) { return b.value - a.value; })[0];
      const topActor = byActor.slice().sort(function (a, b) { return b.value - a.value; })[0];
      const donutId = uid("au-donut"), actorId = uid("au-actor");
      const sortedActors = byActor.slice().sort(function (a, b) { return b.value - a.value; }).slice(0, 8);

      const timeline = recent.length
        ? '<div class="ra-timeline">' + recent.map(function (r) {
            const at = first(r, ["entry_timestamp", "at", "created_at"]);
            const ch = changeText(r.changes);
            return '<div class="ra-tl-item"><div class="ra-tl-head"><span><b>' + esc(textOf(r, ["actor", "created_by", "user"]) || "Someone") + "</b> adjusted " + esc(textOf(r, ["target"]) || "a record") +
              ' <span class="ra-chip">' + esc(human(textOf(r, ["reason"])) || "No reason") + '</span></span><span class="ra-tl-time">' + esc(fmtDateTime(at)) + "</span></div>" +
              (ch ? '<div class="ra-tl-change">' + esc(ch) + "</div>" : "") + "</div>";
          }).join("") + "</div>"
        : emptyState("No adjustments in this period");

      const html = kpiGrid([
        kpiCard({ icon: "shield", label: "Total adjustments", value: num(total) }),
        kpiCard({ icon: "alert", label: "Top reason", value: topReason ? topReason.label : "—", note: topReason ? num(topReason.value) + " adjustment(s)" : "" , tone: "amber" }),
        kpiCard({ icon: "users", label: "Most active person", value: topActor ? topActor.label : "—", note: topActor ? num(topActor.value) + " adjustment(s)" : "" })
      ]) +
        gridOf("two", [
          R.chartCard({ title: "Adjustments by reason", body: byReason.some(function (x) { return x.value > 0; }) ? R.donutHTML(donutId, byReason, { centreValue: num(total), centreLabel: "Total" }) : emptyState("No adjustments to chart") }),
          R.chartCard({ title: "Adjustments by person", body: R.chartBox(actorId, { empty: !sortedActors.length, height: Math.max(200, sortedActors.length * 38 + 60) }) })
        ]) +
        R.chartCard({ title: "Recent adjustments", sub: "Latest 25", body: timeline });

      return {
        html: html,
        post: function (root) {
          const d = canvasOf(root, donutId); if (d) R.donut(d, byReason, {});
          const a = canvasOf(root, actorId);
          if (a) R.bar(a, { labels: sortedActors.map(function (x) { return x.label; }), datasets: [{ label: "Adjustments", data: sortedActors.map(function (x) { return x.value; }), color: theme().green }], horizontal: true, legend: false });
        }
      };
    }
  };

  /* =====================================================================
     5. FCR  (key: fcr)   kg of feed per crate, lower is better
     ===================================================================== */
  const fcr = {
    render: function (data) {
      data = data || {};
      const weekly = arr(data.weekly).map(function (w) { return { week: textOf(w, ["week_start", "week"]), feed: numOf(w, ["feed_kg", "feed"]), crates: numOf(w, ["crates"]), fcr: numOf(w, ["fcr"]) }; });
      const avg = numOf(data, ["average_fcr", "fcr", "average"]);
      const factor = numOf(data, ["crate_factor"]);
      const withFcr = weekly.filter(function (w) { return w.fcr !== null; });
      const last = withFcr[withFcr.length - 1], before = withFcr[withFcr.length - 2];
      const trendBadge = last && before ? badge(delta(last.fcr, before.fcr), true) + '<span class="ra-kpi-note">vs previous week</span>' : "";
      const chartId = uid("fcr-chart");
      const labels = weekly.map(function (w) { return fmtDate(w.week).replace(/ \d{4}$/, ""); });

      const hero = R.chartCard({
        title: "Feed conversion ratio", sub: "Kilograms of feed needed to produce one crate of eggs. Lower is better.",
        body: heroBlock(avg === null ? "—" : avg.toFixed(2), "kg feed per crate", trendBadge)
      });
      const tableHtml = weekly.length
        ? table(th("Week starting") + th("Feed used (kg)", true) + th("Crates", true) + th("FCR", true),
            weekly.map(function (w) { return "<tr><td>" + esc(fmtDate(w.week)) + "</td>" + numCell(w.feed) + numCell(w.crates) + '<td class="num">' + (w.fcr === null ? "—" : w.fcr.toFixed(2)) + "</td></tr>"; }).join(""))
        : emptyState("No weekly data in this period yet");

      const html = hero +
        kpiGrid([
          kpiCard({ icon: "inventory", label: "Feed used", value: num(sum(weekly, function (w) { return w.feed; })) + " kg" }),
          kpiCard({ icon: "egg", label: "Crates produced", value: num(sum(weekly, function (w) { return w.crates; })) }),
          kpiCard({ icon: "package", label: "Crate size", value: factor === null ? "—" : num(factor) + " eggs", note: "Used to convert eggs to crates" })
        ]) +
        gridOf("", [R.chartCard({ title: "FCR and feed used, week by week", body: R.chartBox(chartId, { empty: !weekly.length }) })]) +
        tableHtml;

      return {
        html: html,
        post: function (root) {
          const el = canvasOf(root, chartId);
          if (el) R.combo(el, { labels: labels, line: { label: "FCR (kg per crate)", data: weekly.map(function (w) { return w.fcr; }), color: theme().green }, bar: { label: "Feed used (kg)", data: weekly.map(function (w) { return w.feed; }), color: theme().expense } });
        }
      };
    }
  };

  /* =====================================================================
     6. HHEP  (key: hhep)   hen-housed egg production, tolerant
     ===================================================================== */
  const hhep = {
    render: function (data) {
      data = data || {};
      const flocks = arr(first(data, ["flocks", "rows", "items", "breakdown", "per_flock", "by_flock"])).map(function (f) {
        return {
          name: String(first(f, ["identifier", "flock", "name", "label"]) !== undefined ? first(f, ["identifier", "flock", "name", "label"]) : "—"),
          hhep: numOf(f, ["hhep", "hhep_pct", "hhep_percent", "rate", "percentage"]),
          eggs: numOf(f, ["eggs", "total_eggs", "eggs_collected", "eggs_saleable"]),
          birds: numOf(f, ["birds", "hens", "hens_housed", "birds_housed", "current_count"])
        };
      });
      const withRate = flocks.filter(function (f) { return f.hhep !== null; });
      const avg = numOf(data, ["average_hhep", "avg_hhep", "hhep", "overall_hhep", "average", "overall"]);
      const average = avg !== null ? avg : (withRate.length ? sum(withRate, function (f) { return f.hhep; }) / withRate.length : null);
      const eggs = numOf(data, ["total_eggs"]) !== null ? numOf(data, ["total_eggs"]) : sum(flocks, function (f) { return f.eggs; });
      const birds = numOf(data, ["total_birds", "birds_housed"]) !== null ? numOf(data, ["total_birds", "birds_housed"]) : sum(flocks, function (f) { return f.birds; });
      const chartId = uid("hh-chart");
      const sorted = withRate.slice().sort(function (a, b) { return b.hhep - a.hhep; });

      const html = kpiGrid([
        kpiCard({ icon: "egg", label: "Average HHEP", value: pctText(average), note: "Eggs per 100 hens per day" }),
        kpiCard({ icon: "egg", label: "Total eggs", value: num(eggs) }),
        kpiCard({ icon: "bird", label: "Birds housed", value: num(birds) })
      ]) +
        gridOf("", [R.chartCard({ title: "HHEP by flock", body: R.chartBox(chartId, { empty: !sorted.length, height: Math.max(200, sorted.length * 38 + 60) }) })]) +
        (flocks.length
          ? table(th("Flock") + th("HHEP", true) + th("Eggs", true) + th("Birds", true),
              flocks.map(function (f) { return "<tr><td>" + esc(f.name) + '</td><td class="num">' + pctText(f.hhep) + "</td>" + numCell(f.eggs) + numCell(f.birds) + "</tr>"; }).join(""))
          : genericTable(data));

      return {
        html: html,
        post: function (root) {
          const el = canvasOf(root, chartId);
          if (el) R.bar(el, { labels: sorted.map(function (f) { return f.name; }), datasets: [{ label: "HHEP %", data: sorted.map(function (f) { return f.hhep; }), color: theme().green }], horizontal: true, legend: false, fmt: pctText });
        }
      };
    }
  };

  /* =====================================================================
     7. COST PER CRATE  (key: cost-per-crate)
     ===================================================================== */
  const costPerCrate = {
    render: function (data) {
      data = data || {};
      const comps = arr(data.components).map(function (c) { return { label: textOf(c, ["label", "name"]) || "Other", value: numOf(c, ["value", "amount", "total"]) || 0 }; });
      const per = numOf(data, ["cost_per_crate"]);
      const total = numOf(data, ["total_cost"]) !== null ? numOf(data, ["total_cost"]) : sum(comps, function (c) { return c.value; });
      const crates = numOf(data, ["crates_produced"]);
      const donutId = uid("cc-donut");
      const compTotal = comps.reduce(function (s, c) { return s + c.value; }, 0);

      const html = R.chartCard({ title: "Cost per crate", sub: "Total production cost divided by crates produced", body: heroBlock(per === null ? "—" : money(per), "per crate") }) +
        kpiGrid([
          kpiCard({ icon: "wallet", label: "Total production cost", value: money(total) }),
          kpiCard({ icon: "egg", label: "Crates produced", value: crates === null ? "—" : num(crates) })
        ]) +
        gridOf("", [R.chartCard({ title: "What makes up the cost", body: compTotal > 0 ? R.donutHTML(donutId, comps, { money: true, centreValue: money(total), centreLabel: "Total" }) : emptyState("No cost components in this period") })]) +
        (comps.length
          ? table(th("Component") + th("Amount", true) + th("Share", true),
              comps.map(function (c) { return "<tr><td>" + esc(c.label) + "</td>" + moneyCell(c.value) + '<td class="num">' + (compTotal ? pctText((c.value / compTotal) * 100) : "—") + "</td></tr>"; }).join(""))
          : "");

      return { html: html, post: function (root) { const el = canvasOf(root, donutId); if (el) R.donut(el, comps, { money: true }); } };
    }
  };

  /* =====================================================================
     8. FLOCK ROI  (key: flock-roi)   best/worst are objects, worst can be null
     ===================================================================== */
  const flockRoi = {
    render: function (data) {
      data = data || {};
      const flocks = arr(data.flocks).map(function (f) {
        return { id: f.id, name: String(first(f, ["identifier", "name"]) !== undefined ? first(f, ["identifier", "name"]) : f.id), costs: numOf(f, ["costs", "cost"]), revenue: numOf(f, ["revenue"]), profit: numOf(f, ["profit"]), roi: numOf(f, ["roi_pct", "roi"]) };
      });
      const best = data.best && typeof data.best === "object" ? data.best : null;
      const worst = data.worst && typeof data.worst === "object" ? data.worst : null;
      const isBest = function (f) { return best && f.id === best.id; };
      const isWorst = function (f) { return worst && f.id === worst.id && !isBest(f); };
      const withRoi = flocks.filter(function (f) { return f.roi !== null; });
      const totalProfit = sum(flocks, function (f) { return f.profit; });
      const avgRoi = withRoi.length ? sum(withRoi, function (f) { return f.roi; }) / withRoi.length : null;
      const ranked = withRoi.slice().sort(function (a, b) { return b.roi - a.roi; });
      const chartId = uid("roi-chart");
      const t = theme();

      const html = kpiGrid([
        kpiCard({ icon: "trend", label: "Total profit", value: money(totalProfit), neg: totalProfit < 0, tone: totalProfit < 0 ? "red" : "" }),
        kpiCard({ icon: "chart", label: "Average ROI", value: pctText(avgRoi) }),
        kpiCard({ icon: "bird", label: "Best flock", value: best ? String(first(best, ["identifier", "name"]) !== undefined ? first(best, ["identifier", "name"]) : best.id) : "—", note: best && numOf(best, ["roi_pct"]) !== null ? pctText(numOf(best, ["roi_pct"])) + " ROI" : "" })
      ]) +
        gridOf("", [R.chartCard({ title: "Return on investment by flock", sub: "Profit divided by cost. Green is positive, red is a loss.", body: R.chartBox(chartId, { empty: !ranked.length, height: Math.max(200, ranked.length * 38 + 60) }) })]) +
        (flocks.length
          ? table(th("Flock") + th("Costs", true) + th("Revenue", true) + th("Profit", true) + th("ROI", true) + th(""),
              flocks.map(function (f) {
                return "<tr><td>" + esc(f.name) + "</td>" + moneyCell(f.costs) + moneyCell(f.revenue) + moneyCell(f.profit) +
                  '<td class="num' + (f.roi !== null && f.roi < 0 ? " neg" : "") + '">' + pctText(f.roi) + "</td><td>" +
                  (isBest(f) ? '<span class="ra-badge good">Best</span>' : isWorst(f) ? '<span class="ra-badge bad">Worst</span>' : "") + "</td></tr>";
              }).join(""))
          : emptyState("No flocks to compare in this period"));

      return {
        html: html,
        post: function (root) {
          const el = canvasOf(root, chartId);
          if (el) R.bar(el, { labels: ranked.map(function (f) { return f.name; }), datasets: [{ label: "ROI %", data: ranked.map(function (f) { return f.roi; }), colors: ranked.map(function (f) { return f.roi < 0 ? t.red : t.income; }) }], horizontal: true, legend: false, fmt: pctText });
        }
      };
    }
  };

  /* =====================================================================
     9. FEED FORECAST  (key: feed-forecast)
     ===================================================================== */
  function feedSeverity(item) {
    if (item.days === null) return "none";
    const s = item.severity.toLowerCase();
    if (/crit|danger|high|red/.test(s)) return "critical";
    if (/warn|low|medium|amber/.test(s)) return "warning";
    if (/ok|good|healthy|green|normal/.test(s)) return "ok";
    return item.days <= 7 ? "critical" : item.days <= 14 ? "warning" : "ok";
  }
  const SEV_LABEL = { critical: "Critical", warning: "Running low", ok: "OK", none: "No usage data" };

  const feedForecast = {
    render: function (data) {
      data = data || {};
      const asOf = textOf(data, ["as_of"]);
      const items = arr(data.items).map(function (i) {
        const o = { name: textOf(i, ["name", "item"]) || "—", unit: textOf(i, ["unit", "base_unit_name"]), stock: numOf(i, ["stock", "current_stock"]), daily: numOf(i, ["avg_daily_use", "daily_use"]), days: numOf(i, ["days_left"]), severity: textOf(i, ["severity"]) };
        o.sev = feedSeverity(o);
        return o;
      }).sort(function (a, b) { return (a.days === null ? 1e9 : a.days) - (b.days === null ? 1e9 : b.days); });
      const critical = items.filter(function (i) { return i.sev === "critical"; }).length;
      const low = items.filter(function (i) { return i.sev === "warning"; }).length;
      const known = items.filter(function (i) { return i.days !== null; });
      const soonest = known.length ? known[0] : null;
      const chartId = uid("ff-chart");
      const t = theme();
      const CAP = 30;
      const colour = { critical: t.red, warning: t.expense, ok: t.income, none: "#94a3b8" };

      const cards = items.length
        ? '<div class="ra-feed-list">' + items.map(function (i) {
            const pctFill = i.days === null ? 0 : Math.max(2, Math.min(100, (i.days / CAP) * 100));
            return '<div class="ra-feed ' + i.sev + '"><div class="ra-feed-top"><h4 class="ra-feed-name">' + esc(i.name) + '</h4><span class="ra-badge ' + (i.sev === "critical" ? "bad" : i.sev === "warning" ? "warn" : i.sev === "ok" ? "good" : "none") + '">' + SEV_LABEL[i.sev] + "</span></div>" +
              '<div class="ra-feed-days">' + (i.days === null ? "—" : num(i.days)) + " <small>days left</small></div>" +
              '<div class="ra-bar-track"><div class="ra-bar-fill" style="width:' + pctFill + '%"></div></div>' +
              '<div class="ra-feed-meta"><span>In stock<b>' + (i.stock === null ? "—" : num(i.stock) + " " + esc(i.unit)) + "</b></span><span>Daily use<b>" + (i.daily === null ? "No usage data" : num(i.daily) + " " + esc(i.unit)) + "</b></span>" +
              "<span>Runs out<b>" + (i.days === null ? "—" : esc(fmtDate(addDays(asOf, i.days)))) + "</b></span></div></div>";
          }).join("") + "</div>"
        : emptyState("No stock-tracked feed items yet");

      const html = kpiGrid([
        kpiCard({ icon: "alert", label: "Critical", value: num(critical), note: "7 days or less of stock", tone: critical ? "red" : "", neg: critical > 0 }),
        kpiCard({ icon: "clock", label: "Running low", value: num(low), note: "Under two weeks of stock", tone: low ? "amber" : "" }),
        kpiCard({ icon: "calendar", label: "Soonest runout", value: soonest ? fmtDate(addDays(asOf, soonest.days)) : "—", note: soonest ? soonest.name + " (" + num(soonest.days) + " days)" : "" })
      ]) +
        gridOf("", [R.chartCard({ title: "Days of stock left", sub: "Bars are capped at " + CAP + " days", body: R.chartBox(chartId, { empty: !known.length, height: Math.max(200, known.length * 38 + 60) }) })]) +
        cards;

      return {
        html: html,
        post: function (root) {
          const el = canvasOf(root, chartId);
          if (el) R.bar(el, { labels: known.map(function (i) { return i.name; }), datasets: [{ label: "Days left", data: known.map(function (i) { return Math.min(i.days, CAP); }), colors: known.map(function (i) { return colour[i.sev]; }) }], horizontal: true, legend: false, max: CAP, tips: known.map(function (i) { return num(i.days) + " days"; }) });
        }
      };
    }
  };

  /* =====================================================================
     10. CUSTOMERS  (key: customer-lifecycle)
     ===================================================================== */
  const SEG_COLOR = { loyal: "#147a3a", new: "#2563eb", at_risk: "#f3b93a", dormant: "#c0392b" };
  const customers = {
    render: function (data) {
      data = data || {};
      const summary = data.summary && typeof data.summary === "object" ? data.summary : {};
      const list = arr(data.customers).map(function (c) {
        return { name: textOf(c, ["name"]) || "—", orders: numOf(c, ["orders"]), total: numOf(c, ["total"]), last: textOf(c, ["last_order"]), days: numOf(c, ["days_since"]), seg: textOf(c, ["segment"]).toLowerCase() };
      });
      const segs = ["loyal", "new", "at_risk", "dormant"];
      const count = function (k) { return numOf(summary, [k]) !== null ? numOf(summary, [k]) : list.filter(function (c) { return c.seg === k; }).length; };
      const donutItems = segs.map(function (k) { return { label: human(k), value: count(k), color: SEG_COLOR[k] }; });
      const donutTotal = donutItems.reduce(function (s, x) { return s + x.value; }, 0);
      const donutId = uid("cu-donut");
      const toCall = list.filter(function (c) { return c.seg === "at_risk" || c.seg === "dormant"; }).sort(function (a, b) { return (b.total || 0) - (a.total || 0); }).slice(0, 8);
      const chip = function (seg) { return '<span class="ra-seg-chip ' + esc(seg) + '">' + esc(human(seg) || "—") + "</span>"; };

      const callHtml = toCall.length
        ? '<div class="ra-call-list">' + toCall.map(function (c) {
            return '<div class="ra-call"><div><b>' + esc(c.name) + "</b><small>Last order " + esc(fmtDate(c.last)) + (c.days !== null ? " · " + num(c.days) + " days ago" : "") + " · " + num(c.orders) + ' orders</small></div><div style="text-align:right"><b>' + money(c.total) + "</b><br>" + chip(c.seg) + "</div></div>";
          }).join("") + "</div>"
        : emptyState("Nobody needs a call right now");

      const html = kpiGrid([
        kpiCard({ icon: "users", label: "Loyal", value: num(count("loyal")), note: "Order regularly", tone: "" }),
        kpiCard({ icon: "users", label: "New", value: num(count("new")), note: "First orders recently" }),
        kpiCard({ icon: "alert", label: "At risk", value: num(count("at_risk")), note: "Slowing down", tone: "amber" }),
        kpiCard({ icon: "clock", label: "Dormant", value: num(count("dormant")), note: "Stopped ordering", tone: "red" })
      ]) +
        gridOf("two", [
          R.chartCard({ title: "Customer segments", body: donutTotal > 0 ? R.donutHTML(donutId, donutItems, { centreValue: num(donutTotal), centreLabel: "Customers" }) : emptyState("No customers yet") }),
          R.chartCard({ title: "Who to call this week", sub: "At-risk and dormant customers, biggest spenders first", body: callHtml })
        ]) +
        (list.length
          ? table(th("Customer") + th("Segment") + th("Last order") + th("Days since", true) + th("Orders", true) + th("Total spent", true),
              list.map(function (c) { return "<tr><td>" + esc(c.name) + "</td><td>" + chip(c.seg) + "</td><td>" + esc(fmtDate(c.last)) + "</td>" + numCell(c.days) + numCell(c.orders) + moneyCell(c.total) + "</tr>"; }).join(""))
          : emptyState("No customers to show"));

      return { html: html, post: function (root) { const el = canvasOf(root, donutId); if (el) R.donut(el, donutItems, {}); } };
    }
  };

  /* =====================================================================
     11. TRACEABILITY  (key: traceability)   date picker lives in the page frame
     ===================================================================== */
  // True when a name is missing or is just a placeholder dash / division sign / "null".
  const isBlankName = function (s) {
    return !s || /^[\s\-\u2013\u2014\u00f7]+$/.test(s) || /^(null|undefined|none|n\/a)$/i.test(s);
  };

  // Draws one chip per entry as "[Name]: [Qty] [Unit]".
  //   nameKeys : keys to try for the name, in order (the item may also arrive as an object with a name)
  //   opts.fallback : text shown when the name is missing, so the quantity is never lost
  //   opts.pretty   : run the name through human() (for codes such as FEED_CONSUMPTION); item names are kept as typed
  const traceChips = function (list, nameKeys, opts) {
    opts = opts || {};
    const l = arr(list);
    if (!l.length) return '<span class="ra-kpi-note">None recorded</span>';
    return '<div class="ra-chips">' + l.map(function (x) {
      const raw = first(x, nameKeys);
      let name = raw && typeof raw === "object" ? textOf(raw, ["name", "label", "item_name"]) : (raw === undefined ? "" : String(raw).trim());
      if (!isBlankName(name) && opts.pretty) name = human(name);
      if (isBlankName(name)) name = opts.fallback || "Unspecified";
      const qty = numOf(x, ["qty", "quantity", "amount"]);
      const unit = textOf(x, ["unit", "unit_name", "base_unit_name"]);
      return '<span class="ra-chip">' + esc(name) + (qty !== null ? ": " + num(qty) + (unit ? " " + esc(unit) : "") : "") + "</span>";
    }).join("") + "</div>";
  };

  const traceability = {
    render: function (data) {
      data = data || {};
      const batches = arr(data.batches);
      const date = textOf(data, ["date"]);
      const html = batches.length
        ? kpiGrid([
            kpiCard({ icon: "calendar", label: "Date", value: fmtDate(date) }),
            kpiCard({ icon: "package", label: "Batches", value: num(batches.length) }),
            kpiCard({ icon: "egg", label: "Saleable eggs", value: num(sum(batches, function (b) { return b.eggs_saleable; })) })
          ]) +
          '<div class="ra-batch-list">' + batches.map(function (b) {
            return '<div class="ra-batch"><div class="ra-card-head" style="margin:0"><div><h3 class="ra-card-title">Flock ' + esc(textOf(b, ["flock"]) || "—") + '</h3><p class="ra-card-sub">Recorded by ' + esc(textOf(b, ["recorded_by"]) || "—") + '</p></div><span class="ra-badge good">' + num(numOf(b, ["eggs_saleable"])) + " saleable</span></div>" +
              '<div><div class="ra-kpi-label" style="margin-bottom:6px">Feed used</div>' + traceChips(b.feed_used, ["item", "item_name", "name", "feed"], { fallback: "Unspecified feed" }) + "</div>" +
              '<div><div class="ra-kpi-label" style="margin-bottom:6px">Other activities</div>' + traceChips(b.other_activities, ["type", "activity_type", "name"], { pretty: true, fallback: "Activity" }) + "</div></div>";
          }).join("") + "</div>"
        : emptyState("No production batches on " + (date ? fmtDate(date) : "this date"));
      return { html: html };
    }
  };

  /* =====================================================================
     12. PERIOD COMPARISON  (key: period-comparison)
     Period A vs Period B (any two date ranges).
     The page (js/views/reports.js) sends start_date_a, end_date_a,
     start_date_b, end_date_b and passes ctx.cmp = { a: {start_date, end_date},
     b: {start_date, end_date} } so the subtitle can show the dates even if the
     backend does not echo them back.
     No "higher is better" flag from the backend, so it is decided here.
     ===================================================================== */
  const LOWER_IS_BETTER = /expense|cost|mortality|damage|loss|outstanding|payable/i;
  const MONEY_METRIC = /revenue|sales|profit|expense|cost|income|cash|receivable|payable|outstanding|paid|value|spend|price/i;
  const NOT_MONEY = /count|number|rate|%|birds|eggs|crates|orders|qty|quantity/i;
  const isMoneyMetric = function (m) { return MONEY_METRIC.test(m) && !NOT_MONEY.test(m); };

  const periodComparison = {
    render: function (data, ctx) {
      data = data || {};
      const pa = data.period_a && typeof data.period_a === "object" ? data.period_a : {};
      const pb = data.period_b && typeof data.period_b === "object" ? data.period_b : {};
      const cmp = (ctx && ctx.cmp) || {};
      const labelA = textOf(pa, ["label"]) || "Period A";
      const labelB = textOf(pb, ["label"]) || "Period B";
      const winText = function (w) {
        const s = first(w, ["start_date", "start", "from"]), e = first(w, ["end_date", "end", "to"]);
        return s && e ? fmtDate(s) + " – " + fmtDate(e) : "";
      };
      const rangeA = winText(pa) || winText(cmp.a || {}), rangeB = winText(pb) || winText(cmp.b || {});
      const rangeSub = rangeA && rangeB ? rangeA + " vs " + rangeB : "Period A vs Period B";

      // Rows are read as a/b (or period_a/period_b); the old current/previous keys are the fallback.
      const rows = arr(data.rows).map(function (r) {
        return { metric: textOf(r, ["metric", "label", "name"]) || "—", cur: numOf(r, ["a", "period_a", "current"]), prev: numOf(r, ["b", "period_b", "previous"]) };
      });
      const moneyRows = rows.filter(function (r) { return isMoneyMetric(r.metric); });
      const showPrev = hasPrevious(moneyRows.map(function (r) { return r.prev; }));
      const chartId = uid("pc-chart");
      const t = theme();
      const fmtVal = function (r, v) { return v === null ? "—" : isMoneyMetric(r.metric) ? money(v) : num(v); };

      const html = gridOf("", [R.chartCard({
        title: "Money metrics: Period A vs Period B",
        sub: rangeSub + " · Counts such as eggs or birds are in the table",
        body: R.chartBox(chartId, { empty: !moneyRows.length, emptyText: "No money metrics to chart" })
      })]) +
        (rows.length
          ? table(th("Metric") + th("Period A", true) + th("Period B", true) + th("Change", true),
              rows.map(function (r) {
                return "<tr><td>" + esc(r.metric) + '</td><td class="num">' + esc(fmtVal(r, r.cur)) + '</td><td class="num prev">' + esc(fmtVal(r, r.prev)) + '</td><td class="num">' + badge(delta(r.cur, r.prev), LOWER_IS_BETTER.test(r.metric)) + "</td></tr>";
              }).join(""))
          : emptyState("No comparison data for these periods"));

      return {
        html: html,
        post: function (root) {
          const el = canvasOf(root, chartId);
          if (!el) return;
          const sets = [{ label: labelA, data: moneyRows.map(function (r) { return r.cur || 0; }), color: t.income }];
          if (showPrev) sets.push({ label: labelB, data: moneyRows.map(function (r) { return r.prev || 0; }), color: "#94a3b8" });
          R.bar(el, { labels: moneyRows.map(function (r) { return r.metric; }), datasets: sets, money: true });
        }
      };
    }
  };

  /* ---------------------------------------------------------------------
     Register
     --------------------------------------------------------------------- */
  // Lets the overview page (js/views/reports.js) read Revenue / Total costs / Net profit
  // with the same tolerant logic the P&L report uses.
  R.plFigures = function (data) { return plFigures(data || {}, plRows(data || {})); };

  R.views = Object.assign(R.views || {}, {
    "pl": pl,
    "cash-flow": cashFlow,
    "inventory-valuation": inventoryValuation,
    "audit": audit,
    "fcr": fcr,
    "hhep": hhep,
    "cost-per-crate": costPerCrate,
    "flock-roi": flockRoi,
    "feed-forecast": feedForecast,
    "customer-lifecycle": customers,
    "traceability": traceability,
    "period-comparison": periodComparison
  });
})(window);