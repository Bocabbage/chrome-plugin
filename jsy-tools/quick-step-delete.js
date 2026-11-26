(() => {
  const singleton = Symbol.for("jsy-tools.quick-step-delete");
  if (window[singleton]) return;
  window[singleton] = true;
  const selector = '[data-test-type="analysis-history-node"][data-test-node-kind="operator"]';
  const applyActions = {
    apply: { symbol: "√", label: "应用" },
    cancel_apply: { symbol: "−", label: "取消应用" },
  };
  const style = document.createElement("style");
  style.textContent = `
    [data-jsy-quick-step-delete] { position:absolute; top:-8px; right:-8px; z-index:4; width:16px; height:16px;
      border:0; border-radius:8px; padding:0; background:#e52a35; color:#fff; font:14px/16px Arial,sans-serif;
      text-align:center; cursor:pointer; visibility:hidden }
    /* 来源表紧贴滚动区顶部，圆形按钮需要留在滚动区内。 */
    ${selector}[data-test-operator-type="1"] > [data-jsy-quick-step-delete] { top:0 }
    [data-jsy-quick-step-delete="apply"] { background:#168754 }
    [data-jsy-quick-step-delete="cancel_apply"] { background:#ce650b }
    ${selector}:hover > [data-jsy-quick-step-delete], [data-jsy-quick-step-delete]:focus { visibility:visible }
  `;
  let enabled = false;
  let applyMode = false;
  let button;

  function* descendants(parent) {
    const stack = [parent.child];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      yield node;
      stack.push(node.sibling, node.child);
    }
  }

  function* nativeMenus(fiber) {
    for (const node of descendants(fiber)) {
      const menu = node.memoizedProps?.content?.props;
      if (menu?.["data-test-id"] !== "analysis-history-node-menu" || !Array.isArray(menu.items)) continue;
      // V1 的菜单没有步骤 ID，以其所属步骤行为准。
      for (let owner = node.return; owner; owner = owner.return) {
        const props = owner.memoizedProps;
        if (props?.["data-test-type"] !== "analysis-history-node") continue;
        yield { id: props["data-test-node-id"], items: menu.items };
        break;
      }
    }
  }

  function targetFor(row) {
    const path = location.pathname;
    if (!/^\/decision\/home\/project\/[^/]+\/analysis\/[^/]+(?:\/|$)/.test(path)) return null;
    const key = Object.keys(row).find(name => name.startsWith("__reactFiber$"));
    if (!key) return null;
    let root = row[key];
    while (root.return) root = root.return;
    const queue = [root.stateNode?.current || root];
    let fiber;
    while (queue.length) {
      const node = queue.pop();
      if (node.stateNode === row) { fiber = node; break; }
      if (node.sibling) queue.push(node.sibling);
      if (node.child) queue.push(node.child);
    }
    const id = row.dataset.testNodeId;
    let step, flow, history;
    for (let node = fiber?.return; node; node = node.return) {
      const props = node.memoizedProps;
      if (!step && props?.id === id && props.nodeType === "operator" && typeof props.onToolPopoverSelect === "function") step = props;
      else if (step && typeof props?.onToolPopoverSelect === "function" && typeof props.onSelect === "function") flow = props;
      if (typeof props?.hasAuth === "boolean" && typeof props.isEdit === "boolean" && typeof props.onRefresh === "function") {
        history = props;
        break;
      }
    }
    if (!step || step.isPreviewMode || step.isMultiMode || !history?.hasAuth || history.root?.getState().readOnly) return null;
    if ([36, 66].includes(step.operatorType)) return null; // 原步骤菜单也排除配置模型和示例数据。
    if (step.operatorType !== 1) {
      if (!row.querySelector('[data-test-type="analysis-history-node-more-trigger"]')) return null;
      if (applyMode) {
        const command = step.applied ? "cancel_apply" : "apply";
        const menu = [...nativeMenus(fiber)].find(menu => menu.id === id);
        if (!menu?.items.some(item => item.key === command && !item.disabled)) return null;
        const { label, symbol } = applyActions[command];
        return { id, path, label, symbol, command, run: () => step.onToolPopoverSelect(command) };
      }
      return { id, path, label: "删除此步骤", run: () => step.onToolPopoverSelect("delete") };
    }
    if (applyMode) return null;
    const steps = history.root?.getState().steps ?? history.operators;
    if (!flow || !Array.isArray(steps) || steps[0]?.id !== id || steps.length < 2) return null;
    const later = steps.slice(1);
    // 只取分析主链。V2 图表存于 components，旧版图表存于 templateHelper。
    if (later.some(item => !item.id || [1, 12, 36, 66, 71].includes(item.type))) return null;
    return { id, path, label: "删除全部分析步骤（保留来源表和图表）", run: () => {
      for (const item of later.reverse()) flow.onToolPopoverSelect("delete", item.id);
    } };
  }

  document.addEventListener("pointerover", event => {
    if (!enabled) return;
    const row = event.target.closest?.(selector);
    if (!row || (button?.parentElement === row && row.contains(event.relatedTarget))) return;
    button?.remove();
    const shown = targetFor(row);
    if (!shown) return;
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.jsyQuickStepDelete = shown.command ?? "";
    action.title = shown.label;
    action.setAttribute("aria-label", shown.label);
    action.textContent = shown.symbol ?? "×";
    action.addEventListener("click", event => {
      event.stopPropagation();
      if (!enabled || !row.isConnected) return;
      const current = targetFor(row);
      if (current?.id !== shown.id || current.path !== shown.path || current.label !== shown.label) return;
      action.remove();
      current.run();
    });
    row.append(action);
    button = action;
  });

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin ||
        event.data?.channel !== "jsy-tools" || event.data.type !== "settings") return;
    const next = event.data.quickStepDeleteEnabled === true;
    const nextMode = event.data.quickStepApplyMode === true;
    if (next === enabled && nextMode === applyMode) return;
    if (nextMode !== applyMode) button?.remove();
    applyMode = nextMode;
    enabled = next;
    if (enabled && !style.isConnected) document.documentElement.append(style);
    if (!enabled) {
      button?.remove();
      style.remove();
    }
  });
  window.postMessage({ channel: "jsy-tools", type: "ready" }, location.origin);
})();
