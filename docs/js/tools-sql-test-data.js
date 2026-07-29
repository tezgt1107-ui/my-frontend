(() => {
  const $ = selector => document.querySelector(selector);
  const state = { groups: [], index: 0 };
  const fileTimestamp = (date = new Date()) =>
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;

  function matchingParen(text, openAt) {
    let depth = 0, quote = null;
    for (let i = openAt; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        if (char === quote) {
          if (text[i + 1] === quote) i++;
          else quote = null;
        }
      } else if (char === "'" || char === '"') quote = char;
      else if (char === '[') quote = ']';
      else if (char === '(') depth++;
      else if (char === ')' && --depth === 0) return i;
    }
    return -1;
  }

  function splitTopLevel(text) {
    const values = [];
    let start = 0, depth = 0, quote = null;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        if (char === quote) {
          if (text[i + 1] === quote) i++;
          else quote = null;
        }
      } else if (char === "'" || char === '"') quote = char;
      else if (char === '[') quote = ']';
      else if (char === '(') depth++;
      else if (char === ')') depth--;
      else if (char === ',' && depth === 0) {
        values.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    values.push(text.slice(start).trim());
    return values;
  }

  function splitStatements(sql) {
    const statements = [];
    let start = 0, quote = null, lineComment = false, blockComment = false;
    for (let i = 0; i < sql.length; i++) {
      const char = sql[i], next = sql[i + 1];
      if (lineComment) { if (char === '\n') lineComment = false; continue; }
      if (blockComment) { if (char === '*' && next === '/') { blockComment = false; i++; } continue; }
      if (quote) {
        if (char === quote) { if (sql[i + 1] === quote) i++; else quote = null; }
        continue;
      }
      if (char === '-' && next === '-') { lineComment = true; i++; }
      else if (char === '/' && next === '*') { blockComment = true; i++; }
      else if (char === "'" || char === '"') quote = char;
      else if (char === '[') quote = ']';
      else if (char === ';') { statements.push(sql.slice(start, i + 1)); start = i + 1; }
    }
    if (sql.slice(start).trim()) statements.push(sql.slice(start));
    return statements;
  }

  const cleanName = name => name.trim().replace(/[\[\]"`]/g, '');
  const normalize = name => cleanName(name).split('.').pop().replace(/[^a-z0-9]/gi, '').toLowerCase();
  const quoteSql = value => `'${String(value).replaceAll("'", "''")}'`;
  const pad = number => String(number).padStart(3, '0');
  const names = ['王小明', '陳美玲', '林志豪', '張雅婷', '李冠宇', '黃怡君', '吳俊傑', '劉佳蓉'];
  const cities = ['台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市'];

  function generateValue(column, sample, sequence, options) {
    const field = normalize(column);
    const value = sample.trim();
    if (/^null$/i.test(value)) {
      if (options.keepNull) return 'NULL';
      if (/date|time|created|updated|modified/.test(field)) return options.useGetDate ? 'GETDATE()' : quoteSql(new Date().toISOString());
      return quoteSql(`Test_${pad(sequence)}`);
    }
    if (/date|time|createdat|updatedat|modifiedat/.test(field)) {
      if (options.useGetDate) return 'GETDATE()';
      const dateText = value.match(/^(?:N)?'(.*)'$/i)?.[1];
      const date = dateText ? new Date(dateText.replaceAll("''", "'")) : new Date();
      if (!Number.isNaN(date.getTime())) {
        date.setDate(date.getDate() + sequence - 1);
        return quoteSql(date.toISOString().replace('T', ' ').slice(0, 19));
      }
    }
    if (/^(?:newid|newsequentialid)\s*\(\s*\)$/i.test(value)) return 'NEWID()';
    const stringMatch = value.match(/^(N)?'([\s\S]*)'$/i);
    if (stringMatch) {
      const unicode = stringMatch[1] || '';
      const original = stringMatch[2].replaceAll("''", "'");
      let generated;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(original) || /guid|uuid/.test(field)) {
        generated = crypto.randomUUID();
      } else if (/email|mail/.test(field)) generated = `test${sequence}@example.com`;
      else if (/phone|mobile|tel/.test(field)) generated = `09${String(10000000 + sequence).slice(-8)}`;
      else if (/name|user|contact/.test(field)) generated = `${names[(sequence - 1) % names.length]}${sequence}`;
      else if (/address|addr|city/.test(field)) generated = `${cities[(sequence - 1) % cities.length]}測試路${sequence}號`;
      else if (/code|no|number/.test(field)) generated = `${original.replace(/\d+$/, '') || 'TEST'}${pad(sequence)}`;
      else if (/title|subject/.test(field)) generated = `測試標題 ${sequence}`;
      else if (/description|desc|remark|memo|note/.test(field)) generated = `第 ${sequence} 筆測試資料`;
      else generated = `${original || 'Test'}_${pad(sequence)}`;
      return `${unicode}${quoteSql(generated)}`;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      if (/^(is|has|can|enabled|active|status)/.test(field) && (value === '0' || value === '1')) return String(sequence % 2);
      const number = Number(value);
      if (Number.isInteger(number)) return String(number + sequence - 1);
      const decimals = value.split('.')[1]?.length || 2;
      return (number + (sequence - 1) / Math.pow(10, decimals)).toFixed(decimals);
    }
    if (/^(true|false)$/i.test(value)) return sequence % 2 ? '1' : '0';
    return value;
  }

  function parseInsert(statement) {
    const match = statement.match(/INSERT\s+INTO\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w$#]+)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w$#]+))*)\s*\(/i);
    if (!match) return null;
    const table = match[1];
    const columnsOpen = match.index + match[0].lastIndexOf('(');
    const columnsClose = matchingParen(statement, columnsOpen);
    if (columnsClose < 0) return null;
    const columns = splitTopLevel(statement.slice(columnsOpen + 1, columnsClose));
    const valuesMatch = statement.slice(columnsClose + 1).match(/^\s*VALUES\s*\(/i);
    if (!valuesMatch) return null;
    const valuesOpen = columnsClose + 1 + valuesMatch[0].lastIndexOf('(');
    const valuesClose = matchingParen(statement, valuesOpen);
    if (valuesClose < 0) return null;
    const values = splitTopLevel(statement.slice(valuesOpen + 1, valuesClose));
    if (columns.length !== values.length) return { table, error: '欄位數與範例值數量不一致' };
    return { table: cleanName(table), rawTable: table, columns, values };
  }

  function generate() {
    const sql = $('#testDataInput').value;
    if (!sql.trim()) { $('#testDataStatus').textContent = '請先貼上或上傳 INSERT SQL'; return; }
    const count = Math.min(1000, Math.max(1, Number($('#testDataCount').value) || 1));
    const start = Math.max(1, Number($('#testDataStart').value) || 1);
    const options = { keepNull: $('#testDataKeepNull').checked, useGetDate: $('#testDataUseGetDate').checked };
    const groups = new Map();
    const errors = [];
    splitStatements(sql).forEach(statement => {
      const parsed = parseInsert(statement);
      if (!parsed) return;
      if (parsed.error) { errors.push(`${cleanName(parsed.table)}：${parsed.error}`); return; }
      const rows = Array.from({ length: count }, (_, offset) => {
        const sequence = start + offset;
        return `(${parsed.values.map((value, index) => generateValue(parsed.columns[index], value, sequence, options)).join(', ')})`;
      });
      const generated = `INSERT INTO ${parsed.rawTable} (${parsed.columns.join(', ')})\nVALUES\n${rows.join(',\n')};`;
      const key = parsed.table.toLowerCase();
      if (!groups.has(key)) groups.set(key, { table: parsed.table, statements: [] });
      groups.get(key).statements.push(generated);
    });
    state.groups = [...groups.values()];
    state.index = 0;
    $('#testDataResult').hidden = !state.groups.length;
    $('#testDataStatus').textContent = state.groups.length
      ? `完成：${state.groups.length} 個 table，共產生 ${state.groups.reduce((sum, group) => sum + group.statements.length * count, 0)} 筆測試資料`
      : `找不到可處理的 INSERT INTO (...) VALUES (...)${errors.length ? `；${errors.join('；')}` : ''}`;
    if (state.groups.length) window.markActionComplete?.($('#testDataGenerate'));
    render();
  }

  function render() {
    const group = state.groups[state.index];
    if (!group) return;
    $('#testDataTable').textContent = group.table;
    $('#testDataPosition').textContent = `${state.index + 1} / ${state.groups.length}`;
    $('#testDataOutput').value = group.statements.join('\n\n');
    $('#testDataPrevious').disabled = state.index === 0;
    $('#testDataNext').disabled = state.index === state.groups.length - 1;
  }

  $('#testDataGenerate').addEventListener('click', generate);
  $('#testDataPrevious').addEventListener('click', () => { if (state.index > 0) { state.index--; render(); } });
  $('#testDataNext').addEventListener('click', () => { if (state.index < state.groups.length - 1) { state.index++; render(); } });
  $('#testDataClear').addEventListener('click', () => {
    $('#testDataInput').value = ''; $('#testDataOutput').value = ''; $('#testDataFile').value = '';
    $('#testDataResult').hidden = true; $('#testDataStatus').textContent = '等待 INSERT 範例'; state.groups = [];
  });
  $('#testDataDownload').addEventListener('click', () => {
    if (!state.groups.length) { $('#testDataStatus').textContent = '請先產生測試資料'; return; }
    const usedNames = new Map();
    const timestamp = fileTimestamp();
    const files = state.groups.map((group, index) => {
      const name = group.table.split('.').at(-1).replace(/[\[\]"`]/g, '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || `table-${index + 1}`;
      const occurrence = (usedNames.get(name.toLowerCase()) || 0) + 1;
      usedNames.set(name.toLowerCase(), occurrence);
      const uniqueName = occurrence === 1 ? name : `${name}-${occurrence}`;
      return { name: `${uniqueName}_${timestamp}.sql`, content: group.statements.join('\n\n') };
    });
    if (files.length === 1) window.downloadFile(files[0]);
    else window.downloadZip(`sql-test-data_${timestamp}.zip`, files);
    $('#testDataStatus').textContent = files.length === 1
      ? `已下載 ${files[0].name}`
      : `已打包 ${state.groups.length} 份 SQL，每個 table 一份`;
    window.markActionComplete?.($('#testDataDownload'));
  });

  async function loadFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    try {
      const contents = await Promise.all(files.map(file => file.text()));
      $('#testDataInput').value = contents.map((content, index) => `-- 來源檔案：${files[index].name}\n${content.trim()}`).join('\n\n');
      $('#testDataStatus').textContent = `已讀取 ${files.length} 份檔案，正在產生測試資料…`;
      generate();
    } catch { $('#testDataStatus').textContent = '無法讀取檔案'; }
  }
  $('#testDataFile').addEventListener('change', event => loadFiles(event.target.files));
  const dropZone = $('#testDataDropZone');
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', event => loadFiles(event.dataTransfer.files));
})();
