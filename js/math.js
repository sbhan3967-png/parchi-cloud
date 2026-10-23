/* Parchi Cloud - verification math (ported from the desktop Parchi Reader).
   Silver: Silver Wt = Net x (T+W)/100; wastage % = (T+W)-tunch.
   Gold:   Fine = N.Wt x Tunch/100; Calc = dia+stone+making vs Billed. */
'use strict';

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
};
const r2 = v => (v === null || v === undefined || isNaN(v)) ? null : Math.round(v * 100) / 100;
const r3 = v => (v === null || v === undefined || isNaN(v)) ? null : Math.round(v * 1000) / 1000;

// tunch from item name: last number 30-100; bigger than T+W => model number
function inferTunch(item, tw) {
  let flag = '';
  const ms = (item || '').match(/(\d+(?:\.\d+)?)/g) || [];
  let tunch = null;
  for (const m of ms) {
    const v = parseFloat(m);
    if (v >= 30 && v <= 100) tunch = v;
  }
  if (tunch !== null && tw !== null && tunch > tw) {
    flag = 'number in name bigger than T+W - treated as model no., tunch = T+W';
    tunch = tw;
  }
  return [tunch, flag];
}

function computeSilver(r, rateKg) {
  const rateG = (num(rateKg) || 205000) / 1000;
  const net = num(r.net), tw = num(r.tw);
  let tunch = num(r.tunch), flag = r.flag || '';
  if (tunch === null) {
    const [t, f] = inferTunch(r.item || '', tw);
    tunch = t; if (f) flag = flag ? flag + ' | ' + f : f;
  }
  if (tunch !== null && tunch > 100) flag += (flag ? ' | ' : '') + 'tunch > 100 impossible - confirm';
  const silver = (net !== null && tw !== null) ? net * tw / 100 : null;
  const wPct = (tw !== null && tunch !== null) ? tw - tunch : (tw === null ? 0 : null);
  const wRsg = wPct !== null ? wPct / 100 * rateG : null;
  const labour = num(r.labour_rs);
  const lRsg = (labour !== null && net) ? labour / net : null;
  const total = (wRsg !== null && lRsg !== null) ? wRsg + lRsg : null;
  const metalVal = silver !== null ? silver * rateG : null;
  const totalAmt = metalVal !== null ? metalVal + (labour || 0) : null;
  return { tunch: r2(tunch), silver_wt: r3(silver), wastage_pct: r2(wPct),
           wastage_rsg: r2(wRsg), labour_rs: r2(labour), labour_rsg: r2(lRsg),
           total_rsg: r2(total), total_amt: r2(totalAmt), flag };
}

function computeGold(r, rateKg) {
  const rateG = (num(rateKg) || 1300000) / 1000;
  let flag = r.flag || '';
  const nwt = num(r.nwt), tunch = num(r.tunch);
  const diaWt = num(r.dia_wt), diaRate = num(r.dia_rate);
  const stWt = num(r.st_wt), stRate = num(r.st_rate);
  const making = num(r.making), billed = num(r.billed);
  const fine = (nwt !== null && tunch !== null) ? nwt * tunch / 100 : null;
  const diaVal = (diaWt !== null && diaRate !== null) ? diaWt * diaRate : 0;
  const stVal = (stWt !== null && stRate !== null) ? stWt * stRate : 0;
  const makingVal = (making !== null && nwt !== null) ? making * nwt : null;
  const calc = makingVal !== null ? diaVal + stVal + makingVal : null;
  const diff = (billed !== null && calc !== null) ? billed - calc : null;
  if (diff !== null && Math.abs(diff) > 2)
    flag += (flag ? ' | ' : '') + 'billed differs by Rs ' + diff.toFixed(2);
  const metalVal = fine !== null ? fine * rateG : null;
  const grand = (metalVal !== null && makingVal !== null) ? metalVal + diaVal + stVal + makingVal : null;
  return { fine: r3(fine), dia_val: r2(diaVal), st_val: r2(stVal),
           making_val: r2(makingVal), calc_total: r2(calc), diff: r2(diff),
           total_amt: r2(grand), flag };
}

window.ParchiMath = { computeSilver, computeGold, num, r2, r3 };
