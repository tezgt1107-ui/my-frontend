(() => {
  const encoder = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    crcTable[n] = value >>> 0;
  }
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const header = (size, write) => {
    const bytes = new Uint8Array(size);
    write(new DataView(bytes.buffer));
    return bytes;
  };
  const join = parts => {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    parts.forEach(part => { result.set(part, offset); offset += part.length; });
    return result;
  };
  const dosDateTime = date => {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  };

  window.downloadFile = file => {
    if (!file?.name) throw new Error('沒有可下載的檔案');
    const blob = new Blob([file.content], { type: file.type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  window.downloadZip = (archiveName, files) => {
    if (!files?.length) throw new Error('ZIP 沒有可下載的檔案');
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const stamp = dosDateTime(new Date());

    files.forEach(file => {
      const name = encoder.encode(file.name);
      const data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
      const checksum = crc32(data);
      const localHeader = header(30, view => {
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x0800, true);
        view.setUint16(8, 0, true);
        view.setUint16(10, stamp.time, true);
        view.setUint16(12, stamp.date, true);
        view.setUint32(14, checksum, true);
        view.setUint32(18, data.length, true);
        view.setUint32(22, data.length, true);
        view.setUint16(26, name.length, true);
        view.setUint16(28, 0, true);
      });
      const centralHeader = header(46, view => {
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 20, true);
        view.setUint16(8, 0x0800, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, stamp.time, true);
        view.setUint16(14, stamp.date, true);
        view.setUint32(16, checksum, true);
        view.setUint32(20, data.length, true);
        view.setUint32(24, data.length, true);
        view.setUint16(28, name.length, true);
        view.setUint16(30, 0, true);
        view.setUint16(32, 0, true);
        view.setUint16(34, 0, true);
        view.setUint16(36, 0, true);
        view.setUint32(38, 0, true);
        view.setUint32(42, localOffset, true);
      });
      localParts.push(localHeader, name, data);
      centralParts.push(centralHeader, name);
      localOffset += localHeader.length + name.length + data.length;
    });

    const central = join(centralParts);
    const end = header(22, view => {
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(4, 0, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, files.length, true);
      view.setUint16(10, files.length, true);
      view.setUint32(12, central.length, true);
      view.setUint32(16, localOffset, true);
      view.setUint16(20, 0, true);
    });
    const blob = new Blob([...localParts, central, end], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = archiveName.endsWith('.zip') ? archiveName : `${archiveName}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
})();
