import {
  API,
  $,
  busy,
  setBusy,
  fetchJson,
  showFeedback,
  hideFeedback,
  bindTopbarActions,
  requireReady,
  initNavigation,
  showToast,
  escapeHtml,
  whenReady,
} from "./shared.js";
import { setButtonLoading } from "./ux.js";

initNavigation();
bindTopbarActions();
requireReady();

const STATUS_LABELS = {
  added: "Ditambahkan",
  invited: "Diundang",
  failed: "Gagal",
  skipped: "Dilewati",
};

function formatSettingsNote(settings) {
  if (!settings) return "";
  const parts = [];
  parts.push(
    settings.membersCanSendMessages
      ? "Semua anggota bisa kirim pesan."
      : "Hanya admin yang bisa kirim pesan.",
  );
  if (settings.membersPromotedToAdmin) {
    parts.push("Anggota diundang dijadikan admin.");
  } else if (settings.promoteFailed) {
    parts.push("Gagal menjadikan anggota sebagai admin.");
  }
  return parts.join(" ");
}

function parsePhoneList(text) {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderParticipantResults(container, data) {
  if (!container || !data?.participants?.length) {
    if (container) container.hidden = true;
    return;
  }

  const summary = data.summary || {};
  const rows = data.participants
    .map((p) => {
      const statusClass = `participant-results__status--${p.status}`;
      return `<tr>
        <td>${escapeHtml(p.phone)}</td>
        <td><span class="participant-results__status ${statusClass}">${escapeHtml(STATUS_LABELS[p.status] || p.status)}</span></td>
        <td>${escapeHtml(p.message || "")}</td>
      </tr>`;
    })
    .join("");

  container.hidden = false;
  container.innerHTML = `
    <p class="participant-results__summary">
      Ditambahkan: <strong>${summary.added ?? 0}</strong> ·
      Diundang: <strong>${summary.invited ?? 0}</strong> ·
      Gagal: <strong>${summary.failed ?? 0}</strong> ·
      Dilewati: <strong>${summary.skipped ?? 0}</strong>
    </p>
    <div class="participant-results__table-wrap">
      <table class="participant-results__table">
        <thead>
          <tr><th>Nomor</th><th>Status</th><th>Keterangan</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function loadGroups() {
  const select = $("select-group");
  if (!select) return;

  select.innerHTML = '<option value="">Memuat…</option>';
  try {
    const data = await fetchJson(API.groups);
    const groups = data.groups || [];
    if (!groups.length) {
      select.innerHTML = '<option value="">Belum ada grup</option>';
      return;
    }
    select.innerHTML =
      '<option value="">— Pilih grup —</option>' +
      groups
        .map(
          (g) =>
            `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (${g.participantsCount} anggota)</option>`,
        )
        .join("");
  } catch (err) {
    select.innerHTML = `<option value="">Gagal memuat: ${escapeHtml(err.message)}</option>`;
  }
}

whenReady(() => loadGroups());

$("form-create-group")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;

  const name = $("input-group-name")?.value.trim();
  const participants = parsePhoneList($("input-create-phones")?.value || "");
  const inviteComment = $("input-invite-comment")?.value.trim() || undefined;
  const messageMode =
    document.querySelector('input[name="message-mode"]:checked')?.value || "all";
  const promoteMembersToAdmin = Boolean($("input-promote-admin")?.checked);

  if (!name || !participants.length) {
    showFeedback($("create-feedback"), "Nama grup dan minimal satu nomor wajib diisi.", false);
    return;
  }

  setBusy(true);
  const btn = $("btn-create-group");
  setButtonLoading(btn, true);
  hideFeedback($("create-feedback"));
  $("create-results").hidden = true;

  try {
    const res = await fetchJson(API.createGroup, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        participants,
        inviteComment,
        messageMode,
        promoteMembersToAdmin,
      }),
    });
    const settingsNote = formatSettingsNote(res.settings);
    showFeedback(
      $("create-feedback"),
      `Grup "${res.groupName}" dibuat (${res.groupId}). ${settingsNote}`,
      true,
      true,
    );
    renderParticipantResults($("create-results"), res);
    loadGroups();
  } catch (err) {
    showFeedback($("create-feedback"), err.message, false);
    showToast(err.message, false);
  } finally {
    setBusy(false);
    setButtonLoading(btn, false);
  }
});

$("form-add-participants")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;

  const groupId = $("select-group")?.value;
  const participants = parsePhoneList($("input-add-phones")?.value || "");

  if (!groupId) {
    showFeedback($("add-feedback"), "Pilih grup terlebih dahulu.", false);
    return;
  }
  if (!participants.length) {
    showFeedback($("add-feedback"), "Minimal satu nomor wajib diisi.", false);
    return;
  }

  setBusy(true);
  const btn = $("btn-add-participants");
  setButtonLoading(btn, true);
  hideFeedback($("add-feedback"));
  $("add-results").hidden = true;

  try {
    const res = await fetchJson(API.addGroupParticipants, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, participants }),
    });
    showFeedback($("add-feedback"), `Proses selesai untuk grup ${groupId}`, true, true);
    renderParticipantResults($("add-results"), res);
    loadGroups();
  } catch (err) {
    showFeedback($("add-feedback"), err.message, false);
    showToast(err.message, false);
  } finally {
    setBusy(false);
    setButtonLoading(btn, false);
  }
});
