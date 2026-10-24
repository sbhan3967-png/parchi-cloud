/* Parchi Cloud - phone PWA. Supabase DB + Storage, camera upload. */
'use strict';
let sb = null, user = null, parchis = [], current = null, rows = [];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtN = (v, d=2) => (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(d);

function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + view).classList.add('active');
  window.scrollTo(0, 0);
}

/* ---------- auth ---------- */
async function init() {
  try {
    // Show login view early so the page is never blank, even if auth fails.
    var loginEl = document.getElementById('view-login');
    if (loginEl) loginEl.classList.add('active');
    if (!window.supabase) {
      document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif;"><h2>Could not load app libraries</h2><p>Check your internet connection and reload.</p></div>';
      return;
    }
    if (!window.PARCHI_CONFIG || !window.PARCHI_CONFIG.SUPABASE_URL || window.PARCHI_CONFIG.SUPABASE_URL.includes('YOUR-PROJECT')) {
      document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif;"><h2>App not configured</h2><p>Supabase keys missing. Contact support.</p></div>';
      return;
    }
    const { createClient } = window.supabase;
    sb = createClient(window.PARCHI_CONFIG.SUPABASE_URL, window.PARCHI_CONFIG.SUPABASE_ANON_KEY);
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    user = data.session?.user || null;
    if (user) { enterApp(); } else { show('login'); }
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif;"><h2>Error</h2><p>' + esc(e.message) + '</p></div>';
  }
}
async function doLogin(e) {
  e.preventDefault();
  const email = $('login-email').value.trim(), pw = $('login-pw').value;
  $('login-msg').textContent = 'Signing in...';
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  $('login-msg').textContent = error ? error.message : '';
  if (!error) { user = (await sb.auth.getUser()).data.user; enterApp(); }
}
async function doSignup() {
  const email = $('login-email').value.trim(), pw = $('login-pw').value;
  if (!email || pw.length < 6) { $('login-msg').textContent = 'Enter email + password (min 6 chars).'; return; }
  $('login-msg').textContent = 'Creating account...';
  const { error } = await sb.auth.signUp({ email, password: pw });
  $('login-msg').textContent = error ? error.message : 'Account created - you can sign in now.';
}
async function doLogout() { await sb.auth.signOut(); location.reload(); }

/* ---------- home / list ---------- */
async function enterApp() { show('home'); await loadParchis(); }
async function loadParchis() {
  $('home-list').innerHTML = '<p class="muted">Loading...</p>';
  const q = $('home-search').value.trim();
  let query = sb.from('parchis').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
  if (q) query = query.ilike('party_name', '%' + q + '%');
  const { data, error } = await query;
  if (error) { $('home-list').innerHTML = '<p class="err">' + esc(error.message) + '</p>'; return; }
  parchis = data;
  $('home-list').innerHTML = parchis.length ? parchis.map(p => `
    <div class="card" onclick="openParchi('${p.id}')">
      <div class="card-top"><b>${esc(p.party_name)}</b><span class="pill ${p.kind}">${p.kind === 'gold' ? 'Gold-Diamond' : 'Silver'}</span></div>
      <div class="muted">${esc(p.bill_no || '')} ${p.bill_date ? '· ' + esc(p.bill_date) : ''}</div>
      <div class="card-total">${p.total_amt != null ? '₹' + Number(p.total_amt).toLocaleString('en-IN', {maximumFractionDigits: 0}) : ''}</div>
    </div>`).join('') : '<p class="muted">No parchis yet. Tap + New Parchi.</p>';
}

