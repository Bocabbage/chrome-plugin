(() => {
  const key = Symbol.for("jsy-tools.quick-copy");
  if (window[key]) return;
  window[key] = true;

  let enabled = false;
  let armed = null;
  let copied = null;
  let shortcut = null;
  let busy = false;
  let notice = null;
  let noticeTimer;

  function projectId() {
    const match = location.pathname.match(/^\/decision\/home\/project\/([^/]+)(?:\/|$)/);
    try { return match ? decodeURIComponent(match[1]) : null; }
    catch { return null; }
  }

  function sameIdentity(target) {
    return projectId() === target.projectId && window.BI?.system?.currentCorpId === target.corpId &&
      window.BI?.personal?.userId === target.userId;
  }

  function notify(text, error = false) {
    clearTimeout(noticeTimer);
    notice?.remove();
    if (!document.body) return;
    notice = document.createElement("div");
    notice.setAttribute("role", error ? "alert" : "status");
    notice.style.cssText = "position:fixed;left:24px;bottom:24px;z-index:1000;max-width:min(440px,calc(100vw - 48px));padding:12px 16px;border:1px solid #dce4ef;border-radius:8px;background:#fff;color:#1d293d;box-shadow:0 4px 12px #16264518;font:13px/1.7 'Microsoft YaHei',sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;";
    if (error) notice.style.color = "#b42318";
    notice.textContent = text;
    document.body.appendChild(notice);
    noticeTimer = setTimeout(() => { notice?.remove(); notice = null; }, error ? 10000 : 3500);
  }

  function fiber(element) {
    const name = Object.keys(element).find(name => name.startsWith("__reactFiber$") || name.startsWith("__reactContainer$"));
    return name ? element[name] : null;
  }

  // shortcut: 沿用产品的 React 文件树与 QueryClient；产品结构变化时在写请求前停止，不能仅移动 DOM 假装保存排序。
  function context(id) {
    let tree, client;
    const seen = new Set();
    for (const element of document.querySelectorAll("*")) {
      const name = Object.keys(element).find(name => name.startsWith("__reactContainer$"));
      if (!name) continue;
      const root = element[name];
      const stack = [root.stateNode?.current || root];
      while (stack.length && seen.size < 30000) {
        const node = stack.pop();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        const props = node.memoizedProps;
        if (props?.project?.id === id && Array.isArray(props.treeData) && props.nodeMap && typeof props.selectedKey === "string") tree = props;
        const value = props?.value;
        if (typeof value?.getQueryData === "function" && typeof value.setQueryData === "function" && typeof value.invalidateQueries === "function" &&
            value.getQueryData(["useEditProject", id])?.data) client = value;
        if (node.child) stack.push(node.child);
        if (node.sibling) stack.push(node.sibling);
      }
      if (tree && client) return { tree, client };
    }
    throw new Error("尚未识别到项目资源列表，请等待加载完成；若持续失败，当前产品版本需适配。");
  }

  function resourceAt(element) {
    const row = element?.closest?.("[data-project-id], .tree-node");
    if (!row) return null;
    let node = fiber(row);
    for (let i = 0; node && i < 60; i++, node = node.return) {
      const props = node.memoizedProps;
      const file = props?.file || (props?.node?.isLeaf ? props.node : null);
      if (file?.projectId === projectId() && typeof file.id === "string" && file.type !== 35) return { projectId: file.projectId, id: file.id };
    }
    return null;
  }

  function editing(event) {
    const selector = "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox'],.monaco-editor,.CodeMirror,.ace_editor";
    return [document.activeElement, ...(event.composedPath?.() || [event.target])].some(element =>
      element?.isContentEditable || element?.closest?.(selector)) || window.getSelection()?.isCollapsed === false ||
      Array.from(document.querySelectorAll("[role='dialog'][aria-modal='true']")).some(element => element.getClientRects().length);
  }

  function inResourceList(event) {
    return enabled && armed?.projectId === projectId() && !editing(event);
  }

  function position(nodes, id, parentId = "") {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.id === id && node.isLeaf) return { parentId, next: nodes[i + 1]?.id };
      if (!node.isLeaf && node.children) {
        const found = position(node.children, id, node.id);
        if (found) return found;
      }
    }
    return null;
  }

  function autoName(name, files) {
    const date = new Date();
    const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("");
    const names = new Set(files.map(file => file.name));
    for (let n = 1; ; n++) {
      const suffix = `_${stamp}${n === 1 ? "" : `_${n}`}`;
      const candidate = name.slice(0, 100 - suffix.length).replace(/[\uD800-\uDBFF]$/, "") + suffix;
      if (!names.has(candidate)) return candidate;
    }
  }

  async function request(target, method, url, options = {}) {
    if (!enabled || !sameIdentity(target)) throw new Error("能力已关闭，或项目、企业、账号已改变，已停止后续操作。");
    const result = await window.HI[method](url, { baseUrl: "/decision/v2", ...options, skipGlobalError: true });
    if (!result || result.errorCode != null) throw new Error(result?.errorMsg || String(result?.errorCode || "服务器未返回有效结果"));
    return result;
  }

  async function refresh(client, target) {
    if (!sameIdentity(target)) return;
    const queryKey = ["useEditProject", target.projectId];
    try {
      await client.invalidateQueries({ queryKey }, { throwOnError: true });
    } catch {
      // 原生刷新可能被其他资源事件取消；重新读取真实列表，不重发创建或排序请求。
      const result = await request(target, "reqGet", `platform/assets/projects/${encodeURIComponent(target.projectId)}/files?edit=true`);
      if (!sameIdentity(target)) return;
      if (!Array.isArray(result.data?.children)) throw new Error("项目资源列表未能刷新。");
      client.setQueryData(queryKey, result);
    }
    // 附带项目信息的请求取消或失败，不影响副本创建和文件树更新的结果。
    void client.invalidateQueries({ queryKey: ["useEditProjectInfo", target.projectId] }).catch(error => {
      console.warn("[jsy-tools] 副本已创建，项目信息刷新未完成", error);
    });
  }

  async function paste(target) {
    busy = true;
    notify("正在创建副本…");
    let client, attempted = false, created = false, sorted = false;
    try {
      if (typeof window.HI?.reqGet !== "function" || typeof window.HI?.reqPost !== "function" ||
          window.BI?.hiServletURL !== "/decision" || !target.userId || !target.corpId) throw new Error("九数云登录环境尚未就绪或版本不兼容。");
      client = context(target.projectId).client;
      const project = (await request(target, "reqGet", `platform/assets/projects/${encodeURIComponent(target.projectId)}/files?edit=true`)).data;
      if (!enabled || !sameIdentity(target)) throw new Error("能力已关闭，或项目、企业、账号已改变，未创建副本。");
      if (!Array.isArray(project?.children) || !Array.isArray(project.groupLabels) || !project.workspaceId) throw new Error("项目资源列表不完整，未创建副本。");
      const auth = project.cooperators?.find(cooperator => cooperator.member === target.userId)?.authType;
      if (!["manager", "edit"].includes(auth) || window.BI.personal.role === 2) throw new Error("当前账号没有项目编辑权限，未创建副本。");
      const source = project.children.find(file => file.id === target.id && file.type === target.type);
      if (!source || source.type === 35 || typeof source.name !== "string") throw new Error("原资源已不存在或类型已改变，请重新选择并复制。");
      if ([31, 32].includes(source.type) && [0, 5, 6].includes(source.status)) throw new Error("当前计算模型不可创建副本。");
      const current = context(target.projectId).tree;
      if (current.isCheckMode) throw new Error("请退出批量选择模式后复制单个资源。");
      const placement = position(current.treeData, source.id);
      // 原生文件树把没有对应分组的父标识归到根目录，接口值不一定为空。
      const parentId = project.groupLabels.some(group => group.id === source.pSubsetId) ? source.pSubsetId : "";
      if (!placement || placement.parentId !== parentId) throw new Error("原资源位置已改变，请等待列表更新后重试。");
      const name = autoName(source.name, project.children);
      // 写请求不重试：网络中断时服务端可能已经创建，必须先检查列表。
      attempted = true;
      const result = await request(target, "reqPost", "designer/editor/files/save-as", {
        params: { groupId: project.workspaceId },
        data: { ids: [{ id: source.id, type: source.type, name }], toProjectId: target.projectId,
          toWorkspaceId: project.workspaceId, toParentId: placement.parentId || target.projectId },
      });
      created = true;
      const copy = result.data?.length === 1 ? result.data[0] : null;
      const id = copy?.id || copy?.name;
      if (typeof id !== "string" || !id || id === source.id || copy.folderId !== target.projectId) throw new Error("副本返回信息不完整，无法确认排序。");
      await request(target, "reqPost", `platform/assets/projects/${encodeURIComponent(target.projectId)}/files/sort`, {
        data: { parentId: placement.parentId, ...(placement.next ? { next: placement.next } : {}), resources: [{ id, type: copy.type ?? source.type }] },
      });
      sorted = true;
      await refresh(client, target);
      if (sameIdentity(target)) notify(`已创建副本“${name}”，位于原资源下方`);
    } catch (error) {
      if (sorted) {
        notify("副本已创建并保存排序，但列表暂未更新。请刷新页面查看，勿重复粘贴。", true);
        return;
      }
      if (created && client) {
        try { await refresh(client, target); } catch { /* 下方提示保留手动刷新路径。 */ }
      }
      const recovery = created ? "副本已创建，但未能完成排序；请检查列表后手动调整，勿重复粘贴。" :
        attempted ? "创建结果未确认，请先检查项目列表，勿直接重复粘贴。" : "";
      notify(`${error?.message || "创建副本失败"}${recovery ? `\n${recovery}` : ""}`, true);
    } finally {
      busy = false;
    }
  }

  window.addEventListener("pointerdown", event => {
    armed = enabled && event.button === 0 ? resourceAt(event.target) : null;
  }, true);

  window.addEventListener("keydown", event => {
    shortcut = null;
    if (!event.isTrusted || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
        !enabled || !projectId() || editing(event)) return;
    const letter = event.key.toLowerCase();
    if (letter !== "c" && letter !== "v") return;
    if (letter === "c" && !inResourceList(event)) return;
    // 点击画布只结束资源选择；粘贴仍使用已复制的资源，输入框除外。
    if (letter === "v" && !copied && !inResourceList(event)) return;
    if (letter === "v" && !copied) { notify("请先按 Ctrl+C 复制左侧选中的资源"); return; }
    if (letter === "v" && !sameIdentity(copied)) { notify("只能在复制时的项目和登录账号内创建副本", true); return; }
    event.stopImmediatePropagation();
    if (event.repeat) { event.preventDefault(); return; }
    if (letter === "v") {
      // 资源副本使用页面内的复制记录，不等待浏览器 paste 事件或自定义剪贴板格式。
      event.preventDefault();
      if (busy) notify("正在创建副本，请稍候");
      else void paste({ ...copied });
      return;
    }
    shortcut = { letter, time: Date.now() };
  }, true);

  window.addEventListener("copy", event => {
    const intent = shortcut;
    shortcut = null;
    copied = null;
    if (!event.isTrusted || intent?.letter !== "c" || Date.now() - intent.time > 1000 || !event.clipboardData || !inResourceList(event)) return;
    try {
      const id = projectId();
      const { tree } = context(id);
      const source = tree.nodeMap[tree.selectedKey];
      if (tree.isCheckMode || !source?.isLeaf || source.id !== armed.id) return;
      const target = { projectId: id, id: source.id, type: source.type,
        corpId: window.BI?.system?.currentCorpId, userId: window.BI?.personal?.userId };
      if (!target.corpId || !target.userId) throw new Error("请等待登录信息加载完成。");
      event.clipboardData.setData("text/plain", source.name);
      event.preventDefault();
      event.stopImmediatePropagation();
      copied = target;
      notify(`已复制“${source.name}”`);
    } catch (error) { notify(error.message, true); }
  }, true);

  window.addEventListener("cut", () => { copied = null; shortcut = null; }, true);
  // 离开窗口后系统剪贴板可能被其他应用改写，要求重新复制，避免粘贴到过期资源。
  window.addEventListener("blur", () => { copied = null; shortcut = null; });

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "jsy-tools" ||
        event.data.type !== "settings" || typeof event.data.quickCopyEnabled !== "boolean") return;
    enabled = event.data.quickCopyEnabled;
    if (!enabled) {
      copied = armed = shortcut = null;
      clearTimeout(noticeTimer);
      notice?.remove();
      notice = null;
    }
  });
  window.postMessage({ channel: "jsy-tools", type: "ready" }, location.origin);
})();
