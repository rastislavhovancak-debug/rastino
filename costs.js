// ============================================================
// COSTS VIEW SWITCHER
// ============================================================
function switchCostsView(v) {
  ['costs-salaries', 'costs-ctc', 'costs-overhead', 'costs-devcosts'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('costs-' + v);
  if (el) el.style.display = '';
  document.getElementById('btn-costs-salaries')?.classList.toggle('active', v === 'salaries');
  document.getElementById('btn-costs-ctc')?.classList.toggle('active', v === 'ctc');
  document.getElementById('btn-costs-overhead')?.classList.toggle('active', v === 'overhead');
  document.getElementById('btn-costs-devcosts')?.classList.toggle('active', v === 'devcosts');
  if (v === 'salaries') renderSalaries();
  if (v === 'ctc') renderCtc();
  if (v === 'overhead') renderOverhead();
  if (v === 'devcosts') renderDevCosts();
}

// ── Shared helper ────────────────────────────────────────────────────────
// Returns developers who were on the project (project_start/project_end) in the given year/month
// Falls back to assignment dates if project_start not set
// If showAll=true, also includes active developers with no project dates
function getActiveDevsSorted(teamFilter, year, month, showAll) {
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  const yr = year || 2026;
  const periodStart = month ? new Date(yr, month - 1, 1) : new Date(yr, 0, 1);
  const periodEnd = month ? new Date(yr, month, 0) : new Date(yr, 11, 31);

  let devs = developers.filter(d => {
    // Use project_start/project_end if available
    if (d.project_start) {
      const ps = new Date(d.project_start);
      const pe = d.project_end ? new Date(d.project_end) : new Date('2099-12-31');
      return ps <= periodEnd && pe >= periodStart;
    }
    // Fallback: use assignment dates
    const hasAssignment = (d.assignments||[]).some(a => {
      if (!allTeams.includes(a.team)) return false;
      const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
      const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
      return s <= periodEnd && e >= periodStart;
    });
    if (hasAssignment) return true;
    // showAll: also include active devs with no project dates or assignments
    if (showAll && d.status === 'active') return true;
    return false;
  });

  if (teamFilter) devs = devs.filter(d =>
    (d.assignments||[]).some(a => a.team === teamFilter)
  );

  devs = sortDevsByOrder(devs);
  return devs;
}

// Helper: check if developer is on project for given month
function isDevOnProject(dev, year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  if (dev.project_start) {
    const ps = new Date(dev.project_start);
    const pe = dev.project_end ? new Date(dev.project_end) : new Date('2099-12-31');
    return ps <= monthEnd && pe >= monthStart;
  }
  // Fallback: has any assignment in that month
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  return (dev.assignments||[]).some(a => {
    if (!allTeams.includes(a.team)) return false;
    const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
    const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
    return s <= monthEnd && e >= monthStart;
  });
}

// ============================================================
// SALARIES
// ============================================================
let salariesData = []; // [{id, developer_id, year, month, salary}]
let editingSalaryKey = null; // {devId, year, month}

async function loadSalaries() {
  const { data, error } = await db.from('salaries').select('*').eq('year', 2026);
  if (error) { console.error('loadSalaries:', error); return; }
  salariesData = data || [];
}

function getSalary(devId, year, month) {
  return salariesData.find(s => s.developer_id === devId && s.year === year && s.month === month);
}

function populateSalariesTeamFilter() {
  const sel = document.getElementById('salaries-team');
  if (!sel) return;
  const cur = sel.value;
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  sel.innerHTML = '<option value="">All teams</option>' +
    allTeams.map(t => `<option value="${t}"${t===cur?' selected':''}>${t}</option>`).join('');
}

function renderSalaries() {
  populateSalariesTeamFilter();
  const body = document.getElementById('salaries-body');
  if (!body) return;
  const year = parseInt(document.getElementById('salaries-year')?.value) || 2026;
  const teamFilter = document.getElementById('salaries-team')?.value || '';

  const showAll = document.getElementById('salaries-show-all')?.checked;
  let devs = getActiveDevsSorted(teamFilter, year, null, showAll);
  if (!devs.length) { body.innerHTML = '<tr><td colspan="15" class="empty">No developers found</td></tr>'; return; }

  body.innerHTML = devs.map(d => {
    const loc = locations.find(l => l.id === d.location_id);
    const locName = loc ? loc.name : '—';
    const isContractor = d.workertype === 'Contractor';
    const label = isContractor ? 'CTR' : 'FTE';

    const cells = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
      const s = getSalary(d.id, year, m);
      const val = s?.salary;
      const bg = val != null ? 'background:var(--green-lt)' : '';
      const color = val != null ? 'color:var(--green)' : 'color:var(--text-3)';
      const curr = s?.currency || 'EUR';
      const sym = curr === 'EUR' ? '€' : curr === 'INR' ? '₹' : curr === 'RON' ? 'R' : curr;
      const text = val != null ? sym + val.toLocaleString('de-DE',{maximumFractionDigits:0}) : '+';
      return `<td style="text-align:center;padding:4px 2px;cursor:pointer;${bg}" onclick="openSalaryModal(${d.id},${year},${m})">
        <span style="font-size:11px;font-weight:500;${color}">${text}</span>
      </td>`;
    }).join('');

    return `<tr>
      <td style="padding:6px 10px;font-weight:500;position:sticky;left:0;background:var(--surface);white-space:nowrap">${d.firstname} ${d.lastname}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-2)">${locName}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-2)">${label}</td>
      ${cells}
    </tr>`;
  }).join('');
}

