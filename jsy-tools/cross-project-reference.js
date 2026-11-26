(() => {
  const singleton = Symbol.for("jsy-tools.cross-project-reference");
  if (window[singleton]) return;
  window[singleton] = true;

  const rowSelector = '[data-test-type="add-data-source-table"]';
  const pending = new Set();
  let enabled = false;
  let button;
  let notice;
  let noticeTimer;
  const style = document.createElement("style");
  style.textContent = `
    ${rowSelector}:has(> [data-jsy-cross-reference]) { position:relative }
    [data-jsy-cross-reference] { display:none; position:absolute; inset-inline-end:4px; top:50%; transform:translateY(-50%);
      padding:4px 6px; border:0; border-radius:4px; background:var(--fd-color-bg-container,#fff);
      color:var(--color-primary-text,#008b81); font:inherit; font-size:12px; white-space:nowrap; cursor:pointer }
    ${rowSelector}:hover > [data-jsy-cross-reference], [data-jsy-cross-reference]:focus { display:block }
    [data-jsy-cross-reference]:disabled { opacity:.6; cursor:wait }
  `;

  function rowContext(row) {
    const route = location.pathname;
    if (!/^\/decision\/home\/project\/[^/]+(?:\/|$)/.test(route)) return null;
    const key = Object.keys(row).find(name => name.startsWith("__reactFiber$"));
    const fiber = key && row[key];
    if (!fiber) return null;
    let root = fiber;
    while (root.return) root = root.return;
    const stack = [root.stateNode?.current || root];
    let current;
    while (stack.length) {
      const node = stack.pop();
      if (node.stateNode === row) { current = node; break; }
      if (node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
    let table, tree, client, activeTab;
    for (let node = current; node; node = node.return) {
      const props = node.memoizedProps;
      if (!table && props?.node?.isLeaf && props.node.type === 4) table = props.node;
      if (!tree && props?.projectId && props.targetProjectId && typeof props.onSelectedNodeChange === "function") tree = props;
      const value = props?.value;
      if (!client && typeof value?.getQueryData === "function" && typeof value.invalidateQueries === "function") client = value;
      if (value && typeof value === "object" && "activeTab" in value && "allowBatch" in value) activeTab = value.activeTab;
    }
    if (activeTab !== "space" || !table?.id || !tree || !client || tree.allowCrossProject ||
        table.projectId !== tree.projectId || tree.projectId === tree.targetProjectId ||
        table.allowCrossProject !== false || [0, 5, 6].includes(table.status)) return null;
    const { projectId, currentTableId } = tree;
    const queryKey = currentTableId ? ["useFilteredAnalysisTable", projectId, currentTableId] : ["useEditProject", projectId];
    const project = client.getQueryData(["useEditProject", projectId])?.data;
    const filtered = client.getQueryData(queryKey)?.data;
    const user = window.BI?.personal;
    const corpId = window.BI?.system?.currentCorpId;
    const cooperators = project?.cooperators ?? filtered?.cooperators;
    if (!corpId || !user?.userId || typeof user.role !== "number" || user.role === 2 ||
        cooperators?.find(member => member.member === user.userId)?.authType !== "manager") return null;
    return { id: table.id, projectId, queryKey, client, corpId, userId: user.userId, route };
  }

  function showNotice(message) {
    notice?.remove();
    clearTimeout(noticeTimer);
    notice = document.createElement("div");
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;bottom:24px;left:24px;z-index:10000;padding:10px 16px;background:#fff;color:#b42318;border:1px solid #dce4ef;border-radius:8px;box-shadow:0 4px 12px #16264518";
    notice.textContent = message;
    document.body.append(notice);
    noticeTimer = setTimeout(() => notice?.remove(), 6000);
  }

  async function openReference(row, action, shown) {
    const target = enabled && row.isConnected && rowContext(row);
    if (!target || target.id !== shown.id || target.projectId !== shown.projectId || target.route !== shown.route ||
        target.corpId !== shown.corpId || target.userId !== shown.userId || pending.has(target.id)) return;
    pending.add(target.id);
    action.disabled = true;
    let saved = false;
    try {
      const result = await window.HI.reqPost(`designer/analysis-table/${encodeURIComponent(target.id)}/allow-cross`, {
        baseUrl: `${window.BI.hiServletURL}/v2`, data: { allowCross: true }, skipGlobalError: true,
      });
      if (!result || result.errorCode != null) throw new Error(result?.errorMsg || "服务器未返回有效结果");
      saved = true;
      action.remove();
      if (window.BI?.system?.currentCorpId !== target.corpId || window.BI?.personal?.userId !== target.userId) return;
      await Promise.all([
        target.client.invalidateQueries({ queryKey: ["useEditProject", target.projectId] }, { throwOnError: true }),
        ...(target.queryKey[0] === "useFilteredAnalysisTable"
          ? [target.client.invalidateQueries({ queryKey: target.queryKey }, { throwOnError: true })] : []),
      ]);
    } catch (error) {
      if (enabled && row.isConnected) showNotice(saved ? "跨项目引用已开启，请重新打开添加数据刷新列表。" : `开启跨项目引用失败：${error.message}`);
    } finally {
      pending.delete(target.id);
      // 悬浮离开再进入可能已重建按钮，恢复当前表行上的按钮状态。
      if (button?.parentElement === row && button.dataset.jsyCrossReference === target.id) {
        if (saved) button.remove();
        else button.disabled = false;
      }
    }
  }

  document.addEventListener("pointerover", event => {
    if (!enabled) return;
    const row = event.target.closest?.(rowSelector);
    if (!row || !row.closest('[data-test-id="add-data-drawer"]') || row.contains(event.relatedTarget)) return;
    button?.remove();
    const target = rowContext(row);
    if (!target || typeof window.HI?.reqPost !== "function" || !window.BI?.hiServletURL) return;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.jsyCrossReference = target.id;
    action.textContent = "开启跨项目引用";
    action.disabled = pending.has(target.id);
    action.addEventListener("click", event => {
      event.stopPropagation();
      void openReference(row, action, target);
    });
    row.append(action);
    button = action;
  });

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin ||
        event.data?.channel !== "jsy-tools" || event.data.type !== "settings") return;
    enabled = event.data.crossProjectReferenceEnabled === true;
    if (enabled) document.documentElement.append(style);
    else {
      style.remove();
      button?.remove();
      notice?.remove();
    }
  });
  window.postMessage({ channel: "jsy-tools", type: "ready" }, location.origin);
})();
