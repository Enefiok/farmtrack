/* js/views/dashboard.js - dashboardView and its cards */
"use strict";

function statCard(ic, label, value, delta, since, note) {
  const badge =
    delta == null
      ? ""
      : `<span class="badge ${delta < 0 ? "neg" : ""}">${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%</span><span>${since}</span>`;
  return `<div class="card stat"><div class="lbl">${icon(ic, 16)}${esc(label)}</div><div class="val">${value}</div><div class="delta">${badge}${note || ""}</div></div>`;
}

const ACT_PAGE = 5; // activities shown per page in Recent Activity
// The label on the right of each Recent Activity row: the full time when we have it, otherwise just the date.
const actWhen = (a) => {
  if (a.at && !isNaN(new Date(a.at))) return fmtWhen(a.at);
  const d = a.day ? new Date(String(a.day).slice(0, 10) + "T00:00:00") : null;
  return d && !isNaN(d) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
};
function activityItems() {
  const d = state.data;
  const mk = (type, r) => {
    switch (type) {
      case "production":
        return {
          ic: "egg",
          t: "Egg production recorded",
          s: `${fmtInt(r.collected)} eggs • ${flockName(r.flock)}`,
        };
      case "sales":
        return {
          ic: "wallet",
          t: "Sale recorded",
          s: `${unitQty(r)} ${r.product} • ${r.customer}`,
        };
      case "purchase":
        return {
          ic: "wallet",
          t: "Purchase recorded",
          s: `${unitQty(r)} ${r.item} • ${r.supplier}`,
        };
      case "flock":
        return {
          ic: "bird",
          t: "Flock added",
          s: `${fmtInt(r.starting_count)} birds • ${r.identifier}`,
        };
      case "expense":
        return {
          ic: "wallet",
          t: "Expense recorded",
          s: `${r.supplier || r.description} • ${fmtMoney0(r.amount)}`,
        };
      default:
        return {
          ic: "records",
          t: `${r.type} recorded`,
          s: r.details || (r.flock ? flockName(r.flock) : "Farm activity"),
        };
    }
  };
  return TYPES.flatMap((t) =>
    // at  = when it was recorded (shown on the row).
    // day = the record's own date, shown instead when the server sent no created time.
    // on  = the date the period filter checks. It matches the cards (the record's own date). A flock's
    //       arrival date can be long ago, so "Flock added" uses when it was added instead.
    d[t].map((r) => ({ ...mk(t, r), at: r.created_at, day: r.date || r.arrival_date, on: t === "flock" ? (r.created_at || r.arrival_date) : (r.date || r.created_at) })),
  ).sort((a, b) => new Date(b.at || b.day || 0) - new Date(a.at || a.day || 0));
}

/* ---------- "Add existing birds" setup card ---------- */
const skipKey = () => `agroflow:v1:skip-opening:${state.farmId}`;
const openingSkipped = () => {
  try {
    return localStorage.getItem(skipKey()) === "1";
  } catch {
    return false;
  }
};
// Shown only while the farm has no flocks and the user hasn't skipped it.
// As soon as any flock exists it disappears by itself.
const showSetupCard = () => state.data.flock.length === 0 && !openingSkipped();

function setupCard() {
  return `<section class="card setup-card">
      <div class="setup-ic">${icon("bird", 22)}</div>
      <div class="setup-txt"><h3>Already have birds on your farm?</h3><p>Add them now so your numbers start correct.</p></div>
      <div class="setup-actions">
        <button class="btn" data-action="add-existing">${icon("plus", 14)}Add existing birds</button>
        <button class="link-btn" data-action="skip-opening">Skip, I'm starting fresh</button>
      </div>
    </section>`;
}

function flockOverviewCard() {
  const fl = state.data.flock.filter((f) => f.status === "Active").slice(0, 5);
  return `<section class="card perf area-perf">
          <h3>Flock overview</h3>
          <p class="sub">Birds on your farm</p>
          ${fl.length ? fl.map((f) => `<div class="act">${icon("bird", 18)}<div class="txt"><b>${esc(f.identifier)}</b><small>${esc(f.stage)} • ${fmtInt(f.current_count)} of ${fmtInt(f.starting_count)} birds</small></div><time>${num(f.mortality_rate).toFixed(1)}% lost</time></div>`).join("") : `<div class="empty-line">No active flocks yet.</div>`}
          <div class="below"><span>${fmtInt(metrics().live)} live birds</span><button class="chip" data-action="review-flock">View flocks</button></div>
        </section>`;
}

// The sentence under the greeting follows the period chosen in the filter.
const GREET_PERIOD = { today: "today", "7d": "over the last 7 days", "30d": "over the last 30 days", month: "this month", lastmonth: "last month", year: "this year", all: "across all time" };

