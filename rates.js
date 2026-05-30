// ============================================================
// RATES MODULE
// ============================================================
let rates = {};  // keyed by developer_id
let ratesSelectedTeam = null;

async function loadRates() {
  const {data, error} = await db.from('rates').select('*').eq('year', 2026);
  if (error) { showToast('Error loading rates: ' + error.message); return; }
  rates = {};
  (data||[]).forEach(r => { rates[r.developer_id] = r; });
  renderRates();
}

function getRatesStatusFilter() {
  if (ratesSelectedTeam) return document.getElementById('rates-filter-status2').value;
  return document.getElementById('rates-filter-status').value;
}

function getOrderedRatesTeams() {
  const status = getRatesStatusFilter();
  const today = new Date(); today.setHours(0,0,0,0);
  const visibleDevs = developers.filter(d => {
    if (status === 'active') return d.status === 'active';
    if (status === 'has_assignment') return (d.assignments||[]).length > 0;
    return true;
  });
  const allTeams = [...new Set(visibleDevs.flatMap(d => (d.assignments||[]).filter(a => {
    const start = a.start_date ? new Date(a.start_date) : null;
    const end = a.end_date ? new Date(a.end_date) : null;
    if (start && start > today) return false;
    if (end && end < today) return false;
    return true;
  }).map(a => a.team)).filter(Boolean))];
  const ordered = getOrderedTeams().filter(t => allTeams.includes(t));
  const rest = allTeams.filter(t => !EU_TEAMS.includes(t) && !IND_TEAMS.includes(t)).sort();
  return [...ordered, ...rest];
}

function ratesSelectTeam(team, keepFilter) {
  ratesSelectedTeam = team;
  document.getElementById('rates-toolbar-all').style.display = 'none';
  document.getElementById('rates-toolbar-team').style.display = '';
  document.getElementById('rates-team-title-row').style.display = '';
  document.getElementById('rates-team-title').textContent = team;
  if (!keepFilter) {
    const s = document.getElementById('rates-filter-status').value;
    document.getElementById('rates-filter-status2').value = s;
  }
  renderRates();
}

function ratesBackToAll() {
  ratesSelectedTeam = null;
  document.getElementById('rates-toolbar-all').style.display = '';
  document.getElementById('rates-toolbar-team').style.display = 'none';
  document.getElementById('rates-team-title-row').style.display = 'none';
  renderRates();
}

function ratesPrevTeam() {
  const teams = getOrderedRatesTeams();
  const idx = teams.indexOf(ratesSelectedTeam);
  ratesSelectTeam(teams[(idx - 1 + teams.length) % teams.length], true);
}

function ratesNextTeam() {
  const teams = getOrderedRatesTeams();
  const idx = teams.indexOf(ratesSelectedTeam);
  ratesSelectTeam(teams[(idx + 1) % teams.length], true);
}

function switchRatesView(v) { renderRates(); }

let ratesSort = {field: 'lastname', dir: 'asc'};

function setRatesSort(field) {
  if (ratesSort.field === field) {
    ratesSort.dir = ratesSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    ratesSort.field = field;
    ratesSort.dir = 'asc';
  }
  renderRates();
}

function ratesSortArrow(field) {
  if (ratesSort.field !== field) return '<span style="color:#ccc;font-size:10px"> ⇅</span>';
  return ratesSort.dir === 'asc' ? '<span style="font-size:10px"> ▲</span>' : '<span style="font-size:10px"> ▼</span>';
}

function getRatesFiltered() {
  const status = getRatesStatusFilter();
  return developers.filter(d => {
    const matchTeam = ratesSelectedTeam ? (d.assignments||[]).some(a => a.team === ratesSelectedTeam) : true;
    let matchStatus = true;
    if (status === 'active') matchStatus = d.status === 'active';
    else if (status === 'has_assignment') matchStatus = (d.assignments||[]).length > 0;
    return matchTeam && matchStatus;
  });
}

