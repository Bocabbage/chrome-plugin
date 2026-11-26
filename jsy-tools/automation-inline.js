(() => {
  const singleton = Symbol.for("jsy-tools.automation-inline");
  if (window[singleton]) return;
  window[singleton] = true;
  let enabled = false, scheduled = false;
  let observedPanel = null;
  const records = new Map();
  const warned = new WeakSet();
  const style = document.createElement("style");
  const roles = ["data-jsy-auto-page", "data-jsy-auto-slot", "data-jsy-auto-project", "data-jsy-auto-method"];
  const projectId = () => location.pathname.match(/^\/decision\/home\/project\/([^/]+)(?:\/|$)/)?.[1];
  const route = () => location.pathname + location.search + location.hash;

  // shortcut: 使用现有自动化和项目编辑区结构定位；结构不匹配时报告并保留产品原样。
  function propsFor(element, predicate) {
    const key = Object.keys(element).find(name => name.startsWith("__reactFiber$"));
    let node = key && element[key];
    if (!node) return null;
    let root = node;
    while (root.return) root = root.return;
    const current = root.stateNode?.current;
    if (current) {
      const stack = [current], seen = new Set();
      node = null;
      while (stack.length && seen.size < 30000) {
        const item = stack.pop();
        if (!item || seen.has(item)) continue;
        seen.add(item);
        if (item.stateNode === element) { node = item; break; }
        if (item.sibling) stack.push(item.sibling);
        if (item.child) stack.push(item.child);
      }
    }
    for (; node; node = node.return) if (predicate(node.memoizedProps)) return node.memoizedProps;
    return null;
  }

  function restore(record) {
    for (const element of [record.page, record.slot, record.project, record.method]) {
      if (element) for (const role of roles) element.removeAttribute(role);
    }
  }
  function watchPanel(panel) {
    if (observedPanel === panel) return;
    resize.disconnect();
    observedPanel = panel;
    if (panel) resize.observe(panel);
  }
  function update() {
    scheduled = false;
    for (const record of records.values()) restore(record);
    for (const [page] of records) if (!page.isConnected) records.delete(page);
    const id = projectId();
    if (!enabled || !id) { style.remove(); records.clear(); watchPanel(null); return; }
    const pages = document.querySelectorAll('[data-test-id="workflow-page"]');
    if (!pages.length) { style.remove(); watchPanel(null); return; }
    const headers = [...document.querySelectorAll("header")];
    const header = headers.find(element => element.getClientRects().length && propsFor(element, props => props?.project?.id === id));
    if (!header) { style.remove(); watchPanel(null); return; }
    const shell = header.parentElement;
    const content = shell.querySelector('[data-test-id="project-editor-content"]');
    const panel = content?.querySelector(".overflow-hidden.rounded-xl.bg-container.shadow-subtle");
    let rules = "";
    for (const page of pages) {
      const props = propsFor(page, props => props?.projectId === id && typeof props.onClose === "function" && typeof props.visible === "boolean");
      if (!props) continue;
      if (!content || !panel) {
        if (!warned.has(page)) { console.warn("[jsy-tools] 无法定位自动化的项目内容区，保留原显示方式"); warned.add(page); }
        continue;
      }
      let record = records.get(page);
      if (!record) { record = { page, id, suspended: false, resumedAt: null }; records.set(page, record); }
      if (record.resumedAt && record.resumedAt !== route()) {
        record.resumedAt = null;
        record.suspended = true;
      }
      const embedded = props.embedded === true;
      record.embedded = embedded;
      record.shell = shell;
      record.slot = null;
      record.project = null;
      record.method = null;
      if (embedded) {
        const slot = page.parentElement;
        let project = content;
        while (project.parentElement && project.parentElement !== slot.parentElement) project = project.parentElement;
        if (project.parentElement !== slot.parentElement || project === slot) {
          if (!warned.has(page)) { console.warn("[jsy-tools] 自动化宿主结构不匹配，保留原显示方式"); warned.add(page); }
          continue;
        }
        record.slot = slot;
        record.project = project;
        slot.setAttribute("data-jsy-auto-slot", "");
        project.setAttribute("data-jsy-auto-project", "");
      } else {
        const method = page.closest('[data-test-id="workflow-method-host"]');
        if (!method) {
          if (!warned.has(page)) { console.warn("[jsy-tools] 未识别自动化宿主，保留原显示方式"); warned.add(page); }
          continue;
        }
        record.method = method;
        method.setAttribute("data-jsy-auto-method", "");
      }
      page.setAttribute("data-jsy-auto-page", "");
      // 先恢复项目布局再测量；只用 CSS 覆盖位置，不移动 React 管理的 DOM。
      const layoutRules = '[data-jsy-auto-slot],[data-jsy-auto-method]{display:contents!important}[data-jsy-auto-project]{display:flex!important;flex:1;min-width:0;width:100%}[data-jsy-auto-page]{position:fixed!important;inset:auto!important;padding:0!important}';
      // 滚动期间不能临时清除高度或 display，否则内部滚动区域会重新计算并丢失位置。
      if (!style.isConnected) {
        style.textContent = layoutRules;
        document.documentElement.append(style);
      }
      const rect = panel.getBoundingClientRect();
      const visible = embedded ? props.visible !== false : !record.suspended && (props.visible !== false || record.resumedAt === route());
      rules = layoutRules + `[data-jsy-auto-page]{position:fixed!important;inset:auto!important;left:${rect.left}px!important;top:${rect.top}px!important;width:${rect.width}px!important;height:${rect.height}px!important;padding:0!important;z-index:20!important;display:${visible ? "block" : "none"}!important;overflow:hidden!important;box-sizing:border-box}`;
      watchPanel(panel);
      break;
    }
    if (rules) { if (style.textContent !== rules) style.textContent = rules; }
    else { style.remove(); watchPanel(null); }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }
  const resize = new ResizeObserver(schedule);
  new MutationObserver(changes => {
    if (changes.some(change => change.target !== style && !style.contains(change.target))) schedule();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });

  window.addEventListener("click", event => {
    if (!enabled) return;
    for (const record of records.values()) {
      if (record.embedded || record.id !== projectId() || !record.page.isConnected) continue;
      const entry = event.target.closest?.('[data-test-id="project-workflow-trigger"]');
      if (entry && record.shell.contains(entry) && record.suspended) {
        event.preventDefault();
        event.stopPropagation();
        record.suspended = false;
        record.resumedAt = route();
        schedule();
        return;
      }
      const resource = event.target.closest?.('[data-test-type="file-tab"],[data-project-id]');
      if (resource && record.shell.contains(resource) && !record.page.contains(resource)) {
        record.suspended = true;
        record.resumedAt = null;
        schedule();
      }
    }
  }, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", event => {
    if (!event.target.closest?.('[data-test-id="workflow-page"]')) schedule();
  }, true);
  window.addEventListener("popstate", schedule);
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "jsy-tools" || event.data.type !== "settings") return;
    enabled = event.data.automationInlineEnabled === true;
    if (!enabled) watchPanel(null);
    schedule();
  });
  window.postMessage({ channel: "jsy-tools", type: "ready" }, location.origin);
})();
