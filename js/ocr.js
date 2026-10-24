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
   We look for a line with at least 3 numbers. The item name is the
   leading non-numeric text. Numbers after it are assigned by position
   and validated with Silver = Net x (T+W)/100. */
function parseSilverLine(text) {
  // Split into tokens, keeping the item-name part separate
  const m = text.match(/^(.*?)\s+([\d.,\s]+.*)$/);
  if (!m) return null;
  const item = m[1].trim();
  const numPart = m[2];
  if (!item || item.length < 2) return null;
  // Skip header lines and packet/bracket lines
  if (/^(item|g\.?wt|less|net|t\+w|labour|silver|amount|bill|s\.?no)/i.test(item)) return null;
  if (/^\(/.test(item)) return null;
  // Extract all numbers from the numeric part
  const nums = (numPart.match(/[\d,]+\.?\d*/g) || []).map(s => num(s)).filter(n => n !== null);
  if (nums.length < 3) return null;
  // Heuristic assignment: last numbers are usually Silver, Amount.
  // Try to find a (net, tw, silver) triple satisfying silver = net*tw/100.
  // Common layouts: [gwt, less, net, tw, labour?, silver, amount]
  //                 [gwt, net, tw, silver] (less/labour missing)
  let gwt = null, net = null, tw = null, silver = null, labour = null;
  // Try 4-number pattern: gwt, net, tw, silver
  // Try 5-number: gwt, less, net, tw, silver
  // Try 6-number: gwt, less, net, tw, labour, silver
  // Try 7-number: gwt, less, net, tw, labour, silver, amount
  const n = nums.length;
  if (n >= 4) {
    // Assume: first = gwt, last-or-second-last = silver
    // Work backwards: silver is usually the 2nd-last or last number
    // (amount may follow silver). Try both.
    for (const silverIdx of [n - 1, n - 2]) {
      if (silverIdx < 3) continue;
      const s = nums[silverIdx];
      // net and tw are the two numbers before silver (skipping labour if present)
      for (let twIdx = silverIdx - 1; twIdx >= silverIdx - 2 && twIdx >= 2; twIdx--) {
        const t = nums[twIdx];
        const netIdx = twIdx - 1;
        if (netIdx < 1) continue;
        const nt = nums[netIdx];
        if (t > 0 && t < 200 && nt > 0) {
          const expected = nt * t / 100;
          if (Math.abs(expected - s) < Math.max(0.5, s * 0.02)) {
            // Match found
            gwt = nums[0]; net = nt; tw = t; silver = s;
            // labour: number between tw and silver, if any
            if (silverIdx - twIdx > 1) labour = nums[twIdx + 1];
            break;
          }
        }
      }
      if (silver !== null) break;
    }
  }
  if (net === null || tw === null) {
    // Fallback: positional guess for 4+ numbers
    // [gwt, less?, net, tw, ...] — take first as gwt, then find net/tw pair
    if (n >= 4) {
      gwt = nums[0];
      // If 5+ numbers, assume [gwt, less, net, tw, ...]
      // If 4 numbers, assume [gwt, net, tw, silver]
      if (n >= 5) { net = nums[2]; tw = nums[3]; }
      else { net = nums[1]; tw = nums[2]; }
      if (tw > 200 || tw <= 0) return null;
      silver = net * tw / 100;
    } else return null;
  }
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

/* ---------- Main entry ---------- */
async function readPhoto(blobOrUrl, kind, onProgress) {
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
      // Skip S-number prefixes like "S 1" / "1"
      const clean = text.replace(/^\s*S?\s*\d+\s+/, '').trim();
      if (!clean) continue;
      const parsed = kind === 'gold' ? parseGoldLine(clean) : parseSilverLine(clean);
      if (parsed) {
        parsed.sno = sno++;
        rows.push(parsed);
      }
    }
    return rows;
  } finally {
    await worker.terminate();
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
    if (!window.current || !window.current.id) { setMsg('Open a parchi first.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Reading photo...'; }
    setMsg('Loading OCR engine (first time takes ~10s)...');
    // Get the photo: prefer the already-uploaded file, else fetch from storage
    let blob = window._currentPhotoBlob;
    if (!blob && window.current.photo_url && window.sb) {
      setMsg('Downloading photo...');
      const { data } = await window.sb.storage.from('parchi-photos')
        .createSignedUrl(window.current.photo_url, 3600);
      if (!data?.signedUrl) throw new Error('Could not get photo URL.');
      const res = await fetch(data.signedUrl);
      blob = await res.blob();
    }
    if (!blob) throw new Error('No photo on this parchi. Upload a photo first, then tap Read Photo.');
    setMsg('Reading photo... this takes 10-30 seconds.');
    const kind = window.current.kind || 'silver';
    const rows = await readPhoto(blob, kind, p => {
      setMsg('Reading photo... ' + Math.round(p * 100) + '%');
    });
    if (!rows.length) {
      setMsg('No rows detected. Try a clearer, straighter photo with good light. You can still add rows manually with + Add Row.');
    } else {
      // Replace current rows with OCR results (user verifies before saving)
      window.rows = rows;
      if (typeof window.renderRows === 'function') window.renderRows();
      setMsg('Found ' + rows.length + ' rows. Check every row, fix any misreads, then tap Save.');
    }
  } catch (e) {
    setMsg('Photo read failed: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Read Photo'; }
  }
}

window.ParchiOCR = { readPhoto, parseSilverLine, parseGoldLine, readCurrentPhoto };
})();
