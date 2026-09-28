// Supply Korean system fonts to WASM PDFium before documents are loaded.
// FPDF_SYSFONTINFO v1 ABI: https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_sysfontinfo.h
// Rendering substitution only: opening a PDF never rewrites its font resources.
const fs = require('fs');
const path = require('path');
const installed = new WeakMap();

function install(P) {
  if (installed.has(P)) return installed.get(P);
  const M = P.pdfium, entries = [], handles = new Map(), callbacks = [];
  const root = path.join(process.env.WINDIR || 'C:/Windows', 'Fonts');
  const load = (names) => {
    for (const name of names) {
      try {
        const data = fs.readFileSync(path.join(root, name));
        if (data.readUInt32BE(0) !== 0x00010000) continue; // static sfnt, not TTC/CFF
        const entry = { data, name: path.basename(name, '.ttf'), tables: new Map() };
        for (let n = 0; n < data.readUInt16BE(4); n++) {
          const offset = 12 + n * 16, start = data.readUInt32BE(offset + 8), length = data.readUInt32BE(offset + 12);
          if (start + length > data.length) throw new Error('Invalid font table');
          entry.tables.set(data.readUInt32BE(offset), data.subarray(start, start + length));
        }
        entries.push(entry); handles.set(entries.length, entry); return entries.length;
      } catch { /* Optional font absent or unreadable: try the next local face. */ }
    }
    return 0;
  };
  const sans = load(['malgun.ttf']);
  const sansBold = load(['malgunbd.ttf']) || sans;
  const serif = load(['HANBatang.ttf', 'KoPubBatangMedium.ttf']) || sans;
  const serifBold = load(['HANBatangB.ttf']) || serif;
  if (!sans && !serif) { installed.set(P, null); return null; }
  const copy = (data, buffer, size) => {
    if (!data) return 0;
    if (buffer && size >= data.length) M.HEAPU8.set(data, buffer);
    return data.length;
  };
  const cb = (fn, signature) => {
    const pointer = M.addFunction(fn, signature); callbacks.push(pointer); return pointer;
  };
  // Keep this struct and callbacks alive for the PDFium module's lifetime.
  const info = M._malloc(36);
  M.HEAPU32.fill(0, info / 4, info / 4 + 9);
  const put = (slot, value) => { M.HEAPU32[info / 4 + slot] = value; };
  put(0, 1);
  put(2, cb(() => {}, 'vii')); // No global catalog override for Latin/other scripts.
  put(3, cb((_self, weight, _italic, charset, pitch, face) => {
    if (charset !== 129) return 0;
    const name = M.UTF8ToString(face);
    const roman = /myeong|myung|batang|명조|바탕/i.test(name) || !!(pitch & 16);
    return roman ? (weight >= 700 ? serifBold : serif) : (weight >= 700 ? sansBold : sans) || serif;
  }, 'iiiiiiii'));
  put(5, cb((_self, handle, table, buffer, size) => {
    const entry = handles.get(handle);
    return copy(table ? entry?.tables.get(table >>> 0) : entry?.data, buffer, size);
  }, 'iiiiii'));
  put(6, cb((_self, handle, buffer, size) => {
    const entry = handles.get(handle);
    return entry ? copy(Buffer.from(entry.name + '\0'), buffer, size) : 0;
  }, 'iiiii'));
  put(7, cb(() => 129, 'iii'));
  put(8, cb(() => {}, 'vii')); // Buffers are shared; never free them per font handle.
  P.FPDF_SetSystemFontInfo(info);
  const state = { info, callbacks, entries };
  installed.set(P, state);
  return state;
}

module.exports = { install };
