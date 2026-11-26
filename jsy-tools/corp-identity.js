(() => {
  if (globalThis.__jsyToolsCorpIdentity) return;
  globalThis.__jsyToolsCorpIdentity = true;
  // 主环境只读取企业行的 React key，不读取登录凭据或替换切换回调。
  document.addEventListener('jsy-tools-corp-identity', event => {
    const row = event.target;
    if (!(row instanceof Element) || !row.matches('.corps-container > div, .fx-switch-corp-dialog .corp-wrapper > .corp-item')) return;
    const property = Object.keys(row).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
    const fiber = row[property];
    // 九数云将 key 放在外层 CorpRow，旧版和简道云仍可能放在行元素上。
    const corpId = fiber?.return?.memoizedProps?.corp?.id;
    const key = fiber?.key ?? (corpId === fiber?.return?.key ? corpId : null);
    if (typeof key === 'string' && key && key.length <= 240) row.setAttribute('data-jsy-corp-key', key);
  });
})();
