/* js/views/users.js - Users & Permissions page */
"use strict";

(function () {
  const ROLES = [["OWNER", "Owner"], ["ADMINISTRATOR", "Administrator"], ["FARM_MANAGER", "Farm Manager"], ["ACCOUNTANT", "Accountant"], ["STAFF", "Staff"]];
  const roleLabel = (r) => (ROLES.find((x) => x[0] === r) || [0, r || "—"])[1];
  // Role checks live in js/core/permissions.js
  const isOwner = () => currentRole() === "OWNER";
  const canManage = () => canManageUsers();
  // Only an Owner can hand out the Owner and Administrator roles.
  const assignable = () => ROLES.filter(([v]) => isOwner() || (v !== "OWNER" && v !== "ADMINISTRATOR"));

  // The server's field names are not confirmed yet, so accept the common ones.
  const pick = (...v) => { for (const x of v) if (x != null && x !== "") return x; return ""; };
  const normMember = (m) => {
    const u = m.user && typeof m.user === "object" ? m.user : {};
    return {
      id: pick(m.membership_id, m.id),
      name: String(pick(m.full_name, m.user_name, u.full_name, u.name, m.name)),
      email: String(pick(m.email, m.user_email, u.email)),
      role: String(pick(m.role)).toUpperCase(),
    };
  };
  const normInvite = (i) => ({
    id: pick(i.id, i.invitation_id),
    email: String(pick(i.email, i.invited_email)),
    role: String(pick(i.role)).toUpperCase(),
    sent: String(pick(i.created_at, i.sent_at, i.invited_at, i.created, i.date_sent)),
  });

  const freshState = () => ({ farmId: state.farmId, members: [], invites: [], status: "idle" });

  async function loadUsers(silent) {
    const farmId = state.farmId;
    if (!state.users || state.users.farmId !== farmId) state.users = freshState();
    if (!silent) state.users.status = "loading";
    try {
      const [m, i] = await Promise.all([
        AgroAPI.listFarmMembers(farmId),
        AgroAPI.listPendingInvites(farmId).catch(() => []),
      ]);
      if (farmId !== state.farmId) return;
      state.users = { farmId, members: m.map(normMember), invites: i.map(normInvite), status: "ready" };
    } catch (err) {
      if (farmId !== state.farmId) return;
      if (silent && state.users.status === "ready") return;
      state.users.status = "error";
    }
    if (route().page === "users" && state.status === "ready") renderView();
  }

  function apiMsg(err, ctx) {
    const text = (err && err.message) || "";
    if (err && err.status === 403) return ctx === "role" ? "Only an Owner can assign this role." : (text || "You don't have permission to do that.");
    if (err && err.status === 400) {
      const fieldText = Object.values(err.fields || {}).join(" ");
      if (ctx === "invite" && /already|exist|pending|member/i.test(text + " " + fieldText)) return "This user is already a member or has a pending invite.";
      if (/last owner|only owner|at least one owner/i.test(text + " " + fieldText)) return "Cannot remove the last Owner of the farm.";
      if (fieldText) return fieldText;
    }
    return text || "We couldn't complete that request. Please try again.";
  }

  function membersCard() {
    const manage = canManage(), me = String(state.user.email || "").toLowerCase();
    const rows = state.users.members.map((m) => {
      // The backend refuses self-removal and self role changes (400), so the UI never offers them.
      const isMe = !!me && m.email.toLowerCase() === me;
      const locked = !manage || isMe || (m.role === "OWNER" && !isOwner());
      const who = esc(m.name || m.email);
      const tip = isMe ? ` title="Only another Owner can change your role."` : "";
      const roleCell = `<span class="dv-badge"${tip}>${esc(roleLabel(m.role))}</span>`;
      const mid = "um-" + esc(m.id);
      const action = isMe
        ? `<span style="color:var(--muted)">You</span>`
        : locked ? "" : `<div class="menu-wrap" style="display:inline-block"><button class="icon-btn square row-btn" type="button" data-menu="${mid}" data-fixed aria-label="Actions for ${who}" aria-haspopup="menu">${icon("more", 16)}</button>
           <div class="menu tbl-menu" id="${mid}" role="menu" hidden>
             <button class="menu-item" type="button" role="menuitem" data-user-action="change-role" data-id="${esc(m.id)}"><span class="mi-txt"><b>Change role</b></span></button>
             <button class="menu-item" type="button" role="menuitem" data-user-action="remove" data-id="${esc(m.id)}" style="color:var(--error,#c62828)"><span class="mi-txt"><b>Remove user</b></span></button>
           </div></div>`;
      const you = isMe ? ` <small style="color:var(--muted)">(You)</small>` : "";
      return `<tr><td class="item-name">${esc(m.name || "—")}${you}</td><td>${esc(m.email || "—")}</td><td>${roleCell}</td>${manage ? `<td class="num">${action}</td>` : ""}</tr>`;
    }).join("");
    const body = state.users.members.length
      ? `<div class="table-wrap"><table><thead><tr><th>Full name</th><th>Email</th><th>Role</th>${manage ? `<th class="num">Actions</th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty-line" style="padding:24px 20px">No team members yet.</div>`;
    return `<section class="card table-card inv-table"><div class="table-head"><div><h3>Team members</h3><p class="sub-line">${fmtInt(state.users.members.length)} on this farm</p></div></div>${body}</section>`;
  }

  function invitesCard() {
    const manage = canManage();
    const rows = state.users.invites.map((i) =>
      `<tr><td>${esc(i.email)}</td><td><span class="dv-badge">${esc(roleLabel(i.role))}</span></td><td>${i.sent ? esc(fmtDate(i.sent.slice(0, 10))) : "—"}</td>${manage ? `<td class="num"><button class="btn ghost" type="button" data-user-action="revoke" data-id="${esc(i.id)}">Revoke</button></td>` : ""}</tr>`).join("");
    const body = state.users.invites.length
      ? `<div class="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Date sent</th>${manage ? `<th class="num">Actions</th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty-line" style="padding:24px 20px">No pending invitations.</div>`;
    return `<section class="card table-card inv-table" style="margin-top:20px"><div class="table-head"><div><h3>Pending invitations</h3><p class="sub-line">Invited but not yet accepted</p></div></div>${body}</section>`;
  }

  function usersView() {
    if (!state.users || state.users.farmId !== state.farmId) state.users = freshState();
    const u = state.users;
    const head = `<div class="page-head"><div><h1>Users &amp; Permissions</h1><p>Manage who can access this farm and what they can do.</p></div>${canInvite() ? `<button class="btn" data-user-action="invite">${icon("plus", 14)}Invite User</button>` : ""}</div>`;
    if (u.status === "idle" || u.status === "loading") return head + loadingView();
    if (u.status === "error") return head + `<div class="state-card err" role="alert">${icon("alert", 28)}<h2>Something went wrong</h2><p>We couldn't load your team.</p><button class="btn pill" data-user-action="retry">Try again</button></div>`;
    return head + membersCard() + invitesCard();
  }

  /* ---------- Invite modal ---------- */
  function openInviteModal(trigger) {
    modalTrigger = trigger || document.activeElement;
    const defs = [
      { name: "email", label: "Email address", type: "text", placeholder: "name@example.com", required: true, max: 120 },
      { name: "role", label: "Role", type: "select", placeholder: "Select role", required: true, options: assignable() },
    ];
    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <h2 id="modal-title">Invite User</h2>
          <p class="sub">They will get an invitation to join this farm with the role you choose.</p>
          <form id="invite-form" novalidate>
            <div class="form-grid" id="form-grid">${defs.map(fieldHTML).join("")}</div>
            <p class="form-error" id="form-error" role="alert"></p>
            <div class="actions"><button class="btn" id="save-btn" type="submit" data-label="Send invitation">Send invitation</button></div>
          </form>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    const form = $("#invite-form");
    $("#f-role").value = "STAFF";   // safest default

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      setError("email", ""); setError("role", ""); $("#form-error").textContent = "";
      const email = $("#f-email").value.trim().toLowerCase(), role = $("#f-role").value;
      let bad = false;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("email", "Enter a valid email address."); bad = true; }
      if (!role) { setError("role", "Choose a role."); bad = true; }
      if (bad) return;
      const btn = $("#save-btn");
      saving = true; btn.disabled = true; btn.textContent = "Sending…";
      try {
        await AgroAPI.inviteUser({ email, farm_id: state.farmId, role });
        await loadUsers(true);
        closeModal();
        toast("Invitation sent");
      } catch (err) {
        $("#form-error").textContent = apiMsg(err, "invite");
        btn.disabled = false; btn.textContent = btn.dataset.label;
      } finally {
        saving = false;
      }
    });
    $("#f-email").focus();
  }

  /* ---------- Change role modal ---------- */
  function openRoleModal(id, trigger) {
    const m = state.users.members.find((x) => String(x.id) === String(id));
    if (!m) return;
    modalTrigger = trigger || document.activeElement;
    const defs = [{ name: "role", label: "Role", type: "select", placeholder: "Select role", required: true, options: assignable() }];
    $("#modal-root").innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <button class="close" type="button" data-close aria-label="Close">${icon("x", 18)}</button>
          <h2 id="modal-title">Change role</h2>
          <p class="sub">Choose a new role for ${esc(m.name || m.email)}.</p>
          <form id="role-form" novalidate>
            <div class="form-grid" id="form-grid">${defs.map(fieldHTML).join("")}</div>
            <p class="form-error" id="form-error" role="alert"></p>
            <div class="actions"><button class="btn" id="save-btn" type="submit" data-label="Save role">Save role</button></div>
          </form>
        </div>
      </div>`;
    document.body.style.overflow = "hidden";
    $("#f-role").value = m.role;
    $("#role-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (saving) return;
      const role = $("#f-role").value;
      if (!role) { setError("role", "Choose a role."); return; }
      if (role === m.role) { closeModal(); return; }
      const btn = $("#save-btn");
      saving = true; btn.disabled = true; btn.textContent = "Saving…";
      try {
        await AgroAPI.updateMemberRole(state.farmId, id, role);
        await loadUsers(true);
        closeModal();
        toast("Role updated to " + roleLabel(role) + ".");
      } catch (err) {
        $("#form-error").textContent = apiMsg(err, "role");
        btn.disabled = false; btn.textContent = btn.dataset.label;
      } finally {
        saving = false;
      }
    });
  }

  /* ---------- Actions ---------- */
  async function removeMember(id) {
    const m = state.users.members.find((x) => String(x.id) === String(id));
    if (!m) return;
    if (!confirm(`Remove ${m.name || m.email} from this farm?`)) return;
    try {
      await AgroAPI.removeMember(state.farmId, id);
      toast("Member removed.");
      await loadUsers(true);
    } catch (err) {
      toast(apiMsg(err, "remove"));
    }
  }

  async function revokeInvite(id) {
    const i = state.users.invites.find((x) => String(x.id) === String(id));
    if (!i) return;
    if (!confirm(`Revoke the invitation sent to ${i.email}?`)) return;
    try {
      await AgroAPI.revokeInvitation({ invitation_id: id, farm_id: state.farmId });
      toast("Invitation revoked.");
      await loadUsers(true);
    } catch (err) {
      toast(apiMsg(err, "revoke"));
    }
  }

  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-user-action]");
    if (!act) return;
    closeMenus();
    switch (act.dataset.userAction) {
      case "invite": if (!canInvite()) return; openInviteModal(act); break;
      case "change-role": if (!canManage()) return; openRoleModal(act.dataset.id, act); break;
      case "remove": if (!canManage()) return; removeMember(act.dataset.id); break;
      case "revoke": if (!canManage()) return; revokeInvite(act.dataset.id); break;
      case "retry": state.users.status = "idle"; renderView(); break;
    }
  });

  window.usersView = usersView;
  window.loadUsers = loadUsers;
})();