function openSalaryModal(devId, year, month) {
  const dev = developers.find(d => d.id === devId);
  if (!dev) return;
  const isContractor = dev.workertype === 'Contractor';
  const s = getSalary(devId, year, month);
  editingSalaryKey = { devId, year, month };

  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const loc = locations.find(l => l.id === dev.location_id);
  document.getElementById('salary-modal-title').textContent = `${dev.firstname} ${dev.lastname} — ${MTH[month-1]} ${year}`;
  document.getElementById('salary-modal-info').textContent = `${loc?.name||'—'} · ${isContractor ? 'Contractor (daily rate)' : 'FTE (monthly salary)'}`;
  document.getElementById('salary-field-label').textContent = isContractor ? 'Daily rate (/day)' : 'Monthly salary';
  document.getElementById('salary-currency').value = s?.currency || 'EUR';
  document.getElementById('salary-currency').style.display = '';
  document.getElementById('salary-value').value = s?.salary ?? '';
  document.getElementById('salary-apply-all').checked = false;
  document.getElementById('salary-btn-delete').style.display = s ? '' : 'none';
  // Warn if outside project period
  const onProj = isDevOnProject(dev, year, month);
  const warnEl = document.getElementById('salary-modal-warning');
  if (warnEl) {
    if (!onProj) {
      const MTH2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      warnEl.textContent = `⚠ ${dev.firstname} ${dev.lastname} is not on the project in ${MTH2[month-1]} ${year}`;
      warnEl.style.display = '';
    } else {
      warnEl.style.display = 'none';
    }
  }
  document.getElementById('salary-modal').classList.add('open');
  setTimeout(() => document.getElementById('salary-value').focus(), 100);
}

async function saveSalary() {
  const key = editingSalaryKey;
  if (!key) return;
  const val = document.getElementById('salary-value').value;
  if (val === '') { showToast('Enter a value'); return; }
  const salary = parseFloat(val);
  const currency = document.getElementById('salary-currency').value || 'EUR';
  const applyAll = document.getElementById('salary-apply-all').checked;
  const months = applyAll ? Array.from({length: 12 - key.month + 1}, (_, i) => key.month + i) : [key.month];

  for (const m of months) {
    const row = { developer_id: key.devId, year: key.year, month: m, salary, currency };
    const { error } = await db.from('salaries').upsert(row, { onConflict: 'developer_id,year,month' });
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = salariesData.findIndex(s => s.developer_id===key.devId && s.year===key.year && s.month===m);
    if (idx >= 0) salariesData[idx] = { ...salariesData[idx], ...row };
    else salariesData.push({ ...row, id: 'local_' + Date.now() + m });
  }
  closeModal('salary-modal');
  renderSalaries();
  showToast(applyAll ? 'Saved for all months' : 'Saved');
}

async function deleteSalary() {
  const key = editingSalaryKey;
  if (!key || !confirm('Delete salary for this month?')) return;
  await db.from('salaries').delete().eq('developer_id', key.devId).eq('year', key.year).eq('month', key.month);
  salariesData = salariesData.filter(s => !(s.developer_id===key.devId && s.year===key.year && s.month===key.month));
  closeModal('salary-modal');
  renderSalaries();
  showToast('Deleted');
}

// ============================================================
// COST TO CENTER (CTC)
// ============================================================
let ctcContractorDays = 20; // working days per month for contractor CTC calculation

let ctcData = []; // [{id, developer_id, year, month, amount}]
let editingCtcKey = null;

async function loadCtc() {
  const { data, error } = await db.from('cost_to_center').select('*').eq('year', 2026);
  if (error) { console.error('loadCtc:', error); return; }
  ctcData = data || [];
}

function getCtc(devId, year, month) {
  return ctcData.find(c => c.developer_id === devId && c.year === year && c.month === month);
}

function populateCtcTeamFilter() {
  const sel = document.getElementById('ctc-team');
  if (!sel) return;
  const cur = sel.value;
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  sel.innerHTML = '<option value="">All teams</option>' +
    allTeams.map(t => `<option value="${t}"${t===cur?' selected':''}>${t}</option>`).join('');
}

