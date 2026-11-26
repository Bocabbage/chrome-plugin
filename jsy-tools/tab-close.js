(() => {
  const key = Symbol.for("jsy-tools.tab-close");
  if (window[key]) return;
  window[key] = true;
  let enabled = false;
  let popup = null;
  let busy = false;

  const projectId = () => location.pathname.match(/^\/decision\/home\/project\/([^/]+)(?:\/|$)/)?.[1];
  const identity = () => [projectId(), window.BI?.personal?.userId, window.BI?.system?.currentCorpId].join("|");
  function visit(root, fn) {
    const stack = [root], seen = new Set();
    while (stack.length && seen.size < 30000) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      fn(node);
      if (node.sibling && node !== root) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
  }

  // shortcut: 复用当前 React 标签属性及原生关闭回调，产品结构不匹配时不接管右键。
  function context(element) {
    const name = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    let node = name && element[name];
    if (!node) return null;
    let root = node;
    while (root.return) root = root.return;
    root = root.stateNode?.current || root;
    visit(root, item => { if (item.stateNode === element) node = item; });
    let target, scope;
    for (let current = node; current; current = current.return) {
      const props = current.memoizedProps;
      if (!target && props?.tab?.id && props.file?.projectId === projectId() && typeof props.onCloseTab === "function") target = props;
      if (target && props?.projectId === projectId()) { scope = current; break; }
    }
    if (!target || !scope) return null;
    let tabs = [], dirty = new Set(), workspaceId;
    const visible = new Map();
    visit(scope, item => {
      const props = item.memoizedProps;
      if (props?.onCloseTab !== target.onCloseTab) return;
      if (Array.isArray(props.openedFileTabs) && Array.isArray(props.draftFiles)) {
        tabs = props.openedFileTabs;
        dirty = new Set(props.draftFiles.map(file => file.id));
      }
      if (props.tab?.id && props.file?.projectId === projectId() && typeof props.hasUnsaved === "boolean") visible.set(props.tab.id, props);
    });
    if (!tabs.length) {
      tabs = [...visible.values()].map(props => props.tab);
      dirty = new Set([...visible.values()].filter(props => props.hasUnsaved).map(props => props.tab.id));
    }
    visit(root, item => {
      if (item.memoizedProps?.project?.id === projectId()) workspaceId = item.memoizedProps.project.workspaceId || workspaceId;
    });
    if (tabs.some(tab => typeof tab.id !== "string" || !tab.id) || !tabs.some(tab => tab.id === target.tab.id) || new Set(tabs.map(tab => tab.id)).size !== tabs.length) return null;
    return { id: projectId(), target: target.tab.id, tabs, dirty, workspaceId, close: target.onCloseTab };
  }

  function dismiss(restoreFocus = false) {
    if (!popup) return;
    const { host, anchor } = popup;
    popup = null;
    host.remove();
    if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }

  function report(message) {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const alert = document.createElement("div");
    alert.setAttribute("role", "alert");
    alert.style.cssText = "position:fixed;left:24px;bottom:24px;z-index:10020;max-width:420px;padding:12px 16px;background:white;border:1px solid #dce4ef;border-radius:8px;color:#b42318;font:13px/1.7 sans-serif;box-shadow:0 4px 16px #16264518";
    alert.textContent = message;
    shadow.append(alert);
    document.body.append(host);
    setTimeout(() => host.remove(), 10000);
  }

  async function closeOthers(anchor, targetId, startIdentity, savedOnly) {
    if (busy || !enabled || identity() !== startIdentity) return;
    busy = true;
    try {
      const info = anchor.isConnected && context(anchor);
      if (!info || info.target !== targetId) throw new Error("标签状态已改变，请重新右键操作。");
      const ids = info.tabs.filter(tab => tab.id !== targetId && (!savedOnly || !info.dirty.has(tab.id))).map(tab => tab.id);
      if (!ids.length) return;
      const drafts = ids.filter(id => info.dirty.has(id));
      if (drafts.length) {
        if (!info.workspaceId || !window.BI?.personal?.userId || !window.BI?.system?.currentCorpId ||
            window.BI?.hiServletURL !== "/decision" || typeof window.HI?.reqDelete !== "function") throw new Error("无法识别草稿丢弃入口，未关闭标签。");
        const cacheKey = `${window.BI.personal.userId}_${info.workspaceId}_unsaved_id_map`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          let parsed;
          try { parsed = JSON.parse(cached); } catch { throw new Error("本地草稿状态异常，未丢弃修改或关闭标签。"); }
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("本地草稿状态异常，未丢弃修改或关闭标签。");
        }
        const result = await window.HI.reqDelete(`platform/assets/draft/projects/${encodeURIComponent(info.id)}`, {
          baseUrl: "/decision/v2", data: { assetIds: drafts }, skipGlobalError: true,
        });
        if (!result || result.errorCode != null) throw new Error("草稿丢弃未成功，未关闭标签；请检查后重试。");
        if (identity() !== startIdentity) throw new Error("项目或登录账号已改变，已停止关闭标签。");
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const map = JSON.parse(raw);
          if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("草稿已丢弃，但本地状态异常，请刷新页面后检查标签。");
          for (const id of drafts) delete map[id];
          localStorage.setItem(cacheKey, JSON.stringify(map));
        }
      }
      const latest = anchor.isConnected && context(anchor);
      if (identity() !== startIdentity || !latest || latest.target !== targetId) throw new Error("标签状态已改变，请刷新页面检查。");
      const remaining = ids.filter(id => latest.tabs.some(tab => tab.id === id) && (!savedOnly || !latest.dirty.has(id)));
      if (remaining.length) latest.close(remaining);
    } catch (error) {
      report(error?.message || "标签关闭未完成，请检查页面后重试。");
    } finally { busy = false; }
  }

  window.addEventListener("contextmenu", event => {
    dismiss();
    if (!enabled || busy || !projectId() || event.target.closest?.("input,textarea,[contenteditable=true]")) return;
    const anchor = event.target.closest?.('[data-test-type="file-tab"]');
    const info = anchor && context(anchor);
    if (!info || info.tabs.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    const startIdentity = identity();
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ':host{all:initial}div{position:fixed;z-index:10010;box-sizing:border-box;width:max-content;padding:4px;border:1px solid #e2e7ef;border-radius:6px;background:#fff;box-shadow:0 6px 20px #18243826;font:14px/1.5 "Microsoft YaHei",sans-serif;color:#182438}button{display:block;width:100%;height:38px;padding:0 12px;border:0;border-radius:4px;background:transparent;text-align:left;color:inherit;font:inherit;white-space:nowrap;cursor:pointer}button:hover,button:focus-visible{background:#eaf8f7;outline:none}button:disabled{color:#9ba4b2;background:none;cursor:default}';
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "标签页快捷关闭");
    for (const [text, savedOnly] of [["关闭其它标签页（强行）", false], ["关闭其他已保存标签页", true]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = text;
      button.disabled = !info.tabs.some(tab => tab.id !== info.target && (!savedOnly || !info.dirty.has(tab.id)));
      button.addEventListener("click", () => { dismiss(); void closeOthers(anchor, info.target, startIdentity, savedOnly); });
      menu.append(button);
    }
    shadow.append(style, menu);
    document.body.append(host);
    menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - menu.getBoundingClientRect().width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - 94))}px`;
    popup = { host, anchor };
    shadow.addEventListener("keydown", event => {
      const items = [...menu.querySelectorAll("button:not(:disabled)")];
      const index = items.indexOf(shadow.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
      if (event.key === "Tab") dismiss();
    });
    menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }, true);
  window.addEventListener("pointerdown", event => { if (popup && !event.composedPath().includes(popup.host)) dismiss(); }, true);
  window.addEventListener("keydown", event => { if (popup && event.key === "Escape") { event.preventDefault(); dismiss(true); } }, true);
  window.addEventListener("resize", () => dismiss());
  window.addEventListener("scroll", () => dismiss(), true);
  window.addEventListener("popstate", () => dismiss());
  window.addEventListener("blur", () => dismiss());
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "jsy-tools" || event.data.type !== "settings") return;
    enabled = event.data.tabCloseEnabled === true;
    if (!enabled) dismiss();
  });
  window.postMessage({ channel: "jsy-tools", type: "ready" }, location.origin);
})();
