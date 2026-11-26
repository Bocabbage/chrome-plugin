(() => {
  const singleton = Symbol.for("claire.jsy-tools.recent-projects");
  if (window[singleton]) return;
  window[singleton] = true;
  const controls = new Map();
  let scheduled = false;
  let enabled = false;
  const style = document.createElement("style");
  style.textContent = `
    [data-jsy-recent-projects]{position:relative;flex:none;margin-right:4px;color:inherit;font-size:13px}
    [data-jsy-recent-projects] summary{list-style:none;display:grid;place-items:center;width:24px;height:28px;cursor:pointer;border-radius:4px}
    [data-jsy-recent-projects] summary::-webkit-details-marker{display:none}
    [data-jsy-recent-projects] summary:hover{background:#131d2e0a}
    [data-jsy-recent-projects] summary:focus-visible,[data-jsy-recent-projects] button:focus-visible{outline:2px solid #00afa5;outline-offset:-2px}
    [data-jsy-recent-projects] .jsy-project-menu{position:absolute;left:0;top:32px;width:252px;max-width:calc(100vw - 32px);padding:8px 0;border:1px solid #e6e9ef;border-radius:6px;background:#fff;color:#182438;box-shadow:0 6px 24px #1e314c26;z-index:1005}
    [data-jsy-recent-projects] .jsy-project-caption{padding:4px 12px 8px;color:#737d8c;font-size:12px}
    [data-jsy-recent-projects] .jsy-project-list{max-height:320px;overflow-x:hidden;overflow-y:auto}
    [data-jsy-recent-projects] button{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;padding:10px 12px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
    [data-jsy-recent-projects] button:hover{background:#f4f6f9}
    [data-jsy-recent-projects] button[aria-current=page]{background:#e6f7f4;color:#008b80}
    [data-jsy-recent-projects] .jsy-project-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    [data-jsy-recent-projects] .jsy-project-icon{color:#00afa5}
  `;

  function fiber(element) {
    const key = Object.keys(element).find(key => key.startsWith("__reactFiber$"));
    return key && element[key];
  }

  function projectHeader(header, id) {
    let node = fiber(header);
    let project;
    let navigator;
    let basename = "/";
    while (node) {
      if (node.memoizedProps?.project?.id === id) project = node.memoizedProps.project;
      for (let context = node.dependencies?.firstContext; context; context = context.next) {
        const value = context.memoizedValue;
        if (typeof value?.navigator?.push === "function") {
          navigator = value.navigator;
          basename = typeof value.basename === "string" ? value.basename : "/";
        }
      }
      node = node.return;
    }
    if (!project) return null;
    for (const element of header.querySelectorAll("div")) {
      let current = fiber(element);
      while (current && current.stateNode !== header) {
        const props = current.memoizedProps;
        if (typeof props?.confirm === "function" && props.size === "large" && typeof props.value === "string") {
          return { anchor: element, project: { ...project, name: props.value }, navigator, basename };
        }
        current = current.return;
      }
    }
    return null;
  }

  function projectsFor(project) {
    const corp = window.BI?.system?.currentCorpId;
    const user = window.BI?.personal?.userId;
    if (!corp || !user) return [];
    try {
      const stored = JSON.parse(localStorage.getItem(`opened-projects-${corp}-${user}`));
      const projects = stored?.state?.pinnedProjects;
      const unique = new Map();
      for (const item of Array.isArray(projects) ? projects : []) {
        if (typeof item?.id !== "string" || !/^[\w-]+$/.test(item.id) || typeof item.name !== "string") continue;
        if (!unique.has(item.id)) unique.set(item.id, item.id === project.id ? { ...item, name: project.name } : item);
      }
      return [...unique.values()];
    } catch { return []; }
  }

  function switchProject(record, target) {
    record.dropdown.open = false;
    record.dropdown.querySelector("summary").focus();
    if (target === record.id || !projectsFor(record.info.project).some(project => project.id === target)) return;
    // 优先复用原侧栏项目入口，保留产品自己的导航行为。
    for (const icon of document.querySelectorAll(".data-project-icon")) {
      const entry = icon.parentElement;
      let node = entry && fiber(entry);
      while (node) {
        if (node.key === target && typeof fiber(entry)?.memoizedProps?.onClick === "function") {
          entry.click();
          return;
        }
        node = node.return;
      }
    }
    if (!record.info.navigator) {
      console.warn("[jsy-tools] 未找到项目切换入口，请从首页左侧切换项目");
      return;
    }
    const path = `/decision/home/project/${encodeURIComponent(target)}`;
    const base = (record.info.basename || "/").replace(/\/$/, "");
    record.info.navigator.push(base && path.startsWith(`${base}/`) ? path.slice(base.length) : path);
  }

  function update() {
    scheduled = false;
    const id = location.pathname.match(/^\/decision\/home\/project\/([^/]+)(?:\/|$)/)?.[1];
    for (const [header, record] of controls) {
      if (!enabled || !id || !header.isConnected || !header.getClientRects().length || record.id !== id) {
        record.dropdown.remove();
        controls.delete(header);
      }
    }
    if (!enabled || !id) { style.remove(); return; }
    if (!style.isConnected) document.documentElement.append(style);
    for (const header of document.querySelectorAll("header")) {
      if (!header.getClientRects().length) continue;
      const info = projectHeader(header, id);
      if (!info) continue;
      let record = controls.get(header);
      if (!record) {
        const dropdown = document.createElement("details");
        dropdown.dataset.jsyRecentProjects = "";
        dropdown.innerHTML = '<summary aria-label="切换最近打开的项目" title="最近打开的项目"><svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><div class="jsy-project-menu"><div class="jsy-project-caption">最近打开的项目</div><div class="jsy-project-list"></div></div>';
        record = { id, dropdown, info, signature: "" };
        controls.set(header, record);
      }
      record.info = info;
      record.projects = projectsFor(info.project);
      const signature = JSON.stringify(record.projects.map(project => [project.id, project.name]));
      if (record.signature !== signature) {
        const list = record.dropdown.querySelector(".jsy-project-list");
        list.replaceChildren(...record.projects.map(project => {
          const button = document.createElement("button");
          button.type = "button";
          button.title = project.name || project.id;
          const icon = document.createElement("span");
          icon.className = "jsy-project-icon";
          icon.textContent = "◆";
          icon.setAttribute("aria-hidden", "true");
          const name = document.createElement("span");
          name.className = "jsy-project-name";
          name.textContent = project.name || project.id;
          button.append(icon, name);
          if (project.id === id) {
            button.setAttribute("aria-current", "page");
            const check = document.createElement("span");
            check.textContent = "✓";
            check.setAttribute("aria-hidden", "true");
            button.append(check);
          }
          button.addEventListener("click", () => switchProject(record, project.id));
          return button;
        }));
        if (!record.projects.length) list.textContent = "暂无最近打开的项目";
        record.signature = signature;
      }
      if (info.anchor.previousElementSibling !== record.dropdown) info.anchor.before(record.dropdown);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  }
  new MutationObserver(records => {
    if (records.some(record => !record.target.closest?.("[data-jsy-recent-projects]"))) schedule();
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener("click", event => {
    for (const { dropdown } of controls.values()) if (!dropdown.contains(event.target)) dropdown.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    for (const { dropdown } of controls.values()) if (dropdown.open) {
      dropdown.open = false;
      dropdown.querySelector("summary").focus();
    }
  });
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "jsy-tools" || event.data.type !== "settings") return;
    enabled = event.data.recentProjectsEnabled === true;
    schedule();
  });
  window.addEventListener("storage", schedule);
  window.addEventListener("popstate", schedule);
  window.addEventListener("resize", schedule);
  setInterval(schedule, 1000);
  window.postMessage({ channel: "jsy-tools", type: "ready" }, location.origin);
  schedule();
})();