// CTC formulas per location
const CTC_FORMULAS = {
  'Slovakia':          { multiplier: 1.367, label: 'salary × 1.367' },
  'Romania':           { multiplier: 1.028, label: 'salary × 1.028' },
  'India Pune':        { multiplier: 1.000, label: 'salary → EUR (×1.0)' },
  'India Bangalore':   { multiplier: 1.000, label: 'salary → EUR (×1.0)' },
  'India':             { multiplier: 1.000, label: 'salary → EUR (×1.0)' },
};

function calcCtcForDev(dev, month, year) {
  // Returns { ctc, formula, canCalculate }
  const isContractor = dev.workertype === 'Contractor';
  if (isContractor) {
    const sal = getSalary(dev.id, year, month);
    if (!sal?.salary) return { ctc: null, formula: 'Contractor — daily rate missing', canCalculate: false };
    const currency = sal.currency || 'EUR';
    const dailyRateEur = currency === 'EUR' ? sal.salary : convertToEur(sal.salary, currency, month);
    if (!dailyRateEur) return { ctc: null, formula: 'Contractor — currency conversion failed', canCalculate: false };
    const ctc = dailyRateEur * ctcContractorDays;
    const currLabel = currency === 'EUR' ? `€${sal.salary}` : `${currency} ${sal.salary} → €${dailyRateEur.toFixed(2)}`;
    return {
      ctc,
      formula: `${currLabel}/day × ${ctcContractorDays} days = €${ctc.toFixed(2)}`,
      canCalculate: true
    };
  }

  const loc = locations.find(l => l.id === dev.location_id);
  const locName = loc?.name || '';
  const formula = CTC_FORMULAS[locName];

  if (!formula) return { ctc: null, formula: 'No formula defined for ' + (locName||'this location'), canCalculate: false };

  const sal = getSalary(dev.id, year, month);
  if (!sal?.salary) return { ctc: null, formula: formula.label + ' — salary missing', canCalculate: false };

  // Convert salary to EUR if needed
  const currency = sal.currency || 'EUR';
  const salaryEur = currency === 'EUR' ? sal.salary : convertToEur(sal.salary, currency, month);
  if (!salaryEur) return { ctc: null, formula: formula.label + ' — currency conversion failed', canCalculate: false };

  const ctc = salaryEur * formula.multiplier;
  return {
    ctc,
    formula: currency === 'EUR'
      ? formula.label + ' = ' + sal.salary + ' × ' + formula.multiplier
      : currency + ' ' + sal.salary + ' → €' + salaryEur.toFixed(2) + ' × ' + formula.multiplier,
    canCalculate: true
  };
}

function renderCtc() {
  // Sync days selector
  const daysEl = document.getElementById('ctc-contractor-days');
  if (daysEl) ctcContractorDays = parseInt(daysEl.value) || 20;
  populateCtcTeamFilter();
  const body = document.getElementById('ctc-body');
  if (!body) return;
  const year = parseInt(document.getElementById('ctc-year')?.value) || 2026;
  const teamFilter = document.getElementById('ctc-team')?.value || '';

  const showAllCtc = document.getElementById('ctc-show-all')?.checked;
  let devs = getActiveDevsSorted(teamFilter, year, null, showAllCtc);
  if (!devs.length) { body.innerHTML = '<tr><td colspan="16" class="empty">No developers found</td></tr>'; return; }

  body.innerHTML = devs.map(d => {
    const loc = locations.find(l => l.id === d.location_id);
    const locName = loc?.name || '—';
    const isContractor = d.workertype === 'Contractor';

    const cells = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
      const c = getCtc(d.id, year, m);
      const val = c?.amount;
      const isManual = c?.is_manual;
      const onProject = isDevOnProject(d, year, m);
      let bg = '', color = 'color:var(--text-3)', text = '+', cursor = 'pointer', title = '';
      if (!onProject) {
        bg = 'background:var(--bg)'; color = 'color:var(--text-3)'; text = '—';
        cursor = 'default'; title = 'Not on project this month';
      } else if (val != null) {
        bg = isManual ? 'background:#fff8e1' : 'background:var(--green-lt)';
        color = isManual ? 'color:var(--amber)' : 'color:var(--green)';
        text = '€' + Math.round(val).toLocaleString('de-DE');
        title = isManual ? 'Manual entry' : 'Calculated';
      }
      return `<td style="text-align:center;padding:4px 2px;cursor:${cursor};${bg}" ${onProject?`onclick="openCtcModal(${d.id},${year},${m})"`:''}  title="${title}">
        <span style="font-size:11px;font-weight:500;${color}">${text}</span>
      </td>`;
    }).join('');

    const hasFormula = !!CTC_FORMULAS[locName] && !isContractor;
    const calcBtn = (hasFormula || isContractor)
      ? `<td style="padding:4px 6px"><button class="btn" style="font-size:11px;padding:2px 8px" onclick="openCtcCalcModal(${d.id},${year})">⚡ Calc</button></td>`
      : `<td style="padding:4px 6px"></td>`;

    return `<tr>
      <td style="padding:6px 10px;font-weight:500;position:sticky;left:0;background:var(--surface);min-width:200px">${d.firstname} ${d.lastname}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-2)">${locName}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-2)">${isContractor?'CTR':'FTE'}</td>
      ${calcBtn}
      ${cells}
    </tr>`;
  }).join('');
}

