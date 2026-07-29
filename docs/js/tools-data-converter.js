(() => {
  const $ = selector => document.querySelector(selector);
  const state = { outputFormat: 'json', sourceName: 'converted' };
  const escapeXml = value => String(value).replace(/[<>&'"]/g, char => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', "'":'&apos;', '"':'&quot;' })[char]);
  const fileTimestamp = (date = new Date()) =>
    `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;

  function inferScalar(value) {
    const text = String(value).trim();
    if (/^(null|~)$/i.test(text)) return null;
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
    if (/^-?\d+(?:\.\d+)?$/.test(text) && !/^0\d+/.test(text)) return Number(text);
    return text;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') { value += '"'; i++; }
          else quoted = false;
        } else value += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(value); value = ''; }
      else if (char === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
      else value += char;
    }
    if (value.length || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
    const filtered = rows.filter(item => item.some(cell => cell !== ''));
    if (filtered.length < 2) throw new Error('CSV 至少需要標題列與一列資料');
    const headers = filtered[0].map((header, index) => header.trim() || `column${index + 1}`);
    return filtered.slice(1).map(rowValue => Object.fromEntries(headers.map((header, index) => [header, inferScalar(rowValue[index] ?? '')])));
  }

  const csvCell = value => {
    const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  function toCsv(data) {
    const rows = Array.isArray(data) ? data : [data];
    if (!rows.length) return '';
    if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('CSV 輸出需要物件或物件陣列');
    const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
    return [headers.map(csvCell).join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))].join('\r\n');
  }

  function yamlScalar(value) {
    if (value === null) return 'null';
    if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    const text = String(value);
    if (text === '' || /[:#\-\n\r{}\[\],&*!?|>'"%@`]|\s$|^\s|^(null|true|false|yes|no|~|-?\d+(?:\.\d+)?)$/i.test(text)) {
      return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;
    }
    return text;
  }
  function toYaml(value, indent = 0) {
    const space = ' '.repeat(indent);
    if (Array.isArray(value)) {
      if (!value.length) return `${space}[]`;
      return value.map(item => {
        if (item && typeof item === 'object') return `${space}-\n${toYaml(item, indent + 2)}`;
        return `${space}- ${yamlScalar(item)}`;
      }).join('\n');
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      if (!entries.length) return `${space}{}`;
      return entries.map(([key, item]) => {
        const safeKey = /^[A-Za-z_][\w.-]*$/.test(key) ? key : yamlScalar(key);
        if (item && typeof item === 'object') return `${space}${safeKey}:\n${toYaml(item, indent + 2)}`;
        return `${space}${safeKey}: ${yamlScalar(item)}`;
      }).join('\n');
    }
    return `${space}${yamlScalar(value)}`;
  }

  function parseYamlScalar(text) {
    const value = text.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      if (value[0] === '"') {
        try { return JSON.parse(value); } catch { return value.slice(1, -1); }
      }
      return value.slice(1, -1).replaceAll("''", "'");
    }
    if (value === '[]') return [];
    if (value === '{}') return {};
    return inferScalar(value);
  }
  function yamlKeyValue(text) {
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) { if (char === quote && text[i - 1] !== '\\') quote = null; }
      else if (char === "'" || char === '"') quote = char;
      else if (char === ':') return [text.slice(0, i).trim().replace(/^(['"])(.*)\1$/, '$2'), text.slice(i + 1).trim()];
    }
    return null;
  }
  function parseYaml(text) {
    const lines = text.replace(/\t/g, '  ').split(/\r?\n/).map((raw, number) => ({
      indent: raw.match(/^ */)[0].length, text: raw.trim(), number: number + 1
    })).filter(line => line.text && !line.text.startsWith('#') && line.text !== '---' && line.text !== '...');
    if (!lines.length) throw new Error('YAML 沒有資料');
    function block(index, indent) {
      const arrayMode = lines[index]?.indent === indent && lines[index].text.startsWith('-');
      const result = arrayMode ? [] : {};
      while (index < lines.length && lines[index].indent === indent) {
        const line = lines[index];
        if (arrayMode) {
          if (!line.text.startsWith('-')) break;
          const rest = line.text.slice(1).trim();
          if (!rest) {
            if (!lines[index + 1] || lines[index + 1].indent <= indent) { result.push(null); index++; }
            else { const nested = block(index + 1, lines[index + 1].indent); result.push(nested.value); index = nested.index; }
          } else {
            const pair = yamlKeyValue(rest);
            if (pair) {
              const item = {};
              if (pair[1]) item[pair[0]] = parseYamlScalar(pair[1]);
              else if (lines[index + 1]?.indent > indent) {
                const nested = block(index + 1, lines[index + 1].indent);
                item[pair[0]] = nested.value; index = nested.index - 1;
              } else item[pair[0]] = null;
              index++;
              if (lines[index]?.indent > indent && !lines[index].text.startsWith('-')) {
                const nested = block(index, lines[index].indent);
                Object.assign(item, nested.value); index = nested.index;
              }
              result.push(item);
            } else { result.push(parseYamlScalar(rest)); index++; }
          }
        } else {
          const pair = yamlKeyValue(line.text);
          if (!pair) throw new Error(`YAML 第 ${line.number} 行缺少冒號`);
          if (pair[1]) { result[pair[0]] = parseYamlScalar(pair[1]); index++; }
          else if (lines[index + 1]?.indent > indent) {
            const nested = block(index + 1, lines[index + 1].indent);
            result[pair[0]] = nested.value; index = nested.index;
          } else { result[pair[0]] = null; index++; }
        }
      }
      return { value: result, index };
    }
    return block(0, lines[0].indent).value;
  }

  function xmlElementToValue(element) {
    const children = [...element.children];
    const attributes = Object.fromEntries([...element.attributes].map(attribute => [`@${attribute.name}`, inferScalar(attribute.value)]));
    if (!children.length && !Object.keys(attributes).length) return inferScalar(element.textContent);
    const result = { ...attributes };
    children.forEach(child => {
      const value = xmlElementToValue(child);
      if (Object.hasOwn(result, child.tagName)) result[child.tagName] = Array.isArray(result[child.tagName]) ? [...result[child.tagName], value] : [result[child.tagName], value];
      else result[child.tagName] = value;
    });
    const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).filter(Boolean).join(' ');
    if (directText) result['#text'] = inferScalar(directText);
    return result;
  }
  function parseXml(text) {
    const documentValue = new DOMParser().parseFromString(text, 'application/xml');
    const error = documentValue.querySelector('parsererror');
    if (error) throw new Error(error.textContent.split('\n')[0]);
    return { [documentValue.documentElement.tagName]: xmlElementToValue(documentValue.documentElement) };
  }
  function xmlNode(name, value, indent = 0) {
    const space = '  '.repeat(indent);
    if (Array.isArray(value)) return value.map(item => xmlNode(name, item, indent)).join('\n');
    if (value === null || value === undefined) return `${space}<${name} />`;
    if (typeof value !== 'object') return `${space}<${name}>${escapeXml(value)}</${name}>`;
    const attributes = Object.entries(value).filter(([key]) => key.startsWith('@')).map(([key, item]) => ` ${key.slice(1)}="${escapeXml(item)}"`).join('');
    const children = Object.entries(value).filter(([key]) => !key.startsWith('@') && key !== '#text');
    const text = value['#text'];
    if (!children.length) return text === undefined ? `${space}<${name}${attributes} />` : `${space}<${name}${attributes}>${escapeXml(text)}</${name}>`;
    return `${space}<${name}${attributes}>${text === undefined ? '' : escapeXml(text)}\n${children.map(([key, item]) => xmlNode(key, item, indent + 1)).join('\n')}\n${space}</${name}>`;
  }
  function toXml(data, rootName) {
    const safeRoot = /^[A-Za-z_][\w.-]*$/.test(rootName) ? rootName : 'root';
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 1) {
      const [name, value] = Object.entries(data)[0];
      if (/^[A-Za-z_][\w.-]*$/.test(name)) return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlNode(name, value)}`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlNode(safeRoot, Array.isArray(data) ? { item: data } : data)}`;
  }

  function detectFormat(text) {
    const trimmed = text.trim();
    if (/^[\[{]/.test(trimmed)) { try { JSON.parse(trimmed); return 'json'; } catch {} }
    if (/^<\?xml\b|^<[A-Za-z_][\w:.-]*(?:\s|>)/i.test(trimmed)) return 'xml';
    const firstLine = trimmed.split(/\r?\n/, 1)[0];
    if (firstLine.includes(',') && trimmed.includes('\n')) return 'csv';
    return 'yaml';
  }
  function parse(text, format) {
    if (format === 'json') return JSON.parse(text);
    if (format === 'yaml') return parseYaml(text);
    if (format === 'xml') return parseXml(text);
    if (format === 'csv') return parseCsv(text);
    throw new Error('不支援的輸入格式');
  }
  function serialize(data, format) {
    if (format === 'json') return JSON.stringify(data, null, 2);
    if (format === 'yaml') return toYaml(data);
    if (format === 'xml') return toXml(data, $('#converterRootName').value.trim());
    if (format === 'csv') return toCsv(data);
    throw new Error('不支援的輸出格式');
  }

  function convert() {
    const input = $('#converterInput').value;
    if (!input.trim()) { $('#converterStatus').textContent = '請先輸入或上傳資料'; return; }
    try {
      const selectedInput = $('#converterInputFormat').value;
      const inputFormat = selectedInput === 'auto' ? detectFormat(input) : selectedInput;
      const outputFormat = $('#converterOutputFormat').value;
      const data = parse(input, inputFormat);
      $('#converterOutput').value = serialize(data, outputFormat);
      $('#converterInputLabel').textContent = `${inputFormat.toUpperCase()} 輸入`;
      $('#converterOutputLabel').textContent = `${outputFormat.toUpperCase()} 輸出`;
      $('#converterStatus').textContent = `轉換完成：${inputFormat.toUpperCase()} → ${outputFormat.toUpperCase()}`;
      state.outputFormat = outputFormat;
      window.markActionComplete?.($('#converterRun'));
    } catch (error) {
      $('#converterOutput').value = '';
      $('#converterStatus').textContent = `轉換失敗：${error.message}`;
    }
  }

  $('#converterRun').addEventListener('click', convert);
  $('#converterExample').addEventListener('click', () => {
    $('#converterInputFormat').value = 'json';
    $('#converterOutputFormat').value = 'yaml';
    $('#converterInput').value = JSON.stringify({
      users: [
        { id: 1, name: '王小明', email: 'ming@example.com', active: true },
        { id: 2, name: '陳美玲', email: 'ling@example.com', active: false }
      ]
    }, null, 2);
    convert();
  });
  $('#converterSwap').addEventListener('click', () => {
    if (!$('#converterOutput').value) return;
    const actualInput = $('#converterInputFormat').value === 'auto' ? detectFormat($('#converterInput').value) : $('#converterInputFormat').value;
    const previousOutput = $('#converterOutputFormat').value;
    $('#converterInput').value = $('#converterOutput').value;
    $('#converterInputFormat').value = previousOutput;
    $('#converterOutputFormat').value = actualInput;
    convert();
  });
  $('#converterOutputFormat').addEventListener('change', () => { if ($('#converterInput').value.trim()) convert(); });
  $('#converterClear').addEventListener('click', () => {
    $('#converterInput').value = ''; $('#converterOutput').value = ''; $('#converterFile').value = '';
    $('#converterStatus').textContent = '等待資料'; $('#converterInputLabel').textContent = '輸入資料';
  });
  $('#converterDownload').addEventListener('click', () => {
    const output = $('#converterOutput').value;
    if (!output) { $('#converterStatus').textContent = '請先完成轉換'; return; }
    const extension = state.outputFormat === 'yaml' ? 'yaml' : state.outputFormat;
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${state.sourceName}_${fileTimestamp()}.${extension}`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.markActionComplete?.($('#converterDownload'));
  });

  async function loadFile(file) {
    if (!file) return;
    try {
      const extension = file.name.split('.').pop().toLowerCase();
      const format = extension === 'yml' ? 'yaml' : ['json', 'yaml', 'xml', 'csv'].includes(extension) ? extension : 'auto';
      $('#converterInput').value = await file.text();
      $('#converterInputFormat').value = format;
      state.sourceName = file.name.replace(/\.[^.]+$/, '') || 'converted';
      $('#converterStatus').textContent = `已讀取 ${file.name}`;
      convert();
    } catch { $('#converterStatus').textContent = '無法讀取檔案'; }
  }
  $('#converterFile').addEventListener('change', event => loadFile(event.target.files[0]));
  const dropZone = $('#converterDropZone');
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
})();
