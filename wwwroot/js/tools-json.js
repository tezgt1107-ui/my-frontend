(() => {
  const input = document.querySelector('#jsonInput');
  const output = document.querySelector('#jsonOutput');
  const status = document.querySelector('#jsonStatus');
  if (!input || !output || !status) return;
  const parse = () => { if (!input.value.trim()) throw new Error('請先輸入 JSON'); return JSON.parse(input.value); };
  const set = (value, message) => { output.value = value; status.textContent = message; };
  const fail = error => set('', `格式錯誤：${error.message}`);
  document.querySelector('[data-json-format]')?.addEventListener('click', event => {
    try { set(JSON.stringify(parse(), null, 2), 'JSON 格式化完成'); window.markActionComplete?.(event.currentTarget); } catch (error) { fail(error); }
  });
  document.querySelector('[data-json-minify]')?.addEventListener('click', event => {
    try { set(JSON.stringify(parse()), 'JSON 壓縮完成'); window.markActionComplete?.(event.currentTarget); } catch (error) { fail(error); }
  });
  const propertyName = value => value.replace(/(^|[_\-\s]+)(\w)/g, (_, __, char) => char.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '') || 'Value';
  const primitiveType = value => value === null ? 'object?' : typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'decimal') : 'object';
  function createClass(object, className = 'Root') {
    let nested = '';
    const properties = Object.entries(object).map(([key, value]) => {
      let type = primitiveType(value);
      if (Array.isArray(value)) {
        const item = value[0];
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const itemName = propertyName(key).replace(/s$/i, '') || 'Item';
          type = `List<${itemName}>`; nested += `\n\n${createClass(item, itemName)}`;
        } else type = `List<${item === undefined ? 'object' : primitiveType(item)}>`;
      } else if (value && typeof value === 'object') {
        type = propertyName(key); nested += `\n\n${createClass(value, type)}`;
      }
      return `    public ${type} ${propertyName(key)} { get; set; }${type === 'string' ? ' = string.Empty;' : ''}`;
    });
    return `public sealed class ${className}\n{\n${properties.join('\n\n')}\n}${nested}`;
  }
  document.querySelector('[data-json-csharp]')?.addEventListener('click', event => {
    try {
      const value = parse();
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('最外層必須是 JSON 物件');
      set(createClass(value), '已產生 C# Model');
      window.markActionComplete?.(event.currentTarget);
    } catch (error) { fail(error); }
  });
  document.querySelector('[data-clear-group="json"]')?.addEventListener('click', () => {
    input.value = ''; output.value = ''; status.textContent = '等待輸入'; input.focus();
  });
})();