async function recalcAllContractors() {
  const days = parseInt(document.getElementById('ctc-contractor-days')?.value) || 20;
  const year = parseInt(document.getElementById('ctc-year')?.value) || 2026;

  if (!confirm(`Recalculate CTC for all contractors with ${days} days for all of ${year}?`)) return;

  const contractors = developers.filter(d => d.workertype === 'Contractor');
  if (!contractors.length) { showToast('No contractors found'); return; }

  ctcContractorDays = days;

  let updated = 0;
  for (const dev of contractors) {
    for (let m = 1; m <= 12; m++) {
      const result = calcCtcForDev(dev, m, year);
      if (!result.canCalculate) continue;
      const amount = Math.round(result.ctc * 100) / 100;
      const row = { developer_id: dev.id, year, month: m, amount, is_manual: false };
      const { error } = await db.from('cost_to_center').upsert(row, { onConflict: 'developer_id,year,month' });
      if (error) { showToast('Error: ' + error.message); return; }
      const idx = ctcData.findIndex(c => c.developer_id === dev.id && c.year === year && c.month === m);
      if (idx >= 0) ctcData[idx] = { ...ctcData[idx], ...row };
      else ctcData.push({ ...row, id: 'local_' + Date.now() + m });
      updated++;
    }
  }

  renderCtc();
  showToast(`Updated ${updated} contractor CTC entries`);
}

function openCtcCalcModal(devId, year) {
  const dev = developers.find(d => d.id === devId);
  if (!dev) return;
  editingCtcKey = { devId, year, month: null };

  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const loc = locations.find(l => l.id === dev.location_id);

  document.getElementById('ctc-calc-title').textContent = dev.firstname + ' ' + dev.lastname;
  document.getElementById('ctc-calc-info').textContent = (loc?.name||'—') + ' · ' + (dev.workertype||'FTE');

  // Default to current month
  const curMonth = new Date().getMonth() + 1;
  document.getElementById('ctc-calc-month').value = curMonth;
  updateCtcCalcPreview(devId, year);

  document.getElementById('ctc-calc-modal').classList.add('open');
}

function updateCtcCalcPreview(devId, year) {
  const month = parseInt(document.getElementById('ctc-calc-month')?.value) || 1;
  const dev = developers.find(d => d.id === devId);
  if (!dev) return;

  const isContractor = dev.workertype === 'Contractor';
  const previewEl = document.getElementById('ctc-calc-preview');
  const applyBtn = document.getElementById('ctc-calc-apply-btn');
  const valueEl = document.getElementById('ctc-calc-value');
  const manualRow = document.getElementById('ctc-calc-manual-row');

  if (isContractor) {
    const sal = getSalary(dev.id, year, month);
    const rate = sal?.salary;
    const currency = sal?.currency || 'EUR';
    const sym = currency === 'EUR' ? '€' : currency === 'INR' ? '₹' : currency === 'RON' ? 'R' : currency;
    document.getElementById('ctc-calc-formula').textContent = rate
      ? `Daily rate from Salaries: ${sym}${rate}/day (${currency})`
      : 'No daily rate found in Salaries for this month';
    if (rate) {
      previewEl.style.background = 'var(--green-lt)';
      previewEl.style.color = 'var(--green)';
      valueEl.textContent = sym + rate.toFixed(2) + '/day';
      applyBtn.disabled = false;
      if (manualRow) manualRow.style.display = 'none';
    } else {
      previewEl.style.background = '#fff0f0';
      previewEl.style.color = 'var(--red)';
      valueEl.textContent = '—';
      applyBtn.disabled = true;
    }
    return;
  }

  // FTE formula
  const result = calcCtcForDev(dev, month, year);
  document.getElementById('ctc-calc-formula').textContent = result.formula;
  if (manualRow) manualRow.style.display = 'none';

  if (result.canCalculate) {
    previewEl.style.background = 'var(--green-lt)';
    previewEl.style.color = 'var(--green)';
    valueEl.textContent = '€' + result.ctc.toFixed(2);
    applyBtn.disabled = false;
  } else {
    previewEl.style.background = '#fff0f0';
    previewEl.style.color = 'var(--red)';
    valueEl.textContent = '—';
    applyBtn.disabled = true;
  }
}

