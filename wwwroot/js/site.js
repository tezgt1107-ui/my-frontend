(() => {
  const tools = [
    ['JSON 格式化', '格式化、壓縮、轉成 C#', '/Tools/Json'],
    ['資料格式互轉', 'JSON、YAML、XML、CSV 互相轉換', '/Tools/DataConverter'],
    ['程式異動清單產生器', '從文字或圖片整理路徑並填入 Excel', '/Tools/ChangeList'],
    ['檢核公式 Excel 產生器', '貼上自表與跨表規格，自動生成公式並匯入 Excel', '/Tools/CheckFormula'],
    ['SQL IN 產生器', '將清單轉成 SQL', '/Tools/SqlIn'],
    ['SQL 欄位清理與比對', '清理 UID、稽核欄位並逐表比對', '/Tools/SqlSanitizer'],
    ['SQL 測試資料產生器', '從 INSERT 範例產生測試資料', '/Tools/SqlTestData'],
    ['文字處理', '去重、排序、大小寫轉換', '/Tools/Text'],
    ['時間戳轉換', 'Unix、ISO、UTC', '/Tools/Timestamp'],
    ['JWT 解碼', '檢視 Token 內容', '/Tools/Jwt'],
    ['編碼與雜湊', 'Base64、URL、SHA-256', '/Tools/Encoder'],
    ['Regex 測試', '測試規則與取代', '/Tools/Regex'],
    ['文字 Diff', '逐行比較內容', '/Tools/Diff'],
    ['GUID 與密碼', '產生安全的隨機值', '/Tools/Generator'],
    ['幸運轉盤', '隨機選擇項目', '/Tools/LuckyWheel']
  ];
  const root = document.documentElement;
  root.dataset.theme = localStorage.getItem('devpilot-theme') || 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('devpilot-theme', root.dataset.theme);
  }));
  const appShell = document.querySelector('.app-shell');
  const sidebar = document.querySelector('#sidebar');
  const menuToggle = document.querySelector('[data-menu-toggle]');
  const isMobileMenu = () => window.matchMedia('(max-width: 800px)').matches;
  const updateMenuState = () => {
    if (!menuToggle) return;
    const expanded = isMobileMenu()
      ? sidebar?.classList.contains('open')
      : !appShell?.classList.contains('sidebar-collapsed');
    menuToggle.setAttribute('aria-expanded', String(Boolean(expanded)));
    menuToggle.setAttribute('aria-label', expanded ? '收合選單' : '展開選單');
  };
  if (appShell && localStorage.getItem('devpilot-sidebar-collapsed') === 'true' && !isMobileMenu()) {
    appShell.classList.add('sidebar-collapsed');
  }
  menuToggle?.addEventListener('click', () => {
    if (isMobileMenu()) sidebar?.classList.toggle('open');
    else {
      const collapsed = appShell?.classList.toggle('sidebar-collapsed') || false;
      localStorage.setItem('devpilot-sidebar-collapsed', String(collapsed));
    }
    updateMenuState();
  });
  window.addEventListener('resize', updateMenuState);
  updateMenuState();
  const backdrop = document.querySelector('[data-command-dialog]');
  const input = document.querySelector('[data-command-input]');
  const results = document.querySelector('[data-command-results]');
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const render = (query = '') => {
    if (!results) return;
    const filtered = tools.filter(tool => `${tool[0]} ${tool[1]}`.toLowerCase().includes(query.toLowerCase()));
    results.innerHTML = filtered.length
      ? filtered.map(tool => `<a class="command-item" href="${tool[2]}"><span>${escapeHtml(tool[0])}<small> · ${escapeHtml(tool[1])}</small></span><span>→</span></a>`).join('')
      : '<div class="command-item">找不到符合的工具</div>';
  };
  const open = () => { if (backdrop && input) { backdrop.hidden = false; render(); setTimeout(() => input.focus(), 0); } };
  const close = () => { if (backdrop && input) { backdrop.hidden = true; input.value = ''; } };
  document.querySelectorAll('[data-command-open]').forEach(button => button.addEventListener('click', open));
  input?.addEventListener('input', event => render(event.target.value));
  backdrop?.addEventListener('click', event => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open(); }
    if (event.key === 'Escape' && backdrop && !backdrop.hidden) close();
  });
  window.showToast = message => {
    const toast = document.querySelector('[data-toast]');
    if (!toast) return;
    toast.textContent = message; toast.hidden = false;
    clearTimeout(window.__toast);
    window.__toast = setTimeout(() => { toast.hidden = true; }, 1800);
  };
  document.addEventListener('click', event => {
    const downloadLink = event.target.closest?.('a[download]');
    if (!downloadLink) return;
    const fileName = downloadLink.getAttribute('download') || '檔案';
    setTimeout(() => window.showToast(`下載已完成：${fileName}`), 120);
  }, true);
  window.notifyDownloadComplete = fileName => {
    window.showToast(`下載已完成：${fileName || '檔案'}`);
  };
  document.querySelectorAll('[data-copy-target]').forEach(button => button.addEventListener('click', async () => {
    const target = document.querySelector(button.dataset.copyTarget);
    if (!target) return;
    const text = 'value' in target ? target.value : target.textContent;
    try { await navigator.clipboard.writeText(text || ''); window.showToast('已複製到剪貼簿'); }
    catch { window.showToast('無法存取剪貼簿'); }
  }));

  document.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    document.querySelectorAll('button.is-selected').forEach(item => {
      item.classList.remove('is-selected');
      item.setAttribute('aria-pressed', 'false');
    });
    button.classList.add('is-selected');
    button.setAttribute('aria-pressed', 'true');
    button.classList.remove('is-pressed');
    void button.offsetWidth;
    button.classList.add('is-pressed');
    setTimeout(() => button.classList.remove('is-pressed'), 420);
  });
  window.markActionComplete = button => {
    if (!button) return;
    button.classList.add('is-complete');
    setTimeout(() => button.classList.remove('is-complete'), 900);
  };
})();
