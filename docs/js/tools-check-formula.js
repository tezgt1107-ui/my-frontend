(() => {
  const $ = selector => document.querySelector(selector);
  const state = { selfChecks: [], crossChecks: [] };
  let rangeExpansionTarget = null;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

  function normalizeReferences(text) {
    return String(text).replace(/[〔﹝\[]\s*([A-Za-z0-9_]+)\s*[〕﹞\]]\s*([0-9]+)\s*([A-Za-z](?:[0-9]+)?)?/g,
      (_, report, item, field = '') => `〔${report.toUpperCase()}〕${item}${field.toUpperCase()}`);
  }
  function normalizeFormula(text) {
    let value = normalizeReferences(text)
      .replace(/[＝﹦]/g, '=')
      .replace(/[＞]/g, '>')
      .replace(/[＜]/g, '<')
      .replace(/[≥≧]/g, '>=')
      .replace(/[≤≦]/g, '<=')
      .replace(/[≠]/g, '!=')
      .replace(/[＋﹢]/g, '+')
      .replace(/[－﹣]/g, '-')
      .replace(/[×＊]/g, '*')
      .replace(/[÷／]/g, '/');
    if ($('#checkNormalizeSymbols').checked) {
      value = value.replace(/[ \t]+/g, ' ').replace(/\s*([=!<>+\-*/])\s*/g, '$1').trim();
    }
    return value;
  }
  function normalizeCode(text) {
    return normalizeReferences(text).split(/\r?\n/).map(line => line.replace(/\s+/g, '').trim()).filter(Boolean).join('\n');
  }
  const containsReference = text => /[〔﹝\[]\s*[A-Za-z0-9_]+\s*[〕﹞\]]\s*\d+/i.test(text);
  const containsFormula = text => /(?:>=|<=|!=|<>|[=><＝﹦＞＜≥≤≧≦≠])/.test(text) && containsReference(text);
  const isHeading = text => /^(一、?自表檢核|二、?跨表檢核|﹝?報表編號|檢核項目|項\s*目\s*代\s*號\s*關\s*係\s*式)/.test(text.replace(/\s+/g, ''));
  const isSimilarInstruction = text => /(?:[A-Z]\d*\s*(?:(?:、|,|，|及|與|和|至|到|~|～|-)\s*)?)+欄(?:位)?以此類推/i.test(text);
  const firstReference = text => normalizeReferences(text).match(/〔[^〕]+〕\d+[A-Z]\d*/i)?.[0] || '';
  function comparisonLeftCode(formula) {
    const normalized = normalizeFormula(formula);
    const leftSide = normalized.split(/!=|<>|>=|<=|=|>|</, 1)[0];
    const references = leftSide.match(/〔[^〕]+〕\d+[A-Z]\d*/gi) || [];
    return references.length ? references.join('\n') : firstReference(normalized);
  }
  function appendFormulaContinuation(lastRule, line) {
    if (!lastRule || !containsReference(line)) return false;
    const continuation = normalizeFormula(line);
    const previousEndsWithOperator = /[+\-*/]$/.test(lastRule.formula.trim());
    const continuationStartsWithOperator = /^[+\-*/]/.test(continuation);
    if (!previousEndsWithOperator && !continuationStartsWithOperator) return false;
    lastRule.formula = `${lastRule.formula.trim()}${continuation}`;
    return true;
  }

  function parseText() {
    if ($('#checkTemplateId').value === 'EximAPI2Jcic') {
      parseJcicSingleColumn();
      return;
    }
    const lines = $('#checkFormulaInput').value.replace(/\u00a0/g, ' ').split(/\r?\n/);
    const raw = { self: [], cross: [] };
    let section = 'self';
    let pendingCodes = [];
    let pendingDescriptions = [];
    let lastRule = null;
    let lastDescription = '';

    for (const originalLine of lines) {
      const line = originalLine.trim();
      if (!line) continue;
      if (/^[~～-]+$/.test(line)) continue;
      if (/二、?\s*跨表檢核/.test(line)) {
        section = 'cross'; pendingCodes = []; pendingDescriptions = []; lastRule = null; lastDescription = ''; continue;
      }
      if (/一、?\s*自表檢核/.test(line) || isHeading(line)) continue;
      if (isSimilarInstruction(line)) {
        if (lastRule) lastRule.note = line.replace(/\s+/g, '');
        continue;
      }
      if (!containsFormula(line) && appendFormulaContinuation(lastRule, line)) continue;

      const tabParts = originalLine.split(/\t+/).map(value => value.trim()).filter(Boolean);
      const formulaPartIndex = tabParts.findIndex(containsFormula);
      if (formulaPartIndex >= 0 || containsFormula(line)) {
        const formulaText = formulaPartIndex >= 0 ? tabParts.slice(formulaPartIndex).join(' ') : line;
        const prefix = formulaPartIndex > 0 ? tabParts.slice(0, formulaPartIndex) : [];
        const prefixCode = prefix.find(containsReference);
        const inlineDescriptions = prefix.filter(value => value !== prefixCode);
        const accumulatedDescriptions = [...pendingDescriptions, ...inlineDescriptions].filter(Boolean);
        let description = accumulatedDescriptions.join('\n') || lastDescription;
        const normalizedFormula = normalizeFormula(formulaText);
        const rule = {
          code: comparisonLeftCode(normalizedFormula),
          description: description.trim(),
          formula: normalizedFormula,
          note: '',
          specialMonth: '',
          specialFormula: ''
        };
        raw[section].push(rule);
        lastRule = rule;
        if (rule.description) lastDescription = rule.description;
        pendingCodes = [];
        pendingDescriptions = [];
        continue;
      }

      if (tabParts.length >= 2 && containsReference(tabParts[0])) {
        pendingCodes.push(tabParts[0]);
        pendingDescriptions.push(tabParts.slice(1).join('\n'));
      } else if (containsReference(line) && !/[^\s〔﹝\[\]〕﹞A-Za-z0-9_]/.test(line.replace(/[、,，]/g, ''))) {
        pendingCodes.push(line);
      } else if (containsReference(line) && line.replace(/[〔﹝\[].*?[〕﹞\]]\s*\d+\s*[A-Za-z0-9]*/g, '').trim() === '') {
        pendingCodes.push(line);
      } else {
        pendingDescriptions.push(line);
      }
    }
    state.selfChecks = expandSimilarRules(raw.self);
    state.crossChecks = raw.cross;
  }

  function parseJcicSingleColumn() {
    const lines = $('#checkFormulaInput').value.replace(/\u00a0/g, ' ').split(/\r?\n/);
    const raw = { self: [], cross: [] };
    let section = 'self';
    let lastRule = null;
    for (const originalLine of lines) {
      const line = originalLine.trim();
      if (!line) continue;
      if (/^[~～-]+$/.test(line)) continue;
      if (/二、?\s*跨表檢核/.test(line)) { section = 'cross'; lastRule = null; continue; }
      if (/一、?\s*自表檢核/.test(line) || isHeading(line)) continue;
      if (isSimilarInstruction(line)) {
        if (lastRule) lastRule.note = line.replace(/\s+/g, '');
        continue;
      }
      if (!containsFormula(line) && appendFormulaContinuation(lastRule, line)) continue;
      if (!containsFormula(line)) continue;
      const tabParts = originalLine.split(/\t+/).map(value => value.trim()).filter(Boolean);
      const formulaPartIndex = tabParts.findIndex(containsFormula);
      const formulaText = formulaPartIndex >= 0 ? tabParts.slice(formulaPartIndex).join(' ') : line;
      const formula = normalizeFormula(formulaText);
      const rule = {
        code: comparisonLeftCode(formula),
        description: '',
        formula,
        note: '',
        specialMonth: '',
        specialFormula: ''
      };
      raw[section].push(rule);
      lastRule = rule;
    }
    state.selfChecks = expandSimilarRules(raw.self);
    state.crossChecks = raw.cross;
  }

  function instructionFields(note) {
    if (/[~～]/.test(note)) return [];
    const match = note.match(/(.+?)欄(?:位)?以此類推/i);
    if (!match) return [];
    const phrase = match[1].toUpperCase().replace(/\s+/g, '');
    const range = phrase.match(/^([A-Z])(?:至|到|~|～|-)([A-Z])$/);
    if (range) {
      const start = range[1].charCodeAt(0), end = range[2].charCodeAt(0);
      if (start <= end) return Array.from({ length: end - start + 1 }, (_, index) => String.fromCharCode(start + index));
    }
    return [...new Set(phrase.match(/[A-Z]\d*/g) || [])];
  }
  function replaceReferenceField(text, targetField) {
    return normalizeReferences(text).replace(/(〔[^〕]+〕\d+)([A-Z]\d*)/g, (_, prefix) => `${prefix}${targetField}`);
  }
  function expandSimilarRules(rules) {
    if (!$('#checkExpandSimilar').checked) return rules;
    const expanded = [];
    rules.forEach(rule => {
      const fields = instructionFields(rule.note);
      if (!fields.length) { expanded.push(rule); return; }
      const baseRule = { ...rule, note: '' };
      expanded.push(baseRule);
      const currentField = (rule.code || firstReference(rule.formula)).match(/[A-Z]\d*$/)?.[0];
      fields.filter(field => field !== currentField).forEach(field => expanded.push({
        ...baseRule,
        code: replaceReferenceField(rule.code || firstReference(rule.formula), field),
        formula: replaceReferenceField(rule.formula, field)
      }));
    });
    return expanded;
  }

  function analyze() {
    if (!$('#checkFormulaInput').value.trim()) {
      $('#checkFormulaStatus').textContent = '請先貼上檢核規格文字';
      return;
    }
    parseText();
    render();
    const total = state.selfChecks.length + state.crossChecks.length;
    $('#checkFormulaPreview').hidden = total === 0;
    $('#checkFormulaStatus').textContent = total
      ? `解析完成：自表 ${state.selfChecks.length} 筆、跨表 ${state.crossChecks.length} 筆`
      : '找不到含有等號的檢核公式，請確認貼上的格式';
    if (total) window.markActionComplete?.($('#checkFormulaAnalyze'));
  }

  function rowHtml(rule, index, section) {
    const isCross = section === 'cross';
    return `<tr data-index="${index}" data-section="${section}">
      <td><textarea data-field="code">${escapeHtml(rule.code)}</textarea></td>
      <td><textarea data-field="description">${escapeHtml(rule.description)}</textarea></td>
      <td><textarea data-field="formula">${escapeHtml(rule.formula)}</textarea></td>
      ${isCross
        ? `<td><input data-field="specialMonth" value="${escapeHtml(rule.specialMonth)}" /></td><td><textarea data-field="specialFormula">${escapeHtml(rule.specialFormula)}</textarea></td>`
        : `<td><input data-field="note" value="${escapeHtml(rule.note)}" /></td>`}
      <td><div class="check-row-actions"><button type="button" class="expand-check-range">展開範圍</button><button type="button" class="remove-check-row">移除</button></div></td>
    </tr>`;
  }
  function render() {
    $('#selfCheckRows').innerHTML = state.selfChecks.map((rule, index) => rowHtml(rule, index, 'self')).join('');
    $('#crossCheckRows').innerHTML = state.crossChecks.map((rule, index) => rowHtml(rule, index, 'cross')).join('');
    $('#selfCheckCount').textContent = `自表 ${state.selfChecks.length}`;
    $('#crossCheckCount').textContent = `跨表 ${state.crossChecks.length}`;
    document.querySelectorAll('#selfCheckRows input, #selfCheckRows textarea, #crossCheckRows input, #crossCheckRows textarea').forEach(control => {
      control.addEventListener('input', event => {
        const row = event.target.closest('tr');
        const list = row.dataset.section === 'self' ? state.selfChecks : state.crossChecks;
        list[Number(row.dataset.index)][event.target.dataset.field] = event.target.value;
      });
    });
    document.querySelectorAll('.remove-check-row').forEach(button => button.addEventListener('click', event => {
      const row = event.target.closest('tr');
      const list = row.dataset.section === 'self' ? state.selfChecks : state.crossChecks;
      list.splice(Number(row.dataset.index), 1);
      render();
    }));
    document.querySelectorAll('.expand-check-range').forEach(button => button.addEventListener('click', event => {
      const row = event.target.closest('tr');
      const list = row.dataset.section === 'self' ? state.selfChecks : state.crossChecks;
      const index = Number(row.dataset.index);
      rangeExpansionTarget = { section: row.dataset.section, index };
      $('#checkRangeBaseFormula').textContent = list[index].formula;
      $('#checkRangeValues').value = '';
      $('#checkRangeDialog').showModal();
      $('#checkRangeValues').focus();
    }));
  }

  function expandSelectedRange() {
    if (!rangeExpansionTarget) return;
    const list = rangeExpansionTarget.section === 'self' ? state.selfChecks : state.crossChecks;
    const source = list[rangeExpansionTarget.index];
    if (!source) return;
    const reference = normalizeReferences(source.formula).match(/〔([A-Z0-9_]+)〕(\d+)([A-Z]\d*)/i);
    if (!reference) {
      $('#checkFormulaStatus').textContent = '選取的公式找不到可展開的報表項目代號。';
      return;
    }
    const [, report, baseItem] = reference;
    const itemCodes = [...new Set($('#checkRangeValues').value
      .split(/[\s,，、;；]+/)
      .map(value => value.trim())
      .filter(value => /^\d+$/.test(value) && value !== baseItem))];
    if (!itemCodes.length) {
      $('#checkFormulaStatus').textContent = '請輸入至少一個不同於原公式的數字項目代號。';
      return;
    }
    const escapedReport = report.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const itemPattern = new RegExp(`(〔${escapedReport}〕)${baseItem}(?=[A-Z])`, 'gi');
    const generated = itemCodes.map(item => {
      const formula = normalizeReferences(source.formula).replace(itemPattern, `$1${item}`);
      return { ...source, code: comparisonLeftCode(formula), formula, note: '' };
    });
    list.splice(rangeExpansionTarget.index + 1, 0, ...generated);
    $('#checkRangeDialog').close();
    rangeExpansionTarget = null;
    render();
    $('#checkFormulaStatus').textContent = `已在原列下方插入 ${generated.length} 筆展開公式。`;
  }

  $('#checkFormulaAnalyze').addEventListener('click', analyze);
  $('#checkRangeGenerate').addEventListener('click', expandSelectedRange);
  $('#checkFormulaGenerate').addEventListener('click', async () => {
    if (!state.selfChecks.length && !state.crossChecks.length) analyze();
    if (!state.selfChecks.length && !state.crossChecks.length) return;
    try {
      $('#checkFormulaStatus').textContent = '正在套用 CheckTemplet.xlsx…';
      const response = await fetch('/api/check-formula/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: $('#checkTemplateId').value,
          selfChecks: state.selfChecks,
          crossChecks: state.crossChecks
        })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || `伺服器回應 ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const fileName = encodedName ? decodeURIComponent(encodedName) : `CheckFormula_${Date.now()}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = fileName;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('#checkFormulaStatus').textContent = `Excel 產生完成，共 ${state.selfChecks.length + state.crossChecks.length} 筆公式`;
      window.markActionComplete?.($('#checkFormulaGenerate'));
    } catch (error) {
      $('#checkFormulaStatus').textContent = `Excel 產生失敗：${error.message}`;
    }
  });
  $('#checkFormulaClear').addEventListener('click', () => {
    $('#checkFormulaInput').value = '';
    $('#checkFormulaPreview').hidden = true;
    $('#checkFormulaStatus').textContent = '等待貼上檢核規格';
    state.selfChecks = []; state.crossChecks = [];
  });
  $('#checkTemplateId').addEventListener('change', event => {
    const jcic = event.target.value === 'EximAPI2Jcic';
    $('#checkTemplateDescription').textContent = jcic
      ? '公式寫入 B 欄；系統依「一、自表檢核／二、跨表檢核」TITLE，自動在 A 欄填入 1／2。'
      : '每筆貼 3 欄：代號、檢核項目、關係式，以 Tab 分隔。';
    $('#checkInputModeLabel').textContent = jcic
      ? '貼上 1 欄資料：每行一條公式'
      : '貼上 3 欄資料：代號、檢核項目、關係式';
    $('#checkFormulaInput').placeholder = jcic
      ? '一、自表檢核\n〔AI395〕1000A=〔AI395〕1100A+〔AI395〕1200A\nD欄以此類推\n\n二、跨表檢核\n〔AI395〕1000D=〔AI330〕9999A'
      : '一、自表檢核\n〔AI395〕1000D\\t放款餘額\\t〔AI395〕1000A＝〔AI395〕1100A＋〔AI395〕1200A\nD欄以此類推';
    state.selfChecks = [];
    state.crossChecks = [];
    $('#checkFormulaPreview').hidden = true;
    $('#checkFormulaStatus').textContent = jcic ? '已切換為 Jcic 單欄解析模式' : '已切換為 CBC 三欄解析模式';
  });
})();