function renderRates() {
  const raw = getRatesFiltered();
  const body = document.getElementById('rates-body');

  // Helper to build rate cells for a developer
  function buildRateCells(d, teamFilter) {
    const r = rates[d.id] || {};
    return MTHS.map((m, i) => {
      const monthNum = i + 1;
      let hasAssignment;
      if (teamFilter && teamFilter !== '__EU__' && teamFilter !== '__IND__') {
        hasAssignment = getActiveAssignments(d, 2026, monthNum).some(a => a.team === teamFilter);
      } else {
        hasAssignment = getActiveAssignments(d, 2026, monthNum).length > 0;
      }
      if (!hasAssignment) return `<td style="text-align:center;background:var(--bg);color:#ccc">—</td>`;
      const val = r[m] != null ? r[m] : '';
      const prev = i > 0 ? r[MTHS[i-1]] : null;
      const changed = val && prev && parseFloat(val) !== parseFloat(prev);
      const bg = changed ? 'background:#fff8e1;font-weight:500;color:var(--amber)' : '';
      return `<td style="text-align:center;cursor:pointer;${bg}" onclick="editRateCell(${d.id},'${m}',this)">${val ? parseFloat(val).toFixed(2) : '<span style="color:#ccc">—</span>'}</td>`;
    }).join('');
  }

  if (ratesSelectedTeam) {
    // Single team view
    if (!raw.length) { body.innerHTML = '<tr><td colspan="13" class="empty">No developers found</td></tr>'; return; }
    body.innerHTML = sortDevsByOrder(raw).map(d => `<tr>
      <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500">${d.firstname} ${d.lastname}</td>
      ${buildRateCells(d, ratesSelectedTeam)}
    </tr>`).join('');

  } else {
    // All teams view
    const teamDevs = {};
    sortDevsByOrder(raw).forEach(d => {
      const team = getDevCurrentTeam(d) || 'Unassigned';
      if (!teamDevs[team]) teamDevs[team] = [];
      teamDevs[team].push(d);
    });
    const orderedTeams = [
      ...getOrderedTeams().filter(t => teamDevs[t]),
      ...Object.keys(teamDevs).filter(t => !EU_TEAMS.includes(t) && !IND_TEAMS.includes(t))
    ];
    if (!orderedTeams.length) { body.innerHTML = '<tr><td colspan="13" class="empty">No developers found</td></tr>'; return; }
    body.innerHTML = orderedTeams.map(team => {
      const devs = teamDevs[team];
      const teamRow = `<tr style="background:#f0f4ff;cursor:pointer" onclick="ratesSelectTeam('${team}')">
        <td colspan="13" style="font-weight:600;font-size:13px;color:var(--blue);padding:8px 12px;border-top:2px solid #dde4f5">
          ${team}
          <span style="font-weight:400;font-size:12px;color:var(--text-2);margin-left:8px">${devs.length} developer${devs.length!==1?'s':''}</span>
          <span style="float:right;font-size:11px;color:var(--text-3);font-weight:400">›</span>
        </td>
      </tr>`;
      const devRows = devs.map(d => `<tr>
        <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500">${d.firstname} ${d.lastname}</td>
        ${buildRateCells(d, team)}
      </tr>`).join('');
      return teamRow + devRows;
    }).join('');
  }
}

