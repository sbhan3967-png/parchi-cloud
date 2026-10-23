/* Parchi Cloud - phone PWA. Supabase DB + Storage, camera upload. */
'use strict';
const { createClient } = window.supabase;
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
  sb = createClient(window.PARCHI_CONFIG.SUPABASE_URL, window.PARCHI_CONFIG.SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  user = data.session?.user || null;
  if (user) { enterApp(); } else { show('login'); }
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
  $('np-msg').textContent = 'Saving...';
  $('np-save').disabled = true;
  try {
    const { data: p, error } = await sb.from('parchis').insert({
      user_id: user.id, party_name: party,
      bill_no: $('np-billno').value.trim() || null,
      bill_date: $('np-date').value || null, kind,
      metal_rate: parseFloat($('np-rate').value) || null
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
  const { data: p } = await sb.from('parchis').select('*').eq('id', id).single();
  const { data: r } = await sb.from('parchi_rows').select('*').eq('parchi_id', id).order('sno');
  current = p; rows = r || [];
  let photoHtml = '';
  if (p.photo_url) {
    const { data: u } = await sb.storage.from('parchi-photos').createSignedUrl(p.photo_url, 3600);
    if (u?.signedUrl) photoHtml = `<img class="parchi-photo" src="${u.signedUrl}" onclick="window.open('${u.signedUrl}','_blank')">`;
  }
  $('detail-head').innerHTML = `
    <button class="link" onclick="enterApp()">← Back</button>
    <h2>${esc(p.party_name)}</h2>
    <div class="muted">${p.kind === 'gold' ? 'Gold-Diamond' : 'Silver'} · ${esc(p.bill_no || '')} ${p.bill_date ? '· ' + esc(p.bill_date) : ''}</div>
    <div class="rate-row">Metal rate Rs/kg: <input id="detail-rate" type="number" value="${p.metal_rate || ''}" onchange="onRateChange()"></div>
    ${photoHtml}`;
  renderRows();
}
async function onRateChange() {
  const v = parseFloat($('detail-rate').value) || null;
  await sb.from('parchis').update({ metal_rate: v }).eq('id', current.id);
  current.metal_rate = v; renderRows();
}
function calcRow(r) {
  const M = window.ParchiMath;
  return current.kind === 'gold' ? M.computeGold(r, current.metal_rate) : M.computeSilver(r, current.metal_rate);
}
function renderRows() {
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
    const inp = (f, v, w) => `<input data-i="${i}" data-f="${f}" value="${esc(v ?? '')}" style="width:${w || 64}px" onchange="onCell(this)">`;
    html += `<tr class="${c.flag ? 'flagged' : ''}"><td>${r.sno ?? i + 1}</td><td>${inp('item', r.item, 110)}</td>`;
    if (gold) {
      html += `<td>${inp('gwt', r.gwt)}</td><td>${inp('nwt', r.nwt)}</td><td>${inp('tunch', r.tunch)}</td>
        <td>${inp('dia_wt', r.dia_wt)}</td><td>${inp('dia_rate', r.dia_rate)}</td>
        <td>${inp('st_wt', r.st_wt)}</td><td>${inp('st_rate', r.st_rate)}</td>
        <td>${inp('making', r.making)}</td><td>${inp('billed', r.billed, 80)}</td>
        <td class="calc">${fmtN(c.calc_total)}</td><td class="calc ${c.diff ? 'diffbad' : ''}">${fmtN(c.diff)}</td>
        <td class="calc"><b>${fmtN(c.total_amt)}</b></td>`;
    } else {
      html += `<td>${inp('gwt', r.gwt)}</td><td>${inp('tunch', r.tunch)}</td>
        <td>${inp('net', r.net)}</td><td>${inp('tw', r.tw)}</td>
        <td class="calc">${fmtN(c.silver_wt, 3)}</td><td class="calc">${fmtN(c.wastage_pct)}</td>
        <td class="calc">${fmtN(c.wastage_rsg)}</td><td>${inp('labour_rs', r.labour_rs)}</td>
        <td class="calc">${fmtN(c.labour_rsg)}</td><td class="calc">${fmtN(c.total_rsg)}</td>
        <td class="calc"><b>${fmtN(c.total_amt)}</b></td>`;
    }
    html += `<td class="flagcell">${esc(c.flag || '')}</td>
      <td><button class="link danger" onclick="delRow(${i})">×</button></td></tr>`;
  });
  html += `</tbody></table></div>
    <div class="totalsbar">Grand Total Amt: <b>₹${grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</b>
    <button onclick="saveRows()">Save</button> <button onclick="addRow()">+ Add Row</button>
    <button class="danger" onclick="delParchi()">Delete Parchi</button></div>
    <div id="detail-msg" class="muted"></div>`;
  $('detail-body').innerHTML = html;
  current._grand = grandTotal;
}
async function onCell(el) {
  const i = +el.dataset.i, f = el.dataset.f;
  rows[i][f] = el.value.trim() === '' ? null : el.value.trim();
  renderRows();
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
  // upsert: delete removed, upsert rest
  const ids = rows.filter(r => r.id).map(r => r.id);
  const { data: existing } = await sb.from('parchi_rows').select('id').eq('parchi_id', current.id);
  for (const e of (existing || [])) if (!ids.includes(e.id)) await sb.from('parchi_rows').delete().eq('id', e.id);
  const { data, error } = await sb.from('parchi_rows').upsert(payload, { onConflict: 'id' }).select();
  if (error) { $('detail-msg').textContent = error.message; return; }
  rows = data.sort((a, b) => (a.sno || 0) - (b.sno || 0));
  await sb.from('parchis').update({ total_amt: current._grand || null, updated_at: new Date().toISOString() }).eq('id', current.id);
  $('detail-msg').textContent = 'Saved ✓';
  renderRows();
}
const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
async function delParchi() {
  if (!confirm('Delete this entire parchi?')) return;
  await sb.from('parchis').delete().eq('id', current.id);
  enterApp();
}

window.addEventListener('DOMContentLoaded', init);
