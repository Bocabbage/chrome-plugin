(() => {
  const singleton = Symbol.for("jsy-tools.group-batch");
  if (window[singleton]) return;
  window[singleton] = true;

  const regionSelector = '[data-test-type="analysis-group-region"][data-test-name="30000"]';
  const capsuleSelector = '[data-test-id="analysis-group-field"]';
  const sessions = new Map();
  let enabled = false;
  let frame = 0;

  // React retains the original host fiber on the DOM node across alternate commits.
  function committedPath(element) {
    if (!element) return [];
    const path = [];
    let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber$"))];
    while (fiber?.return) {
      path.push(fiber);
      fiber = fiber.return;
    }
    let current = fiber?.stateNode?.current;
    const props = [];
    for (const previous of path.reverse()) {
      let child = current?.child;
      while (child && child !== previous && child !== previous.alternate) child = child.sibling;
      if (!child) return [];
      props.push(child.memoizedProps);
      current = child;
    }
    return props.reverse().filter(Boolean);
  }

  function labelText(label) {
    if (Array.isArray(label)) return label.map(labelText).join("");
    if (typeof label === "string" || typeof label === "number") return String(label);
    return label?.props ? labelText(label.props.children) : "";
  }

  function methods(items, result = new Map()) {
    for (const item of items) {
      if (item.disabled) continue;
      if (item.children?.length) {
        methods(item.children, result);
      } else if (item.icon?.props?.name === "jsy-icon-font-dot") {
        // Concatenation and custom percentile require additional parameters.
        if (item.key === 5 || item.key === 66) continue;
        const label = labelText(item.label);
        if (label) result.set(item.key > 0 && item.key < 1 ? label + "% 分位" : label, item.key);
      }
    }
    return result;
  }

  function readItem(node) {
    const trigger = node.lastElementChild;
    const path = committedPath(trigger?.querySelector("svg") || trigger);
    const menu = path.find(props => Array.isArray(props.menu?.items))?.menu;
    const combo = path.find(props => typeof props.handleValue === "function" && props.regionType === "30000");
    const legacy = path.find(props => typeof props.onFirstLastConfirm === "function");
    const env = path.find(props => props.value?.actions?.setFunction)?.value;
    const key = legacy ? path.find(props => props.dId)?.dId : node.dataset.testItemKey;
    const source = legacy ? legacy.dimension.id : node.dataset.testSourceField;
    if (!menu || !combo || !key || (!legacy && !env)) return null;
    return {
      node, key, source, methods: methods(menu.items),
      apply(value) {
        if (value !== 57 && value !== 58) return combo.handleValue(value);
        if (legacy) {
          legacy.onFirstLastConfirm([{ type: 1, value }], [{ id: source, sortType: 1 }]);
        } else {
          const sorts = source && source !== "__ROW_NUMBER__" ? [{ field: source, sortType: 1 }] : [];
          env.actions.setFunction(key, { type: value === 57 ? 10 : 11, sorts });
        }
      },
    };
  }

  function button(text, action) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = text;
    el.className = "jsy-batch-action";
    el.onclick = action;
    return el;
  }

  function mount(region, footer, panel) {
    let active = false;
    let step;
    let fieldPanel;
    let previousFields = new Set();
    const selected = new Set();
    const markers = new Map();
    const items = () => [...region.querySelectorAll(capsuleSelector)].map(readItem).filter(Boolean);
    const identity = () => {
      const path = committedPath(region);
      const env = path.find(p => p.value?.actions?.setFunction)?.value;
      if (env) return env.stepId;
      const store = path.find(p => typeof p.value?.getState === "function" && p.value.getState().sourceProps)?.value;
      const props = store?.getState().sourceProps;
      return props?.operators[props.selected]?.id;
    };
    const entry = button("批量设置", () => {
      fieldPanel = panel.previousElementSibling;
      fieldPanel?.addEventListener("click", schedule, true);
      active = true;
      step = identity();
      render();
    });
    footer.prepend(entry);
    const toolbar = document.createElement("div");
    toolbar.className = "jsy-batch-toolbar";
    const allLabel = document.createElement("label");
    const all = document.createElement("input");
    all.type = "checkbox";
    all.className = "jsy-batch-check";
    allLabel.append(all, "全选");
    all.onchange = () => {
      selected.clear();
      if (all.checked) for (const item of items()) if (item.methods.size) selected.add(item.key);
      render();
    };
    const select = document.createElement("select");
    select.setAttribute("aria-label", "统一汇总方式");
    const picker = document.createElement("span");
    picker.className = "jsy-batch-picker";
    picker.append(select);
    select.onchange = () => {
      const targets = items().filter(item => selected.has(item.key));
      const method = select.value;
      if (method && targets.every(item => item.methods.has(method))) {
        for (const item of targets) item.apply(item.methods.get(method));
      }
      select.selectedIndex = 0;
      render();
    };
    toolbar.append(allLabel, picker, button("退出批量", exit));

    function exit() {
      active = false;
      fieldPanel?.removeEventListener("click", schedule, true);
      previousFields.clear();
      selected.clear();
      toolbar.remove();
      for (const marker of markers.values()) marker.remove();
      markers.clear();
      entry.hidden = false;
    }

    function render() {
      if (!active) return;
      if (identity() !== step) return exit();
      const current = items();
      const available = current.filter(item => item.methods.size);
      // Older editors expose only the search control inside GroupFieldList.
      const anchor = fieldPanel?.querySelector('[data-test-id="group-field-list"], [data-test-id="group-field-list-search"]');
      const fields = committedPath(anchor).find(p => Array.isArray(p.selectedFieldIds))?.selectedFieldIds;
      if (fields) {
        const nextFields = new Set(fields);
        for (const item of available) {
          const chosen = nextFields.has(item.source);
          if (chosen === previousFields.has(item.source)) continue;
          if (chosen) selected.add(item.key);
          else selected.delete(item.key);
        }
        previousFields = nextFields;
      }
      const keys = new Set(available.map(item => item.key));
      for (const key of selected) if (!keys.has(key)) selected.delete(key);
      for (const [node, marker] of markers) {
        if (!region.contains(node)) {
          marker.remove();
          markers.delete(node);
        }
      }
      for (const item of current) {
        let marker = markers.get(item.node);
        if (!marker) {
          marker = document.createElement("input");
          marker.type = "checkbox";
          marker.className = "jsy-batch-check";
          markers.set(item.node, marker);
          item.node.prepend(marker);
        }
        marker.setAttribute("aria-label", item.node.dataset.testName || item.source);
        marker.disabled = !item.methods.size;
        marker.checked = selected.has(item.key);
      }
      entry.hidden = true;
      if (!toolbar.isConnected) region.before(toolbar);
      all.checked = keys.size > 0 && selected.size === keys.size;
      all.indeterminate = selected.size > 0 && !all.checked;
      all.disabled = !keys.size;
      const targets = available.filter(item => selected.has(item.key));
      const common = targets.length ? [...targets[0].methods.keys()].filter(name => targets.every(item => item.methods.has(name))) : [];
      if (JSON.stringify(common) !== select.dataset.methods) {
        select.replaceChildren(new Option("统一汇总方式", ""), ...common.map(name => new Option(name, name)));
        select.dataset.methods = JSON.stringify(common);
      }
      select.disabled = !common.length;
    }

    function intercept(event) {
      if (!active) return;
      const node = event.target.closest?.(capsuleSelector);
      if (!node || !region.contains(node)) return;
      event.stopImmediatePropagation();
      if (event.type !== "click") {
        if (event.type === "dragstart") event.preventDefault();
        return;
      }
      const item = readItem(node);
      if (item?.methods.size) {
        if (selected.has(item.key)) selected.delete(item.key);
        else selected.add(item.key);
      }
      render();
    }
    const events = ["pointerdown", "mousedown", "dragstart", "click", "dblclick"];
    for (const name of events) region.addEventListener(name, intercept, true);
    return { entry, render, remove() {
      exit();
      entry.remove();
      for (const name of events) region.removeEventListener(name, intercept, true);
    } };
  }

  function sync() {
    frame = 0;
    const route = /^\/decision\/home\/project\/[^/]+\/analysis\/[^/]+/.test(location.pathname);
    const regions = new Set(enabled && route ? document.querySelectorAll(regionSelector) : []);
    if (enabled && route) {
      // Earlier GroupRegion versions identify only the summary-specific clear-name button.
      for (const clear of document.querySelectorAll('[data-test-id="analysis-group-clear-summary-name"]')) {
        const region = clear.closest(regionSelector) || clear.closest(".operator-region-panel > div");
        if (region) regions.add(region);
      }
    }
    for (const [region, session] of sessions) {
      if (!regions.has(region) || !session.entry.isConnected) {
        session.remove();
        sessions.delete(region);
      }
    }
    for (const region of regions) {
      if (!sessions.has(region)) {
        const panel = region.parentElement.closest(".operator-region-panel")?.parentElement;
        const toggle = panel?.querySelector('[data-test-id="group-merge-previous-toggle"]');
        const footer = toggle?.closest(".ml-auto");
        if (footer) sessions.set(region, mount(region, footer, panel));
      }
      sessions.get(region)?.render();
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(sync);
  }
  const observer = new MutationObserver(schedule);
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "jsy-tools" || event.data.type !== "settings") return;
    const next = event.data.groupBatchEnabled === true;
    if (enabled === next) return;
    enabled = next;
    if (enabled) observer.observe(document, { childList: true, subtree: true, characterData: true });
    else observer.disconnect();
    sync();
  });
  window.postMessage({ channel: "jsy-tools", type: "ready" }, location.origin);
})();