async function applyCtcCalc() {
  const key = editingCtcKey;
  if (!key) return;
  const month = parseInt(document.getElementById('ctc-calc-month')?.value) || 1;
  const applyAll = document.getElementById('ctc-calc-apply-all').checked;
  const dev = developers.find(d => d.id === key.devId);
  if (!dev) return;
  const isContractor = dev.workertype === 'Contractor';

  const months = applyAll
    ? Array.from({length: 12 - month + 1}, (_, i) => month + i)
    : [month];

  for (const m of months) {
    let amount;
    if (isContractor) {
      const result = calcCtcForDev(dev, m, key.year);
      if (!result.canCalculate) { showToast('Cannot calculate for month ' + m + ' — check salary data'); return; }
      amount = Math.round(result.ctc * 100) / 100;
    } else {
      const result = calcCtcForDev(dev, m, key.year);
      if (!result.canCalculate) { showToast('Cannot calculate for month ' + m + ' — check salary data'); return; }
      amount = Math.round(result.ctc * 100) / 100;
    }
    const row = { developer_id: key.devId, year: key.year, month: m, amount, is_manual: false };
    const { error } = await db.from('cost_to_center').upsert(row, { onConflict: 'developer_id,year,month' });
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = ctcData.findIndex(c => c.developer_id===key.devId && c.year===key.year && c.month===m);
    if (idx >= 0) ctcData[idx] = { ...ctcData[idx], ...row };
    else ctcData.push({ ...row, id: 'local_' + Date.now() + m });
  }

  closeModal('ctc-calc-modal');
  renderCtc();
  showToast(applyAll ? 'Saved till end of year' : 'Saved');
}

function openCtcModal(devId, year, month) {
  const dev = developers.find(d => d.id === devId);
  if (!dev) return;
  const c = getCtc(devId, year, month);
  editingCtcKey = { devId, year, month };

  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const loc = locations.find(l => l.id === dev.location_id);
  document.getElementById('ctc-modal-title').textContent = dev.firstname + ' ' + dev.lastname + ' — ' + MTH[month-1] + ' ' + year;
  document.getElementById('ctc-modal-info').textContent = (loc?.name||'—') + ' · ' + (dev.workertype||'FTE');
  document.getElementById('ctc-value').value = c?.amount ?? '';
  document.getElementById('ctc-apply-all').checked = false;
  document.getElementById('ctc-btn-delete').style.display = c ? '' : 'none';
  document.getElementById('ctc-modal').classList.add('open');
  setTimeout(() => document.getElementById('ctc-value').focus(), 100);
}

async function saveCtc() {
  const key = editingCtcKey;
  if (!key) return;
  const val = document.getElementById('ctc-value').value;
  if (val === '') { showToast('Enter a value'); return; }
  const amount = parseFloat(val);
  const applyAll = document.getElementById('ctc-apply-all').checked;
  const months = applyAll ? Array.from({length: 12 - key.month + 1}, (_, i) => key.month + i) : [key.month];

  for (const m of months) {
    const row = { developer_id: key.devId, year: key.year, month: m, amount, is_manual: true };
    const { error } = await db.from('cost_to_center').upsert(row, { onConflict: 'developer_id,year,month' });
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = ctcData.findIndex(c => c.developer_id===key.devId && c.year===key.year && c.month===m);
    if (idx >= 0) ctcData[idx] = { ...ctcData[idx], ...row };
    else ctcData.push({ ...row, id: 'local_' + Date.now() + m });
  }
  closeModal('ctc-modal');
  renderCtc();
  showToast(applyAll ? 'Saved till end of year' : 'Saved');
}

async function deleteCtc() {
  const key = editingCtcKey;
  if (!key || !confirm('Delete CTC for this month?')) return;
  await db.from('cost_to_center').delete()
    .eq('developer_id', key.devId).eq('year', key.year).eq('month', key.month);
  ctcData = ctcData.filter(c => !(c.developer_id===key.devId && c.year===key.year && c.month===key.month));
  closeModal('ctc-modal');
  renderCtc();
  showToast('Deleted');
}


// ============================================================
// TEAM COSTS
// ============================================================
let teamCosts = [];
let editingTeamCostId = null;

async function loadTeamCosts() {
  const { data, error } = await db.from('team_costs').select('*').eq('year', 2026);
  if (error) { console.error('loadTeamCosts:', error); return; }
  teamCosts = data || [];
}

