chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage().catch(error => {
    console.error("[jsy-tools] 无法打开配置页面", error);
  });
});

let recentWrite = Promise.resolve();
let recentCorpWrite = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "remember-recent-corp" || sender.id !== chrome.runtime.id) return;
  let url;
  try { url = new URL(sender.url); } catch { return; }
  const supported = url.pathname.startsWith("/decision/") ||
    ((url.hostname === "jdydevelop.com" || url.hostname.endsWith(".jdydevelop.com")) && /^\/dashboard(?:\/|$)/.test(url.pathname));
  if (!supported || !["http:", "https:"].includes(url.protocol) || typeof message.key !== "string" || !message.key || message.key.length > 240) return;
  recentCorpWrite = recentCorpWrite.then(async () => {
    const settings = await chrome.storage.local.get({ corpSearchEnabled: false, recentCorps: [] });
    if (settings.corpSearchEnabled !== true) return respond({ ok: true });
    const previous = Array.isArray(settings.recentCorps) ? settings.recentCorps.filter(key => typeof key === "string" && key && key.length <= 240) : [];
    const next = [message.key, ...new Set(previous.filter(key => key !== message.key))];
    if (JSON.stringify(previous) !== JSON.stringify(next)) await chrome.storage.local.set({ recentCorps: next });
    respond({ ok: true });
  }).catch(error => {
    console.error("[jsy-tools] 最近使用企业保存失败", error);
    respond({ ok: false });
  });
  return true;
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "remember-recent-action" || sender.id !== chrome.runtime.id) return;
  let url;
  try { url = new URL(sender.url || "https://invalid.local"); }
  catch { return; }
  const action = message.action;
  if (!["http:", "https:"].includes(url.protocol) ||
      !/^\/decision\/home\/project\/[^/]+(?:\/|$)/.test(url.pathname) ||
      !Number.isInteger(action?.key) || action.key < 0 || typeof action.label !== "string" || !action.label.trim() || action.label.length > 120) return;
  // 串行合并多标签页的操作，避免各自读写缓存覆盖另一页的记录。
  recentWrite = recentWrite.then(async () => {
    const settings = await chrome.storage.local.get({ recentActionsEnabled: false, recentActions: [] });
    if (settings.recentActionsEnabled !== true) return respond({ ok: true });
    const existing = Array.isArray(settings.recentActions) ? settings.recentActions : [];
    const previous = existing.find(item => item?.key === action.key);
    const icon = action.icon && JSON.stringify(action.icon).length <= 24000 ? action.icon : previous?.icon;
    const next = [{ key: action.key, label: action.label.trim(), ...(icon ? { icon } : {}) }, ...existing.filter(item => item?.key !== action.key)];
    await chrome.storage.local.set({ recentActions: next });
    respond({ ok: true });
  }).catch(error => {
    console.error("[jsy-tools] 最近操作保存失败", error);
    respond({ ok: false });
  });
  return true;
});
