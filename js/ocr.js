/* Parchi Cloud OCR - reads parchi photos in the browser using Tesseract.js.
   No server needed. The photo never leaves the phone.
   Usage: ParchiOCR.readPhoto(imageBlobOrUrl, kind, onProgress) -> Promise<rows[]>
   kind: 'silver' | 'gold'
   Returns rows in the same shape app.js uses, ready for renderRows().
   Machine proposes, user verifies every row before saving. */

(function () {
'use strict';

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

/* ---------- Tesseract loader (lazy, CDN) ---------- */
let tessPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tessPromise) return tessPromise;
  tessPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Could not load OCR engine. Check internet and retry.'));
    document.head.appendChild(s);
  });
  return tessPromise;
}

/* ---------- Group OCR words into lines ---------- */
function wordsToLines(words) {
  // words: [{text, bbox: {x0,y0,x1,y1}}]
  const sorted = words.filter(w => w.text && w.text.trim())
    .sort((a, b) => (a.bbox.y0 - b.bbox.y0) || (a.bbox.x0 - b.bbox.x0));
  const lines = [];
  for (const w of sorted) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    let line = lines.find(l => Math.abs(l.cy - cy) < 12);
    if (!line) { line = { cy, words: [] }; lines.push(line); }
    line.words.push(w);
  }
  for (const l of lines) l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return lines.sort((a, b) => a.cy - b.cy);
}

/* ---------- Silver parchi line parser ----------
   Columns: Item Name | G.Wt | Less | Net | T+W | Labour | Silver | Amount
   Item names may contain numbers (tunch: 70, 92.5, 60). So we work
   BACKWARDS from the end using the invariant Silver = Net x (T+W)/100:
   find the (net, tw, silver) triple, then G.Wt is just before net
   (skipping Less), and everything before G.Wt is the item name. */
