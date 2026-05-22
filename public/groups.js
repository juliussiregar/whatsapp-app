import {
  API,
  $,
  busy,
  setBusy,
  escapeHtml,
  fetchJson,
  filterItems,
  renderChatList,
  loadMessages,
  setAvatar,
  showFeedback,
  hideFeedback,
  bindTopbarActions,
  requireReady,
  whenReady,
  initNavigation,
  resetMediaState,
  showToast,
} from "./shared.js";
import {
  bindComposerEnter,
  setLastChatId,
  getLastChatId,
  setButtonLoading,
  renderChatListSkeleton,
  initScrollToBottom,
  initMobileChat,
  startLiveRefresh,
  setLiveIndicator,
  LIVE_REFRESH_MS,
} from "./ux.js";

let groups = [];
let selectedGroup = null;
let liveRefresh = null;
const mobileChat = initMobileChat("#chat-workspace");
const messagesEl = $("group-messages");
const scrollUpdate = initScrollToBottom(messagesEl, $("btn-scroll-bottom"));
if (messagesEl) messagesEl._scrollUpdate = scrollUpdate;

function setComposerEnabled(enabled) {
  const input = $("input-group-msg");
  const btn = $("btn-group-send");
  if (input) input.disabled = !enabled;
  if (btn) btn.disabled = !enabled || busy;
}

async function loadGroups() {
  const list = $("list-groups");
  const count = $("groups-count");
  const refreshBtn = $("btn-refresh-groups");
  if (!list) return;
  setButtonLoading(refreshBtn, true);
  renderChatListSkeleton(list);
  if (count) count.textContent = "";
  try {
    const merged = new Map();

    const addChat = (c) => {
      if (!c?.id) return;
      merged.set(c.id, {
        id: c.id,
        name: c.name || c.id,
        isGroup: true,
        participantsCount: c.participantsCount || 0,
        unreadCount: c.unreadCount || 0,
        timestamp: c.timestamp ?? null,
        lastMessage: c.lastMessage ?? null,
      });
    };

    try {
      const res = await fetchJson(`${API.chats}?type=group`);
      (res.chats || []).forEach(addChat);
    } catch (e) {
      console.warn("chats?type=group:", e);
    }

    try {
      const fallback = await fetchJson(API.groups);
      (fallback.groups || []).forEach((g) =>
        addChat({
          ...g,
          isGroup: true,
          unreadCount: 0,
          timestamp: null,
          lastMessage: null,
        }),
      );
    } catch (e) {
      console.warn("groups:", e);
    }

    groups = [...merged.values()];

    if (count) count.textContent = groups.length ? `(${groups.length})` : "";

    if (!groups.length) {
      list.innerHTML = `<li class="chat-list__empty">
        <strong>Belum ada grup</strong><br/>
        Buka WhatsApp di HP → tab <strong>Grup</strong> → scroll daftar grup → tunggu ±10 detik → klik ↻ di atas.
      </li>`;
      return;
    }

    renderGroupList();
    const lastId = getLastChatId("groups");
    if (lastId && !selectedGroup) {
      const item = groups.find((g) => g.id === lastId);
      if (item) await selectGroup(item);
    }
  } catch (err) {
    list.innerHTML = `<li class="chat-list__empty">Gagal memuat grup: ${escapeHtml(err.message)}</li>`;
  } finally {
    setButtonLoading(refreshBtn, false);
  }
}

function renderGroupList() {
  const list = $("list-groups");
  const search = $("search-groups");
  if (!list) return;
  const filtered = filterItems(groups, search?.value || "");
  renderChatList(list, filtered, selectedGroup?.id, selectGroup, search?.value || "");
}

function shouldAutoRefresh() {
  if (!selectedGroup || busy) return false;
  if (document.hidden) return false;
  const ta = $("input-group-msg");
  if (ta?.matches(":focus") && ta.value.trim()) return false;
  return true;
}

function setupLiveRefresh() {
  liveRefresh?.stop();
  liveRefresh = startLiveRefresh({
    intervalMs: LIVE_REFRESH_MS,
    shouldRun: shouldAutoRefresh,
    onTick: async () => {
      if (!selectedGroup) return;
      await loadMessages(selectedGroup.id, messagesEl, true, $("group-chat-meta"), {
        silent: true,
        preserveScroll: true,
      });
    },
  });
}

async function selectGroup(item) {
  resetMediaState();
  selectedGroup = item;
  setLastChatId("groups", item.id);
  mobileChat.openChat();
  renderGroupList();
  $("group-chat-title").textContent = item.name;
  const meta = $("group-chat-meta");
  if (meta) meta.textContent = `${item.participantsCount || 0} anggota`;
  setAvatar($("group-avatar"), item.name, true);
  hideFeedback($("group-feedback"));
  setComposerEnabled(true);
  const refreshBtn = $("btn-refresh-group-msgs");
  if (refreshBtn) refreshBtn.disabled = false;
  const loadBtn = refreshBtn;
  setButtonLoading(loadBtn, true);
  try {
    await loadMessages(item.id, messagesEl, true, meta);
    setLiveIndicator(true);
  } finally {
    setButtonLoading(loadBtn, false);
  }
}

initNavigation();
bindTopbarActions();
requireReady();
bindComposerEnter("form-group-send", "input-group-msg");

$("btn-refresh-groups")?.addEventListener("click", loadGroups);
$("search-groups")?.addEventListener("input", renderGroupList);
$("btn-refresh-group-msgs")?.addEventListener("click", async () => {
  if (!selectedGroup) return;
  const btn = $("btn-refresh-group-msgs");
  setButtonLoading(btn, true);
  try {
    await loadMessages(
      selectedGroup.id,
      messagesEl,
      true,
      $("group-chat-meta"),
    );
  } finally {
    setButtonLoading(btn, false);
  }
});

$("form-group-send")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedGroup || busy) return;
  const input = $("input-group-msg");
  const message = input?.value.trim();
  if (!message) return;

  setBusy(true);
  setComposerEnabled(true);
  hideFeedback($("group-feedback"));
  try {
    await fetchJson(API.sendGroupMessage, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: selectedGroup.id, message }),
    });
    if (input) {
      input.value = "";
      input.focus();
    }
    showFeedback($("group-feedback"), "Pesan grup terkirim", true, true);
    await loadMessages(
      selectedGroup.id,
      messagesEl,
      true,
      $("group-chat-meta"),
    );
  } catch (err) {
    showFeedback($("group-feedback"), err.message, false);
    showToast(err.message, false);
  } finally {
    setBusy(false);
    setComposerEnabled(!!selectedGroup);
  }
});

whenReady(() => {
  loadGroups();
  setupLiveRefresh();
});
