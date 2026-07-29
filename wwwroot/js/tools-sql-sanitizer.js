(() => {
  const $ = selector => document.querySelector(selector);
  const state = { groups: [], index: 0, output: '', fileName: 'sanitized.sql' };
  const fileTimestamp = (date = new Date()) =>
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;

  function splitTopLevel(text, delimiter = ',') {
    const parts = [];
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
      else if (char === delimiter && depth === 0) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts;
  }

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
    if (start < sql.length) statements.push(sql.slice(start));
    return statements;
  }

  const cleanName = name => name.trim().replace(/[\[\]"`]/g, '');
  const normalized = name => cleanName(name).split('.').pop().replace(/[^a-z0-9]/gi, '').toLowerCase();
  const tableKey = name => cleanName(name).toLowerCase();
  const aliases = selector => new Set($(selector).value.split(',').map(normalized).filter(Boolean));

  function identityColumns(sql) {
    const map = new Map();
    const pattern = /CREATE\s+TABLE\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w$#]+)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w$#]+))*)\s*\(/gi;
    let match;
    while ((match = pattern.exec(sql))) {
      const open = pattern.lastIndex - 1;
      const close = matchingParen(sql, open);
      if (close < 0) continue;
      const columns = new Set();
      splitTopLevel(sql.slice(open + 1, close)).forEach(definition => {
        if (!/\bIDENTITY\s*(?:\(|\b)/i.test(definition)) return;
        const column = definition.match(/^\s*(\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w$#]+)/)?.[1];
        if (column) columns.add(normalized(column));
      });
      map.set(tableKey(match[1]), columns);
      map.set(normalized(match[1]), columns);
      pattern.lastIndex = close + 1;
    }
    return map;
  }

  function classify(column, table, identities, rules) {
    const name = normalized(column);
    const identitySet = identities.get(tableKey(table)) || identities.get(normalized(table));
    if (identitySet?.has(name)) return 'uid';
    if (!identitySet && rules.uidFallback && (rules.uid.has(name) || name === `${normalized(table)}uid` || name === `${normalized(table)}id`)) return 'uid';
    if (rules.createUser.has(name)) return 'createUser';
    if (rules.updateUser.has(name)) return 'updateUser';
    if (rules.createDate.has(name)) return 'createDate';
    if (rules.updateDate.has(name)) return 'updateDate';
    return null;
  }

  function parseRows(tail) {
    const valuesMatch = tail.match(/^\s*VALUES\b/i);
    if (!valuesMatch) return null;
    let cursor = valuesMatch[0].length;
    const rows = [];
    while (cursor < tail.length) {
      while (/[\s,]/.test(tail[cursor] || '')) cursor++;
      if (tail[cursor] !== '(') break;
      const close = matchingParen(tail, cursor);
      if (close < 0) return null;
      rows.push(splitTopLevel(tail.slice(cursor + 1, close)));
      cursor = close + 1;
    }
    return rows.length ? { rows, suffix: tail.slice(cursor) } : null;
  }

  function transformStatement(statement, identities, rules) {
    const insert = statement.match(/INSERT\s+INTO\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w$#]+)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[\w$#]+))*)\s*\(/i);
    if (!insert) return null;
    const table = insert[1];
    const open = insert.index + insert[0].lastIndexOf('(');
    const close = matchingParen(statement, open);
    if (close < 0) return null;
    const columns = splitTopLevel(statement.slice(open + 1, close));
    const parsed = parseRows(statement.slice(close + 1));
    if (!parsed || parsed.rows.some(row => row.length !== columns.length)) return { table, error: '欄位數與 VALUES 數量不一致，已略過' };

    const actions = columns.map(column => classify(column, table, identities, rules));
    if (!actions.some(Boolean)) return { table, unchanged: true };
    const keptIndexes = actions.map((action, index) => action === 'uid' ? -1 : index).filter(index => index >= 0);
    const nextColumns = keptIndexes.map(index => columns[index]);
    const nextRows = parsed.rows.map(row => keptIndexes.map(index => {
      if (actions[index] === 'createUser' || actions[index] === 'updateUser') return "'system'";
      if (actions[index] === 'createDate' || actions[index] === 'updateDate') return 'GETDATE()';
      return row[index];
    }));
    const prefix = statement.slice(0, open);
    const formattedRows = nextRows.map(row => `(${row.join(', ')})`).join(',\n');
    const transformed = `${prefix}(${nextColumns.join(', ')})\nVALUES\n${formattedRows}${parsed.suffix}`;
    const changes = [];
    actions.forEach((action, index) => {
      if (action === 'uid') changes.push(`移除 ${cleanName(columns[index])}`);
      if (action === 'createUser' || action === 'updateUser') changes.push(`${cleanName(columns[index])} → 'system'`);
      if (action === 'createDate' || action === 'updateDate') changes.push(`${cleanName(columns[index])} → GETDATE()`);
    });
    return { table: cleanName(table), transformed, changes: [...new Set(changes)] };
  }

  function run(triggerButton) {
    const sql = $('#sanitizeInput').value;
    if (!sql.trim()) { $('#sanitizeStatus').textContent = '請先上傳或貼上 SQL'; return; }
    const rules = {
      uid: aliases('#uidAliases'), createUser: aliases('#createUserAliases'),
      updateUser: aliases('#updateUserAliases'), createDate: aliases('#createDateAliases'),
      updateDate: aliases('#updateDateAliases'), uidFallback: $('#uidFallback').checked
    };
    const identities = identityColumns(sql);
    const groups = new Map();
    const warnings = [];
    let changedStatements = 0;
    const output = splitStatements(sql).map(statement => {
      const result = transformStatement(statement, identities, rules);
      if (!result) return statement;
      if (result.error) { warnings.push(`${cleanName(result.table)}：${result.error}`); return statement; }
      if (result.unchanged) return statement;
      changedStatements++;
      const key = tableKey(result.table);
      if (!groups.has(key)) groups.set(key, { table: result.table, before: [], after: [], changes: new Set() });
      const group = groups.get(key);
      group.before.push(statement.trim());
      group.after.push(result.transformed.trim());
      result.changes.forEach(change => group.changes.add(change));
      return result.transformed;
    }).join('');
    state.output = output;
    state.groups = [...groups.values()].map(group => ({ ...group, changes: [...group.changes] }));
    state.index = 0;
    $('#sanitizeOutput').value = output;
    $('#comparisonShell').hidden = state.groups.length === 0;
    $('#sanitizeStatus').textContent = state.groups.length
      ? `完成：${state.groups.length} 個 table、${changedStatements} 段 INSERT 已修改${warnings.length ? `；${warnings.length} 段略過` : ''}`
      : `沒有找到符合規則的 INSERT 欄位${warnings.length ? `；${warnings.join('；')}` : ''}`;
    if (state.groups.length) window.markActionComplete?.(triggerButton || $('#sanitizeRun'));
    renderGroup();
  }

  function renderGroup() {
    const group = state.groups[state.index];
    if (!group) return;
    $('#currentTable').textContent = group.table;
    $('#tablePosition').textContent = `${state.index + 1} / ${state.groups.length}`;
    renderDiff(group.before.join('\n\n'), group.after.join('\n\n'));
    $('#changeChips').innerHTML = group.changes.map(change => `<span>${change.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</span>`).join('');
    $('#previousTable').disabled = state.index === 0;
    $('#nextTable').disabled = state.index === state.groups.length - 1;
  }

  const escapeHtml = value => String(value).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
  function renderDiff(beforeText, afterText) {
    const tokenize = sql => sql.match(/N?'(?:''|[^'])*'|\[[^\]]+\]|"(?:""|[^"])*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_$#]*\b|\r?\n|[ \t]+|./g) || [];
    const before = tokenize(beforeText);
    const after = tokenize(afterText);
    const sameBefore = new Set();
    const sameAfter = new Set();
    const significant = token => !/^\s+$/.test(token);
    const beforeSignificant = before.map((token, index) => ({ token, index })).filter(item => significant(item.token));
    const afterSignificant = after.map((token, index) => ({ token, index })).filter(item => significant(item.token));

    if (beforeSignificant.length * afterSignificant.length <= 900000) {
      const rows = beforeSignificant.length + 1;
      const columns = afterSignificant.length + 1;
      const matrix = Array.from({ length: rows }, () => new Uint16Array(columns));
      for (let i = beforeSignificant.length - 1; i >= 0; i--) {
        for (let j = afterSignificant.length - 1; j >= 0; j--) {
          matrix[i][j] = beforeSignificant[i].token === afterSignificant[j].token
            ? matrix[i + 1][j + 1] + 1
            : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < beforeSignificant.length && j < afterSignificant.length) {
        if (beforeSignificant[i].token === afterSignificant[j].token) {
          sameBefore.add(beforeSignificant[i++].index);
          sameAfter.add(afterSignificant[j++].index);
        } else if (matrix[i + 1][j] >= matrix[i][j + 1]) i++;
        else j++;
      }
    } else {
      const afterCounts = new Map();
      afterSignificant.forEach(item => afterCounts.set(item.token, (afterCounts.get(item.token) || 0) + 1));
      beforeSignificant.forEach(item => {
        const count = afterCounts.get(item.token) || 0;
        if (count > 0) { sameBefore.add(item.index); afterCounts.set(item.token, count - 1); }
      });
      const beforeCounts = new Map();
      beforeSignificant.forEach(item => beforeCounts.set(item.token, (beforeCounts.get(item.token) || 0) + 1));
      afterSignificant.forEach(item => {
        const count = beforeCounts.get(item.token) || 0;
        if (count > 0) { sameAfter.add(item.index); beforeCounts.set(item.token, count - 1); }
      });
    }

    const renderTokens = (tokens, unchanged, changedClass) => {
      const lines = [[]];
      tokens.forEach((token, index) => {
        if (/^\r?\n$/.test(token)) lines.push([]);
        else {
          const changed = significant(token) && !unchanged.has(index);
          lines[lines.length - 1].push(changed
            ? `<mark class="${changedClass}">${escapeHtml(token)}</mark>`
            : escapeHtml(token));
        }
      });
      return lines.map((parts, index) =>
        `<div class="diff-code-line"><span class="diff-line-number">${index + 1}</span><code>${parts.join('') || ' '}</code></div>`
      ).join('');
    };
    $('#beforeSql').innerHTML = renderTokens(before, sameBefore, 'diff-value-before');
    $('#afterSql').innerHTML = renderTokens(after, sameAfter, 'diff-value-after');
  }

  $('#sanitizeRun').addEventListener('click', event => run(event.currentTarget));
  $('#previousTable').addEventListener('click', () => { if (state.index > 0) { state.index--; renderGroup(); } });
  $('#nextTable').addEventListener('click', () => { if (state.index < state.groups.length - 1) { state.index++; renderGroup(); } });
  $('#sanitizeClear').addEventListener('click', () => {
    $('#sanitizeInput').value = ''; $('#sanitizeOutput').value = ''; $('#sqlFile').value = '';
    $('#comparisonShell').hidden = true; $('#sanitizeStatus').textContent = '等待 SQL 檔案或內容';
    state.groups = []; state.output = '';
  });
  $('#sanitizeDownload').addEventListener('click', () => {
    if (!state.groups.length) { $('#sanitizeStatus').textContent = '請先套用規則，且至少要有一個異動 table'; return; }
    const usedNames = new Map();
    const timestamp = fileTimestamp();
    const files = state.groups.map((group, index) => {
      const baseName = group.table.split('.').at(-1)
        .replace(/[\[\]"`]/g, '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/^\.+|\.+$/g, '') || `table-${index + 1}`;
      const occurrence = (usedNames.get(baseName.toLowerCase()) || 0) + 1;
      usedNames.set(baseName.toLowerCase(), occurrence);
      const uniqueName = occurrence === 1 ? baseName : `${baseName}-${occurrence}`;
      const content = [
        `-- Table: ${group.table}`,
        '-- Generated by DevPilot SQL 欄位清理與比對',
        '',
        group.after.join('\n\n')
      ].join('\n');
      return { name: `${uniqueName}_${timestamp}.sql`, content };
    });
    if (files.length === 1) window.downloadFile(files[0]);
    else window.downloadZip(`sanitized-sql_${timestamp}.zip`, files);
    $('#sanitizeStatus').textContent = files.length === 1
      ? `已下載 ${files[0].name}`
      : `已打包 ${state.groups.length} 份 SQL，每個 table 一份`;
    window.markActionComplete?.($('#sanitizeDownload'));
  });
  async function loadFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    try {
      const contents = await Promise.all(files.map(file => file.text()));
      $('#sanitizeInput').value = contents.map((content, index) =>
        `-- ==================================================\n-- 來源檔案：${files[index].name}\n-- ==================================================\n${content.trim()}\n`
      ).join('\n');
      state.fileName = files.length === 1
        ? files[0].name.replace(/\.sql$/i, '') + '.sanitized.sql'
        : `sanitized-${files.length}-files.sql`;
      $('#sanitizeStatus').textContent = `已讀取 ${files.length} 份檔案，正在套用規則…`;
      run();
    } catch { $('#sanitizeStatus').textContent = '無法讀取檔案'; }
  }
  $('#sqlFile').addEventListener('change', event => loadFiles(event.target.files));
  const dropZone = $('#sqlDropZone');
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', event => loadFiles(event.dataTransfer.files));
})();