function dashboardView() {
  const m = metrics();
  // Stock Value is "—" for three different reasons, so say which one it is.
  const inv = state.inventory || {};
  let stockValue = fmtMoney0(m.stockValue), stockNote = "";
  if (m.stockValue == null) {
    stockValue = "—";
    if (inv.status === "error") stockNote = `<span>Couldn't load inventory.</span><button class="link-btn" type="button" data-action="retry-inventory">Retry</button>`;
    else if (inv.status === "ready") stockNote = "<span>No stock value recorded yet.</span>";
    else stockNote = "<span>Loading…</span>";
  }
  const h = new Date().getHours();
  const greet =
    h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
  const rate = m.target > 0 ? (m.eggsToday / m.target) * 100 : 0;
  const C = 2 * Math.PI * 52;
  const below = Math.max(0, m.target - m.eggsToday);
  const per = dashPeriod()[2];
  const fin = finSeries();
  const allActs = activityItems().filter(inDashPeriod);
  const actPages = Math.max(1, Math.ceil(allActs.length / ACT_PAGE));
  const actPage = Math.min(Math.max(0, state.actPage || 0), actPages - 1);
  state.actPage = actPage;
  const acts = allActs.slice(actPage * ACT_PAGE, (actPage + 1) * ACT_PAGE);

  return `
      <div class="page-head">
      <div><h1>${greet}!</h1><p>Here's what's happening at ${esc(farm().name)} ${GREET_PERIOD[dashPeriod()[0]] || "today"}.</p></div>
      <div class="page-head-actions">
        <div class="sel period-sel">${icon("calendar", 15)}<select id="dash-period" aria-label="Dashboard period">${DASH_PERIODS.map(([k, l]) => `<option value="${k}"${dashPeriod()[0] === k ? " selected" : ""}>${l}</option>`).join("")}</select>${icon("chevronDown", 16)}</div>
        <button class="btn" data-action="export-dashboard">${icon("upload", 16)}Export</button>
      </div>
      </div>

      ${showSetupCard() ? setupCard() : ""}

      <div class="stats">
        ${statCard("bird", "Live birds", fmtInt(m.live), null)}
        ${hasEggs() ? statCard("egg", "Eggs collected", fmtInt(m.eggsToday), m.eggsDelta, "From previous period") : statCard("bird", "Active flocks", fmtInt(state.data.flock.filter((f) => f.status === "Active").length), null)} ${statCard("wallet", "Stock Value", stockValue, null, "", stockNote)}
        ${statCard("trend", "Sales", fmtMoney0(m.sellM), m.sellDelta, "From previous period")}
      </div>

      <div class="dash-grid">
        <section class="card area-chart">
          <div class="card-head">
            <h3>Financial Overview</h3>
            <div class="legend">
              <span>Income <i style="background:#147a3a"></i></span>
              <span>Expenses <i style="background:#f3b93a"></i></span>
              <span>Profit <i style="background:#3b6fd4"></i></span>
              ${fin.gran === "day" ? "" : `<select class="range" id="range" aria-label="Chart view">
                <option value="monthly" ${state.range === "monthly" ? "selected" : ""}>Monthly View</option>
                <option value="quarterly" ${state.range === "quarterly" ? "selected" : ""}>Quarterly View</option>
              </select>`}
            </div>
          </div>
          <p class="sub">Sales against purchases and expenses, ${per}. Based on amounts recorded, not cash received.</p>
          <div class="chart" id="chart">${chartHTML(fin)}</div>
        </section>

        ${
          hasEggs()
            ? `<section class="card perf area-perf">
          <h3>Production performance</h3>
          <p class="sub">${dashPeriod()[0] === "today" ? "Today's laying target" : `Laying target, ${per}`}</p>
          <div class="donut">
            <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="9"/>${rate > 0 ? `<circle cx="60" cy="60" r="52" fill="none" stroke="#4f9a67" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(C * Math.min(rate, 100)) / 100} ${C}"/>` : ""}</svg>
            <div class="mid"><b>${rate.toFixed(1)}%</b><span>Laying rate</span></div>
          </div>
          <div class="split"><div><small>Collected</small><b>${fmtInt(m.eggsToday)}</b></div><div class="vr"></div><div><small>Target</small><b>${fmtInt(m.target)}</b></div></div>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(rate, 100).toFixed(0)}"><i style="width:${Math.min(rate, 100)}%"></i></div>
          <div class="below"><span>${fmtInt(below)} eggs below target</span>${below > 0 && m.target > 0 ? `<button class="chip" data-action="review-flock">Review flock</button>` : ""}</div>
        </section>`
            : flockOverviewCard()
        }

        <section class="card recent area-recent">
        <div class="card-head"><h3>Recent Activity</h3></div>
        <p class="sub">Latest records from your team</p>
         ${acts.length ? acts.map((a) => `<div class="act">${icon(a.ic, 18)}<div class="txt"><b>${esc(a.t)}</b><small>${esc(a.s)}</small></div><time>${esc(actWhen(a))}</time></div>`).join("") : `<div class="empty-line">No activity yet. Records you add will show up here.</div>`}
         ${allActs.length ? `<div class="pager"><span>${actPage * ACT_PAGE + 1}–${Math.min(allActs.length, (actPage + 1) * ACT_PAGE)} of ${fmtInt(allActs.length)}</span><div class="pager-btns"><button class="tool-btn" type="button" data-action="act-prev"${actPage === 0 ? " disabled" : ""}>Previous</button><button class="tool-btn" type="button" data-action="act-next"${actPage >= actPages - 1 ? " disabled" : ""}>Next</button></div></div>` : ""}
        </section>
      </div>`;
}