function renderTeamCostsList() {
  const list = document.getElementById('teamcosts-list');
  if (!list) return;
  const year = 2026;
  const filtered = teamCosts.filter(tc => tc.year===year).sort((a,b) => a.team.localeCompare(b.team)||a.month-b.month);
  if (!filtered.length) { list.innerHTML = '<div style="color:var(--text-3);font-size:13px">No team costs defined.</div>'; return; }
  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  list.innerHTML = filtered.map(tc => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px">
      <div style="flex:1">
        <div style="font-weight:500;font-size:13px">${tc.team} — ${MTH[tc.month-1]}</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:2px">${tc.description||'—'}</div>
      </div>
      <div style="font-weight:600;font-size:13px">€${parseFloat(tc.amount).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <button class="btn" style="padding:3px 10px;font-size:12px" onclick="openEditTeamCost('${tc.id}')">Edit</button>
    </div>`).join('');
}

function openAddTeamCost() {
  editingTeamCostId = null;
  document.getElementById('teamcost-modal-title').textContent = 'Add team cost';
  document.getElementById('teamcost-btn-delete').style.display = 'none';
  document.getElementById('teamcost-desc').value = '';
  document.getElementById('teamcost-amount').value = '';
  document.getElementById('teamcost-month').value = '0';
  const sel = document.getElementById('teamcost-team');
  const allTeams = [...EU_TEAMS.filter(t=>t!=='Selfhosting'), ...IND_TEAMS];
  sel.innerHTML = allTeams.map(t => `<option value="${t}">${t}</option>`).join('');
  document.getElementById('teamcost-modal').classList.add('open');
}

function openEditTeamCost(id) {
  const tc = teamCosts.find(t => t.id===id);
  if (!tc) return;
  editingTeamCostId = id;
  document.getElementById('teamcost-modal-title').textContent = 'Edit team cost';
  document.getElementById('teamcost-btn-delete').style.display = '';
  const sel = document.getElementById('teamcost-team');
  const allTeams = [...EU_TEAMS.filter(t=>t!=='Selfhosting'), ...IND_TEAMS];
  sel.innerHTML = allTeams.map(t => `<option value="${t}"${t===tc.team?' selected':''}>${t}</option>`).join('');
  document.getElementById('teamcost-month').value = tc.month;
  document.getElementById('teamcost-desc').value = tc.description||'';
  document.getElementById('teamcost-amount').value = tc.amount||'';
  document.getElementById('teamcost-modal').classList.add('open');
}

async function saveTeamCost() {
  const year = 2026;
  const team = document.getElementById('teamcost-team').value;
  const month = parseInt(document.getElementById('teamcost-month').value);
  const description = document.getElementById('teamcost-desc').value.trim();
  const amount = parseFloat(document.getElementById('teamcost-amount').value);
  if (!team || isNaN(amount)) { showToast('Fill in team and amount'); return; }
  const months = month===0 ? [1,2,3,4,5,6,7,8,9,10,11,12] : [month];
  for (const m of months) {
    const row = { team, year, month: m, description: description||null, amount };
    if (editingTeamCostId && months.length===1) {
      await db.from('team_costs').update(row).eq('id', editingTeamCostId);
      const idx = teamCosts.findIndex(t => t.id===editingTeamCostId);
      if (idx >= 0) teamCosts[idx] = { ...teamCosts[idx], ...row };
    } else {
      const { data, err } = await db.from('team_costs').upsert(row, { onConflict: 'team,year,month,description' }).select().single();
      if (!err && data) { const idx=teamCosts.findIndex(t=>t.id===data.id); if(idx>=0)teamCosts[idx]=data; else teamCosts.push(data); }
    }
  }
  closeModal('teamcost-modal');
  renderTeamCostsList();
  showToast(months.length>1 ? 'Saved for all months' : 'Saved');
}

async function deleteTeamCost() {
  if (!editingTeamCostId || !confirm('Delete this team cost?')) return;
  await db.from('team_costs').delete().eq('id', editingTeamCostId);
  teamCosts = teamCosts.filter(t => t.id!==editingTeamCostId);
  closeModal('teamcost-modal');
  renderTeamCostsList();
  showToast('Deleted');
}


// ============================================================
// OVERHEAD RATES
// ============================================================
let overheadRates = []; // [{id, location, worker_type, year, month, amount}]
let editingOverheadKey = null;

const OVERHEAD_LOCATIONS = ['Slovakia', 'Romania', 'Latvia', 'India Pune', 'India Bangalore'];
const OVERHEAD_TYPES = ['FTE', 'Contractor'];

async function loadOverheadRates() {
  const { data, error } = await db.from('overhead_rates').select('*').eq('year', 2026);
  if (error) { console.error('loadOverheadRates:', error); return; }
  overheadRates = data || [];
}

function getOverheadRate(location, workerType, year, month) {
  return overheadRates.find(r =>
    r.location === location && r.worker_type === workerType &&
    r.year === year && r.month === month
  );
}

function getOverheadAmount(location, workerType, year, month) {
  return getOverheadRate(location, workerType, year, month)?.amount ?? null;
}

function renderOverhead() {
  const body = document.getElementById('overhead-body');
  if (!body) return;
  const year = parseInt(document.getElementById('overhead-year')?.value) || 2026;
  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const rows = [];
  OVERHEAD_LOCATIONS.forEach(loc => {
    OVERHEAD_TYPES.forEach(type => {
      const cells = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
        const r = getOverheadRate(loc, type, year, m);
        const val = r?.amount;
        const bg = val != null ? 'background:var(--green-lt)' : '';
        const color = val != null ? 'color:var(--green)' : 'color:var(--text-3)';
        const text = val != null ? '€' + val.toLocaleString('de-DE',{maximumFractionDigits:0}) : '+';
        return `<td style="text-align:center;padding:4px 3px;cursor:pointer;${bg}"
          onclick="openOverheadModal('${loc}','${type}',${year},${m})">
          <span style="font-size:11px;font-weight:500;${color}">${text}</span>
        </td>`;
      }).join('');

      rows.push(`<tr>
        <td style="padding:7px 10px;font-weight:500;position:sticky;left:0;background:var(--surface);white-space:nowrap">${loc}</td>
        <td style="padding:7px 8px;font-size:12px;color:var(--text-2)">${type}</td>
        ${cells}
      </tr>`);
    });

    // Separator between locations
    rows.push(`<tr style="height:4px;background:var(--bg)"><td colspan="14"></td></tr>`);
  });

  body.innerHTML = rows.join('');
}

function openOverheadModal(location, workerType, year, month) {
  const r = getOverheadRate(location, workerType, year, month);
  editingOverheadKey = { location, workerType, year, month };

  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('overhead-modal-title').textContent =
    location + ' · ' + workerType + ' — ' + MTH[month-1] + ' ' + year;
  document.getElementById('overhead-value').value = r?.amount ?? '';
  document.getElementById('overhead-apply-all').checked = false;
  document.getElementById('overhead-btn-delete').style.display = r ? '' : 'none';
  document.getElementById('overhead-modal').classList.add('open');
  setTimeout(() => document.getElementById('overhead-value').focus(), 100);
}

async function saveOverhead() {
  const key = editingOverheadKey;
  if (!key) return;
  const val = document.getElementById('overhead-value').value;
  if (val === '') { showToast('Enter a value'); return; }
  const amount = parseFloat(val);
  const applyAll = document.getElementById('overhead-apply-all').checked;
  const months = applyAll
    ? Array.from({length: 12 - key.month + 1}, (_, i) => key.month + i)
    : [key.month];

  for (const m of months) {
    const row = { location: key.location, worker_type: key.workerType, year: key.year, month: m, amount };
    const { error } = await db.from('overhead_rates')
      .upsert(row, { onConflict: 'location,worker_type,year,month' });
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = overheadRates.findIndex(r =>
      r.location===key.location && r.worker_type===key.workerType &&
      r.year===key.year && r.month===m
    );
    if (idx >= 0) overheadRates[idx] = { ...overheadRates[idx], ...row };
    else overheadRates.push({ ...row, id: 'local_' + Date.now() + m });
  }
  closeModal('overhead-modal');
  renderOverhead();
  showToast(applyAll ? 'Saved till end of year' : 'Saved');
}

async function deleteOverhead() {
  const key = editingOverheadKey;
  if (!key || !confirm('Delete overhead for this month?')) return;
  await db.from('overhead_rates').delete()
    .eq('location', key.location).eq('worker_type', key.workerType)
    .eq('year', key.year).eq('month', key.month);
  overheadRates = overheadRates.filter(r =>
    !(r.location===key.location && r.worker_type===key.workerType &&
      r.year===key.year && r.month===key.month)
  );
  closeModal('overhead-modal');
  renderOverhead();
  showToast('Deleted');
}

// ── New COGS calculation ──────────────────────────────────────────────────
function calcDevCogs(dev, month, year) {
  // COGS = CTC + Overhead
  const ctcRow = getCtc(dev.id, year, month);
  if (!ctcRow?.amount) return null;

  const loc = locations.find(l => l.id === dev.location_id);
  const locName = loc?.name || '';
  const workerType = dev.workertype === 'Contractor' ? 'Contractor' : 'FTE';
  const overhead = getOverheadAmount(locName, workerType, year, month) ?? 0;

  return ctcRow.amount + overhead;
}



// ── COGS view (read-only) ─────────────────────────────────────────────────
function populateDevCostsTeamFilter() {
  const sel = document.getElementById('devcosts-team');
  if (!sel) return;
  const cur = sel.value;
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  sel.innerHTML = '<option value="">All teams</option>' +
    allTeams.map(t => `<option value="${t}"${t===cur?' selected':''}>${t}</option>`).join('');
}

function renderDevCosts() {
  populateDevCostsTeamFilter();
  const body = document.getElementById('devcosts-body');
  if (!body) return;
  const year = parseInt(document.getElementById('devcosts-year')?.value) || 2026;
  const teamFilter = document.getElementById('devcosts-team')?.value || '';

  const showAllCogs = document.getElementById('devcosts-show-all')?.checked;
  let devs = getActiveDevsSorted(teamFilter, year, null, showAllCogs);
  if (!devs.length) { body.innerHTML = '<tr><td colspan="15" class="empty">No developers found</td></tr>'; return; }

  body.innerHTML = devs.map(d => {
    const loc = locations.find(l => l.id === d.location_id);
    const locName = loc?.name || '—';
    const isContractor = d.workertype === 'Contractor';

    const cells = [1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
      const cogs = calcDevCogs(d, m, year);
      let bg = '', color = 'color:var(--text-3)', text = '—';
      if (cogs != null) {
        bg = 'background:var(--green-lt)';
        color = 'color:var(--green)';
        text = '€' + Math.round(cogs).toLocaleString('de-DE');
      } else {
        const ctcRow = getCtc(d.id, year, m);
        if (!ctcRow?.amount) { bg = ''; color = 'color:var(--text-3)'; text = '—'; }
      }
      return `<td style="text-align:center;padding:4px 2px;${bg}">
        <span style="font-size:11px;font-weight:500;${color}">${text}</span>
      </td>`;
    }).join('');

    return `<tr>
      <td style="padding:6px 10px;font-weight:500;position:sticky;left:0;background:var(--surface);min-width:200px">${d.firstname} ${d.lastname}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-2)">${locName}</td>
      <td style="padding:6px 8px;font-size:11px;color:var(--text-2)">${isContractor?'CTR':'FTE'}</td>
      ${cells}
    </tr>`;
  }).join('');
}

// ── Overhead Bulk Update ──────────────────────────────────────────────────
function openOverheadBulkModal() {
  const MTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Populate locations
  const locList = document.getElementById('ob-loc-list');
  locList.innerHTML = OVERHEAD_LOCATIONS.map(loc =>
    `<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:4px;cursor:pointer">
      <input type="checkbox" class="ob-loc-cb" value="${loc}" checked> ${loc}
    </label>`
  ).join('');
  document.getElementById('ob-loc-all').checked = true;

  // Populate months
  const monthList = document.getElementById('ob-month-list');
  monthList.innerHTML = MTH_NAMES.map((m, i) =>
    `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
      <input type="checkbox" class="ob-month-cb" value="${i+1}" checked> ${m}
    </label>`
  ).join('');
  document.getElementById('ob-month-all').checked = true;

  document.getElementById('ob-value').value = '';
  document.getElementById('overhead-bulk-modal').classList.add('open');
  setTimeout(() => document.getElementById('ob-value').focus(), 100);
}

function toggleOverheadBulkAll(type) {
  if (type === 'loc') {
    const checked = document.getElementById('ob-loc-all').checked;
    document.querySelectorAll('.ob-loc-cb').forEach(cb => cb.checked = checked);
  } else {
    const checked = document.getElementById('ob-month-all').checked;
    document.querySelectorAll('.ob-month-cb').forEach(cb => cb.checked = checked);
  }
}

async function applyOverheadBulk() {
  const year = parseInt(document.getElementById('overhead-year')?.value) || 2026;
  const val = document.getElementById('ob-value').value;
  if (val === '') { showToast('Enter an overhead amount'); return; }
  const amount = parseFloat(val);
  if (isNaN(amount) || amount < 0) { showToast('Enter a valid amount'); return; }

  const locs = [...document.querySelectorAll('.ob-loc-cb:checked')].map(cb => cb.value);
  const types = ['FTE','Contractor'].filter(t => document.getElementById('ob-type-' + t)?.checked);
  const months = [...document.querySelectorAll('.ob-month-cb:checked')].map(cb => parseInt(cb.value));

  if (!locs.length || !types.length || !months.length) {
    showToast('Select at least one location, type and month');
    return;
  }

  const rows = [];
  locs.forEach(loc => {
    types.forEach(wt => {
      months.forEach(m => {
        rows.push({ location: loc, worker_type: wt, year, month: m, amount });
      });
    });
  });

  const { error } = await db.from('overhead_rates')
    .upsert(rows, { onConflict: 'location,worker_type,year,month' });
  if (error) { showToast('Error: ' + error.message); return; }

  // Update local cache
  rows.forEach(row => {
    const idx = overheadRates.findIndex(r =>
      r.location===row.location && r.worker_type===row.worker_type &&
      r.year===row.year && r.month===row.month
    );
    if (idx >= 0) overheadRates[idx] = { ...overheadRates[idx], ...row };
    else overheadRates.push({ ...row, id: 'local_' + Date.now() + Math.random() });
  });

  closeModal('overhead-bulk-modal');
  renderOverhead();
  showToast(`Updated ${rows.length} overhead entries`);
}

