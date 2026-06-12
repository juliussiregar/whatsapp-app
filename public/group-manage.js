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

function renderGroupOptions(groups) {
  if (!groups.length) {
    return '<option value="">Belum ada grup</option>';
  }
  return (
    '<option value="">— Pilih grup —</option>' +
    groups
      .map(
        (g) =>
          `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (${g.participantsCount} anggota)</option>`,
      )
      .join("")
  );
}

function setSelectLoading(select, message = "Memuat…") {
  if (!select) return;
  select.innerHTML = `<option value="">${message}</option>`;
}

async function loadGroups() {
  const selects = [$("select-group"), $("select-group-delete")].filter(Boolean);
  if (!selects.length) return;

  selects.forEach((select) => setSelectLoading(select));
  try {
    const data = await fetchJson(API.groups);
    const groups = (data.groups || []).filter((g) => (g.participantsCount || 0) > 0);
    const html = groups.length
      ? renderGroupOptions(groups)
      : '<option value="">Tidak ada grup aktif — buat grup baru di atas</option>';
    selects.forEach((select) => {
      select.innerHTML = html;
    });
  } catch (err) {
    const html = `<option value="">Gagal memuat: ${escapeHtml(err.message)}</option>`;
    selects.forEach((select) => {
      select.innerHTML = html;
    });
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

$("form-delete-group")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;

  const select = $("select-group-delete");
  const groupId = select?.value;
  const groupLabel = select?.selectedOptions?.[0]?.textContent?.trim() || groupId;

  if (!groupId) {
    showFeedback($("delete-feedback"), "Pilih grup terlebih dahulu.", false);
    return;
  }

  const confirmed = window.confirm(
    `Bot akan keluar dari grup:\n\n${groupLabel}\n\nGrup tidak dihapus untuk anggota lain. Lanjutkan?`,
  );
  if (!confirmed) return;

  setBusy(true);
  const btn = $("btn-delete-group");
  setButtonLoading(btn, true);
  hideFeedback($("delete-feedback"));

  try {
    const res = await fetchJson(API.deleteGroup, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    showFeedback($("delete-feedback"), res.message || "Grup dihapus untuk bot.", true, true);
    showToast(res.message || "Bot keluar dari grup", true);
    loadGroups();
  } catch (err) {
    showFeedback($("delete-feedback"), err.message, false);
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