function parseSilverLine(text) {
  if (!text || text.length < 5) return null;
  if (/^\(/.test(text.trim())) return null;
  // Find all numbers with their positions
  const numRe = /[\d,]+\.?\d*/g;
  const nums = [];
  let m;
  while ((m = numRe.exec(text)) !== null) {
    const v = num(m[0]);
    if (v !== null) nums.push({ v, idx: m.index, end: m.index + m[0].length });
  }
  if (nums.length < 4) return null;
  // Find (net, tw, silver) triple from the end using the invariant
  let net = null, tw = null, silver = null, silverIdx = -1, netIdx = -1, twIdx = -1;
  for (let s = nums.length - 1; s >= 3; s--) {
    const sv = nums[s].v;
    for (let t = s - 1; t >= s - 2 && t >= 2; t--) {
      const tv = nums[t].v;
      if (tv <= 0 || tv >= 200) continue;
      for (let nn = t - 1; nn >= t - 2 && nn >= 1; nn--) {
        const nv = nums[nn].v;
        if (nv <= 0) continue;
        const expected = nv * tv / 100;
        if (Math.abs(expected - sv) < Math.max(0.5, sv * 0.02)) {
          net = nv; tw = tv; silver = sv;
          silverIdx = s; twIdx = t; netIdx = nn;
          break;
        }
      }
      if (silver !== null) break;
    }
    if (silver !== null) break;
  }
  if (silver === null) return null;
  // G.Wt: the number before net (skip Less if there are 2+ numbers before net)
  // Layout: [item...] G.Wt [Less] Net T+W ... Silver [Amount]
  // If netIdx >= 2, there are at least 2 numbers before net: G.Wt and Less.
  //   G.Wt = nums[netIdx - 2] if netIdx >= 2, else nums[0].
  // Actually: numbers before net are [G.Wt, Less?] — Less is optional.
  //   If netIdx == 1: only G.Wt before net → gwt = nums[0].
  //   If netIdx >= 2: G.Wt = nums[netIdx-2], Less = nums[netIdx-1].
  // But item name may contain numbers too! So we can't just count.
  // Safer: G.Wt is the LAST number before net that is > net*0.5
  // (G.Wt is always >= Net since Less is subtracted).
  let gwt = null, gwtIdx = -1;
  for (let i = netIdx - 1; i >= 0; i--) {
    if (nums[i].v >= net * 0.5 && nums[i].v < net * 3) { gwt = nums[i].v; gwtIdx = i; break; }
  }
  if (gwt === null) return null;
  // Item name = text before G.Wt's position
  const item = text.slice(0, nums[gwtIdx].idx).trim().replace(/^\s*S?\s*\d+\s+/, '').trim();
  if (!item || item.length < 2) return null;
  if (/^(item|g\.?wt|less|net|t\+w|labour|silver|amount|bill|s\.?no)/i.test(item)) return null;
  // Labour: number between tw and silver, if any
  let labour = null;
  if (silverIdx - twIdx > 1) labour = nums[twIdx + 1].v;
  // Tunch from item name (last number 30-100)
  let tunch = null;
  const nameNums = (item.match(/(\d+(?:\.\d+)?)/g) || []).map(parseFloat);
  for (const v of nameNums) { if (v >= 30 && v <= 100) tunch = v; }
  if (tunch !== null && tunch > tw) tunch = tw; // model number, not tunch
  return { item, gwt, net, tw, tunch, labour_rs: labour, silver_wt: silver };
}

/* ---------- Gold-diamond line parser (simplified) ----------
   Columns: Desc | Purity | G.Wt | N.Wt | Tunch | Dia Wt/Rate | St Wt/Rate | Making | Fine | Amount
   We extract: desc, gwt, nwt, tunch, making, amount. Diamond/stone
   details are hard from OCR alone — user verifies and fills those. */
function parseGoldLine(text) {
  const m = text.match(/^(.*?)\s+([\d.,\s]+.*)$/);
  if (!m) return null;
  const item = m[1].trim();
  if (!item || item.length < 2) return null;
  if (/^(desc|purity|g\.?wt|n\.?wt|tunch|diamond|stone|making|fine|amount)/i.test(item)) return null;
  if (/^\(/.test(item)) return null;
  const nums = (text.match(/[\d,]+\.?\d*/g) || []).map(s => num(s)).filter(n => n !== null);
  if (nums.length < 4) return null;
  // Positional: [gwt, nwt, tunch, ..., making, ..., amount]
  // Last number is usually amount; making is often 750 or similar
  const gwt = nums[0], nwt = nums[1], tunch = nums[2];
  const amount = nums[nums.length - 1];
  if (gwt <= 0 || nwt <= 0 || nwt > gwt * 1.5) return null;
  if (tunch < 10 || tunch > 100) return null;
  return { item, gwt, nwt, tunch, billed: amount };
}

/* ---------- Server OCR (same RapidOCR engine as desktop) ----------
   The phone sends the photo to the Parchi OCR server, which runs the
   exact same reader.py pipeline as the desktop software. This is what
   makes phone reading match desktop accuracy. Tesseract.js is only a
   fallback if the server is unreachable. */
const OCR_SERVER_URL = 'https://parchi-ocr-server.onrender.com';

async function readPhotoViaServer(blob, kind, rateKg, onProgress) {
  if (onProgress) onProgress(0.15, 'Sending photo to OCR server...');
  const fd = new FormData();
  fd.append('photo', blob, 'parchi.jpg');
  fd.append('kind', kind);
  fd.append('rate_kg', String(rateKg || 205000));
  let wakeTimer = setTimeout(() => {
    if (onProgress) onProgress(0.4, 'OCR server waking up (takes ~30-60s on free tier)...');
  }, 4000);
  try {
    const res = await fetch(OCR_SERVER_URL + '/read', { method: 'POST', body: fd });
    clearTimeout(wakeTimer);
    if (!res.ok) throw new Error('Server OCR failed (HTTP ' + res.status + ')');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (onProgress) onProgress(1, 'Processing complete');
    return (data.rows || []).map((r, i) => ({
      sno: i + 1,
      item: r.item || '', gwt: r.gwt ?? null, net: r.net ?? null,
      tw: r.tw ?? null, tunch: r.tunch ?? null,
      labour_rs: r.labour_rs ?? null, silver_wt: r.silver_wt ?? null,
      flag: r.flag || '',
    }));
  } finally {
    clearTimeout(wakeTimer);
  }
}

/* ---------- Main entry: server first, Tesseract fallback ---------- */
async function readPhoto(blobOrUrl, kind, onProgress) {
  // Try the server (desktop-grade accuracy) first
  try {
    const blob = blobOrUrl instanceof Blob ? blobOrUrl
      : await (await fetch(blobOrUrl)).blob();
    const state = (typeof window.getParchiState === 'function') ? window.getParchiState() : {};
    const rateKg = (state.current && state.current.metal_rate)
      ? state.current.metal_rate : 205000;
    const rows = await readPhotoViaServer(blob, kind, rateKg, onProgress);
    window._lastOcrSource = 'server';
    return rows;
  } catch (serverErr) {
    console.warn('Server OCR failed, falling back to on-device Tesseract:', serverErr);
    window._lastOcrSource = 'fallback: ' + (serverErr && serverErr.message || String(serverErr));
    // Fall back to on-device Tesseract
    if (onProgress) onProgress(0, 'Server issue (' + (serverErr.message || 'error') + '), trying on-device reader...');
    const T = await loadTesseract();
    const worker = await T.createWorker('eng', 1, {
      logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); }
    });
    try {
      const { data } = await worker.recognize(blobOrUrl);
      const lines = wordsToLines(data.words || []);
      const rows = [];
      let sno = 1;
      for (const line of lines) {
        const text = line.words.map(w => w.text).join(' ');
        const clean = text.replace(/^\s*S?\s*\d+\s+/, '').trim();
        if (!clean) continue;
        const parsed = kind === 'gold' ? parseGoldLine(clean) : parseSilverLine(clean);
        if (parsed) { parsed.sno = sno++; rows.push(parsed); }
      }
      return rows;
    } finally {
      await worker.terminate();
    }
  }
}