function editRateCell(devId, month, cell) {
  const mthNum = MTHS.indexOf(month) + 1;
  if (checkMonthLocked(mthNum, 'rate edit')) return;

  const existing = document.getElementById('rate-popup');
  if (existing) existing.remove();

  const mths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthIdx = mths.indexOf(month);
  const cur = rates[devId]?.[month] || '';
  const devName = developers.find(d=>d.id===devId);
  const name = devName ? devName.firstname+' '+devName.lastname : '';

  const rect = cell.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.id = 'rate-popup';
  popup.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem;z-index:500;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:230px`;
  popup.innerHTML = `
    <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">${name} — ${mthNames[monthIdx]}</div>
    <input type="text" id="rate-input" value="${cur}" placeholder="e.g. 49.37"
      style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;margin-bottom:10px"
      onkeydown="if(event.key==='Enter')confirmRateSave(${devId},'${month}');if(event.key==='Escape')closeRatePopup();">
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger" onclick="confirmRateClear(${devId},'${month}')" style="padding:6px 10px;font-size:12px" title="Clear rate — indicates no active PO">Clear</button>
      <div style="flex:1"></div>
      <button class="btn" onclick="closeRatePopup()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmRateSave(${devId},'${month}')">Save</button>
    </div>
    <div style="font-size:11px;color:var(--text-3);margin-top:8px">Clear = no active PO for this month</div>`;
  document.body.appendChild(popup);
  document.getElementById('rate-input').focus();
  document.getElementById('rate-input').select();

  setTimeout(() => {
    document.addEventListener('mousedown', function handler(e) {
      if (!popup.contains(e.target) && e.target !== cell) {
        closeRatePopup();
        document.removeEventListener('mousedown', handler);
      }
    });
  }, 100);
}

function closeRatePopup() {
  const p = document.getElementById('rate-popup');
  if (p) p.remove();
}

async function confirmRateClear(devId, month) {
  if (checkMonthLocked(MTHS.indexOf(month) + 1, 'rate clear')) return;
  closeRatePopup();
  const mths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthIdx = mths.indexOf(month);
  const remaining = mths.slice(monthIdx + 1);
  const remainingNames = mthNames.slice(monthIdx + 1);

  let applyAll = false;
  if (remaining.length > 0) {
    applyAll = confirm(`Clear rate for ${mthNames[monthIdx]} only, or also for remaining months (${remainingNames.join(', ')})?\n\nOK = clear all remaining months, Cancel = this month only.`);
  }

  const monthsToUpdate = applyAll ? mths.slice(monthIdx) : [month];
  const updateObj = {};
  monthsToUpdate.forEach(m => updateObj[m] = null);

  const existing = rates[devId];
  if (existing) {
    const {error} = await db.from('rates').update(updateObj).eq('id', existing.id);
    if (error) { showToast('Error: ' + error.message); return; }
    monthsToUpdate.forEach(m => rates[devId][m] = null);
  }
  showToast(applyAll ? `Rate cleared for ${monthsToUpdate.length} months` : 'Rate cleared');
  renderRates();
}

async function confirmRateSave(devId, month) {
  if (checkMonthLocked(MTHS.indexOf(month) + 1, 'rate save')) return;
  const input = document.getElementById('rate-input');
  const val = parseFloat(input.value);
  if (isNaN(val) || val <= 0) { closeRatePopup(); return; }
  closeRatePopup();

  const mths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthIdx = mths.indexOf(month);
  const remaining = mths.slice(monthIdx + 1);
  const remainingNames = mthNames.slice(monthIdx + 1);

  let applyAll = false;
  if (remaining.length > 0) {
    applyAll = confirm(`Apply rate ${val} EUR to ${mthNames[monthIdx]} only, or also to remaining months (${remainingNames.join(', ')})?\n\nOK = apply to all remaining months, Cancel = this month only.`);
  }

  const monthsToUpdate = applyAll ? mths.slice(monthIdx) : [month];
  const updateObj = {};
  monthsToUpdate.forEach(m => updateObj[m] = val);

  const existing = rates[devId];
  if (existing) {
    const {error} = await db.from('rates').update(updateObj).eq('id', existing.id);
    if (error) { showToast('Error: ' + error.message); return; }
    monthsToUpdate.forEach(m => rates[devId][m] = val);
  } else {
    const {data, error} = await db.from('rates').insert({developer_id: devId, year: 2026, ...updateObj}).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    rates[devId] = data;
  }
  showToast(applyAll ? `Rate updated for ${monthsToUpdate.length} months` : 'Rate updated');
  renderRates();
}

function exportRates() {
  const filtered = getRatesFiltered();
  const mths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const rows = filtered.map(d => {
    const r = rates[d.id] || {};
    const row = {'Developer': d.firstname+' '+d.lastname, 'NESS ID': d.nessid, 'Team': getDevCurrentTeam(d)||''};
    mths.forEach((m,i) => { row[mthNames[i]] = r[m] != null ? parseFloat(r[m]) : ''; });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rates 2026');
  XLSX.writeFile(wb, 'HERE_Rates_2026.xlsx');
}