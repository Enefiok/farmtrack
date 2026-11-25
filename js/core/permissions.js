/* js/core/permissions.js - one place for every role check in the app */
"use strict";

/* =====================================================================
   ROLE-BASED UI RULES
   The role comes from the active farm: farm().role
   (it changes automatically when the user switches farms).

   Roles: OWNER, ADMINISTRATOR, FARM_MANAGER, ACCOUNTANT, STAFF

   Record types used by canEdit / canDelete:
     Operational: flock, production, activity, inventory
     Financial:   sales, purchase, expense
   ===================================================================== */

const OPERATIONAL_TYPES = ["flock", "production", "activity", "inventory"];
const FINANCIAL_TYPES = ["sales", "purchase", "expense"];

// Pages only Owners and Administrators may open.
const ADMIN_ONLY_PAGES = ["users", "settings"];

// Report keys that Staff must not open.
const FINANCIAL_REPORT_KEYS = [
  "pl", "cash-flow", "inventory-valuation",
  "period-comparison", "flock-roi", "cost-per-crate",
];

/* ---------- who is the user? ---------- */

// The logged-in user's role on the CURRENT farm, always upper-case.
function currentRole() {
  const r = String((farm() && farm().role) || "").toUpperCase();
  return r === "ADMIN" ? "ADMINISTRATOR" : r;
}

const isOwnerOrAdmin = (role = currentRole()) =>
  role === "OWNER" || role === "ADMINISTRATOR";

/* ---------- 1. User management and settings (Owner/Admin only) ---------- */

const canManageUsers = (role = currentRole()) => isOwnerOrAdmin(role);
const canInvite = (role = currentRole()) => isOwnerOrAdmin(role);

// Use for nav links and route guards: canAccessPage("users"), canAccessPage("settings").
const canAccessPage = (page, role = currentRole()) =>
  !ADMIN_ONLY_PAGES.includes(page) || isOwnerOrAdmin(role);

/* ---------- 2. Edit and delete buttons (pencil and trash) ---------- */

// OWNER / ADMINISTRATOR: everything
// FARM_MANAGER:          operational records only
// ACCOUNTANT:            financial records only
// STAFF (and unknown):   nothing, view and add only
function canEdit(recordType, role = currentRole()) {
  if (isOwnerOrAdmin(role)) return true;
  if (role === "FARM_MANAGER") return OPERATIONAL_TYPES.includes(recordType);
  if (role === "ACCOUNTANT") return FINANCIAL_TYPES.includes(recordType);
  return false;
}

// Same rules as edit today. Kept separate so they can diverge later.
const canDelete = (recordType, role = currentRole()) => canEdit(recordType, role);

/* ---------- 3. Financial reports (hidden from Staff) ---------- */

const canViewFinancialReports = (role = currentRole()) => role !== "STAFF";

const canViewReport = (key, role = currentRole()) =>
  role !== "STAFF" || !FINANCIAL_REPORT_KEYS.includes(key);

/* ---------- small helper for guarded click handlers ---------- */

function denyToast() {
  toast("You don't have permission to do that.");
}