/* ---------- UI: Read photo button for the detail view ----------
   Call ParchiOCR.attachReadButton() after openParchi renders, or use
   the button directly: <button onclick="ParchiOCR.readCurrentPhoto()"> */
async function readCurrentPhoto() {
  const btn = document.getElementById('ocr-btn');
  const msg = document.getElementById('ocr-msg');
  const setMsg = t => { if (msg) msg.textContent = t; };
  try {
    const state = (typeof window.getParchiState === 'function') ? window.getParchiState() : {};
    const current = state.current;
    const sb = state.sb;
    if (!current || !current.id) { setMsg('Open a parchi first.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Reading photo...'; }
    setMsg('Checking photo and connecting to OCR server...');
    // Get the photo: prefer the already-uploaded file, else fetch from storage
    let blob = window._currentPhotoBlob;
    if (!blob && current.photo_url && sb) {
      setMsg('Downloading photo...');
      const { data } = await sb.storage.from('parchi-photos')
        .createSignedUrl(current.photo_url, 3600);
      if (!data?.signedUrl) throw new Error('Could not get photo URL.');
      const res = await fetch(data.signedUrl);
      blob = await res.blob();
    }
    if (!blob) {
      const img = document.getElementById('detail-img');
      if (img && img.src && !img.src.startsWith('data:image/svg')) {
        setMsg('Downloading photo preview...');
        const res = await fetch(img.src);
        blob = await res.blob();
      }
    }
    if (!blob) throw new Error('No photo on this parchi. Upload a photo first, then tap Read Photo.');
    setMsg('Reading photo... this takes 10-30 seconds.');
    const kind = current.kind || 'silver';
    const rows = await readPhoto(blob, kind, (p, text) => {
      setMsg(text || ('Reading photo... ' + Math.round(p * 100) + '%'));
    });
    if (!rows.length) {
      if (window._lastOcrSource && window._lastOcrSource.startsWith('fallback')) {
        setMsg('Server OCR could not be reached (' + window._lastOcrSource + '). You can retry or add rows manually.');
      } else {
        setMsg('No rows detected. Try a clearer, straighter photo with good light. You can still add rows manually with + Add Row.');
      }
    } else {
      // Replace current rows with OCR results (user verifies before saving)
      if (typeof window.setParchiRows === 'function') window.setParchiRows(rows);
      else if (typeof window.renderRows === 'function') { window.rows = rows; window.renderRows(); }
      setMsg('Found ' + rows.length + ' rows via ' + (window._lastOcrSource === 'server' ? 'server' : 'on-device OCR') + '. Check every row, fix any misreads, then tap Save.');
    }
  } catch (e) {
    setMsg('Photo read failed: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Read Photo'; }
  }
}

window.ParchiOCR = { readPhoto, parseSilverLine, parseGoldLine, readCurrentPhoto };
})();
