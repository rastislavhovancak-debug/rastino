// ============================================================
// SETTINGS VIEW SWITCHER
// ============================================================
function switchSettingsView(v) {
  ['settings-teamorder','settings-devorder','settings-locations','settings-utilization','settings-discounts',
   'settings-teamdiscounts','settings-extrainvoicing','settings-lockedmonths','settings-eurusd',
   'settings-invgroups','settings-snapshots','settings-linkedteams'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('settings-' + v);
  if (el) el.style.display = '';
  if (v === 'teamorder') renderTeamOrder();
  if (v === 'devorder') renderDevOrder();
  if (v === 'locations') { renderLocations(); populatePhLocSelect(); renderPhList(); }
  if (v === 'utilization') renderRevUtil();
  if (v === 'discounts') renderDiscounts();
  if (v === 'teamdiscounts') renderTeamDiscounts();
  if (v === 'extrainvoicing') renderExtraInvoicing();
  if (v === 'lockedmonths') renderLockedMonths();
  if (v === 'eurusd') renderEurUsd();
  if (v === 'invgroups') renderInvGroups();

  if (v === 'snapshots') { loadSnapshotStatus().then(renderSnapshots); }
  if (v === 'linkedteams') renderLinkedTeams();
}

let rateCatalog = [];

async function loadRateCatalog() {
  const { data, error } = await db.from('rate_catalog').select('*').order('year', { ascending: false }).order('region').order('seniority');
  if (error) { showToast('Error loading rate catalog: ' + error.message); return; }
  rateCatalog = data || [];
  renderRateCatalog(2026);
  renderRateCatalog(2025);
}

function renderRateCatalog(year) {
  const body = document.getElementById(`info-body-${year}`);
  if (!body) return;
  const rows = rateCatalog.filter(r => r.year === year);
  if (!rows.length) { body.innerHTML = '<tr><td colspan="5" class="empty">No data</td></tr>'; return; }

  const regions = [...new Set(rows.map(r => r.region))];
  body.innerHTML = regions.map(region => {
    const regionRows = rows.filter(r => r.region === region);
    const header = `<tr style="background:var(--bg)"><td colspan="5" style="font-weight:500;color:var(--text-2);font-size:12px;padding:6px 12px">${region}</td></tr>`;
    const dataRows = regionRows.map(r => `<tr>
      <td>${r.role}</td>
      <td>${r.seniority}</td>
      <td style="text-align:right">${parseFloat(r.hourly_rate).toFixed(2)}</td>
      <td>${r.catalog_name}</td>
      <td style="text-align:right">${r.equivalent_152h ? parseFloat(r.equivalent_152h).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'}</td>
    </tr>`).join('');
    return header + dataRows;
  }).join('');
}

function switchInfoView(v) {
  ['info-rates2026', 'info-rates2025'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('info-' + v);
  if (el) el.style.display = '';
}

// ============================================================
// PUBLIC HOLIDAYS
// ============================================================
let publicHolidays = []; // [{id, location_id, date, name}]
let editingPhId = null;

async function loadPublicHolidays() {
  const { data, error } = await db.from('public_holidays').select('*').order('date');
  if (error) { console.error('loadPublicHolidays:', error); return; }
  publicHolidays = data || [];
}

function populatePhLocSelect() {
  const sel = document.getElementById('ph-loc-select');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— select location —</option>' +
    locations.map(l => `<option value="${l.id}"${String(l.id) === cur ? ' selected' : ''}>${l.name}</option>`).join('');
}

function renderPhList() {
  const list = document.getElementById('ph-list');
  if (!list) return;
  const locId = parseInt(document.getElementById('ph-loc-select')?.value);
  const year = parseInt(document.getElementById('ph-year-select')?.value) || 2026;
  if (!locId) { list.innerHTML = '<div style="color:var(--text-3);font-size:13px">Select a location to view holidays</div>'; return; }

  const filtered = publicHolidays.filter(h => {
    const d = new Date(h.date);
    return h.location_id === locId && d.getFullYear() === year;
  }).sort((a, b) => a.date.localeCompare(b.date));

  if (!filtered.length) {
    list.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:8px 0">No holidays defined for this location and year.</div>';
    return;
  }

  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  list.innerHTML = filtered.map(h => {
    const d = new Date(h.date);
    const dateStr = `${DAY[d.getDay()]} ${d.getDate()} ${MTH[d.getMonth()]} ${d.getFullYear()}`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px">
      <div style="font-size:13px;font-weight:500;min-width:180px">${dateStr}</div>
      <div style="font-size:13px;color:var(--text-2);flex:1">${h.name || '—'}</div>
      <button class="btn" style="padding:3px 10px;font-size:12px" onclick="openEditPhModal('${h.id}')">Edit</button>
    </div>`;
  }).join('');
}

function openAddPhModal() {
  const locId = document.getElementById('ph-loc-select')?.value;
  if (!locId) { showToast('Select a location first'); return; }
  editingPhId = null;
  document.getElementById('ph-modal-title').textContent = 'Add public holiday';
  document.getElementById('ph-date').value = '';
  document.getElementById('ph-name').value = '';
  document.getElementById('ph-btn-delete').style.display = 'none';
  document.getElementById('ph-modal').classList.add('open');
  setTimeout(() => document.getElementById('ph-date').focus(), 100);
}

function openEditPhModal(id) {
  const h = publicHolidays.find(h => h.id === id);
  if (!h) return;
  editingPhId = id;
  document.getElementById('ph-modal-title').textContent = 'Edit public holiday';
  document.getElementById('ph-date').value = h.date.substring(0, 10);
  document.getElementById('ph-name').value = h.name || '';
  document.getElementById('ph-btn-delete').style.display = 'block';
  document.getElementById('ph-modal').classList.add('open');
}

async function savePhHoliday() {
  const locId = parseInt(document.getElementById('ph-loc-select')?.value);
  const date = document.getElementById('ph-date').value;
  const name = document.getElementById('ph-name').value.trim() || null;
  if (!date) { showToast('Date is required'); return; }
  if (!locId) { showToast('Select a location first'); return; }

  if (editingPhId) {
    const { error } = await db.from('public_holidays')
      .update({ date, name }).eq('id', editingPhId);
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = publicHolidays.findIndex(h => h.id === editingPhId);
    if (idx >= 0) publicHolidays[idx] = { ...publicHolidays[idx], date, name };
  } else {
    const { data, error } = await db.from('public_holidays')
      .insert({ location_id: locId, date, name }).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    publicHolidays.push(data);
  }

  closeModal('ph-modal');
  renderPhList();
  showToast(editingPhId ? 'Holiday updated' : 'Holiday added');
}

async function deletePhHoliday() {
  if (!editingPhId) return;
  if (!confirm('Delete this holiday?')) return;
  const { error } = await db.from('public_holidays').delete().eq('id', editingPhId);
  if (error) { showToast('Error: ' + error.message); return; }
  publicHolidays = publicHolidays.filter(h => h.id !== editingPhId);
  closeModal('ph-modal');
  renderPhList();
  showToast('Holiday deleted');
}


// COSTS MODULE → costs.js

// GROSS MARGIN MODULE → grossmargin.js

// ============================================================
// INVOICE GROUPS
// ============================================================
let invoiceGroups = []; // [{id, position, teams:[], po}]

// Default groups derived from team PO assignments
function getDefaultInvGroups() {
  const ALL_TEAMS = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  // Build default: group teams with same PO together
  const poMap = {};
  ALL_TEAMS.forEach(team => {
    const cfg = getTeamInvoiceConfig(team);
    if (!cfg.po) return;
    if (!poMap[cfg.po]) poMap[cfg.po] = { teams: [], po: cfg.po };
    poMap[cfg.po].teams.push(team);
  });
  // Selfhosting
  poMap['50019177'] = { teams: ['Selfhosting'], po: '50019177' };
  return Object.values(poMap).map((g, i) => ({ id: 'default_' + i, position: i + 1, teams: g.teams, po: g.po }));
}

async function loadInvGroups() {
  const { data, error } = await db.from('invoice_groups').select('*').order('position');
  if (error || !data || !data.length) {
    invoiceGroups = getDefaultInvGroups();
    return;
  }
  invoiceGroups = data.map(r => ({ id: r.id, position: r.position, teams: r.teams || [], po: r.po || '' }));
}

async function saveInvGroupOrder() {
  for (let i = 0; i < invoiceGroups.length; i++) {
    const g = invoiceGroups[i];
    g.position = i + 1;
    if (g.id && !g.id.startsWith('default_')) {
      await db.from('invoice_groups').update({ position: g.position }).eq('id', g.id);
    }
  }
}

async function saveInvGroup(group) {
  if (!group.id || group.id.startsWith('default_')) {
    const { data, error } = await db.from('invoice_groups')
      .insert({ position: group.position, teams: group.teams, po: group.po })
      .select().single();
    if (!error && data) group.id = data.id;
  } else {
    await db.from('invoice_groups')
      .update({ position: group.position, teams: group.teams, po: group.po })
      .eq('id', group.id);
  }
}

async function deleteInvGroup(id) {
  if (!id.startsWith('default_')) {
    await db.from('invoice_groups').delete().eq('id', id);
  }
  invoiceGroups = invoiceGroups.filter(g => g.id !== id);
  invoiceGroups.forEach((g, i) => g.position = i + 1);
  renderInvGroups();
}

async function moveInvGroup(id, dir) {
  const idx = invoiceGroups.findIndex(g => g.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= invoiceGroups.length) return;
  [invoiceGroups[idx], invoiceGroups[newIdx]] = [invoiceGroups[newIdx], invoiceGroups[idx]];
  await saveInvGroupOrder();
  renderInvGroups();
}

async function addInvGroup() {
  const allTeams = [...EU_TEAMS, ...IND_TEAMS];
  const usedTeams = invoiceGroups.flatMap(g => g.teams);
  const available = allTeams.filter(t => !usedTeams.includes(t));
  if (!available.length) { showToast('All teams already assigned to groups'); return; }
  const newGroup = { id: 'default_new_' + Date.now(), position: invoiceGroups.length + 1, teams: [available[0]], po: '' };
  invoiceGroups.push(newGroup);
  await saveInvGroup(newGroup);
  renderInvGroups();
  // Auto-open edit for new group
  setTimeout(() => editInvGroup(newGroup.id), 100);
}

async function resetInvGroups() {
  if (!confirm('Reset to default groupings? All custom ordering and groupings will be lost.')) return;
  // Delete all from DB
  for (const g of invoiceGroups) {
    if (g.id && !g.id.startsWith('default_')) {
      await db.from('invoice_groups').delete().eq('id', g.id);
    }
  }
  invoiceGroups = getDefaultInvGroups();
  renderInvGroups();
  showToast('Reset to defaults');
}

function editInvGroup(id) {
  const group = invoiceGroups.find(g => g.id === id);
  if (!group) return;

  const allTeams = [...EU_TEAMS, ...IND_TEAMS];
  const usedElsewhere = invoiceGroups.filter(g => g.id !== id).flatMap(g => g.teams);
  const available = allTeams.filter(t => !usedElsewhere.includes(t));

  const existing = document.getElementById('invgroup-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'invgroup-popup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;z-index:600;box-shadow:0 8px 32px rgba(0,0,0,0.15);min-width:380px;max-width:480px';

  const teamCheckboxes = available.map(t => {
    const checked = group.teams.includes(t) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;font-size:13px">
      <input type="checkbox" value="${t}" ${checked}> ${t}
    </label>`;
  }).join('');

  popup.innerHTML = `
    <div style="font-weight:600;font-size:14px;margin-bottom:1rem">Edit invoice group</div>
    <div style="font-size:12px;color:var(--text-2);margin-bottom:6px">Teams in this group:</div>
    <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:12px">${teamCheckboxes}</div>
    <div style="font-size:12px;color:var(--text-2);margin-bottom:6px">PO number:</div>
    <input id="invgroup-po" type="text" value="${group.po}" placeholder="e.g. 50019236"
      style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;margin-bottom:1rem;box-sizing:border-box">
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('invgroup-popup').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveInvGroupEdit('${id}')">Save</button>
    </div>`;

  document.body.appendChild(popup);
  document.getElementById('invgroup-po').focus();
}

async function saveInvGroupEdit(id) {
  const group = invoiceGroups.find(g => g.id === id);
  if (!group) return;

  const checkboxes = document.querySelectorAll('#invgroup-popup input[type=checkbox]:checked');
  const teams = Array.from(checkboxes).map(cb => cb.value);
  const po = document.getElementById('invgroup-po').value.trim();

  if (!teams.length) { showToast('Select at least one team'); return; }
  if (!po) { showToast('Enter a PO number'); return; }

  group.teams = teams;
  group.po = po;
  await saveInvGroup(group);
  document.getElementById('invgroup-popup').remove();
  renderInvGroups();
  showToast('Group saved');
}

function renderInvGroups() {
  const list = document.getElementById('invgroups-list');
  if (!list) return;

  if (!invoiceGroups.length) {
    list.innerHTML = '<div style="color:var(--text-3);font-size:13px;padding:1rem 0">No groups defined. Click "Add group" to start.</div>';
    return;
  }

  list.innerHTML = invoiceGroups.map((g, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px">
      <div style="color:var(--text-3);font-size:12px;min-width:20px;text-align:center">${i + 1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;font-size:13px">${g.teams.join(' + ')}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">PO: ${g.po || '—'}</div>
      </div>
      <button class="btn" style="padding:3px 8px;font-size:12px" onclick="editInvGroup('${g.id}')">Edit</button>
      <div style="display:flex;flex-direction:column;gap:2px">
        <button onclick="moveInvGroup('${g.id}',-1)" style="border:1px solid var(--border);background:var(--bg);border-radius:4px;width:24px;height:18px;cursor:pointer;font-size:10px;line-height:1" ${i===0?'disabled':''}>▲</button>
        <button onclick="moveInvGroup('${g.id}',1)" style="border:1px solid var(--border);background:var(--bg);border-radius:4px;width:24px;height:18px;cursor:pointer;font-size:10px;line-height:1" ${i===invoiceGroups.length-1?'disabled':''}>▼</button>
      </div>
      <button onclick="deleteInvGroup('${g.id}')" style="border:none;background:none;cursor:pointer;color:var(--text-3);font-size:16px;padding:0 4px" title="Remove">×</button>
    </div>
  `).join('');
}


// ============================================================
// EUR/USD RATES
// ============================================================
let eurUsdRates = {}; // { month: {rate, cad, gbp, inr, ron} } for 2026

const FOREX_CURRENCIES = [
  { key: 'rate', label: 'EUR', desc: '1 USD = ? EUR' },
  { key: 'inr',  label: 'INR', desc: '1 USD = ? INR' },
  { key: 'ron',  label: 'RON', desc: '1 USD = ? RON' },
  { key: 'cad',  label: 'CAD', desc: '1 USD = ? CAD' },
  { key: 'gbp',  label: 'GBP', desc: '1 USD = ? GBP' },
];

async function loadEurUsd() {
  const { data, error } = await db.from('eur_usd_rates').select('*').eq('year', 2026);
  if (error) { console.error('loadEurUsd:', error); return; }
  eurUsdRates = {};
  (data || []).forEach(r => { eurUsdRates[r.month] = r; });
}

function getEurUsdRate(monthNum) {
  return eurUsdRates[monthNum]?.rate || null;
}

// Convert amount in given currency to EUR for a specific month
function convertToEur(amount, currency, monthNum) {
  if (!amount) return null;
  if (currency === 'EUR') return amount;
  const row = eurUsdRates[monthNum];
  if (!row) return null;
  const eurPerUsd = parseFloat(row.rate) || 0.91;
  const lcPerUsd = parseFloat(row[currency.toLowerCase()]);
  if (!lcPerUsd) return null;
  // amount / lcPerUsd = amount in USD; × eurPerUsd = amount in EUR
  return (amount / lcPerUsd) * eurPerUsd;
}

function renderEurUsd() {
  const body = document.getElementById('eurusd-body');
  if (!body) return;
  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  body.innerHTML = FOREX_CURRENCIES.map(fc => {
    const cells = MTH.map((m, i) => {
      const monthNum = i + 1;
      const row = eurUsdRates[monthNum];
      const val = row ? parseFloat(row[fc.key]) : null;
      const display = val ? val.toFixed(4) : '<span style="color:var(--text-3)">—</span>';
      return `<td style="text-align:center;cursor:pointer;padding:8px 10px;min-width:70px"
        onclick="editForexCell('${fc.key}','${fc.label}',${monthNum},this)">${display}</td>`;
    }).join('');
    return `<tr>
      <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500;padding:8px 12px">${fc.label}</td>
      ${cells}
    </tr>`;
  }).join('');
}

function editForexCell(key, label, monthNum, cell) {
  document.getElementById('eurusd-popup')?.remove();
  const MTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const row = eurUsdRates[monthNum] || {};
  const cur = row[key] || '';
  const fc = FOREX_CURRENCIES.find(f => f.key === key);
  const rect = cell.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.id = 'eurusd-popup';
  popup.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;z-index:500;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:240px`;
  popup.innerHTML = `
    <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">${MTH_FULL[monthNum-1]} 2026 — ${fc.desc}</div>
    <input type="number" id="eurusd-input" value="${cur}" placeholder="e.g. 0.9100" step="0.0001" min="0"
      style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;margin-bottom:8px"
      onkeydown="if(event.key==='Enter')saveForexCell('${key}',${monthNum});if(event.key==='Escape')closeEurUsdPopup();">
    <label style="font-size:12px;display:flex;align-items:center;gap:6px;margin-bottom:10px;cursor:pointer">
      <input type="checkbox" id="forex-apply-all"> Apply to all months
    </label>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="closeEurUsdPopup()">Cancel</button>
      <button class="btn btn-primary" onclick="saveForexCell('${key}',${monthNum})">Save</button>
    </div>`;
  document.body.appendChild(popup);
  document.getElementById('eurusd-input')?.focus();
  document.getElementById('eurusd-input')?.select();
}

function closeEurUsdPopup() {
  document.getElementById('eurusd-popup')?.remove();
}

// Keep old name for compatibility
function editEurUsdCell(monthNum, cell) {
  editForexCell('rate', 'EUR', monthNum, cell);
}

async function saveForexCell(key, monthNum) {
  const val = parseFloat(document.getElementById('eurusd-input')?.value);
  if (isNaN(val) || val <= 0) { showToast('Enter a valid rate'); return; }
  const applyAll = document.getElementById('forex-apply-all')?.checked;
  const months = applyAll ? [1,2,3,4,5,6,7,8,9,10,11,12] : [monthNum];

  for (const m of months) {
    const updateObj = { year: 2026, month: m, [key]: val };
    const { error } = await db.from('eur_usd_rates')
      .upsert(updateObj, { onConflict: 'year,month' });
    if (error) { showToast('Error: ' + error.message); return; }
    if (!eurUsdRates[m]) eurUsdRates[m] = { month: m, year: 2026 };
    eurUsdRates[m][key] = val;
  }

  closeEurUsdPopup();
  renderEurUsd();
  showToast(applyAll ? 'Saved for all months' : 'Rate saved');
}

// Legacy save function
async function saveEurUsdCell(monthNum) {
  await saveForexCell('rate', monthNum);
}


// ============================================================
// SNAPSHOTS
// ============================================================

const SNAPSHOT_TYPES = [
  {
    key: 'revenue',
    label: 'Revenue (T&M + Fixed)',
    description: 'Stores calculated T&M revenue per developer per team, plus Selfhosting/CVS Oncall/Extra invoicing',
    tables: ['monthly_revenue_tm', 'monthly_revenue_fixed'],
  },
  // Future: { key: 'cogs', label: 'COGS', ... }
  // Future: { key: 'ctc', label: 'CTC snapshot', ... }
];

let snapshotStatus = {}; // { 'revenue_1': {exists, snapshotted_at}, ... } keyed by type_month

async function loadSnapshotStatus() {
  // Check monthly_revenue_tm for revenue snapshots
  const { data: tmData } = await db.from('monthly_revenue_tm')
    .select('month, snapshotted_at')
    .eq('year', 2026)
    .order('month');

  const { data: fixedData } = await db.from('monthly_revenue_fixed')
    .select('month, snapshotted_at')
    .eq('year', 2026)
    .order('month');

  snapshotStatus = {};
  // Revenue snapshot exists if either table has data for that month
  for (let m = 1; m <= 12; m++) {
    const hasTm = (tmData||[]).some(r => r.month === m);
    const hasFixed = (fixedData||[]).some(r => r.month === m);
    if (hasTm || hasFixed) {
      const latest = [...(tmData||[]), ...(fixedData||[])]
        .filter(r => r.month === m)
        .map(r => r.snapshotted_at)
        .sort().pop();
      snapshotStatus['revenue_' + m] = { exists: true, snapshotted_at: latest };
    } else {
      snapshotStatus['revenue_' + m] = { exists: false };
    }
  }
}

function renderSnapshots() {
  const container = document.getElementById('snapshots-container');
  if (!container) return;

  const month = parseInt(document.getElementById('snapshot-month')?.value) || 1;
  const MTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const rows = SNAPSHOT_TYPES.map(t => {
    const status = snapshotStatus[t.key + '_' + month] || { exists: false };
    const statusBadge = status.exists
      ? `<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px;font-weight:500">✓ Snapshotted</span>`
      : `<span style="background:var(--bg);color:var(--text-3);padding:2px 8px;border-radius:99px;font-size:11px">Not yet</span>`;
    const dateStr = status.exists && status.snapshotted_at
      ? new Date(status.snapshotted_at).toLocaleString('en-GB', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
      : '—';

    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px">
      <input type="checkbox" id="snap-check-${t.key}" style="width:16px;height:16px;cursor:pointer" checked>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;font-size:13px">${t.label}</div>
        <div style="font-size:11px;color:var(--text-2);margin-top:2px">${t.description}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:4px">Last snapshot: ${dateStr}</div>
      </div>
      ${statusBadge}
    </div>`;
  }).join('');

  container.innerHTML = rows;
}

async function runSnapshot() {
  const month = parseInt(document.getElementById('snapshot-month')?.value) || 1;
  const MTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = MTH_FULL[month - 1];

  // Check which types are selected
  const selected = SNAPSHOT_TYPES.filter(t => document.getElementById('snap-check-' + t.key)?.checked);
  if (!selected.length) { showToast('Select at least one snapshot type'); return; }

  // Warn per type if already exists
  for (const t of selected) {
    const status = snapshotStatus[t.key + '_' + month];
    if (status?.exists) {
      const ok = confirm(`"${t.label}" snapshot already exists for ${monthName} 2026.

Overwrite it?`);
      if (!ok) return;
    }
  }

  // Run each selected snapshot
  for (const t of selected) {
    if (t.key === 'revenue') {
      await snapshotRevenue(month);
    }
    // Future: if (t.key === 'cogs') await snapshotCogs(month);
  }

  await loadSnapshotStatus();
  renderSnapshots();
  showToast('Snapshot complete for ' + monthName);
}

async function snapshotRevenue(month) {
  const year = 2026;
  const mi = month - 1;
  const monthStart = new Date(year, mi, 1);
  const monthEnd = new Date(year, mi + 1, 0);
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  const now = new Date().toISOString();

  // ── T&M rows ─────────────────────────────────────────────
  const tmRows = [];
  developers.filter(d => d.status === 'active').forEach(dev => {
    (dev.assignments || []).forEach(a => {
      if (!allTeams.includes(a.team)) return;
      if (a.billable === false) return;
      const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
      const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
      if (s > monthEnd || e < monthStart) return;

      const r = calcRevenue(dev, mi, a.team);
      if (r.revenue == null) return;

      const devDisc = r.discountAmt || 0;
      const ah = actualHours[String(dev.id)]?.[month];
      const source = ah ? 'actuals' : 'forecast';

      // Team discount
      const mKey = MTHS[mi];
      const tdAmounts = teamDiscountAmounts[a.team] || {};
      const tdAmt = tdAmounts[mKey] || 0;
      const devShare = tdAmt; // simplified — full team discount attributed per developer row

      tmRows.push({
        developer_id: dev.id,
        team: a.team,
        year,
        month,
        hours: r.hours ?? null,
        rate: r.rate ?? null,
        gross_revenue: r.revenue,
        dev_discount: devDisc,
        team_discount: 0, // team discount handled at team level
        net_revenue: r.revenue + devDisc,
        source,
        snapshotted_at: now,
      });
    });
  });

  if (tmRows.length) {
    const { error } = await db.from('monthly_revenue_tm')
      .upsert(tmRows, { onConflict: 'developer_id,team,year,month' });
    if (error) { showToast('Error saving T&M: ' + error.message); return; }
  }

  // ── Fixed rows ────────────────────────────────────────────
  const fixedRows = [];

  // Selfhosting
  const sh = calcSelfhostingRevenue(mi);
  if (sh.revenue) {
    fixedRows.push({
      team: 'Selfhosting', year, month,
      revenue_type: 'selfhosting',
      description: 'Selfhosting fixed price',
      amount: sh.revenue,
      snapshotted_at: now,
    });
  }

  // CVS Oncall
  const cvs = calcCvsOncallRevenue(mi);
  if (cvs.revenue) {
    fixedRows.push({
      team: 'Connected veh. ser.', year, month,
      revenue_type: 'cvs_oncall',
      description: 'CVS On-Call',
      amount: cvs.revenue,
      snapshotted_at: now,
    });
  }

  // Extra invoicing
  const extras = extraInvoicing.filter(e => e.month === month);
  extras.forEach(e => {
    fixedRows.push({
      team: e.team, year, month,
      revenue_type: 'extra',
      description: e.description || 'Extra invoicing',
      amount: e.amount,
      snapshotted_at: now,
    });
  });

  if (fixedRows.length) {
    const { error } = await db.from('monthly_revenue_fixed')
      .upsert(fixedRows, { onConflict: 'team,year,month,revenue_type' });
    if (error) { showToast('Error saving fixed: ' + error.message); return; }
  }
}


// ============================================================
// LOCKED MONTHS
// ============================================================
let lockedMonths = {}; // { month: true/false } for year 2026

async function loadLockedMonths() {
  const { data, error } = await db.from('locked_months')
    .select('*').eq('year', 2026);
  if (error) { console.error('loadLockedMonths:', error); return; }
  lockedMonths = {};
  (data || []).forEach(r => { lockedMonths[r.month] = r.locked; });
}

function isMonthLocked(monthNum) {
  return lockedMonths[monthNum] === true;
}

function renderLockedMonths() {
  const MTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const body = document.getElementById('locked-months-body');
  if (!body) return;
  body.innerHTML = MTH_FULL.map((name, i) => {
    const m = i + 1;
    const locked = isMonthLocked(m);
    return `<tr style="background:${locked ? 'var(--red-lt)' : 'var(--surface)'}">
      <td style="padding:10px 14px;font-weight:500">${name}</td>
      <td style="padding:10px 14px;text-align:center">
        ${locked
          ? '<span style="background:var(--red-lt);color:var(--red);padding:3px 12px;border-radius:99px;font-size:12px;font-weight:500">🔒 Locked</span>'
          : '<span style="background:var(--green-lt);color:var(--green);padding:3px 12px;border-radius:99px;font-size:12px;font-weight:500">🔓 Open</span>'
        }
      </td>
      <td style="padding:10px 14px">
        <button class="btn ${locked ? '' : 'btn-danger'}" onclick="toggleMonthLock(${m}, ${!locked})"
          style="font-size:12px;padding:4px 14px">
          ${locked ? '🔓 Unlock' : '🔒 Lock'}
        </button>
      </td>
      <td style="padding:10px 14px;font-size:12px;color:var(--text-3)">
        ${locked ? 'All actual_hours writes blocked for this month' : ''}
      </td>
    </tr>`;
  }).join('');
}

async function toggleMonthLock(monthNum, shouldLock) {
  const action = shouldLock ? 'lock' : 'unlock';
  const MTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = MTH_FULL[monthNum - 1];

  if (!confirm(`Are you sure you want to ${action} ${monthName}?\n\n${shouldLock ? 'This will prevent any changes to actual hours for this month.' : 'This will allow editing actual hours for this month again.'}`)) return;

  // Upsert locked_months record
  const { error } = await db.from('locked_months')
    .upsert({ year: 2026, month: monthNum, locked: shouldLock }, { onConflict: 'year,month' });

  if (error) { showToast('Error: ' + error.message); return; }

  lockedMonths[monthNum] = shouldLock;
  renderLockedMonths();
  showToast(`${monthName} ${shouldLock ? 'locked 🔒' : 'unlocked 🔓'}`);
}

function checkMonthLocked(monthNum, actionName) {
  // Returns true if blocked, false if allowed
  if (!isMonthLocked(monthNum)) return false;
  const MTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  showToast(`${MTH_FULL[monthNum-1]} is locked 🔒 — ${actionName} blocked`);
  return true;
}


// ============================================================
// TEAM ORDER MODULE
// ============================================================
function renderTeamOrder() {
  renderTeamOrderRegion('europe', EU_TEAMS);
  renderTeamOrderRegion('india', IND_TEAMS);
}

function renderTeamOrderRegion(region, teams) {
  const container = document.getElementById(`team-order-${region}`);
  if (!container) return;
  container.innerHTML = teams.map((team, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:${i%2===0?'#fafafa':'white'};border-radius:6px;margin-bottom:4px">
      <span style="flex:1;font-size:13px">${team}</span>
      <button class="btn" onclick="moveTeam('${region}','${team}',-1)" ${i===0?'disabled':''}
        style="padding:2px 8px;font-size:13px;${i===0?'opacity:0.3;cursor:default':''}">▲</button>
      <button class="btn" onclick="moveTeam('${region}','${team}',1)" ${i===teams.length-1?'disabled':''}
        style="padding:2px 8px;font-size:13px;${i===teams.length-1?'opacity:0.3;cursor:default':''}">▼</button>
      <button class="btn" onclick="openEditTeamModal('${region}','${team}')"
        style="padding:2px 8px;font-size:13px;" title="Edit team">✏️</button>
      <button class="btn btn-danger" onclick="confirmDeleteTeam('${region}','${team}')"
        style="padding:2px 8px;font-size:13px;" title="Delete team">🗑</button>
    </div>`).join('');
}

async function moveTeam(region, team, dir) {
  const teams = region === 'europe' ? [...EU_TEAMS] : [...IND_TEAMS];

  const idx = teams.indexOf(team);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= teams.length) return;

  [teams[idx], teams[newIdx]] = [teams[newIdx], teams[idx]];

  // Update positions in teams table
  for (let i = 0; i < teams.length; i++) {
    await db.from('teams').update({ position: i + 1 }).eq('name', teams[i]).eq('region', region);
  }

  // Update local state
  if (region === 'europe') EU_TEAMS = teams;
  else IND_TEAMS = teams;

  renderTeamOrder();
  showToast('Team order saved');
}

function openAddTeamModal() {
  document.getElementById('add-team-name').value = '';
  document.getElementById('add-team-region').value = 'europe';
  document.getElementById('add-team-modal').className = 'modal-bg open';
}

async function saveNewTeam() {
  const name = document.getElementById('add-team-name').value.trim();
  const region = document.getElementById('add-team-region').value;
  if (!name) { showToast('Team name is required'); return; }
  if ([...EU_TEAMS, ...IND_TEAMS].includes(name)) { showToast('Team already exists'); return; }

  const position = (region === 'europe' ? EU_TEAMS.length : IND_TEAMS.length) + 1;
  const { error } = await db.from('teams').insert({ name, region, position, active: true });
  if (error) { showToast('Error: ' + error.message); return; }

  // Update local arrays
  if (region === 'europe') EU_TEAMS = [...EU_TEAMS, name];
  else IND_TEAMS = [...IND_TEAMS, name];

  closeModal('add-team-modal');
  renderTeamOrder();
  showToast('Team added');
}

function openEditTeamModal(region, team) {
  document.getElementById('edit-team-original-name').value = team;
  document.getElementById('edit-team-original-region').value = region;
  document.getElementById('edit-team-name').value = team;
  document.getElementById('edit-team-region').value = region;
  document.getElementById('edit-team-modal').className = 'modal-bg open';
}

async function saveEditTeam() {
  const originalName = document.getElementById('edit-team-original-name').value;
  const originalRegion = document.getElementById('edit-team-original-region').value;
  const newName = document.getElementById('edit-team-name').value.trim();
  const newRegion = document.getElementById('edit-team-region').value;

  if (!newName) { showToast('Team name is required'); return; }
  if (newName !== originalName && [...EU_TEAMS, ...IND_TEAMS].includes(newName)) {
    showToast('Team name already exists'); return;
  }

  const { error } = await db.from('teams')
    .update({ name: newName, region: newRegion })
    .eq('name', originalName).eq('region', originalRegion);
  if (error) { showToast('Error: ' + error.message); return; }

  // Update local arrays
  if (originalRegion === 'europe') EU_TEAMS = EU_TEAMS.filter(t => t !== originalName);
  else IND_TEAMS = IND_TEAMS.filter(t => t !== originalName);
  if (newRegion === 'europe') EU_TEAMS = [...EU_TEAMS, newName];
  else IND_TEAMS = [...IND_TEAMS, newName];

  // Also update any developer assignments with the old name
  await db.from('developer_assignments').update({ team: newName }).eq('team', originalName);

  closeModal('edit-team-modal');
  renderTeamOrder();
  showToast('Team updated');
}

function confirmDeleteTeam(region, team) {
  document.getElementById('delete-team-name').textContent = team;
  document.getElementById('delete-team-region').textContent = region === 'europe' ? 'Europe' : 'India';
  document.getElementById('delete-team-modal').className = 'modal-bg open';
  document.getElementById('btn-confirm-delete-team').onclick = () => deleteTeam(region, team);
}

async function deleteTeam(region, team) {
  const { error } = await db.from('teams').delete().eq('name', team).eq('region', region);
  if (error) { showToast('Error: ' + error.message); return; }

  if (region === 'europe') EU_TEAMS = EU_TEAMS.filter(t => t !== team);
  else IND_TEAMS = IND_TEAMS.filter(t => t !== team);

  closeModal('delete-team-modal');
  renderTeamOrder();
  showToast('Team deleted');
}

// ============================================================
// SELFHOSTING MODULE
// ============================================================
function renderSelfhostingDetail() {
  const body = document.getElementById('selfhosting-body');
  if (!body) return;
  if (!selfhostingServices.length) {
    body.innerHTML = '<tr><td colspan="15" class="empty">No services loaded. Run the SQL setup first.</td></tr>';
    return;
  }

  const fixed = selfhostingServices.filter(s => s.type === 'fixed');
  const releases = selfhostingServices.filter(s => s.type === 'release');

  let rows = '';

  // Forecast + lock checkbox row
  const forecastCells = MTHS.map((m, mi) => {
    const month = mi + 1;
    const fcst = selfhostingForecast[month] || {releases: 0, is_locked: false};
    const isLocked = fcst.is_locked;
    const val = fcst.releases || 0;
    const bg = isLocked ? '#e8f5e9' : '#e3f2fd';
    const checkId = `lock-cb-${month}`;
    return `<td style="text-align:center;background:${bg};padding:4px">
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <label style="font-size:10px;color:${isLocked?'#1a7340':'var(--blue)'};cursor:pointer;display:flex;align-items:center;gap:3px">
          <input type="checkbox" id="${checkId}" ${isLocked?'checked':''} onchange="toggleSelfhostingLock(${month},this.checked)" style="cursor:pointer">
          ${isLocked ? '🔒' : '🔓'}
        </label>
        <div style="display:flex;align-items:center;gap:3px">
          <button onclick="adjustForecast(${month},-1)" ${isLocked?'disabled':''} style="border:none;background:none;cursor:${isLocked?'default':'pointer'};font-size:13px;color:${isLocked?'#ccc':'var(--blue)'};padding:0 2px;line-height:1">▼</button>
          <span style="font-weight:500;min-width:20px;text-align:center;font-size:13px">${val}</span>
          <button onclick="adjustForecast(${month},1)" ${isLocked?'disabled':''} style="border:none;background:none;cursor:${isLocked?'default':'pointer'};font-size:13px;color:${isLocked?'#ccc':'var(--blue)'};padding:0 2px;line-height:1">▲</button>
        </div>
      </div>
    </td>`;
  }).join('');
  rows += `<tr style="background:var(--blue-lt)">
    <td style="position:sticky;left:0;background:var(--blue-lt);z-index:1;font-style:italic;color:var(--blue);font-size:13px">↳ Forecast / Lock actual</td>
    <td></td>
    ${forecastCells}
    <td></td>
  </tr>`;

  // Fixed services
  rows += fixed.map(s => buildSelfhostingRow(s, true)).join('');

  // Separator
  rows += `<tr style="background:var(--bg)"><td colspan="15" style="font-size:12px;font-weight:500;color:var(--text-2);padding:6px 12px">Software Releases — €${parseFloat(releases[0]?.rate||3930).toFixed(2)} per release</td></tr>`;

  // Release services
  rows += releases.map(s => buildSelfhostingRow(s, false)).join('');

  // Revenue total row
  const totalCells = MTHS.map((m, mi) => {
    const {revenue, type} = calcSelfhostingRevenue(mi);
    const bg = type === 'tmsh' ? '#e8f5e9' : type === 'manual' ? '#fff3e0' : '#e3f2fd';
    return `<td style="text-align:right;font-weight:500;background:${bg};padding:6px 10px;white-space:nowrap">${fmtEur(revenue)}</td>`;
  }).join('');
  const yearTotal = MTHS.reduce((s, m, mi) => s + (calcSelfhostingRevenue(mi).revenue||0), 0);
  rows += `<tr style="background:#f0f4ff;border-top:2px solid #dde4f5">
    <td style="position:sticky;left:0;background:#f0f4ff;z-index:1;font-weight:600;color:var(--blue)">Total Revenue</td>
    <td></td>
    ${totalCells}
    <td style="text-align:right;font-weight:600;color:var(--blue);padding:6px 10px">${fmtEur(yearTotal)}</td>
  </tr>`;

  body.innerHTML = rows;
}

function buildSelfhostingRow(s, isFixed) {
  const cells = MTHS.map((m, mi) => {
    const month = mi + 1;
    if (isFixed) {
      return `<td style="text-align:center;background:var(--green-lt);color:var(--green);font-weight:500">1</td>`;
    }
    const count = selfhostingActuals[s.id]?.[month] || 0;
    const fcst = selfhostingForecast[month] || {is_locked: false};
    const isLocked = fcst.is_locked;
    const bg = isLocked ? '#e8f5e9' : (count > 0 ? '#fff3e0' : '#f9f9f9');
    const arrowColor = isLocked ? '#ccc' : '#666';
    return `<td style="text-align:center;background:${bg};padding:4px">
      <div style="display:flex;align-items:center;justify-content:center;gap:3px">
        <button onclick="adjustRelease(${s.id},${month},-1)" ${isLocked?'disabled':''} style="border:none;background:none;cursor:${isLocked?'default':'pointer'};font-size:13px;color:${arrowColor};padding:0 2px;line-height:1">▼</button>
        <span style="min-width:18px;text-align:center;font-size:13px">${count > 0 ? count : '<span style="color:#ccc">0</span>'}</span>
        <button onclick="adjustRelease(${s.id},${month},1)" ${isLocked?'disabled':''} style="border:none;background:none;cursor:${isLocked?'default':'pointer'};font-size:13px;color:${arrowColor};padding:0 2px;line-height:1">▲</button>
      </div>
    </td>`;
  }).join('');

  const yearTotal = isFixed
    ? parseFloat(s.rate) * 12
    : MTHS.reduce((sum, m, mi) => {
        const count = selfhostingActuals[s.id]?.[mi+1] || 0;
        return sum + count * parseFloat(s.rate);
      }, 0);

  return `<tr>
    <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-size:13px">${s.name}</td>
    <td style="text-align:center;font-size:12px;color:var(--text-2);white-space:nowrap">€${parseFloat(s.rate).toLocaleString('de-DE', {minimumFractionDigits:2})}</td>
    ${cells}
    <td style="text-align:right;font-size:12px;color:var(--text-2);white-space:nowrap">${fmtEur(yearTotal > 0 ? yearTotal : null)}</td>
  </tr>`;
}

async function adjustForecast(month, delta) {
  const fcst = selfhostingForecast[month] || {releases: 0, is_locked: false};
  if (fcst.is_locked) return; // don't adjust locked months
  const newVal = Math.max(0, (fcst.releases || 0) + delta);
  const {error} = await db.from('selfhosting_forecast')
    .upsert({year: 2026, month, releases: newVal, is_locked: false}, {onConflict: 'year,month'});
  if (error) { showToast('Error saving: ' + error.message); return; }
  selfhostingForecast[month] = {...fcst, releases: newVal};
  renderSelfhostingDetail();
  renderRevOverview();
}

async function toggleSelfhostingLock(month, locked) {
  const fcst = selfhostingForecast[month] || {releases: 0, is_locked: false};
  const {error} = await db.from('selfhosting_forecast')
    .upsert({year: 2026, month, releases: fcst.releases || 0, is_locked: locked}, {onConflict: 'year,month'});
  if (error) { showToast('Error saving: ' + error.message); return; }
  selfhostingForecast[month] = {...fcst, is_locked: locked};
  renderSelfhostingDetail();
  renderRevOverview();
  showToast(locked ? `Month ${MTH_NAMES[month-1]} locked as actual` : `Month ${MTH_NAMES[month-1]} unlocked`);
}

async function adjustRelease(serviceId, month, delta) {
  const fcst = selfhostingForecast[month] || {is_locked: false};
  if (fcst.is_locked) return; // don't edit locked months
  const current = selfhostingActuals[serviceId]?.[month] || 0;
  const newVal = Math.max(0, current + delta);
  const {error} = await db.from('selfhosting_actuals')
    .upsert({service_id: serviceId, year: 2026, month, count: newVal, updated_at: new Date().toISOString()}, {onConflict: 'service_id,year,month'});
  if (error) { showToast('Error saving: ' + error.message); return; }
  if (!selfhostingActuals[serviceId]) selfhostingActuals[serviceId] = {};
  selfhostingActuals[serviceId][month] = newVal;
  renderSelfhostingDetail();
  renderRevOverview();
}

function openAddSelfhostingService() {
  const name = prompt('Service name:');
  if (!name?.trim()) return;
  const rateStr = prompt('Rate per release (€):', '3930');
  if (!rateStr) return;
  const rate = parseFloat(rateStr);
  if (isNaN(rate)) { showToast('Invalid rate'); return; }
  const pos = selfhostingServices.length + 1;
  db.from('selfhosting_services').insert({name: name.trim(), type: 'release', rate, position: pos}).select().single()
    .then(({data, error}) => {
      if (error) { showToast('Error: ' + error.message); return; }
      selfhostingServices.push(data);
      renderSelfhostingDetail();
      showToast('Service added');
    });
}
// ============================================================
// CVS ONCALL MODULE
// ============================================================
const CVS_ONCALL_FIXED = 2200;
const CVS_ONCALL_INCIDENT_RATE = 240;
let cvsOncallIncidents = []; // [{id, jira_id, incident_date, description}]
let cvsOncallForecast = {};  // keyed by month -> {incidents, is_locked, id}

async function loadCvsOncall() {
  const [{data: incidents}, {data: forecast}] = await Promise.all([
    db.from('cvs_oncall_incidents').select('*').eq('year', 2026).order('incident_date'),
    db.from('cvs_oncall_forecast').select('*').eq('year', 2026)
  ]);
  cvsOncallIncidents = incidents || [];
  cvsOncallForecast = {};
  (forecast||[]).forEach(f => { cvsOncallForecast[f.month] = {incidents: f.incidents, is_locked: f.is_locked || false, id: f.id}; });
}

function getCvsOncallIncidentsByMonth(month) {
  return cvsOncallIncidents.filter(i => {
    const d = new Date(i.incident_date);
    return d.getMonth() + 1 === month;
  });
}

function calcCvsOncallRevenue(monthIdx) {
  const month = monthIdx + 1;
  const fcst = cvsOncallForecast[month] || {incidents: 0, is_locked: false};
  const actualIncidents = getCvsOncallIncidentsByMonth(month).length;
  const isLocked = fcst.is_locked;

  let incidentCount, type;
  if (isLocked) {
    incidentCount = actualIncidents;
    type = 'tmsh'; // green
  } else if (actualIncidents > 0) {
    incidentCount = actualIncidents;
    type = 'manual'; // yellow
  } else {
    incidentCount = fcst.incidents || 0;
    type = incidentCount > 0 ? 'utilization' : 'utilization'; // blue
  }

  const revenue = CVS_ONCALL_FIXED + incidentCount * CVS_ONCALL_INCIDENT_RATE;
  return {revenue, type, incidents: incidentCount, isLocked};
}

function renderCvsOncall() {
  renderCvsOncallSummary();
  renderCvsOncallIncidents();
}

function renderCvsOncallSummary() {
  const body = document.getElementById('cvs-oncall-summary-body');
  if (!body) return;

  // Forecast + lock row
  const forecastCells = MTHS.map((m, mi) => {
    const month = mi + 1;
    const fcst = cvsOncallForecast[month] || {incidents: 0, is_locked: false};
    const isLocked = fcst.is_locked;
    const actualCount = getCvsOncallIncidentsByMonth(month).length;
    const val = isLocked ? actualCount : (fcst.incidents || 0);
    const bg = isLocked ? '#e8f5e9' : '#e3f2fd';
    return `<td style="text-align:center;background:${bg};padding:4px">
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <label style="font-size:10px;color:${isLocked?'#1a7340':'var(--blue)'};cursor:pointer;display:flex;align-items:center;gap:3px">
          <input type="checkbox" ${isLocked?'checked':''} onchange="toggleCvsOncallLock(${month},this.checked)" style="cursor:pointer">
          ${isLocked ? '🔒' : '🔓'}
        </label>
        <div style="display:flex;align-items:center;gap:3px">
          <button onclick="adjustCvsOncallForecast(${month},-1)" ${isLocked?'disabled':''} style="border:none;background:none;cursor:${isLocked?'default':'pointer'};font-size:13px;color:${isLocked?'#ccc':'var(--blue)'};padding:0 2px">▼</button>
          <span style="font-weight:500;min-width:18px;text-align:center;font-size:13px">${val}</span>
          <button onclick="adjustCvsOncallForecast(${month},1)" ${isLocked?'disabled':''} style="border:none;background:none;cursor:${isLocked?'default':'pointer'};font-size:13px;color:${isLocked?'#ccc':'var(--blue)'};padding:0 2px">▲</button>
        </div>
      </div>
    </td>`;
  }).join('');

  // Fixed fee row
  const fixedCells = MTHS.map(() =>
    `<td style="text-align:center;background:var(--green-lt);color:var(--green);font-weight:500">€${CVS_ONCALL_FIXED.toLocaleString('de-DE')}</td>`
  ).join('');

  // Incidents row
  const incidentCells = MTHS.map((m, mi) => {
    const month = mi + 1;
    const fcst = cvsOncallForecast[month] || {is_locked: false};
    const isLocked = fcst.is_locked;
    const count = getCvsOncallIncidentsByMonth(month).length;
    const bg = isLocked ? '#e8f5e9' : count > 0 ? '#fff3e0' : '#f9f9f9';
    return `<td style="text-align:center;background:${bg}">${count > 0 ? count : '<span style="color:#ccc">0</span>'}</td>`;
  }).join('');

  // Total row
  const totalCells = MTHS.map((m, mi) => {
    const {revenue, type} = calcCvsOncallRevenue(mi);
    const bg = type === 'tmsh' ? '#e8f5e9' : type === 'manual' ? '#fff3e0' : '#e3f2fd';
    return `<td style="text-align:center;font-weight:500;background:${bg}">${fmtEur(revenue)}</td>`;
  }).join('');

  const yearTotal = MTHS.reduce((s, m, mi) => s + calcCvsOncallRevenue(mi).revenue, 0);
  const fixedYearTotal = CVS_ONCALL_FIXED * 12;
  const incidentYearTotal = cvsOncallIncidents.length * CVS_ONCALL_INCIDENT_RATE;

  body.innerHTML = `
    <tr style="background:var(--blue-lt)">
      <td style="font-style:italic;color:var(--blue);font-size:13px">↳ Forecast / Lock actual</td>
      ${forecastCells}
      <td></td>
    </tr>
    <tr>
      <td style="font-size:13px">Fixed monthly fee</td>
      ${fixedCells}
      <td style="text-align:right;font-weight:500">${fmtEur(fixedYearTotal)}</td>
    </tr>
    <tr>
      <td style="font-size:13px">Incidents (× €${CVS_ONCALL_INCIDENT_RATE})</td>
      ${incidentCells}
      <td style="text-align:right;font-weight:500">${fmtEur(incidentYearTotal)}</td>
    </tr>
    <tr style="background:#f0f4ff;border-top:2px solid #dde4f5">
      <td style="font-weight:600;color:var(--blue)">Total</td>
      ${totalCells}
      <td style="text-align:right;font-weight:600;color:var(--blue)">${fmtEur(yearTotal)}</td>
    </tr>`;
}

function renderCvsOncallIncidents() {
  const body = document.getElementById('cvs-oncall-incidents-body');
  if (!body) return;
  if (!cvsOncallIncidents.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty">No incidents logged yet</td></tr>';
    return;
  }
  body.innerHTML = cvsOncallIncidents.map(i => {
    const d = new Date(i.incident_date);
    const dateStr = i.incident_date.substring(0, 10);
    const monthName = MTH_NAMES[d.getMonth()];
    return `<tr>
      <td style="font-size:13px;font-weight:500">${i.jira_id || '—'}</td>
      <td style="font-size:13px">${dateStr} <span style="color:var(--text-3);font-size:11px">(${monthName})</span></td>
      <td style="font-size:13px">${i.description || '—'}</td>
      <td style="text-align:right">
        <button class="btn" onclick="editIncident(${i.id})" style="padding:3px 8px;font-size:12px">Edit</button>
        <button class="btn btn-danger" onclick="deleteIncident(${i.id})" style="padding:3px 8px;font-size:12px">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function openAddIncident() {
  openIncidentModal(null);
}

function editIncident(id) {
  const inc = cvsOncallIncidents.find(i => i.id === id);
  if (inc) openIncidentModal(inc);
}

function openIncidentModal(inc) {
  const existing = document.getElementById('incident-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'incident-modal';
  modal.className = 'modal-bg open';
  modal.innerHTML = `
    <div class="modal" style="max-width:440px">
      <h2>${inc ? 'Edit incident' : 'Add incident'}</h2>
      <div class="form-group" style="margin-bottom:1rem">
        <label>Jira ID</label>
        <input type="text" id="inc-jira" value="${inc?.jira_id || ''}" placeholder="e.g. CVS-1234" style="width:100%">
      </div>
      <div class="form-group" style="margin-bottom:1rem">
        <label>Date *</label>
        <input type="date" id="inc-date" value="${inc?.incident_date?.substring(0,10) || ''}" style="width:100%">
      </div>
      <div class="form-group" style="margin-bottom:1.25rem">
        <label>Description</label>
        <input type="text" id="inc-desc" value="${inc?.description || ''}" placeholder="Short description" style="width:100%">
      </div>
      <div class="modal-footer">
        <div></div>
        <div class="modal-footer-right">
          <button class="btn" onclick="document.getElementById('incident-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="saveIncident(${inc?.id || 'null'})">Save</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('inc-date').focus();
}

async function saveIncident(id) {
  const jira_id = document.getElementById('inc-jira').value.trim();
  const incident_date = document.getElementById('inc-date').value;
  const description = document.getElementById('inc-desc').value.trim();

  if (!incident_date) { alert('Date is required'); return; }

  const year = new Date(incident_date).getFullYear();
  const payload = {jira_id: jira_id || null, incident_date, description: description || null, year};

  if (id) {
    const {error} = await db.from('cvs_oncall_incidents').update(payload).eq('id', id);
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = cvsOncallIncidents.findIndex(i => i.id === id);
    if (idx >= 0) cvsOncallIncidents[idx] = {...cvsOncallIncidents[idx], ...payload};
  } else {
    const {data, error} = await db.from('cvs_oncall_incidents').insert(payload).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    cvsOncallIncidents.push(data);
    cvsOncallIncidents.sort((a, b) => a.incident_date.localeCompare(b.incident_date));
  }

  document.getElementById('incident-modal').remove();
  showToast(id ? 'Incident updated' : 'Incident added');
  renderCvsOncall();
  renderRevOverview();
}

async function adjustCvsOncallForecast(month, delta) {
  const fcst = cvsOncallForecast[month] || {incidents: 0, is_locked: false};
  if (fcst.is_locked) return;
  const newVal = Math.max(0, (fcst.incidents || 0) + delta);
  const {error} = await db.from('cvs_oncall_forecast')
    .upsert({year: 2026, month, incidents: newVal, is_locked: false}, {onConflict: 'year,month'});
  if (error) { showToast('Error: ' + error.message); return; }
  cvsOncallForecast[month] = {...fcst, incidents: newVal};
  renderCvsOncall();
  renderRevOverview();
}

async function toggleCvsOncallLock(month, locked) {
  const fcst = cvsOncallForecast[month] || {incidents: 0, is_locked: false};
  const {error} = await db.from('cvs_oncall_forecast')
    .upsert({year: 2026, month, incidents: fcst.incidents || 0, is_locked: locked}, {onConflict: 'year,month'});
  if (error) { showToast('Error: ' + error.message); return; }
  cvsOncallForecast[month] = {...fcst, is_locked: locked};
  renderCvsOncall();
  renderRevOverview();
  showToast(locked ? `${MTH_NAMES[month-1]} locked as actual` : `${MTH_NAMES[month-1]} unlocked`);
}

async function deleteIncident(id) {
  if (!confirm('Delete this incident?')) return;
  const {error} = await db.from('cvs_oncall_incidents').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message); return; }
  cvsOncallIncidents = cvsOncallIncidents.filter(i => i.id !== id);
  showToast('Incident deleted');
  renderCvsOncall();
  renderRevOverview();
}

// TIMESHEETS MODULE → timesheets.js

// ============================================================
let developerDiscounts = []; // [{id, developer_id, rate, start_date, end_date, note}]
let editingDiscountId = null;

async function loadDiscounts() {
  const {data, error} = await db.from('developer_discounts').select('*').order('start_date', {ascending: false});
  if (error) { console.warn('Discounts not loaded:', error.message); return; }
  developerDiscounts = data || [];
}

// Get active discount rate for a developer in a given month
function getDiscountedRate(devId, year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const discount = developerDiscounts.find(d => {
    if (d.developer_id !== devId) return false;
    const start = new Date(d.start_date);
    const end = d.end_date ? new Date(d.end_date) : null;
    if (start > monthEnd) return false;
    if (end && end < monthStart) return false;
    return true;
  });
  return discount ? parseFloat(discount.rate) : null;
}

function renderDiscounts() {
  const body = document.getElementById('discounts-body');
  if (!body) return;
  if (!developerDiscounts.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No discounts configured</td></tr>';
    return;
  }
  body.innerHTML = developerDiscounts.map(d => {
    const dev = developers.find(x => x.id === d.developer_id);
    const name = dev ? `${dev.firstname} ${dev.lastname}` : '—';
    // Get standard rate — use current month as reference
    const stdRate = dev ? getStandardRate(dev) : null;
    const endStr = d.end_date ? d.end_date.substring(0,10) : '<span style="color:var(--green)">active</span>';
    return `<tr>
      <td style="font-weight:500">${name}</td>
      <td style="text-align:right;color:var(--text-2)">${stdRate != null ? stdRate.toFixed(2) : '—'}</td>
      <td style="text-align:right;font-weight:500;color:var(--amber)">${parseFloat(d.rate).toFixed(2)}</td>
      <td style="font-size:13px">${d.start_date.substring(0,10)}</td>
      <td style="font-size:13px">${endStr}</td>
      <td style="font-size:12px;color:var(--text-2)">${d.note || '—'}</td>
      <td style="text-align:right">
        <button class="btn" onclick="openDiscountModal(${d.id})" style="padding:3px 8px;font-size:12px">Edit</button>
        <button class="btn btn-danger" onclick="deleteDiscount(${d.id})" style="padding:3px 8px;font-size:12px">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function getStandardRate(dev) {
  // Get current month standard rate from rates table
  const now = new Date();
  const m = MTHS[now.getMonth()];
  return rates[dev.id]?.[m] != null ? parseFloat(rates[dev.id][m]) : null;
}

function getRoleFromRate(dev) {
  // Derive HERE role/seniority from billing rate
  const rate = getStandardRate(dev);
  if (rate == null) return '—';
  const map = [
    [58.14, 'Project Manager'],
    [54.85, 'Lead Engineer'],
    [49.37, 'Sr. Engineer'],
    [47.66, 'Project Manager'],
    [41.99, 'Lead Engineer'],
    [38.40, 'Regular Engineer'],
    [35.17, 'Sr. Engineer'],
    [29.50, 'Regular Engineer'],
  ];
  // find closest match within 0.5 tolerance
  const match = map.find(([r]) => Math.abs(r - rate) < 0.5);
  return match ? match[1] : `€${rate}/h`;
}

function openDiscountModal(id) {
  editingDiscountId = id;
  const disc = id ? developerDiscounts.find(d => d.id === id) : null;

  // Populate developer dropdown
  const sel = document.getElementById('disc-developer');
  const sorted = [...developers].sort((a,b) => a.lastname.localeCompare(b.lastname));
  sel.innerHTML = '<option value="">Select developer...</option>' +
    sorted.map(d => `<option value="${d.id}"${disc && disc.developer_id === d.id ? ' selected' : ''}>${d.firstname} ${d.lastname}</option>`).join('');

  document.getElementById('discount-modal-title').textContent = id ? 'Edit discount' : 'Add discount';
  document.getElementById('disc-rate').value = disc ? disc.rate : '';
  document.getElementById('disc-start').value = disc ? disc.start_date.substring(0,10) : '';
  document.getElementById('disc-end').value = disc?.end_date ? disc.end_date.substring(0,10) : '';
  document.getElementById('disc-note').value = disc?.note || '';

  // Update standard rate display
  if (disc) updateStandardRateDisplay(disc.developer_id);
  sel.onchange = () => updateStandardRateDisplay(parseInt(sel.value));

  document.getElementById('discount-modal').classList.add('open');
}

function updateStandardRateDisplay(devId) {
  const dev = developers.find(d => d.id === devId);
  const stdRate = dev ? getStandardRate(dev) : null;
  document.getElementById('disc-standard-rate').value = stdRate != null ? stdRate.toFixed(2) : '—';
}

async function saveDiscount() {
  const devId = parseInt(document.getElementById('disc-developer').value);
  const rate = parseFloat(document.getElementById('disc-rate').value);
  const start = document.getElementById('disc-start').value;
  const end = document.getElementById('disc-end').value || null;
  const note = document.getElementById('disc-note').value.trim() || null;

  if (!devId) { alert('Please select a developer'); return; }
  if (isNaN(rate) || rate <= 0) { alert('Please enter a valid rate'); return; }
  if (!start) { alert('Start date is required'); return; }

  const payload = {developer_id: devId, rate, start_date: start, end_date: end, note};

  if (editingDiscountId) {
    const {error} = await db.from('developer_discounts').update({...payload, updated_at: new Date().toISOString()}).eq('id', editingDiscountId);
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = developerDiscounts.findIndex(d => d.id === editingDiscountId);
    if (idx >= 0) developerDiscounts[idx] = {...developerDiscounts[idx], ...payload};
  } else {
    const {data, error} = await db.from('developer_discounts').insert(payload).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    developerDiscounts.unshift(data);
  }

  closeModal('discount-modal');
  showToast(editingDiscountId ? 'Discount updated' : 'Discount added');
  renderDiscounts();
  renderRevOverview();
}

async function deleteDiscount(id) {
  if (!confirm('Delete this discount?')) return;
  const {error} = await db.from('developer_discounts').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message); return; }
  developerDiscounts = developerDiscounts.filter(d => d.id !== id);
  showToast('Discount deleted');
  renderDiscounts();
  renderRevOverview();
}

// ============================================================
// TEAM DISCOUNTS MODULE
// ============================================================
let teamDiscounts = [];
let teamDiscountAmounts = {}; // keyed by team_discount_id -> month -> {amount, id}
let editingTeamDiscountId = null;

async function loadTeamDiscounts() {
  const [{data: discounts}, {data: amounts}] = await Promise.all([
    db.from('team_discounts').select('*').order('start_date', {ascending: false}),
    db.from('team_discount_amounts').select('*').eq('year', 2026)
  ]);
  teamDiscounts = discounts || [];
  teamDiscountAmounts = {};
  (amounts||[]).forEach(a => {
    if (!teamDiscountAmounts[a.team_discount_id]) teamDiscountAmounts[a.team_discount_id] = {};
    teamDiscountAmounts[a.team_discount_id][a.month] = {amount: a.amount, id: a.id};
  });
}

function getActiveTeamDiscounts(team, year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  return teamDiscounts.filter(d => {
    if (d.team !== team) return false;
    const start = new Date(d.start_date);
    const end = d.end_date ? new Date(d.end_date) : null;
    if (start > monthEnd) return false;
    if (end && end < monthStart) return false;
    return true;
  });
}

async function saveTeamDiscountAmount(discountId, month, amount) {
  const existing = teamDiscountAmounts[discountId]?.[month];
  const payload = {team_discount_id: discountId, year: 2026, month, amount, updated_at: new Date().toISOString()};
  const {error} = await db.from('team_discount_amounts')
    .upsert(payload, {onConflict: 'team_discount_id,year,month'});
  if (error) { showToast('Error: ' + error.message); return; }
  if (!teamDiscountAmounts[discountId]) teamDiscountAmounts[discountId] = {};
  teamDiscountAmounts[discountId][month] = {amount, id: existing?.id};
  renderRevDetail();
  renderRevOverview();
}

function renderTeamDiscounts() {
  const body = document.getElementById('team-discounts-body');
  if (!body) return;
  if (!teamDiscounts.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No team discounts configured</td></tr>';
    return;
  }
  body.innerHTML = teamDiscounts.map(d => {
    const endStr = d.end_date ? d.end_date.substring(0,10) : '<span style="color:var(--green)">active</span>';
    return `<tr>
      <td style="font-weight:500">${d.team}</td>
      <td style="font-size:13px">${d.start_date.substring(0,10)}</td>
      <td style="font-size:13px">${endStr}</td>
      <td style="font-size:13px;color:var(--text-2)">${d.note || '—'}</td>
      <td style="text-align:right">
        <button class="btn" onclick="openTeamDiscountModal(${d.id})" style="padding:3px 8px;font-size:12px">Edit</button>
        <button class="btn btn-danger" onclick="deleteTeamDiscount(${d.id})" style="padding:3px 8px;font-size:12px">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function openTeamDiscountModal(id) {
  editingTeamDiscountId = id;
  const disc = id ? teamDiscounts.find(d => d.id === id) : null;

  // Populate team dropdown
  const sel = document.getElementById('td-team');
  const teams = getOrderedTeams();
  sel.innerHTML = '<option value="">Select team...</option>' +
    teams.map(t => `<option value="${t}"${disc && disc.team === t ? ' selected' : ''}>${t}</option>`).join('');

  document.getElementById('team-discount-modal-title').textContent = id ? 'Edit team discount' : 'Add team discount';
  document.getElementById('td-start').value = disc ? disc.start_date.substring(0,10) : '';
  document.getElementById('td-end').value = disc?.end_date ? disc.end_date.substring(0,10) : '';
  document.getElementById('td-note').value = disc?.note || '';

  document.getElementById('team-discount-modal').classList.add('open');
}

async function saveTeamDiscount() {
  const team = document.getElementById('td-team').value;
  const start = document.getElementById('td-start').value;
  const end = document.getElementById('td-end').value || null;
  const note = document.getElementById('td-note').value.trim() || null;

  if (!team) { alert('Please select a team'); return; }
  if (!start) { alert('Start date is required'); return; }

  const payload = {team, start_date: start, end_date: end, note, updated_at: new Date().toISOString()};

  if (editingTeamDiscountId) {
    const {error} = await db.from('team_discounts').update(payload).eq('id', editingTeamDiscountId);
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = teamDiscounts.findIndex(d => d.id === editingTeamDiscountId);
    if (idx >= 0) teamDiscounts[idx] = {...teamDiscounts[idx], ...payload};
  } else {
    const {data, error} = await db.from('team_discounts').insert(payload).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    teamDiscounts.unshift(data);
  }

  closeModal('team-discount-modal');
  showToast(editingTeamDiscountId ? 'Discount updated' : 'Discount added');
  renderTeamDiscounts();
}

async function deleteTeamDiscount(id) {
  if (!confirm('Delete this team discount?')) return;
  const {error} = await db.from('team_discounts').delete().eq('id', id);
  if (error) { showToast('Error: ' + error.message); return; }
  teamDiscounts = teamDiscounts.filter(d => d.id !== id);
  showToast('Discount deleted');
  renderTeamDiscounts();
}

// ============================================================
let attImportPending = []; // rows ready to save after conflict resolution
let attImportMonth = null;

function getAttFiltered() {
  const team = document.getElementById('att-filter-team').value;
  const status = document.getElementById('att-filter-status').value;
  return developers.filter(d => {
    // Exclude developers whose only assignments are fixed-price (Selfhosting)
    const hasNonFixed = (d.assignments||[]).some(a => a.team !== 'Selfhosting');
    if (!hasNonFixed) return false;
    const devTeam = getDevCurrentTeam(d);
    let matchTeam = true;
    if (team === '__EU__') matchTeam = EU_TEAMS.includes(devTeam);
    else if (team === '__IND__') matchTeam = IND_TEAMS.includes(devTeam);
    else if (team) matchTeam = (d.assignments||[]).some(a => a.team === team);
    const matchStatus = status === 'all' || d.status === status;
    return matchTeam && matchStatus;
  });
}

function buildAttRow(d) {
  const cells = MTHS.map((m, mi) => {
    const monthNum = mi + 1;
    const hasAssignment = getActiveAssignments(d, 2026, monthNum).length > 0;
    if (!hasAssignment) return `<td style="background:var(--bg);text-align:center;color:#ccc;white-space:nowrap">—</td>`;
    const ah = actualHours[String(d.id)]?.[monthNum];
    let bg, val;
    if (ah && ah.hours != null) {
      bg = ah.source === 'tmsh' ? '#e8f5e9' : '#fff3e0';
      val = parseFloat(ah.hours).toFixed(0) + 'h';
    } else {
      const r = rates[d.id];
      const rate = r ? r[m] : null;
      if (!rate) return `<td style="background:var(--bg);text-align:center;color:#ccc;white-space:nowrap">—</td>`;
      const activeA = getActiveAssignments(d, 2026, monthNum);
      const team = activeA.length ? activeA[activeA.length-1].team : null;
      const tu = team ? teamUtilization[team] : null;
      const util = tu ? tu[m] : null;
      if (util == null) return `<td style="background:var(--bg);text-align:center;color:#ccc;white-space:nowrap">—</td>`;
      const loc = locations.find(l => l.id === d.location_id);
      const maxH = loc ? loc[m] : 160;
      bg = '#e3f2fd';
      val = Math.round(maxH * parseFloat(util)) + 'h';
    }
    const locked = isMonthLocked(monthNum);
    return `<td style="text-align:center;cursor:${locked?'default':'pointer'};background:${bg};white-space:nowrap;padding:6px 10px;opacity:${locked?0.7:1}"
      ${locked ? '' : `onclick="editAttCell(${d.id},${monthNum},this)"`}
      title="${locked?'🔒 Locked':''}">${locked?'🔒 ':''} ${val}</td>`;
  }).join('');
  return cells;
}

function renderAttendance() {
  const body = document.getElementById('att-body');
  const status = getAttStatusFilter();

  if (attSelectedTeam) {
    // ── Single-team view ────────────────────────────────────────────
    const devs = developers.filter(d => {
      if (status !== 'all' && d.status !== status) return false;
      return (d.assignments||[]).some(a => a.team === attSelectedTeam);
    }).sort((a, b) => parseInt(a.nessid||0) - parseInt(b.nessid||0));

    if (!devs.length) { body.innerHTML = '<tr><td colspan="13" class="empty">No developers found</td></tr>'; return; }
    body.innerHTML = devs.map(d => `<tr>
      <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500;white-space:nowrap">${d.firstname} ${d.lastname}</td>
      ${buildAttRow(d)}
    </tr>`).join('');

  } else {
    // ── All-teams view — team header row + dev rows expanded (same as rates) ──
    const devs = developers.filter(d => status !== 'all' ? d.status === status : true);
    const teamDevs = {};
    devs.forEach(d => {
      const team = getDevCurrentTeam(d) || 'Unassigned';
      if (!teamDevs[team]) teamDevs[team] = [];
      teamDevs[team].push(d);
    });
    const orderedTeams = [
      ...getOrderedTeams().filter(t => teamDevs[t]),
      ...Object.keys(teamDevs).filter(t => !EU_TEAMS.includes(t) && !IND_TEAMS.includes(t) && teamDevs[t])
    ];
    if (!orderedTeams.length) { body.innerHTML = '<tr><td colspan="13" class="empty">No developers found</td></tr>'; return; }
    body.innerHTML = orderedTeams.map(team => {
      const tDevs = teamDevs[team];
      const teamRow = `<tr style="background:#f0f4ff;cursor:pointer" onclick="attSelectTeam('${team}')">
        <td colspan="13" style="font-weight:600;font-size:13px;color:var(--blue);padding:8px 12px;border-top:2px solid #dde4f5">
          ${team}
          <span style="font-weight:400;font-size:12px;color:var(--text-2);margin-left:8px">${tDevs.length} developer${tDevs.length!==1?'s':''}</span>
          <span style="float:right;font-size:11px;color:var(--text-3);font-weight:400">›</span>
        </td>
      </tr>`;
      const devRows = tDevs.map(d => `<tr>
        <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500;white-space:nowrap">${d.firstname} ${d.lastname}</td>
        ${buildAttRow(d)}
      </tr>`).join('');
      return teamRow + devRows;
    }).join('');
  }
}

function editAttCell(devId, month, cell) {
  const existing = document.getElementById('att-cell-popup');
  if (existing) existing.remove();

  const dev = developers.find(d => d.id === devId);
  const name = dev ? dev.firstname + ' ' + dev.lastname : '';
  const ah = actualHours[devId]?.[month];
  const curHours = ah?.hours != null ? ah.hours : '';
  const loc = locations.find(l => l.id === dev?.location_id);
  const maxH = loc ? loc[MTHS[month-1]] : 160;

  const rect = cell.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.id = 'att-cell-popup';
  popup.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${Math.min(rect.left, window.innerWidth-280)}px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem;z-index:500;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:250px`;
  popup.innerHTML = `
    <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">${name} — ${MTH_NAMES[month-1]}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">Max hours this month: ${maxH}h</div>
    <input type="text" id="att-hours-input" value="${curHours}" placeholder="e.g. 152"
      style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;margin-bottom:10px"
      onkeydown="if(event.key==='Enter')saveAttCell(${devId},${month});if(event.key==='Escape')closeAttPopup();">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Leave empty to use utilization forecast</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger" onclick="clearAttCell(${devId},${month})" style="padding:6px 10px;font-size:12px">Clear</button>
      <div style="flex:1"></div>
      <button class="btn" onclick="closeAttPopup()">Cancel</button>
      <button class="btn btn-primary" onclick="saveAttCell(${devId},${month})">Save</button>
    </div>`;
  document.body.appendChild(popup);
  document.getElementById('att-hours-input').focus();
  document.getElementById('att-hours-input').select();

  setTimeout(() => {
    document.addEventListener('mousedown', function handler(e) {
      if (!popup.contains(e.target)) { closeAttPopup(); document.removeEventListener('mousedown', handler); }
    });
  }, 100);
}

function closeAttPopup() {
  const p = document.getElementById('att-cell-popup');
  if (p) p.remove();
}

async function saveAttCell(devId, month) {
  const val = parseFloat(document.getElementById('att-hours-input').value);
  closeAttPopup();
  if (isNaN(val) || val < 0) return;
  await upsertActualHours(devId, month, val, 'manual');
  showToast('Hours saved');
  renderAttendance();
  renderRevOverview();
}

async function clearAttCell(devId, month) {
  closeAttPopup();
  const existing = actualHours[devId]?.[month];
  if (existing?.id) {
    await db.from('actual_hours').delete().eq('id', existing.id);
    delete actualHours[devId][month];
  }
  showToast('Cleared — using forecast');
  renderAttendance();
  renderRevOverview();
}

async function upsertActualHours(devId, month, hours, source) {
  if (isMonthLocked(month)) {
    showToast(`Month ${month} is locked 🔒 — write blocked`);
    return;
  }
  const existing = actualHours[devId]?.[month];
  if (existing?.id) {
    await db.from('actual_hours').update({hours, source, updated_at: new Date().toISOString()}).eq('id', existing.id);
    actualHours[devId][month] = {...existing, hours, source};
  } else {
    const {data} = await db.from('actual_hours').insert({developer_id: devId, year: 2026, month, hours, source}).select().single();
    if (!actualHours[devId]) actualHours[devId] = {};
    actualHours[devId][month] = {hours, source, id: data.id};
  }
}

// ---- CSV Import ----
function openAttImport() {
  document.getElementById('att-import-month').value = '';
  document.getElementById('att-import-file').value = '';
  document.getElementById('att-import-modal').classList.add('open');
}

async function processAttImport() {
  const monthVal = document.getElementById('att-import-month').value;
  const fileInput = document.getElementById('att-import-file');

  if (!monthVal) { alert('Please select a month.'); return; }
  if (!fileInput.files.length) { alert('Please select a CSV file.'); return; }

  const month = parseInt(monthVal);
  const file = fileInput.files[0];
  const text = await file.text();

  // Parse CSV
  const lines = text.split('\n').map(l => l.trim().replace(/\r/g, '')).filter(l => l);
  if (!lines.length || !lines[0].toLowerCase().includes('ness_id')) {
    alert('Invalid CSV format. Expected header: NESS_ID,Hours');
    return;
  }

  const csvRows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 2) continue;
    const nessid = parts[0].trim();
    const hours = parseFloat(parts[1].trim());
    if (!nessid || isNaN(hours)) continue;
    csvRows.push({nessid, hours});
  }

  // Match to developers
  const toImport = [];   // {dev, hours} — new entries, no conflict
  const conflicts = [];  // {dev, existing, newHours} — already have manual hours

  for (const row of csvRows) {
    // Skip hours <= 40 (threshold)
    if (row.hours <= 40) continue;

    const dev = developers.find(d => d.nessid === row.nessid);
    if (!dev) continue;

    // Check if developer has active assignment this month
    const active = getActiveAssignments(dev, 2026, month);
    if (!active.length) continue;

    const existing = actualHours[String(dev.id)]?.[month];
    if (existing && existing.hours != null && existing.source === 'manual') {
      // Conflict — already has manual hours
      conflicts.push({dev, existingHours: existing.hours, newHours: row.hours, existingId: existing.id});
    } else {
      toImport.push({dev, hours: row.hours});
    }
  }

  closeModal('att-import-modal');
  attImportMonth = month;

  if (conflicts.length > 0) {
    // Show conflict resolution dialog
    attImportPending = {toImport, conflicts};
    const tbody = document.getElementById('att-conflict-body');
    tbody.innerHTML = conflicts.map((c, i) => `
      <tr>
        <td style="text-align:center"><input type="checkbox" id="conf-cb-${i}" checked></td>
        <td>${c.dev.firstname} ${c.dev.lastname}</td>
        <td style="text-align:right">${c.existingHours}h</td>
        <td style="text-align:right;font-weight:500;color:var(--blue)">${c.newHours}h</td>
      </tr>`).join('');
    document.getElementById('att-conflict-all').checked = true;
    document.getElementById('att-conflict-modal').classList.add('open');
  } else {
    // No conflicts — import directly
    await executeAttImport(toImport, []);
  }
}

function toggleAllConflicts(checked) {
  document.querySelectorAll('[id^="conf-cb-"]').forEach(cb => cb.checked = checked);
}

async function confirmAttImport() {
  const {toImport, conflicts} = attImportPending;
  // Get selected conflicts to overwrite
  const selectedConflicts = conflicts.filter((c, i) => {
    const cb = document.getElementById(`conf-cb-${i}`);
    return cb && cb.checked;
  });
  closeModal('att-conflict-modal');
  await executeAttImport(toImport, selectedConflicts);
}

async function executeAttImport(toImport, selectedConflicts) {
  let count = 0;
  const month = attImportMonth;

  // Import new entries
  for (const {dev, hours} of toImport) {
    await upsertActualHours(dev.id, month, hours, 'manual');
    count++;
  }

  // Overwrite selected conflicts
  for (const {dev, newHours} of selectedConflicts) {
    await upsertActualHours(dev.id, month, newHours, 'manual');
    count++;
  }

  showToast(`Imported ${count} developers for ${MTH_NAMES[month-1]}`);
  renderAttendance();
  renderRevOverview();
  renderRevDetail();
}

// ============================================================
// LOCATIONS MODULE
// ============================================================
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let locations = [];
let editingLocId = null;

async function loadLocations() {
  const {data, error} = await db.from('locations').select('*').order('name');
  if (error) { showToast('Error loading locations: ' + error.message); return; }
  locations = data || [];
  populateLocationDropdown();
}

function populateLocationDropdown() {
  const sel = document.getElementById('f-location');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select...</option>' +
    locations.map(l => `<option value="${l.id}"${l.id==cur?' selected':''}>${l.name}</option>`).join('');
}

// Weekdays per month for 2026 (Mon-Fri only)
const WEEKDAYS_2026 = [22, 20, 22, 22, 21, 22, 23, 21, 22, 22, 21, 23];

function renderLocations() {
  const body = document.getElementById('locations-body');
  const hBody = document.getElementById('locations-holidays-body');
  if (!locations.length) {
    body.innerHTML = '<tr><td colspan="15" class="empty">No locations yet. Click "+ Add location" to add one.</td></tr>';
    if (hBody) hBody.innerHTML = '';
    return;
  }
  body.innerHTML = locations.map(loc => {
    const total = MONTHS.reduce((sum, m) => sum + (loc[m] || 0), 0);
    const cells = MONTHS.map(m => `<td style="text-align:center">${loc[m] || 0}</td>`).join('');
    return `<tr>
      <td><strong style="font-weight:500">${loc.name}</strong></td>
      ${cells}
      <td style="text-align:center;font-weight:500;color:var(--blue)">${total}</td>
      <td style="text-align:center">
        <button class="btn" onclick="openEditLocation(${loc.id})" style="padding:3px 10px;font-size:12px">Edit</button>
      </td>
    </tr>`;
  }).join('');

  // Holidays table — show calculated / defined
  if (hBody) {
    hBody.innerHTML = locations.map(loc => {
      const holidays = MONTHS.map((m, i) => {
        const workHours = loc[m] || 0;
        const maxHours = WEEKDAYS_2026[i] * 8;
        const calc = Math.round(((maxHours - workHours) / 8) * 10) / 10;
        // Count defined holidays for this location in this month
        const monthNum = i + 1;
        const defined = publicHolidays.filter(h => {
          if (h.location_id !== loc.id) return false;
          const d = new Date(h.date);
          return d.getFullYear() === 2026 && d.getMonth() + 1 === monthNum;
        }).length;
        return { calc, defined };
      });
      const totalCalc = holidays.reduce((s, v) => s + v.calc, 0);
      const totalDefined = holidays.reduce((s, v) => s + v.defined, 0);
      const cells = holidays.map(({ calc, defined }) => {
        const hasCalc = calc > 0;
        const match = defined === calc;
        const bg = !hasCalc && !defined ? 'color:var(--text-3)' :
                   match ? 'background:var(--green-lt);color:var(--green);font-weight:500' :
                   'background:var(--blue-lt);color:var(--blue);font-weight:500';
        const text = !hasCalc && !defined ? '—' :
                     defined > 0 ? `${calc}/${defined}` : `${calc}`;
        return `<td style="text-align:center;${bg}">${text}</td>`;
      }).join('');
      const totalBg = totalDefined === totalCalc && totalCalc > 0 ? 'color:var(--green);' : 'color:var(--blue);';
      const totalText = totalDefined > 0 ? `${totalCalc}/${totalDefined}` : `${totalCalc}`;
      return `<tr>
        <td style="font-weight:500">${loc.name}</td>
        ${cells}
        <td style="text-align:center;font-weight:600;${totalBg}">${totalText}</td>
        <td></td>
      </tr>`;
    }).join('');
  }
}

function openAddLocation() {
  editingLocId = null;
  document.getElementById('loc-modal-title').textContent = 'Add location';
  document.getElementById('loc-btn-delete').style.display = 'none';
  document.getElementById('loc-name').value = '';
  MONTHS.forEach(m => document.getElementById('loc-' + m).value = '');
  document.getElementById('loc-modal').classList.add('open');
}

function openEditLocation(id) {
  const loc = locations.find(l => l.id === id);
  if (!loc) return;
  editingLocId = id;
  document.getElementById('loc-modal-title').textContent = 'Edit location';
  document.getElementById('loc-btn-delete').style.display = 'block';
  document.getElementById('loc-name').value = loc.name;
  MONTHS.forEach(m => document.getElementById('loc-' + m).value = loc[m] || '');
  document.getElementById('loc-modal').classList.add('open');
}

async function saveLoc() {
  const name = document.getElementById('loc-name').value.trim();
  if (!name) { alert('Location name is required.'); return; }
  const data = { name };
  MONTHS.forEach(m => data[m] = parseInt(document.getElementById('loc-' + m).value) || 0);
  if (editingLocId) {
    const {error} = await db.from('locations').update(data).eq('id', editingLocId);
    if (error) { showToast('Error: ' + error.message); return; }
    showToast('Location updated');
  } else {
    const {error} = await db.from('locations').insert(data);
    if (error) { showToast('Error: ' + error.message); return; }
    showToast('Location added');
  }
  closeModal('loc-modal');
  await loadLocations();
}

async function deleteLoc() {
  if (!confirm('Delete this location? Make sure no developers are assigned to it.')) return;
  const {error} = await db.from('locations').delete().eq('id', editingLocId);
  if (error) { showToast('Error: ' + error.message); return; }
  closeModal('loc-modal');
  showToast('Location deleted');
  await loadLocations();
}
// ============================================================
// DEV ORDER MODULE
// ============================================================

function renderDevOrder() {
  const container = document.getElementById('dev-order-container');
  if (!container) return;

  const allTeams = [...EU_TEAMS, ...IND_TEAMS].filter(t => t !== 'Selfhosting');

  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem;max-width:1200px">';

  allTeams.forEach(team => {
    const teamDevs = developers.filter(d =>
      (d.assignments||[]).some(a => a.team === team && a.billable !== false)
    );
    if (!teamDevs.length) return;

    const sorted = sortDevsByOrder(teamDevs);

    html += `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem">
      <div style="font-weight:600;font-size:13px;color:var(--blue);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">${team}</div>
      <div id="devorder-team-${team.replace(/[^a-z0-9]/gi,'_')}">
        ${sorted.map((dev, idx) => `
          <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-light,#f0f0f0)" data-dev-id="${dev.id}">
            <span style="font-size:12px;color:var(--text-3);min-width:20px;text-align:right">${getDevPosition(dev.id)}</span>
            <span style="flex:1;font-size:13px">${dev.firstname} ${dev.lastname}</span>
            <button onclick="moveDevOrder(${dev.id},'up','${team}')" style="border:none;background:none;cursor:pointer;padding:2px 5px;color:var(--text-2);font-size:14px" title="Move up">▲</button>
            <button onclick="moveDevOrder(${dev.id},'down','${team}')" style="border:none;background:none;cursor:pointer;padding:2px 5px;color:var(--text-2);font-size:14px" title="Move down">▼</button>
          </div>`).join('')}
      </div>
    </div>`;
  });

  html += '</div>';
  container.innerHTML = html;
}

async function moveDevOrder(devId, direction, team) {
  // Get all devs in this team sorted by current position
  const teamDevs = developers.filter(d =>
    (d.assignments||[]).some(a => a.team === team && a.billable !== false)
  );
  const sorted = sortDevsByOrder(teamDevs);
  const idx = sorted.findIndex(d => d.id === devId);
  if (idx === -1) return;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;

  const devA = sorted[idx];
  const devB = sorted[swapIdx];
  const posA = getDevPosition(devA.id);
  const posB = getDevPosition(devB.id);

  // Swap positions
  const updates = [
    { developer_id: devA.id, position: posB },
    { developer_id: devB.id, position: posA }
  ];

  for (const u of updates) {
    const { error } = await db.from('developer_order')
      .upsert(u, { onConflict: 'developer_id' });
    if (error) { showToast('Error: ' + error.message); return; }
    devOrderData[u.developer_id] = u.position;
  }

  renderDevOrder();
}

// ============================================================
// LINKED TEAMS SETTINGS
// ============================================================

function renderLinkedTeams() {
  const container = document.getElementById('settings-linkedteams');
  if (!container) return;

  // Get all available teams for the checkboxes
  const allTeams = [...EU_TEAMS, ...IND_TEAMS].sort();

  if (!purchaseOrders || !purchaseOrders.length) {
    container.innerHTML = '<div style="color:var(--text-3);font-size:13px">No purchase orders loaded.</div>';
    return;
  }

  // Only T&M POs make sense for linked teams
  const tmPOs = [...purchaseOrders].sort((a, b) => (a.position||999) - (b.position||999))
    .filter(po => po.po_type === 'tm');

  let html = `<div style="font-size:12px;color:var(--text-2);margin-bottom:1.25rem;line-height:1.6">
    Link additional teams to a PO so their hours are included in PO utilization tracking.
    Used for combined EU+India projects (e.g. 3D Visuals EU covers both <em>3D Visuals EU</em> and <em>3D Visuals IN</em>).
  </div>
  <table style="border-collapse:collapse;width:100%;max-width:860px;font-size:13px">
    <thead>
      <tr style="color:var(--text-3);font-size:11px;border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:6px 12px;width:140px">PO Number</th>
        <th style="text-align:left;padding:6px 12px;width:180px">Primary Team</th>
        <th style="text-align:left;padding:6px 12px">Linked Teams</th>
        <th style="width:80px"></th>
      </tr>
    </thead>
    <tbody>`;

  tmPOs.forEach(po => {
    const linked = (po.linked_teams || '').split(',').map(t => t.trim()).filter(Boolean);
    const linkedDisplay = linked.length
      ? linked.map(t => `<span style="display:inline-block;background:var(--blue-lt);color:var(--blue);border-radius:4px;padding:2px 8px;font-size:11px;margin:2px 3px 2px 0">${t}</span>`).join('')
      : `<span style="color:var(--text-3);font-size:12px">None</span>`;

    html += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 12px;font-weight:500">${po.po_number}</td>
      <td style="padding:8px 12px;color:var(--text-2)">${po.team}</td>
      <td style="padding:8px 12px">${linkedDisplay}</td>
      <td style="padding:8px 8px;text-align:right">
        <button class="btn" onclick="openLinkedTeamsEdit('${po.id}')" style="font-size:11px;padding:3px 10px">Edit</button>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function openLinkedTeamsEdit(poId) {
  const po = purchaseOrders.find(p => p.id === poId);
  if (!po) return;

  const allTeams = [...EU_TEAMS, ...IND_TEAMS].filter(t => t !== po.team).sort();
  const linked = (po.linked_teams || '').split(',').map(t => t.trim()).filter(Boolean);

  const existing = document.getElementById('linked-teams-popup');
  if (existing) existing.remove();

  const checkboxes = allTeams.map(t => {
    const checked = linked.includes(t) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;font-size:13px">
      <input type="checkbox" value="${t}" ${checked} style="cursor:pointer"> ${t}
    </label>`;
  }).join('');

  const popup = document.createElement('div');
  popup.id = 'linked-teams-popup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.25rem;z-index:500;box-shadow:0 8px 32px rgba(0,0,0,0.15);min-width:320px;max-width:420px';
  popup.innerHTML = `
    <div style="font-weight:600;font-size:14px;margin-bottom:4px">${po.po_number}</div>
    <div style="font-size:12px;color:var(--text-2);margin-bottom:1rem">Primary team: ${po.team}</div>
    <div style="font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">Link additional teams:</div>
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:1rem">
      ${checkboxes}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" onclick="document.getElementById('linked-teams-popup').remove()">Cancel</button>
      <button class="btn btn-primary" onclick="saveLinkedTeams('${po.id}')">Save</button>
    </div>`;

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'linked-teams-backdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:499';
  backdrop.onclick = () => { popup.remove(); backdrop.remove(); };
  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
}

async function saveLinkedTeams(poId) {
  const popup = document.getElementById('linked-teams-popup');
  const backdrop = document.getElementById('linked-teams-backdrop');
  const checked = [...popup.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
  const linked = checked.length ? checked.join(', ') : null;

  const { error } = await db.from('purchase_orders').update({ linked_teams: linked }).eq('id', poId);
  if (error) { showToast('Error: ' + error.message); return; }

  const po = purchaseOrders.find(p => p.id === poId);
  if (po) po.linked_teams = linked;

  popup.remove();
  if (backdrop) backdrop.remove();
  showToast('Linked teams saved');
  renderLinkedTeams();
}
