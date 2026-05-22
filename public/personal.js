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
  chatIdToPhone,
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

let personalChats = [];
let selectedPersonal = null;
let liveRefresh = null;
const mobileChat = initMobileChat("#chat-workspace");
const messagesEl = $("personal-messages");
const scrollUpdate = initScrollToBottom(messagesEl, $("btn-scroll-bottom"));
if (messagesEl) messagesEl._scrollUpdate = scrollUpdate;

function setComposerEnabled(enabled) {
  const input = $("input-personal-msg");
  const btn = $("btn-personal-send");
  if (input) input.disabled = !enabled;
  if (btn) btn.disabled = !enabled || busy;
}

async function loadPersonalChats() {
  const list = $("list-chats");
  const count = $("chats-count");
  const refreshBtn = $("btn-refresh-chats");
  if (!list) return;
  setButtonLoading(refreshBtn, true);
  renderChatListSkeleton(list);
  if (count) count.textContent = "";
  try {
    const data = await fetchJson(`${API.chats}?type=personal`);
    personalChats = data.chats || [];
    if (count) count.textContent = `(${personalChats.length})`;
    renderPersonalList();
    const lastId = getLastChatId("personal");
    if (lastId && !selectedPersonal) {
      const item = personalChats.find((c) => c.id === lastId);
      if (item) await selectPersonal(item);
    }
  } catch (err) {
    list.innerHTML = `<li class="chat-list__empty">Gagal memuat chat: ${escapeHtml(err.message)}</li>`;
  } finally {
    setButtonLoading(refreshBtn, false);
  }
}

function renderPersonalList() {
  const list = $("list-chats");
  const search = $("search-chats");
  if (!list) return;
  const filtered = filterItems(personalChats, search?.value || "");
  renderChatList(
    list,
    filtered,
    selectedPersonal?.id,
    selectPersonal,
    search?.value || "",
  );
}

function shouldAutoRefresh() {
  if (!selectedPersonal || busy) return false;
  if (document.hidden) return false;
  const ta = $("input-personal-msg");
  if (ta?.matches(":focus") && ta.value.trim()) return false;
  return true;
}

function setupLiveRefresh() {
  liveRefresh?.stop();
  liveRefresh = startLiveRefresh({
    intervalMs: LIVE_REFRESH_MS,
    shouldRun: shouldAutoRefresh,
    onTick: async () => {
      if (!selectedPersonal) return;
      await loadMessages(
        selectedPersonal.id,
        messagesEl,
        false,
        $("personal-chat-meta"),
        { silent: true, preserveScroll: true },
      );
    },
  });
}

async function selectPersonal(item) {
  resetMediaState();
  selectedPersonal = item;
  setLastChatId("personal", item.id);
  mobileChat.openChat();
  renderPersonalList();
  $("personal-chat-title").textContent = item.name;
  const meta = $("personal-chat-meta");
  if (meta) meta.textContent = chatIdToPhone(item.id);
  setAvatar($("personal-avatar"), item.name, false);
  hideFeedback($("personal-feedback"));
  setComposerEnabled(true);
  const refreshBtn = $("btn-refresh-personal-msgs");
  if (refreshBtn) refreshBtn.disabled = false;
  setButtonLoading(refreshBtn, true);
  try {
    await loadMessages(item.id, messagesEl, false, meta);
    setLiveIndicator(true);
  } finally {
    setButtonLoading(refreshBtn, false);
  }
}

initNavigation();
bindTopbarActions();
requireReady();
bindComposerEnter("form-personal-send", "input-personal-msg");

$("btn-refresh-chats")?.addEventListener("click", loadPersonalChats);
$("search-chats")?.addEventListener("input", renderPersonalList);
$("btn-refresh-personal-msgs")?.addEventListener("click", async () => {
  if (!selectedPersonal) return;
  const btn = $("btn-refresh-personal-msgs");
  setButtonLoading(btn, true);
  try {
    await loadMessages(
      selectedPersonal.id,
      messagesEl,
      false,
      $("personal-chat-meta"),
    );
  } finally {
    setButtonLoading(btn, false);
  }
});

$("form-personal-send")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedPersonal || busy) return;
  const input = $("input-personal-msg");
  const message = input?.value.trim();
  if (!message) return;

  setBusy(true);
  setComposerEnabled(true);
  hideFeedback($("personal-feedback"));
  try {
    await fetchJson(API.sendMessage, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: chatIdToPhone(selectedPersonal.id),
        message,
      }),
    });
    if (input) {
      input.value = "";
      input.focus();
    }
    showFeedback($("personal-feedback"), "Pesan terkirim", true, true);
    await loadMessages(
      selectedPersonal.id,
      messagesEl,
      false,
      $("personal-chat-meta"),
    );
  } catch (err) {
    showFeedback($("personal-feedback"), err.message, false);
    showToast(err.message, false);
  } finally {
    setBusy(false);
    setComposerEnabled(!!selectedPersonal);
  }
});

whenReady(() => {
  loadPersonalChats();
  setupLiveRefresh();
});
