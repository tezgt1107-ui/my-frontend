(() => {
  const $ = selector => document.querySelector(selector);
  const state = { items: [], imageFile: null };
  const today = new Date();
  $('#changeReleaseDate').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const normalizePath = value => {
    let path = value.trim().replaceAll('\\', '/').replace(/[),.;:'"`]+$/g, '');
    path = path.replace(/\/{2,}/g, '/');
    return path.startsWith('/') ? path : `/${path}`;
  };
  function translateAction(text, fallback) {
    if (/\b(added|add|created|create|new)\b|新增/i.test(text)) return '新增';
    if (/\b(deleted|delete|removed|remove)\b|刪除/i.test(text)) return '刪除';
    if (/\b(modified|modify|changed|change|updated|update|renamed|rename)\b|修改|異動/i.test(text)) return '修改';
    return fallback;
  }
  function extractEntries(text, fallbackRemark) {
    const candidates = [];
    const actionSequence = [];
    text.split(/\r?\n/).forEach(line => {
      const detectedAction = translateAction(line, '');
      if (detectedAction) actionSequence.push(detectedAction);
      const matches = line.match(/(?:[A-Za-z]:)?[\\/](?:[^\\/\s"'<>|,;]+[\\/])*[^\\/\s"'<>|,;]*/g) || [];
      matches.forEach(match => {
        const path = normalizePath(match);
        if (path.length > 3 && path.includes('/')) candidates.push({ path, remark: detectedAction || fallbackRemark });
      });
    });
    const unique = [...new Map(candidates.map(item => [item.path, item])).values()];
    if (actionSequence.length >= unique.length) unique.forEach((item, index) => { item.remark = actionSequence[index] || item.remark; });
    return unique;
  }
  function inferServer(path) {
    const serverBase = $('#changeServerBase')?.value.trim().replace(/\/+$/, '') || '';
    if (!serverBase) return '';
    const segments = path.split('/').filter(Boolean);
    const environmentIndex = segments.findIndex(segment => /^(dev|uat|sit|prod|prd)$/i.test(segment));
    if (environmentIndex > 0) {
      const repository = segments.slice(0, environmentIndex).join('/');
      return `${serverBase}/${repository}/UAT`;
    }
    return `${serverBase}/`;
  }
  function importServerParameterFile(file) {
    if (!file) return;
    file.text().then(text => {
      let parameters;
      try {
        parameters = JSON.parse(text);
      } catch {
        throw new Error('Server 參數檔不是有效的 JSON 格式');
      }
      if (!Array.isArray(parameters)) throw new Error('Server 參數檔必須是陣列格式');
      const parameter = parameters.find(item =>
        item && item.system === 'DevPilot' && item.parameterId === 'serverBase');
      if (!parameter || typeof parameter.parameterValue !== 'string' || !parameter.parameterValue.trim()) {
        throw new Error('找不到 system=DevPilot、parameterId=serverBase 的參數');
      }
      $('#changeServerBase').value = parameter.parameterValue.trim();
      $('#changeListStatus').textContent = '已匯入 DevPilot 的 serverBase 參數';
    }).catch(error => {
      $('#changeListStatus').textContent = `匯入 Server 參數檔失敗：${error.message}`;
    });
  }
  function pathItem(path) {
    const trimmed = path.replace(/\/+$/, '');
    const parts = trimmed.split('/');
    const item = parts.pop() || '';
    return { item, directory: `${parts.join('/')}/` || '/' };
  }
  function analyze() {
    const defaultRemark = $('#changeDefaultRemark').value;
    const entries = extractEntries($('#changeListInput').value, defaultRemark);
    if (!entries.length) {
      $('#changeListStatus').textContent = '找不到路徑，請確認每筆資料包含完整檔案或目錄路徑';
      return;
    }
    state.items = entries.map(entry => {
      const path = entry.path;
      const split = pathItem(path);
      return {
        server: inferServer(path),
        item: split.item,
        path: split.directory,
        destinationPath: split.directory,
        remark: entry.remark
      };
    });
    renderRows();
    $('#changeListPreview').hidden = false;
    $('#changeListStatus').textContent = `已解析 ${state.items.length} 筆異動項目，請確認後產生 Excel`;
    window.markActionComplete?.($('#changeListAnalyze'));
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }
  function renderRows() {
    $('#changeListRows').innerHTML = state.items.map((item, index) => `
      <tr data-index="${index}">
        <td>${index + 1}</td>
        <td><input data-field="server" value="${escapeHtml(item.server)}" /></td>
        <td><input data-field="item" value="${escapeHtml(item.item)}" /></td>
        <td><input data-field="path" value="${escapeHtml(item.path)}" /></td>
        <td><select data-field="remark">
          <option value="修改" ${item.remark === '修改' ? 'selected' : ''}>修改</option>
          <option value="新增" ${item.remark === '新增' ? 'selected' : ''}>新增</option>
          <option value="刪除" ${item.remark === '刪除' ? 'selected' : ''}>刪除</option>
        </select></td>
        <td><button type="button" class="remove-change-row" aria-label="移除第 ${index + 1} 筆">移除</button></td>
      </tr>`).join('');
    $('#changeListRows').querySelectorAll('input, select').forEach(control => control.addEventListener('input', event => {
      const row = event.target.closest('tr');
      const index = Number(row.dataset.index);
      state.items[index][event.target.dataset.field] = event.target.value;
      if (event.target.dataset.field === 'path') state.items[index].destinationPath = event.target.value;
    }));
    $('#changeListRows').querySelectorAll('.remove-change-row').forEach(button => button.addEventListener('click', event => {
      state.items.splice(Number(event.target.closest('tr').dataset.index), 1);
      renderRows();
      if (!state.items.length) $('#changeListPreview').hidden = true;
    }));
  }

  $('#changeListAnalyze').addEventListener('click', analyze);
  $('#changeListGenerate').addEventListener('click', async () => {
    const personName = $('#changePersonName').value.trim();
    if (!personName) { $('#changeListStatus').textContent = '請先輸入填表人姓名'; $('#changePersonName').focus(); return; }
    if (!state.items.length) analyze();
    if (!state.items.length) return;
    const payload = {
      personName,
      releaseDate: $('#changeReleaseDate').value || null,
      department: $('#changeDepartment').value.trim(),
      systemName: $('#changeSystemName').value.trim(),
      projectCode: $('#changeProjectCode').value.trim(),
      version: $('#changeVersion').value.trim(),
      projectManager: $('#changeProjectManager').value.trim(),
      items: state.items
    };
    try {
      $('#changeListStatus').textContent = '正在產生 Excel…';
      if (!window.ExcelJS) throw new Error('Excel 元件尚未載入，請重新整理頁面');
      const templateUrl = document.body.dataset.changeTemplateUrl || $('.change-list-tool').dataset.changeTemplateUrl || '/Templates/程式異動清單.xlsx';
      const response = await fetch(templateUrl);
      if (!response.ok) throw new Error('找不到 Excel 範本');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await response.arrayBuffer());
      const sheet = workbook.worksheets[0];
      const setValue = (address, value) => { sheet.getCell(address).value = value ?? ''; };
      setValue('B4', payload.releaseDate || ''); setValue('E4', payload.department);
      setValue('B5', payload.systemName); setValue('E5', payload.projectCode); setValue('F3', payload.version);
      state.items.forEach((item, index) => {
        const row = 8 + index;
        const targetRow = sheet.getRow(row);
        const detailTemplate = sheet.getRow(10);
        targetRow.height = detailTemplate.height;
        for (let column = 1; column <= 6; column++) {
          targetRow.getCell(column).style = { ...detailTemplate.getCell(column).style };
        }
        setValue(`A${row}`, index + 1); setValue(`B${row}`, item.server);
        setValue(`C${row}`, item.item); setValue(`D${row}`, item.path); setValue(`F${row}`, item.remark);
      });
      const output = await workbook.xlsx.writeBuffer();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      link.download = `程式異動清單_${Date.now()}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove();
      $('#changeListStatus').textContent = `Excel 產生完成：${state.items.length} 筆異動，填表人 ${personName}`;
      window.markActionComplete?.($('#changeListGenerate'));
    } catch (error) {
      $('#changeListStatus').textContent = `Excel 產生失敗：${error.message}`;
    }
  });

  $('#changeListOcr').addEventListener('click', async () => {
    if (!state.imageFile) { $('#changeListStatus').textContent = '請先上傳圖片'; return; }
    try {
      $('#changeListStatus').textContent = '正在本機辨識圖片文字…';
      let text = '';
      if ('Tesseract' in window) {
        const worker = await Tesseract.createWorker('eng', 1, {
          logger: message => {
            if (message.status === 'recognizing text') {
              $('#changeListStatus').textContent = `正在本機辨識圖片文字… ${Math.round((message.progress || 0) * 100)}%`;
            }
          }
        });
        try {
          const result = await worker.recognize(state.imageFile);
          text = result.data.text;
        } finally {
          await worker.terminate();
        }
      } else if ('TextDetector' in window) {
        const bitmap = await createImageBitmap(state.imageFile);
        const results = await new TextDetector().detect(bitmap);
        bitmap.close();
        text = results.map(result => result.rawValue).join('\n');
      } else {
        throw new Error('OCR 引擎載入失敗，請確認網路後重試');
      }
      $('#changeListInput').value = text;
      analyze();
      window.markActionComplete?.($('#changeListOcr'));
    } catch (error) {
      $('#changeListStatus').textContent = `圖片辨識失敗：${error.message}`;
    }
  });
  $('#changeListClear').addEventListener('click', () => {
    $('#changeListInput').value = ''; $('#changeListFile').value = ''; $('#changePersonName').value = '';
    $('#changeListImagePreview').hidden = true; $('#changeListPreview').hidden = true;
    $('#changeListRows').innerHTML = ''; $('#changeListStatus').textContent = '等待路徑資料';
    state.items = []; state.imageFile = null;
  });

  async function loadFile(file) {
    if (!file) return;
    if (file.type.startsWith('image/')) {
      state.imageFile = file;
      const preview = $('#changeListImagePreview');
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      $('#changeListStatus').textContent = '圖片已載入，請點「辨識圖片文字」';
      return;
    }
    try {
      $('#changeListInput').value = await file.text();
      $('#changeListStatus').textContent = `已讀取 ${file.name}，正在解析…`;
      analyze();
    } catch { $('#changeListStatus').textContent = '無法讀取檔案'; }
  }
  $('#changeListFile').addEventListener('change', event => loadFile(event.target.files[0]));
  $('#changeServerParameterFile').addEventListener('change', event => {
    importServerParameterFile(event.target.files[0]);
  });
  document.addEventListener('paste', event => {
    const items = [...(event.clipboardData?.items || [])];
    const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (!imageItem) return;

    const blob = imageItem.getAsFile();
    if (!blob) return;
    event.preventDefault();
    const pastedFile = new File([blob], `pasted-screenshot-${Date.now()}.${blob.type.split('/')[1] || 'png'}`, {
      type: blob.type,
      lastModified: Date.now()
    });
    loadFile(pastedFile);
    $('#changeListStatus').textContent = '已貼上剪貼簿截圖，可按 OCR 辨識文字';
  });
  const dropZone = $('#changeListDropZone');
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
})();