/* ---------- new parchi ---------- */
let newPhotoFile = null;
function openNew() {
  $('np-party').value = ''; $('np-billno').value = '';
  $('np-date').value = new Date().toISOString().slice(0, 10);
  $('np-rate').value = '205000'; newPhotoFile = null;
  $('np-photo-name').textContent = 'No photo chosen';
  $('np-preview').src = ''; $('np-preview').style.display = 'none';
  document.querySelector('input[name="np-kind"][value="silver"]').checked = true;
  show('new');
}
function onPhotoChosen(input) {
  const f = input.files[0]; if (!f) return;
  newPhotoFile = f;
  $('np-photo-name').textContent = f.name + ' (' + Math.round(f.size / 1024) + ' KB)';
  const rd = new FileReader();
  rd.onload = e => { $('np-preview').src = e.target.result; $('np-preview').style.display = 'block'; };
  rd.readAsDataURL(f);
}
async function saveNewParchi() {
  const party = $('np-party').value.trim();
  if (!party) { $('np-msg').textContent = 'Enter party name.'; return; }
  const kind = document.querySelector('input[name="np-kind"]:checked').value;
  const billno = $('np-billno').value.trim() || null;
  $('np-msg').textContent = 'Checking for duplicates...';
  $('np-save').disabled = true;
  try {
    if (billno) {
      const { data: dupes } = await sb.from('parchis')
        .select('id,party_name,bill_no,bill_date').eq('party_name', party).eq('bill_no', billno).limit(3);
      if (dupes && dupes.length) {
        const list = dupes.map(p => `${p.party_name} | bill ${p.bill_no} | ${p.bill_date || ''}`).join('\n');
        if (!confirm('This looks like a parchi you already uploaded:\n\n' + list + '\n\nSave anyway?')) {
          $('np-msg').textContent = ''; $('np-save').disabled = false; return;
        }
      }
    }
    let phash = null;
    if (newPhotoFile) {
      const buf = await newPhotoFile.arrayBuffer();
      const h = await crypto.subtle.digest('SHA-256', buf);
      phash = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
      const { data: pdupes } = await sb.from('parchis')
        .select('id,party_name,bill_no,bill_date').eq('photo_hash', phash).limit(3);
      if (pdupes && pdupes.length) {
        const list = pdupes.map(p => `${p.party_name} | bill ${p.bill_no || ''} | ${p.bill_date || ''}`).join('\n');
        if (!confirm('This exact photo was already uploaded as:\n\n' + list + '\n\nSave anyway?')) {
          $('np-msg').textContent = ''; $('np-save').disabled = false; return;
        }
      }
    }
    $('np-msg').textContent = 'Saving...';
    const { data: p, error } = await sb.from('parchis').insert({
      user_id: user.id, party_name: party,
      bill_no: billno,
      bill_date: $('np-date').value || null, kind,
      metal_rate: parseFloat($('np-rate').value) || null,
      photo_hash: phash
    }).select().single();
    if (error) throw error;
    if (newPhotoFile) {
      const ext = (newPhotoFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = user.id + '/' + p.id + '.' + ext;
      const { error: upErr } = await sb.storage.from('parchi-photos').upload(path, newPhotoFile, { upsert: true });
      if (upErr) throw upErr;
      await sb.from('parchis').update({ photo_url: path }).eq('id', p.id);
    }
    $('np-msg').textContent = '';
    openParchi(p.id);
  } catch (e) { $('np-msg').textContent = e.message; }
  $('np-save').disabled = false;
}

/* ---------- detail / rows ---------- */
async function openParchi(id) {
  show('detail');
  $('detail-body').innerHTML = '<p class="muted">Loading...</p>';
  try {
    const { data: p, error: pErr } = await sb.from('parchis').select('*').eq('id', id).single();
    if (pErr) throw new Error('Could not load parchi: ' + pErr.message);
    if (!p) throw new Error('Parchi not found.');
    const { data: r } = await sb.from('parchi_rows').select('*').eq('parchi_id', id).order('sno');
    current = p; rows = r || [];
    if (!rows || rows.length === 0) {
      rows = [
        { parchi_id: p.id, sno: 1, item: '' },
        { parchi_id: p.id, sno: 2, item: '' },
        { parchi_id: p.id, sno: 3, item: '' }
      ];
    }
    let photoHtml = '';
    if (p.photo_url) {
      const { data: u } = await sb.storage.from('parchi-photos').createSignedUrl(p.photo_url, 3600);
      if (u?.signedUrl) {
        photoHtml = `
        <div class="photo-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:13px;font-weight:600;color:#666">📷 Bill Photo (tap to view full)</span>
            <button class="link" type="button" onclick="togglePhoto(this)">Hide Photo</button>
          </div>
          <img id="detail-img" class="parchi-photo" src="${u.signedUrl}" onclick="window.open('${u.signedUrl}','_blank')">
        </div>`;
      }
    }
    $('detail-head').innerHTML = `
    <button class="link" onclick="enterApp()">← Back</button>
    <h2>${esc(p.party_name)}</h2>
    <div class="muted">${p.kind === 'gold' ? 'Gold-Diamond' : 'Silver'} · ${esc(p.bill_no || '')} ${p.bill_date ? '· ' + esc(p.bill_date) : ''}</div>
    <div class="rate-row">Metal rate Rs/kg: <input id="detail-rate" type="number" value="${p.metal_rate || ''}" onchange="onRateChange()"></div>
    ${photoHtml}`;
    renderRows();
  } catch (e) {
    $('detail-body').innerHTML = '<p class="err">' + esc(e.message) + '</p><button class="link" onclick="enterApp()">← Back</button>';
  }
}
function togglePhoto(btn) {
  const img = $('detail-img');
  if (!img) return;
  const isHidden = img.style.display === 'none';
  img.style.display = isHidden ? 'block' : 'none';
  btn.textContent = isHidden ? 'Hide Photo' : 'Show Photo';
}
async function onRateChange() {
  const v = parseFloat($('detail-rate').value) || null;
  await sb.from('parchis').update({ metal_rate: v }).eq('id', current.id);
  current.metal_rate = v; renderRows();
}
function calcRow(r) {
  try {
    const M = window.ParchiMath;
    return current.kind === 'gold' ? M.computeGold(r, current.metal_rate) : M.computeSilver(r, current.metal_rate);
  } catch (e) {
    return { flag: 'calc error: ' + e.message };
  }
}
function renderRows() {
  try {
    if (!window.ParchiMath) throw new Error('Calculation engine (math.js) did not load. Check your connection and reload.');
    if (!current) throw new Error('No parchi selected.');
    const gold = current.kind === 'gold';
    let html = `<div class="tbl-wrap"><table class="rows"><thead><tr>
    <th>#</th><th>Item</th>${gold
      ? '<th>G.Wt</th><th>N.Wt</th><th>Tunch</th><th>Dia Wt</th><th>Dia Rate</th><th>St Wt</th><th>St Rate</th><th>Mk/g</th><th>Billed</th><th>Calc</th><th>Diff</th><th>Total Amt</th>'
      : '<th>G.Wt</th><th>Tunch</th><th>Net</th><th>T+W</th><th>Silver Wt</th><th>Wst%</th><th>Wst Rs/g</th><th>Lab Rs</th><th>Lab Rs/g</th><th>Total Rs/g</th><th>Total Amt</th>'}
    <th>Flag</th><th></th></tr></thead><tbody>`;
    let grandTotal = 0;
    rows.forEach((r, i) => {
      const c = calcRow(r);
      r._c = c;
      if (c.total_amt != null) grandTotal += c.total_amt;
      const inp = (f, v, w) => `<input data-i="${i}" data-f="${f}" value="${esc(v ?? '')}" style="width:${w || 64}px" oninput="onCell(this)">`;
      html += `<tr data-row="${i}" class="${c.flag ? 'flagged' : ''}"><td>${r.sno ?? i + 1}</td><td>${inp('item', r.item, 110)}</td>`;
      if (gold) {
        html += `<td>${inp('gwt', r.gwt)}</td><td>${inp('nwt', r.nwt)}</td><td>${inp('tunch', r.tunch)}</td>
        <td>${inp('dia_wt', r.dia_wt)}</td><td>${inp('dia_rate', r.dia_rate)}</td>
        <td>${inp('st_wt', r.st_wt)}</td><td>${inp('st_rate', r.st_rate)}</td>
        <td>${inp('making', r.making)}</td><td>${inp('billed', r.billed, 80)}</td>
        <td class="calc c-calc_total">${fmtN(c.calc_total)}</td><td class="calc c-diff ${c.diff ? 'diffbad' : ''}">${fmtN(c.diff)}</td>
        <td class="calc c-total_amt"><b>${fmtN(c.total_amt)}</b></td>`;
      } else {
        html += `<td>${inp('gwt', r.gwt)}</td><td>${inp('tunch', r.tunch)}</td>
        <td>${inp('net', r.net)}</td><td>${inp('tw', r.tw)}</td>
        <td class="calc c-silver_wt">${fmtN(c.silver_wt, 3)}</td><td class="calc c-wastage_pct">${fmtN(c.wastage_pct)}</td>
        <td class="calc c-wastage_rsg">${fmtN(c.wastage_rsg)}</td><td>${inp('labour_rs', r.labour_rs)}</td>
        <td class="calc c-labour_rsg">${fmtN(c.labour_rsg)}</td><td class="calc c-total_rsg">${fmtN(c.total_rsg)}</td>
        <td class="calc c-total_amt"><b>${fmtN(c.total_amt)}</b></td>`;
      }
      html += `<td class="flagcell c-flag">${esc(c.flag || '')}</td>
      <td><button class="link danger" onclick="delRow(${i})">×</button></td></tr>`;
    });
    html += `</tbody></table></div>
    <div class="totalsbar">Grand Total Amt: <b id="grand-total-val">₹${grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</b>
    <button onclick="saveRows()">Save</button> <button onclick="addRow()">+ Add Row</button>
    <button class="danger" onclick="delParchi()">Delete Parchi</button></div>
    ${rows.length === 0 ? '<p style="background:#fff8e1;padding:12px;border-radius:8px;margin-top:10px">No items yet. Tap <b>+ Add Row</b> below to add your first item, then fill in the weights — Silver Wt and Total Amt will calculate automatically.</p>' : ''}
    <div id="detail-msg" class="muted"></div>`;
    $('detail-body').innerHTML = html;
    current._grand = grandTotal;
  } catch (e) {
    $('detail-body').innerHTML = '<p class="err">' + esc(e.message) + '</p><button onclick="renderRows()">Retry</button>';
  }
}
function updateRowCalcs(i) {
  const r = rows[i];
  const c = calcRow(r);
  r._c = c;
  const tr = document.querySelector(`tr[data-row="${i}"]`);
  if (!tr) return;
  if (c.flag) {
    tr.classList.add('flagged');
  } else {
    tr.classList.remove('flagged');
  }
  const setCell = (cls, val, isBold = false) => {
    const el = tr.querySelector('.' + cls);
    if (el) {
      if (isBold) el.innerHTML = `<b>${val}</b>`;
      else el.textContent = val;
    }
  };
  if (current.kind === 'gold') {
    setCell('c-calc_total', fmtN(c.calc_total));
    const diffEl = tr.querySelector('.c-diff');
    if (diffEl) {
      diffEl.textContent = fmtN(c.diff);
      diffEl.className = 'calc c-diff ' + (c.diff ? 'diffbad' : '');
    }
    setCell('c-total_amt', fmtN(c.total_amt), true);
  } else {
    setCell('c-silver_wt', fmtN(c.silver_wt, 3));
    setCell('c-wastage_pct', fmtN(c.wastage_pct));
    setCell('c-wastage_rsg', fmtN(c.wastage_rsg));
    setCell('c-labour_rsg', fmtN(c.labour_rsg));
    setCell('c-total_rsg', fmtN(c.total_rsg));
    setCell('c-total_amt', fmtN(c.total_amt), true);
  }
  setCell('c-flag', c.flag || '');
  let grand = 0;
  rows.forEach(row => {
    const rc = row._c || calcRow(row);
    if (rc.total_amt != null) grand += rc.total_amt;
  });
  current._grand = grand;
  const gt = document.getElementById('grand-total-val');
  if (gt) gt.textContent = '₹' + grand.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function onCell(el) {
  const i = +el.dataset.i, f = el.dataset.f;
  const val = el.value.trim() === '' ? null : el.value.trim();
  rows[i][f] = val;
  if (current.kind !== 'gold' && f === 'gwt' && (!rows[i].net || rows[i].net === '')) {
    rows[i].net = val;
    const netInp = document.querySelector(`input[data-i="${i}"][data-f="net"]`);
    if (netInp && (!netInp.value || netInp.value === '')) netInp.value = val || '';
  }
  if (current.kind === 'gold' && f === 'gwt' && (!rows[i].nwt || rows[i].nwt === '')) {
    rows[i].nwt = val;
    const nwtInp = document.querySelector(`input[data-i="${i}"][data-f="nwt"]`);
    if (nwtInp && (!nwtInp.value || nwtInp.value === '')) nwtInp.value = val || '';
  }
  updateRowCalcs(i);
}
function addRow() {
  const sno = rows.length ? Math.max(...rows.map(r => r.sno || 0)) + 1 : 1;
  rows.push({ parchi_id: current.id, sno, item: '' });
  renderRows();
}
async function delRow(i) {
  if (!confirm('Delete this row?')) return;
  const r = rows[i];
  if (r.id) await sb.from('parchi_rows').delete().eq('id', r.id);
  rows.splice(i, 1); renderRows();
}
function contentHash(rows, kind) {
  const parts = rows.map(r => {
    const c = r._c || {};
    const f3 = v => { const n = parseFloat(v); return isNaN(n) ? '' : n.toFixed(3); };
    if (kind === 'gold') return [r.item, r.gwt, r.nwt, r.tunch, r.dia_wt, r.dia_rate, r.st_wt, r.st_rate, r.making, r.billed].map(v => String(v ?? '').trim().toLowerCase()).join('|');
    return [r.item, r.gwt, r.tunch, r.net, r.tw, r.labour_rs, c.wastage_pct, c.labour_rsg].map(v => String(v ?? '').trim().toLowerCase()).join('|');
  }).sort().join('\n');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < parts.length; i++) { h1 = (h1 ^ parts.charCodeAt(i)) * 0x01000193 >>> 0; h2 = (h2 ^ parts.charCodeAt(parts.length - 1 - i)) * 0x01000193 >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
async function saveRows() {
  $('detail-msg').textContent = 'Saving...';
  const payload = rows.map((r, i) => {
    const c = r._c || {};
    const base = { parchi_id: current.id, sno: r.sno ?? i + 1, item: r.item || null,
      gwt: num(r.gwt), flag: c.flag || null };
    const gold = current.kind === 'gold';
    const full = gold ? { ...base, nwt: num(r.nwt), tunch: num(r.tunch),
        dia_wt: num(r.dia_wt), dia_rate: num(r.dia_rate), st_wt: num(r.st_wt), st_rate: num(r.st_rate),
        making: num(r.making), billed: num(r.billed), calc_total: c.calc_total, diff: c.diff, total_amt: c.total_amt }
      : { ...base, tunch: c.tunch, net: num(r.net), tw: num(r.tw), silver_wt: c.silver_wt,
        wastage_pct: c.wastage_pct, wastage_rsg: c.wastage_rsg, labour_rs: c.labour_rs,
        labour_rsg: c.labour_rsg, total_rsg: c.total_rsg, total_amt: c.total_amt };
    if (r.id) full.id = r.id;
    return full;
  });
  const ids = rows.filter(r => r.id).map(r => r.id);
  const { data: existing } = await sb.from('parchi_rows').select('id').eq('parchi_id', current.id);
  for (const e of (existing || [])) if (!ids.includes(e.id)) await sb.from('parchi_rows').delete().eq('id', e.id);
  const { data, error } = await sb.from('parchi_rows').upsert(payload, { onConflict: 'id' }).select();
  if (error) { $('detail-msg').textContent = error.message; return; }
  rows = data.sort((a, b) => (a.sno || 0) - (b.sno || 0));
  const chash = contentHash(rows, current.kind);
  const { data: cdupes } = await sb.from('parchis')
    .select('id,party_name,bill_no,bill_date').eq('content_hash', chash).neq('id', current.id).limit(3);
  if (cdupes && cdupes.length) {
    const list = cdupes.map(p => `${p.party_name} | bill ${p.bill_no || ''} | ${p.bill_date || ''}`).join('\n');
    $('detail-msg').textContent = 'Saved ✓ (note: same content as:\n' + list + ')';
  } else {
    $('detail-msg').textContent = 'Saved ✓';
  }
  await sb.from('parchis').update({ total_amt: current._grand || null, content_hash: chash, updated_at: new Date().toISOString() }).eq('id', current.id);
  renderRows();
}
/* num() is defined in math.js - do not redeclare here */
async function delParchi() {
  if (!confirm('Delete this entire parchi?')) return;
  await sb.from('parchis').delete().eq('id', current.id);
  enterApp();
}

async function startAppSafely() {
  try {
    await init();
  } catch (error) {
    var pre = document.createElement('pre');
    pre.id = 'fatal-error';
    pre.style.cssText = 'background:#fee;color:#900;padding:16px;white-space:pre-wrap;z-index:999999;position:relative';
    pre.textContent = 'Init failed: ' + (error && error.stack || error && error.message || String(error));
    document.body.insertAdjacentElement('afterbegin', pre);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startAppSafely, { once: true });
} else {
  startAppSafely();
}
