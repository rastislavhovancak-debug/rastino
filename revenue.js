// ============================================================
// REVENUE MODULE
// ============================================================
const ALL_TEAMS = () => {
  const ordered = getOrderedTeams().filter(t => t !== 'Selfhosting');
  const result = [];
  for (const t of ordered) {
    result.push(t);
    if (t === 'Connected veh. ser.') result.push('CVS Oncall');
  }
  // Insert Selfhosting after last EU team, before India teams
  const lastEuIdx = result.reduce((idx, t, i) => EU_TEAMS.includes(t) ? i : idx, -1);
  result.splice(lastEuIdx + 1, 0, 'Selfhosting');
  return result;
};

let teamUtilization = {};   // keyed by team name
let actualHours = {};       // keyed by developer_id -> month -> {hours, source}

// Selfhosting fixed-price data
let selfhostingServices = [];  // [{id, name, type, rate, position}]
let selfhostingActuals = {};   // keyed by service_id -> month -> count
let selfhostingForecast = {};  // keyed by month -> {releases, is_locked}

async function loadSelfhosting() {
  const [{data: svcs}, {data: acts}, {data: fcst}] = await Promise.all([
    db.from('selfhosting_services').select('*').order('position'),
    db.from('selfhosting_actuals').select('*').eq('year', 2026),
    db.from('selfhosting_forecast').select('*').eq('year', 2026)
  ]);
  selfhostingServices = svcs || [];
  selfhostingActuals = {};
  (acts||[]).forEach(a => {
    if (!selfhostingActuals[a.service_id]) selfhostingActuals[a.service_id] = {};
    selfhostingActuals[a.service_id][a.month] = a.count;
  });
  selfhostingForecast = {};
  (fcst||[]).forEach(f => { selfhostingForecast[f.month] = {releases: f.releases, is_locked: f.is_locked || false, id: f.id}; });
}

// Calculate selfhosting revenue for a month
function calcSelfhostingRevenue(monthIdx) {
  const m = monthIdx + 1;
  const fixed = selfhostingServices.filter(s => s.type === 'fixed');
  const releases = selfhostingServices.filter(s => s.type === 'release');

  const fixedRev = fixed.reduce((sum, s) => sum + parseFloat(s.rate), 0);
  const releaseRate = releases.length ? parseFloat(releases[0].rate) : 3930;

  const fcst = selfhostingForecast[m] || {releases: 0, is_locked: false};
  const isLocked = fcst.is_locked;
  const hasActuals = releases.some(s => (selfhostingActuals[s.id]?.[m] || 0) > 0);

  let releaseRev = 0;
  let type;

  if (isLocked) {
    // Locked — use sum of actuals, show green
    const actualCount = releases.reduce((sum, s) => sum + (selfhostingActuals[s.id]?.[m] || 0), 0);
    releaseRev = actualCount * releaseRate;
    type = 'tmsh'; // green
  } else if (hasActuals) {
    // Actuals entered but not locked yet — yellow
    const actualCount = releases.reduce((sum, s) => sum + (selfhostingActuals[s.id]?.[m] || 0), 0);
    releaseRev = actualCount * releaseRate;
    type = 'manual'; // yellow
  } else {
    // No actuals — use forecast, blue
    releaseRev = (fcst.releases || 0) * releaseRate;
    type = 'utilization'; // blue
  }

  return {revenue: fixedRev + releaseRev, type, fixedRev, releaseRev, isLocked, hasActuals};
}
let revView = 'overview';

async function loadRevenue() {
  const [{data: tu}, {data: ah}] = await Promise.all([
    db.from('team_utilization').select('*').eq('year', 2026),
    db.from('actual_hours').select('*').eq('year', 2026)
  ]);
  teamUtilization = {};
  (tu||[]).forEach(r => { teamUtilization[r.team] = r; });
  actualHours = {};
  (ah||[]).forEach(r => {
    const ahKey = String(r.developer_id);
    if (!actualHours[ahKey]) actualHours[ahKey] = {};
    actualHours[ahKey][r.month] = {hours: r.hours, source: r.source, id: r.id};
  });
  renderRevenue();
}

function switchRevView(v) {
  revView = v;
  document.getElementById('btn-rev-overview').classList.toggle('active', v==='overview');
  document.getElementById('btn-rev-split').classList.toggle('active', v==='split');
  document.getElementById('btn-rev-detail').classList.toggle('active', v==='detail');
  document.getElementById('btn-rev-devdetail').classList.toggle('active', v==='devdetail');
  document.getElementById('rev-overview-view').style.display = v==='overview' ? '' : 'none';
  document.getElementById('rev-split-view').style.display = v==='split' ? '' : 'none';
  const statsRow = document.getElementById('rev-stats-row');
  if (statsRow) statsRow.style.display = (v==='overview' || v==='split') ? '' : 'none';
  document.getElementById('rev-detail-view').style.display = v==='detail' ? '' : 'none';
  document.getElementById('rev-devdetail-view').style.display = v==='devdetail' ? '' : 'none';
  document.getElementById('rev-selfhosting-view').style.display = v==='selfhosting' ? '' : 'none';
  document.getElementById('rev-cvs-oncall-view').style.display = v==='cvs-oncall' ? '' : 'none';
  // Show/hide nav zone in unified toolbar
  const navZone = document.getElementById('rev-nav-zone');
  const monthZone = document.getElementById('rev-month-zone');
  const inDetail = v==='detail' || v==='devdetail';
  if (navZone) navZone.style.display = inDetail ? 'flex' : 'none';
  if (monthZone) monthZone.style.display = v==='devdetail' ? 'flex' : 'none';
  if (v==='detail') { revDetailOpen(revDetailCurrentTeam); }
  if (v==='devdetail') { revDevDetailOpen(revDevDetailCurrentTeam); }
  if (v==='overview') renderRevOverview();
  if (v==='split') renderRevSplit();
}

// Unified nav back/prev/next — delegates to active view
function revNavBack() {
  if (revView === 'detail') revDetailBackToAll();
  else if (revView === 'devdetail') revDevDetailBackToAll();
}
function revNavPrev() {
  if (revView === 'detail') revDetailPrevTeam();
  else if (revView === 'devdetail') revDevDetailPrevTeam();
}
function revNavNext() {
  if (revView === 'detail') revDetailNextTeam();
  else if (revView === 'devdetail') revDevDetailNextTeam();
}

// Calculate revenue for one developer for one month
function calcRevenue(dev, monthIdx, teamFilter) {
  const m = monthIdx + 1; // 1-based month
  const mKey = MTHS[monthIdx];
  const r = rates[dev.id];
  const stdRate = r ? parseFloat(r[mKey]) : null;

  // Get active assignments for this month — skip non-billable (e.g. On-Call assignments)
  let activeAssignments = getActiveAssignments(dev, 2026, m).filter(a => a.billable !== false);
  if (!activeAssignments.length) return {revenue: null, type: 'nopo'};

  // If a team filter is specified, only consider that team's assignment
  if (teamFilter) {
    activeAssignments = activeAssignments.filter(a => a.team === teamFilter);
    if (!activeAssignments.length) return {revenue: null, type: 'nopo'};
  }

  if (!stdRate) return {revenue: null, type: 'nopo'};

  // Check for active discount this month
  const discountedRate = getDiscountedRate(dev.id, 2026, m);
  const rate = discountedRate != null ? discountedRate : stdRate;
  const hasDiscount = discountedRate != null && discountedRate !== stdRate;

  // Check if this is a partial month
  const partial = isPartialMonth(dev, 2026, m);

  // Check actual hours first (manual or tmsh)
  const ah = actualHours[String(dev.id)]?.[m];
  if (ah && ah.hours != null) {
    const hours = parseFloat(ah.hours);
    const revenue = hours * stdRate;
    const discountAmt = hasDiscount ? hours * (discountedRate - stdRate) : 0;
    return {revenue, hours, type: ah.source, hasDiscount, discountAmt, stdRate, discountedRate};
  }

  // Partial month with no manual entry yet
  if (partial) {
    const loc = locations.find(l => l.id === dev.location_id);
    const maxHours = loc ? loc[mKey] : 160;
    return {revenue: null, hours: maxHours, type: 'partial'};
  }

  // Fall back to team utilization forecast
  const team = activeAssignments[activeAssignments.length - 1].team;
  const tu = teamUtilization[team];
  const util = tu ? tu[mKey] : null;
  if (util == null) return {revenue: null, type: 'nopo'};

  const loc = locations.find(l => l.id === dev.location_id);
  const maxHours = loc ? loc[mKey] : 160;
  const forecastHours = maxHours * parseFloat(util);
  const revenue = forecastHours * stdRate;
  const discountAmt = hasDiscount ? forecastHours * (discountedRate - stdRate) : 0;
  return {revenue, hours: forecastHours, type: 'utilization', hasDiscount, discountAmt, stdRate, discountedRate};
}

function cellStyle(type) {
  if (type === 'tmsh')        return 'background:var(--green-lt);';
  if (type === 'manual')      return 'background:var(--amber-lt);';
  if (type === 'utilization') return 'background:var(--blue-lt);';
  if (type === 'partial')     return 'background:#fff0f0;border:1px solid #ffaaaa;';
  return 'background:#f9f9f9;color:#ccc;';
}

let revCurrency = 'eur'; // 'eur' | 'usd'

function setRevCurrency(cur) {
  revCurrency = cur;
  // Update button styles
  const isUsd = cur === 'usd';
  const eurBtn = document.getElementById('btn-rev-eur');
  const usdBtn = document.getElementById('btn-rev-usd');
  if (eurBtn) {
    eurBtn.style.background = isUsd ? 'var(--surface)' : 'var(--blue)';
    eurBtn.style.color = isUsd ? 'var(--text-2)' : '#fff';
  }
  if (usdBtn) {
    usdBtn.style.background = isUsd ? 'var(--blue)' : 'var(--surface)';
    usdBtn.style.color = isUsd ? '#fff' : 'var(--text-2)';
  }
  // Stat cards USD lines always visible
  renderRevOverview();
}

function fmtRevVal(eurVal, monthNum) {
  // Format value in current currency
  if (eurVal == null) return '<span style="color:#ccc">—</span>';
  if (revCurrency === 'usd') {
    const rate = monthNum ? getEurUsdRate(monthNum) : null;
    // For totals across months use average of available rates
    let effectiveRate = rate;
    if (!effectiveRate) effectiveRate = getAvgUsdRate([1,2,3,4,5,6,7,8,9,10,11,12]);
    const usdVal = effectiveRate ? eurVal / effectiveRate : null;
    if (!usdVal) return eurVal.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' <span style="font-size:10px;color:var(--text-3)">no rate</span>';
    return usdVal.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  return eurVal.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function getAvgUsdRate(months) {
  // Get average EUR/USD rate for a list of month numbers
  const rates = months.map(m => getEurUsdRate(m)).filter(Boolean);
  if (!rates.length) return null;
  return rates.reduce((s,r) => s+r, 0) / rates.length;
}

function fmtEur(val) {
  if (val == null) return '<span style="color:#ccc">—</span>';
  return val.toLocaleString('de-DE', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function renderRevenue() {
  renderRevOverview();
  if (revView === 'utilization') renderRevUtil();
}

function getTeamMonthSource(devs, mi, team) {
  const types = devs.map(d => calcRevenue(d, mi, team).type).filter(t => t !== 'nopo');
  if (!types.length) return 'nopo';
  const allTmsh = types.every(t => t === 'tmsh');
  const allForecast = types.every(t => t === 'utilization');
  if (allTmsh) return 'tmsh';
  if (allForecast) return 'utilization';
  return 'manual'; // mixed
}

function renderRevOverview() {
  const body = document.getElementById('rev-overview-body');
  const teamsToShow = ALL_TEAMS().filter(t => t === 'Selfhosting' || t === 'CVS Oncall' || developers.some(d => (d.assignments||[]).some(a => a.team === t)));

  // Populate stat cards
  try {
    const MTH_NAMES_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // Count locked months (all devs have tmsh for that month)
    const activDevs = developers.filter(d => (d.assignments||[]).some(a => a.team));
    let lockedMonthsCount = 0;
    let lockedNames = [];
    for (let mi = 0; mi < 12; mi++) {
      const hasTmsh = activDevs.some(d => actualHours[String(d.id)]?.[mi+1]?.source === 'tmsh');
      if (hasTmsh) { lockedMonthsCount++; lockedNames.push(MTH_NAMES_S[mi]); }
    }
    // YTD = sum of locked months across all teams
    let ytd = 0, fullYear = 0;
    teamsToShow.forEach(team => {
      MTHS.forEach((m, mi) => {
        let rev = 0;
        if (team === 'Selfhosting') rev = calcSelfhostingRevenue(mi).revenue || 0;
        else if (team === 'CVS Oncall') rev = calcCvsOncallRevenue(mi).revenue || 0;
        else {
          const devs = developers.filter(d => (d.assignments||[]).some(a => a.team === team));
          devs.forEach(d => { const r = calcRevenue(d, mi, team); if (r.revenue != null) rev += r.revenue + (r.discountAmt||0); });
        }
        fullYear += rev;
        if (mi+1 <= lockedMonthsCount) ytd += rev;
      });
    });
    const activeDevCount = developers.filter(d => (d.assignments||[]).some(a => !a.end_date || new Date(a.end_date) >= new Date('2026-01-01'))).length;
    const fmtM = v => '€ ' + (v/1000000).toFixed(2) + ' M';
    const el = id => document.getElementById(id);
    const lockedMonthNums = Array.from({length:12},(_,i)=>i+1).filter(m=>lockedMonthsCount>=m);
    const avgYtdRate = getAvgUsdRate(lockedMonthNums);
    const avgTotalRate = getAvgUsdRate(Array.from({length:12},(_,i)=>i+1));
    const eurYtd = lockedMonthsCount ? fmtM(ytd) : '—';
    const usdYtd = (lockedMonthsCount && avgYtdRate) ? '$ ' + (ytd/avgYtdRate/1000000).toFixed(2) + ' M' : '';
    const eurTotal = fmtM(fullYear);
    const usdTotal = avgTotalRate ? '$ ' + (fullYear/avgTotalRate/1000000).toFixed(2) + ' M' : '';

    const showSep = id => { const s = el(id); if(s) s.style.display = ''; };

    if (revCurrency === 'usd') {
      if (el('rev-stat-ytd')) { el('rev-stat-ytd').textContent = usdYtd || '—'; el('rev-stat-ytd').style.color = 'var(--blue)'; }
      if (usdYtd && eurYtd) {
        showSep('rev-stat-ytd-sep');
        if (el('rev-stat-ytd-usd')) { el('rev-stat-ytd-usd').textContent = '€ ' + eurYtd.replace('€','').trim(); el('rev-stat-ytd-usd').style.display = ''; }
      }
      if (el('rev-stat-total')) { el('rev-stat-total').textContent = usdTotal || '—'; el('rev-stat-total').style.color = 'var(--text)'; }
      if (usdTotal && eurTotal) {
        showSep('rev-stat-total-sep');
        if (el('rev-stat-total-usd')) { el('rev-stat-total-usd').textContent = '€ ' + eurTotal.replace('€','').trim(); el('rev-stat-total-usd').style.display = ''; }
      }
    } else {
      if (el('rev-stat-ytd')) { el('rev-stat-ytd').textContent = eurYtd; el('rev-stat-ytd').style.color = 'var(--blue)'; }
      if (usdYtd) {
        showSep('rev-stat-ytd-sep');
        if (el('rev-stat-ytd-usd')) { el('rev-stat-ytd-usd').textContent = usdYtd; el('rev-stat-ytd-usd').style.display = ''; }
      }
      if (el('rev-stat-total')) { el('rev-stat-total').textContent = eurTotal; el('rev-stat-total').style.color = 'var(--text)'; }
      if (usdTotal) {
        showSep('rev-stat-total-sep');
        if (el('rev-stat-total-usd')) { el('rev-stat-total-usd').textContent = usdTotal; el('rev-stat-total-usd').style.display = ''; }
      }
    }
    if (el('rev-stat-ytd-sub')) el('rev-stat-ytd-sub').textContent = lockedMonthsCount ? lockedNames.slice(0,3).join(', ') + (lockedMonthsCount > 3 ? '…' : '') : 'no locked months yet';
    if (el('rev-stat-devs')) el('rev-stat-devs').textContent = activeDevCount;
    if (el('rev-stat-locked')) el('rev-stat-locked').textContent = lockedMonthsCount;
    if (el('rev-stat-locked-sub')) el('rev-stat-locked-sub').textContent = lockedMonthsCount ? lockedNames.join(', ') : 'none yet';
  } catch(e) { console.warn('Stat cards error:', e); }

  let totalRow = new Array(12).fill(0);
  const rows = teamsToShow.map(team => {
    let monthData;

    if (team === 'Selfhosting') {
      monthData = MTHS.map((m, mi) => {
        const {revenue, type} = calcSelfhostingRevenue(mi);
        return {value: revenue, source: type};
      });
    } else if (team === 'CVS Oncall') {
      monthData = MTHS.map((m, mi) => {
        const {revenue, type} = calcCvsOncallRevenue(mi);
        return {value: revenue, source: type};
      });
    } else {
      const devs = developers.filter(d => (d.assignments||[]).some(a => a.team === team));
      monthData = MTHS.map((m, mi) => {
        let sum = 0;
        let hasData = false;
        devs.forEach(d => {
          const {revenue, discountAmt} = calcRevenue(d, mi, team);
          if (revenue != null) { sum += revenue + (discountAmt || 0); hasData = true; }
        });
        // Add team discount amounts for this month
        const month = mi + 1;
        teamDiscounts.filter(d => d.team === team).forEach(d => {
          const active = getActiveTeamDiscounts(team, 2026, month).some(td => td.id === d.id);
          if (active) {
            const val = teamDiscountAmounts[d.id]?.[month]?.amount || 0;
            if (val !== 0) { sum += val; hasData = true; }
          }
        });
        // Add extra invoicing lines for this team/month
        extraInvoicing.filter(e => e.team === team && e.month === month && e.year === 2026).forEach(e => {
          sum += parseFloat(e.value || 0);
          hasData = true;
        });
        const source = getTeamMonthSource(devs, mi, team);
        return {value: hasData ? sum : null, source};
      });
    }

    monthData.forEach((d, i) => { if (d.value != null) totalRow[i] += d.value; });
    const yearTotal = monthData.reduce((s, d) => s + (d.value||0), 0);
    const cells = monthData.map((d, cellIdx) => {
      const bg = d.source==='tmsh' ? 'background:var(--green-lt);' : d.source==='manual' ? 'background:var(--amber-lt);' : d.source==='utilization' ? 'background:var(--blue-lt);' : '';
      return `<td style="text-align:right;padding:8px 10px;white-space:nowrap;${bg}">${fmtRevVal(d.value, cellIdx+1)}</td>`;
    }).join('');
    return `<tr onclick="clickTeamRow('${team}')" style="cursor:pointer">
      <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500;white-space:nowrap">${team}</td>
      ${cells}
      <td style="text-align:right;padding:8px 10px;font-weight:500;color:var(--blue);white-space:nowrap">${fmtRevVal(yearTotal, null)}</td>
    </tr>`;
  });

  // Grand total row
  const grandTotal = totalRow.reduce((s,v) => s+v, 0);
  const totalCells = totalRow.map((v,mi) => `<td style="text-align:right;padding:8px 10px;font-weight:500;border-top:2px solid #e5e5e5;white-space:nowrap">${fmtRevVal(v, mi+1)}</td>`).join('');
  rows.push(`<tr class="tbl-total" style="background:var(--bg)">
    <td style="position:sticky;left:0;background:#F8FAFC;z-index:1;font-weight:600;white-space:nowrap;border-top:2px solid var(--border)">Total</td>
    ${totalCells}
    <td style="text-align:right;padding:8px 10px;font-weight:600;color:var(--blue);border-top:2px solid var(--border);white-space:nowrap">${fmtRevVal(grandTotal, null)}</td>
  </tr>`);

  body.innerHTML = rows.join('');
}

function renderRevSplit() {
  const body = document.getElementById('rev-split-body');
  if (!body) return;

  const EU_TEAMS_INV = [...EU_TEAMS, 'CVS Oncall'];
  const IND_TEAMS_INV = [...IND_TEAMS];

  // Build monthly data per team
  function buildTeamRow(team) {
    const monthData = MTHS.map((m, mi) => {
      let sum = 0, hasData = false;
      let source = null;
      if (team === 'Selfhosting') {
        const {revenue, type} = calcSelfhostingRevenue(mi);
        sum = revenue || 0; hasData = revenue != null; source = type;
      } else if (team === 'CVS Oncall') {
        const {revenue, type} = calcCvsOncallRevenue(mi);
        sum = revenue || 0; hasData = revenue != null; source = type;
      } else {
        const devs = developers.filter(d => (d.assignments||[]).some(a => a.team === team));
        devs.forEach(d => {
          const {revenue, discountAmt} = calcRevenue(d, mi, team);
          if (revenue != null) { sum += revenue + (discountAmt||0); hasData = true; }
        });
        const month = mi + 1;
        teamDiscounts.filter(td => td.team === team).forEach(td => {
          const active = getActiveTeamDiscounts(team, 2026, month).some(t => t.id === td.id);
          if (active) { const val = teamDiscountAmounts[td.id]?.[month]?.amount || 0; if (val) { sum += val; hasData = true; } }
        });
        extraInvoicing.filter(e => e.team === team && e.month === month && e.year === 2026).forEach(e => {
          sum += parseFloat(e.value || 0); hasData = true;
        });
        if (hasData) source = getTeamMonthSource(devs, mi, team);
      }
      return hasData ? {value: sum, source} : null;
    });
    const yearTotal = monthData.reduce((s, v) => s + (v?.value||0), 0);
    return { monthData, yearTotal };
  }

  function sectionRows(teams, label) {
    const rows = [];
    const sectionTotals = new Array(12).fill(0);

    // Section header
    rows.push(`<tr style="background:#f0f4ff;cursor:default">
      <td colspan="14" style="font-weight:600;font-size:13px;color:var(--blue);padding:8px 12px;border-top:2px solid #dde4f5">${label}</td>
    </tr>`);

    teams.forEach(team => {
      const activeDevs = team === 'Selfhosting' || team === 'CVS Oncall'
        ? true
        : developers.some(d => (d.assignments||[]).some(a => a.team === team));
      if (!activeDevs) return;

      const {monthData, yearTotal} = buildTeamRow(team);
      if (yearTotal === 0 && monthData.every(v => v == null)) return;

      monthData.forEach((v, i) => { if (v != null) sectionTotals[i] += v.value; });

      const cells = monthData.map((v, cellIdx) => {
        if (v == null) return `<td style="text-align:right;padding:8px 10px;white-space:nowrap"><span style="color:#ccc">—</span></td>`;
        const bg = v.source==='tmsh' ? 'background:var(--green-lt);' : v.source==='manual' ? 'background:var(--amber-lt);' : v.source==='utilization' ? 'background:var(--blue-lt);' : '';
        return `<td style="text-align:right;padding:8px 10px;white-space:nowrap;${bg}">${fmtRevVal(v.value, cellIdx+1)}</td>`;
      }).join('');

      rows.push(`<tr onclick="clickTeamRow('${team}')" style="cursor:pointer">
        <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500;white-space:nowrap">${team}</td>
        ${cells}
        <td style="text-align:right;padding:8px 10px;font-weight:500;color:var(--blue);white-space:nowrap">${fmtRevVal(yearTotal, null)}</td>
      </tr>`);
    });

    // Section total
    const sectionYearTotal = sectionTotals.reduce((s,v) => s+v, 0);
    const totalCells = sectionTotals.map((v, cellIdx) =>
      `<td style="text-align:right;padding:8px 10px;font-weight:500;border-top:2px solid #e5e5e5;white-space:nowrap">${fmtRevVal(v, cellIdx+1)}</td>`
    ).join('');
    rows.push(`<tr class="tbl-total" style="background:var(--bg)">
      <td style="position:sticky;left:0;background:#F8FAFC;z-index:1;font-weight:600;white-space:nowrap;border-top:2px solid var(--border)">${label} Total</td>
      ${totalCells}
      <td style="text-align:right;padding:8px 10px;font-weight:600;color:var(--blue);border-top:2px solid var(--border);white-space:nowrap">${fmtRevVal(sectionYearTotal, null)}</td>
    </tr>`);

    return { rows, sectionTotals, sectionYearTotal };
  }

  const eu = sectionRows(EU_TEAMS_INV, 'Europe');
  const ind = sectionRows(IND_TEAMS_INV, 'India');

  // Grand total
  const grandTotals = eu.sectionTotals.map((v, i) => v + ind.sectionTotals[i]);
  const grandYear = eu.sectionYearTotal + ind.sectionYearTotal;
  const grandCells = grandTotals.map((v, cellIdx) =>
    `<td style="text-align:right;padding:8px 10px;font-weight:500;border-top:2px solid #e5e5e5;white-space:nowrap">${fmtRevVal(v, cellIdx+1)}</td>`
  ).join('');

  const grandRow = `<tr class="tbl-total" style="background:var(--bg)">
    <td style="position:sticky;left:0;background:#F8FAFC;z-index:1;font-weight:600;white-space:nowrap;border-top:2px solid var(--border)">Grand Total</td>
    ${grandCells}
    <td style="text-align:right;padding:8px 10px;font-weight:600;color:var(--blue);border-top:2px solid var(--border);white-space:nowrap">${fmtRevVal(grandYear, null)}</td>
  </tr>`;

  body.innerHTML = [...eu.rows, ...ind.rows, grandRow].join('');
}


function clickTeamRow(team) {
  if (team === 'Selfhosting') {
    switchRevView('selfhosting');
    renderSelfhostingDetail();
    return;
  }
  if (team === 'CVS Oncall') {
    switchRevView('cvs-oncall');
    renderCvsOncall();
    return;
  }
  switchRevView('detail');
  document.getElementById('btn-rev-overview').classList.remove('active');
  document.getElementById('btn-rev-detail').classList.add('active');
  revDetailOpen(team);
}

function getRevDetailTeams() {
  return ALL_TEAMS().filter(t => t !== 'Selfhosting' && t !== 'CVS Oncall' && developers.some(d => (d.assignments||[]).some(a => a.team === t)));
}

let revDetailCurrentTeam = null;
let revDevDetailCurrentTeam = null;

function revDetailOpen(team) {
  const teams = getRevDetailTeams();
  revDetailCurrentTeam = team || teams[0] || null;
  const titleEl = document.getElementById('rev-detail-title');
  const titleRow = document.getElementById('rev-detail-title-row');
  if (titleEl) titleEl.textContent = revDetailCurrentTeam || '';
  if (titleRow) titleRow.style.display = revDetailCurrentTeam ? '' : 'none';
  renderRevDetail();
}

function revDetailBackToAll() {
  revDetailCurrentTeam = null;
  const titleRow = document.getElementById('rev-detail-title-row');
  if (titleRow) titleRow.style.display = 'none';
  switchRevView('overview');
}

function revDetailPrevTeam() {
  const teams = getRevDetailTeams();
  const idx = teams.indexOf(revDetailCurrentTeam);
  revDetailCurrentTeam = teams[(idx - 1 + teams.length) % teams.length];
  const titleEl = document.getElementById('rev-detail-title');
  if (titleEl) titleEl.textContent = revDetailCurrentTeam;
  renderRevDetail();
}

function revDetailNextTeam() {
  const teams = getRevDetailTeams();
  const idx = teams.indexOf(revDetailCurrentTeam);
  revDetailCurrentTeam = teams[(idx + 1) % teams.length];
  const titleEl = document.getElementById('rev-detail-title');
  if (titleEl) titleEl.textContent = revDetailCurrentTeam;
  renderRevDetail();
}

function revDevDetailOpen(team) {
  const teams = getRevDetailTeams();
  revDevDetailCurrentTeam = team || teams[0] || null;
  const titleEl = document.getElementById('rev-devdetail-title');
  const titleRow = document.getElementById('rev-devdetail-title-row');
  if (titleEl) titleEl.textContent = revDevDetailCurrentTeam || '';
  if (titleRow) titleRow.style.display = revDevDetailCurrentTeam ? '' : 'none';
  updateDevDetailMonthLabel();
  if (revDevDetailCurrentTeam) renderRevDevDetail();
}

function revDevDetailBackToAll() {
  revDevDetailCurrentTeam = null;
  const titleRow = document.getElementById('rev-devdetail-title-row');
  if (titleRow) titleRow.style.display = 'none';
  switchRevView('overview');
}

function revDevDetailPrevTeam() {
  const teams = getRevDetailTeams();
  const idx = teams.indexOf(revDevDetailCurrentTeam);
  revDevDetailCurrentTeam = teams[(idx - 1 + teams.length) % teams.length];
  const titleEl = document.getElementById('rev-devdetail-title');
  if (titleEl) titleEl.textContent = revDevDetailCurrentTeam;
  renderRevDevDetail();
}

function revDevDetailNextTeam() {
  const teams = getRevDetailTeams();
  const idx = teams.indexOf(revDevDetailCurrentTeam);
  revDevDetailCurrentTeam = teams[(idx + 1) % teams.length];
  const titleEl = document.getElementById('rev-devdetail-title');
  if (titleEl) titleEl.textContent = revDevDetailCurrentTeam;
  renderRevDevDetail();
}

function populateRevDetailTeams() { /* replaced by revDetailOpen */ }

function renderRevDetail() {
  const team = revDetailCurrentTeam;
  const body = document.getElementById('rev-detail-body');
  if (!team) { body.innerHTML = '<tr><td colspan="14" class="empty">Select a team above</td></tr>'; return; }

  const devs = sortDevsByOrder(developers.filter(d => (d.assignments||[]).some(a => a.team === team && a.billable !== false)));
  if (!devs.length) { body.innerHTML = '<tr><td colspan="14" class="empty">No active developers in this team</td></tr>'; return; }

  const rows = [];
  const teamTotals = new Array(12).fill(0);

  devs.forEach(d => {
    let devYearTotal = 0;
    let discYearTotal = 0;
    const cells = MTHS.map((m, mi) => {
      const {revenue, type} = calcRevenue(d, mi, team);
      if (revenue != null) { devYearTotal += revenue; teamTotals[mi] += revenue; }
      return `<td style="text-align:right;padding:8px 10px;cursor:pointer;${cellStyle(type)}"
        onclick="goToHoursRevenue('${team}',${mi})" title="View Hours & Revenue for ${MTH_NAMES[mi]}">
        ${fmtEur(revenue)}</td>`;
    }).join('');
    rows.push(`<tr>
      <td style="position:sticky;left:0;background:var(--surface);z-index:1">${d.firstname} ${d.lastname}</td>
      ${cells}
      <td style="text-align:right;padding:8px 10px;font-weight:500;color:var(--blue)">${fmtEur(devYearTotal)}</td>
    </tr>`);

    // Check if this developer has any discount active for any month this year
    const hasAnyDiscount = MTHS.some((m, mi) => {
      const {hasDiscount} = calcRevenue(d, mi, team);
      return hasDiscount;
    });

    if (hasAnyDiscount) {
      const discCells = MTHS.map((m, mi) => {
        const {discountAmt, type} = calcRevenue(d, mi, team);
        if (discountAmt == null || discountAmt === 0) return `<td style="text-align:right;padding:8px 10px;color:#ccc">—</td>`;
        discYearTotal += discountAmt;
        teamTotals[mi] += discountAmt;
        const bg = type === 'tmsh' ? '#e8f5e9' : type === 'manual' ? '#fff3e0' : '#e3f2fd';
        return `<td style="text-align:right;padding:8px 10px;color:#c62828;background:${bg}">${fmtEur(discountAmt)}</td>`;
      }).join('');
      rows.push(`<tr style="background:#fff8f8">
        <td style="position:sticky;left:0;background:#fff8f8;z-index:1;font-size:12px;color:#c62828;padding-left:24px">↳ Rate discount #${d.firstname} ${d.lastname}#</td>
        ${discCells}
        <td style="text-align:right;padding:8px 10px;font-size:12px;color:#c62828">${fmtEur(discYearTotal)}</td>
      </tr>`);
    }
  });

  // Team discount rows — one per active discount for this team
  const activeTeamDiscounts = teamDiscounts.filter(d => {
    if (d.team !== team) return false;
    // Check if discount overlaps any month in 2026
    const start = new Date(d.start_date);
    const end = d.end_date ? new Date(d.end_date) : null;
    if (start > new Date(2026, 11, 31)) return false;
    if (end && end < new Date(2026, 0, 1)) return false;
    return true;
  });

  activeTeamDiscounts.forEach(disc => {
    let discYearTotal = 0;
    const discCells = MTHS.map((m, mi) => {
      const month = mi + 1;
      const active = getActiveTeamDiscounts(team, 2026, month).some(d => d.id === disc.id);
      if (!active) return `<td style="background:var(--bg);text-align:right;padding:8px 10px;color:#ccc">—</td>`;
      const val = teamDiscountAmounts[disc.id]?.[month]?.amount || 0;
      discYearTotal += val;
      teamTotals[mi] += val;
      return `<td style="text-align:right;padding:8px 10px;color:#c62828;cursor:pointer;background:#fff8f8"
        onclick="editTeamDiscountCell(${disc.id},${month},this)">${val !== 0 ? fmtEur(val) : '<span style="color:#ccc">click to enter</span>'}</td>`;
    }).join('');
    rows.push(`<tr style="background:#fff8f8">
      <td style="position:sticky;left:0;background:#fff8f8;z-index:1;font-size:13px;color:#c62828;font-style:italic">
        Discount (${disc.note || team})
      </td>
      ${discCells}
      <td style="text-align:right;padding:8px 10px;color:#c62828;font-weight:500">${discYearTotal !== 0 ? fmtEur(discYearTotal) : '—'}</td>
    </tr>`);
  });

  // Extra invoicing rows for this team
  const extraLines = extraInvoicing.filter(e => e.team === team && e.year === 2026);
  extraLines.forEach(ei => {
    const month = ei.month;
    const val = parseFloat(ei.value || 0);
    const eiCells = MTHS.map((m, mi) => {
      if (mi + 1 === month) {
        teamTotals[mi] += val;
        return `<td style="text-align:right;padding:8px 10px;color:var(--green);font-weight:500;background:var(--green-lt)">${fmtEur(val)}</td>`;
      }
      return `<td style="background:var(--bg);text-align:right;padding:8px 10px;color:#ccc">—</td>`;
    }).join('');
    rows.push(`<tr style="background:var(--green-lt)">
      <td style="position:sticky;left:0;background:var(--green-lt);z-index:1;font-size:13px;color:var(--green);font-style:italic">
        Extra: ${ei.description}
      </td>
      ${eiCells}
      <td style="text-align:right;padding:8px 10px;color:var(--green);font-weight:500">${fmtEur(val)}</td>
    </tr>`);
  });

  // Team total row
  const grandTotal = teamTotals.reduce((s,v) => s+v, 0);
  const totalCells = teamTotals.map(v => `<td style="text-align:right;padding:8px 10px;font-weight:500;border-top:2px solid #e5e5e5">${fmtEur(v)}</td>`).join('');
  rows.push(`<tr style="background:var(--bg)">
    <td style="position:sticky;left:0;background:var(--bg);z-index:1;font-weight:500;border-top:2px solid #e5e5e5">Team total</td>
    ${totalCells}
    <td style="text-align:right;padding:8px 10px;font-weight:500;color:var(--blue);border-top:2px solid #e5e5e5">${fmtEur(grandTotal)}</td>
  </tr>`);

  body.innerHTML = rows.join('');
}

// Edit team discount cell popup
function editTeamDiscountCell(discountId, month, cell) {
  const existing = document.getElementById('team-disc-popup');
  if (existing) existing.remove();

  const disc = teamDiscounts.find(d => d.id === discountId);
  const curVal = teamDiscountAmounts[discountId]?.[month]?.amount || '';

  const rect = cell.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.id = 'team-disc-popup';
  popup.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${Math.min(rect.left, window.innerWidth-280)}px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem;z-index:500;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:240px`;
  popup.innerHTML = `
    <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">${disc?.note || 'Discount'} — ${MTH_NAMES[month-1]}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">Enter discount amount (negative = deduction)</div>
    <input type="number" id="team-disc-input" value="${curVal}" step="0.01" placeholder="e.g. -500.00"
      style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;margin-bottom:10px"
      onkeydown="if(event.key==='Enter')saveTeamDiscCell(${discountId},${month});if(event.key==='Escape')closeTeamDiscPopup();">
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger" onclick="saveTeamDiscCell(${discountId},${month},true)" style="padding:6px 10px;font-size:12px">Clear</button>
      <div style="flex:1"></div>
      <button class="btn" onclick="closeTeamDiscPopup()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTeamDiscCell(${discountId},${month})">Save</button>
    </div>`;
  document.body.appendChild(popup);
  document.getElementById('team-disc-input').focus();
  document.getElementById('team-disc-input').select();

  setTimeout(() => {
    document.addEventListener('mousedown', function handler(e) {
      if (!popup.contains(e.target)) { closeTeamDiscPopup(); document.removeEventListener('mousedown', handler); }
    });
  }, 100);
}

function closeTeamDiscPopup() {
  const p = document.getElementById('team-disc-popup');
  if (p) p.remove();
}

async function saveTeamDiscCell(discountId, month, clear) {
  const amount = clear ? 0 : parseFloat(document.getElementById('team-disc-input')?.value || 0);
  closeTeamDiscPopup();
  if (isNaN(amount)) return;
  await saveTeamDiscountAmount(discountId, month, amount);
  showToast('Discount saved');
}

// Edit hours popup (for manual forecast entry in team detail view)
function goToHoursRevenue(team, monthIdx) {
  devDetailMonth = monthIdx;
  switchRevView('devdetail');
  revDevDetailOpen(team);
}

function editHoursCell(devId, month, cell) {
  if (checkMonthLocked(month, 'manual edit')) return;
  const existing = document.getElementById('hours-popup');
  if (existing) existing.remove();

  const dev = developers.find(d => d.id === devId);
  const name = dev ? dev.firstname+' '+dev.lastname : '';
  const ah = actualHours[devId]?.[month];
  const curHours = ah?.hours || '';
  const curSource = ah?.source || 'manual';
  const loc = locations.find(l => l.id === dev?.location_id);
  const maxH = loc ? loc[MTHS[month-1]] : 160;
  const tu = teamUtilization[dev?.team];
  const util = tu ? tu[MTHS[month-1]] : null;
  const forecastH = util != null ? Math.round(maxH * util) : '—';

  const rect = cell.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.id = 'hours-popup';
  popup.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${Math.min(rect.left, window.innerWidth-280)}px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem;z-index:500;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:260px`;
  popup.innerHTML = `
    <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">${name} — ${MTH_NAMES[month-1]}</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:10px">Max hours: ${maxH} | Forecast (${util!=null?Math.round(util*100)+'%':'—'}): ${forecastH}h</div>
    <input type="text" id="hours-input" value="${curHours}" placeholder="e.g. 144"
      style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;margin-bottom:10px"
      onkeydown="if(event.key==='Enter')saveHoursCell(${devId},${month});if(event.key==='Escape')closeHoursPopup();">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Leave empty to use team utilization forecast</div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-danger" onclick="clearHoursCell(${devId},${month})" style="padding:6px 10px;font-size:12px">Clear</button>
      <div style="flex:1"></div>
      <button class="btn" onclick="closeHoursPopup()">Cancel</button>
      <button class="btn btn-primary" onclick="saveHoursCell(${devId},${month})">Save</button>
    </div>`;
  document.body.appendChild(popup);
  document.getElementById('hours-input').focus();
  document.getElementById('hours-input').select();

  setTimeout(() => {
    document.addEventListener('mousedown', function handler(e) {
      if (!popup.contains(e.target)) {
        closeHoursPopup();
        document.removeEventListener('mousedown', handler);
      }
    });
  }, 100);
}

function closeHoursPopup() {
  const p = document.getElementById('hours-popup');
  if (p) p.remove();
}

async function saveHoursCell(devId, month) {
  const val = parseFloat(document.getElementById('hours-input').value);
  closeHoursPopup();
  if (isNaN(val) || val < 0) return;

  const existing = actualHours[devId]?.[month];
  if (existing?.id) {
    await db.from('actual_hours').update({hours: val, source: 'manual', updated_at: new Date().toISOString()}).eq('id', existing.id);
    actualHours[devId][month] = {...existing, hours: val, source: 'manual'};
  } else {
    const {data} = await db.from('actual_hours').insert({developer_id: devId, year: 2026, month, hours: val, source: 'manual'}).select().single();
    if (!actualHours[devId]) actualHours[devId] = {};
    actualHours[devId][month] = {hours: val, source: 'manual', id: data.id};
  }
  showToast('Hours saved');
  renderRevDevDetail();
  renderRevDetail();
  renderRevOverview();
}

async function clearHoursCell(devId, month) {
  closeHoursPopup();
  const existing = actualHours[devId]?.[month];
  if (existing?.id) {
    await db.from('actual_hours').delete().eq('id', existing.id);
    delete actualHours[devId][month];
  }
  showToast('Hours cleared — using utilization forecast');
  renderRevDevDetail();
  renderRevDetail();
  renderRevOverview();
}

let devDetailMonth = new Date().getMonth(); // 0=Jan, current month as default

function changeDevDetailMonth(dir) {
  devDetailMonth = Math.max(0, Math.min(11, devDetailMonth + dir));
  renderRevDevDetail();
}

function populateRevDevDetailTeams() { /* replaced by revDevDetailOpen */ }

/* changeDetailTeam/changeDevDetailTeam replaced by revDetail*Team functions */

function updateDevDetailMonthLabel() {
  const label = document.getElementById('rev-devdetail-month-label');
  if (label) label.textContent = MTH_NAMES[devDetailMonth] + ' 2026';
}

function renderRevDevDetail() {
  updateDevDetailMonthLabel();
  const team = revDevDetailCurrentTeam;
  const body = document.getElementById('rev-devdetail-body');

  if (!team) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Select a team above</td></tr>';
    return;
  }

  const currentMonth = new Date().getMonth(); // 0-based
  const isPastMonth = devDetailMonth < currentMonth;

  const devs = developers.filter(d => {
    // Check if developer has a billable assignment for this team in the selected month
    const month = devDetailMonth + 1;
    const hasActiveAssignment = getActiveAssignments(d, 2026, month)
      .some(a => a.team === team && a.billable !== false);
    if (!hasActiveAssignment) return false;
    return d.status === 'active';
  });

  const sortedDevs = sortDevsByOrder(devs);

  if (!sortedDevs.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No developers found for this month</td></tr>';
    return;
  }

  const mi = devDetailMonth;
  const mKey = MTHS[mi];
  let totalHours = 0, totalRevenue = 0;

  const rows = [];
  sortedDevs.forEach(d => {
    const {revenue, hours, type, hasDiscount, discountAmt, stdRate, discountedRate} = calcRevenue(d, mi, team);
    const r = rates[d.id];
    const rate = r ? parseFloat(r[mKey]) : null;
    const loc = locations.find(l => l.id === d.location_id);
    const maxH = loc ? loc[mKey] : 160;
    const utilPct = hours != null && maxH > 0 ? Math.round((parseFloat(hours) / maxH) * 100) : null;

    if (hours != null) totalHours += parseFloat(hours);
    if (revenue != null) totalRevenue += revenue;
    if (discountAmt) totalRevenue += discountAmt;

    const bg = type==='tmsh' ? '#e8f5e9' : type==='manual' ? '#fff3e0' : type==='utilization' ? '#e3f2fd' : type==='partial' ? '#fff0f0' : '#f9f9f9';
    const textColor = type==='nopo' ? '#ccc' : type==='partial' ? '#cc0000' : '';

    const sourceLabel = type==='tmsh' ? '<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px">Actuals</span>'
      : type==='manual' ? '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">Manual</span>'
      : type==='utilization' ? '<span style="background:var(--blue-lt);color:var(--blue);padding:2px 8px;border-radius:99px;font-size:11px">Forecast</span>'
      : type==='partial' ? '<span style="background:#fff0f0;color:#cc0000;padding:2px 8px;border-radius:99px;font-size:11px">Manual needed</span>'
      : '<span style="color:#ccc;font-size:11px">No active PO</span>';

    rows.push(`<tr style="background:${bg}">
      <td style="position:sticky;left:0;background:${bg};z-index:1;font-weight:500">${d.firstname} ${d.lastname}</td>
      <td style="text-align:right;cursor:pointer;color:${textColor}" onclick="editHoursCell(${d.id},${mi+1},this)">
        ${hours != null ? parseFloat(hours).toFixed(0) : '<span style="color:#ccc">—</span>'}
      </td>
      <td style="text-align:right;color:${textColor}">${rate != null ? rate.toFixed(2) : '<span style="color:#ccc">—</span>'}</td>
      <td style="text-align:right;font-weight:500;color:${type==='nopo'?'#ccc':type==='partial'?'#cc0000':'var(--text)'}">${revenue != null ? revenue.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) : '<span style="color:#ccc">—</span>'}</td>
      <td style="text-align:center;color:${textColor}">${utilPct != null ? utilPct+'%' : '<span style="color:#ccc">—</span>'}</td>
      <td style="text-align:center">${sourceLabel}</td>
    </tr>`);

    // Discount line
    if (hasDiscount && discountAmt) {
      rows.push(`<tr style="background:#fff8f8">
        <td style="position:sticky;left:0;background:#fff8f8;z-index:1;font-size:12px;color:#c62828;padding-left:24px">↳ Rate discount #${d.firstname} ${d.lastname}#</td>
        <td></td>
        <td style="text-align:right;font-size:12px;color:#c62828">${discountedRate.toFixed(2)} vs ${stdRate.toFixed(2)}</td>
        <td style="text-align:right;font-weight:500;color:#c62828">${discountAmt.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
        <td></td>
        <td style="text-align:center"><span style="background:#fff8f8;color:#c62828;padding:2px 8px;border-radius:99px;font-size:11px">Discount</span></td>
      </tr>`);
    }
  });

  // Team discount rows for this month
  const month = mi + 1;
  const activeTeamDiscs = teamDiscounts.filter(d => {
    if (d.team !== team) return false;
    return getActiveTeamDiscounts(team, 2026, month).some(td => td.id === d.id);
  });

  activeTeamDiscs.forEach(disc => {
    const val = teamDiscountAmounts[disc.id]?.[month]?.amount || 0;
    totalRevenue += val;
    rows.push(`<tr style="background:#fff8f8">
      <td style="position:sticky;left:0;background:#fff8f8;z-index:1;font-size:13px;color:#c62828;font-style:italic;cursor:pointer"
        onclick="editTeamDiscountCell(${disc.id},${month},this)">
        Discount (${disc.note || team})
      </td>
      <td></td>
      <td></td>
      <td style="text-align:right;font-weight:500;color:#c62828;cursor:pointer"
        onclick="editTeamDiscountCell(${disc.id},${month},this)">
        ${val !== 0 ? val.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2}) : '<span style="color:#ccc">click to enter</span>'}
      </td>
      <td></td>
      <td style="text-align:center"><span style="background:#fff8f8;color:#c62828;padding:2px 8px;border-radius:99px;font-size:11px">Discount</span></td>
    </tr>`);
  });

  // Extra invoicing rows for this team/month
  extraInvoicing.filter(e => e.team === team && e.month === month && e.year === 2026).forEach(ei => {
    const val = parseFloat(ei.value || 0);
    totalRevenue += val;
    rows.push(`<tr style="background:var(--green-lt)">
      <td style="position:sticky;left:0;background:var(--green-lt);z-index:1;font-size:13px;color:var(--green);font-style:italic">
        Extra: ${ei.description}
      </td>
      <td></td>
      <td></td>
      <td style="text-align:right;font-weight:500;color:var(--green)">${val.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
      <td></td>
      <td style="text-align:center"><span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px">Extra</span></td>
    </tr>`);
  });

  // Total row
  const totalRow = `<tr style="background:var(--bg);border-top:2px solid #e5e5e5">
    <td style="position:sticky;left:0;background:var(--bg);z-index:1;font-weight:500">Team total</td>
    <td style="text-align:right;font-weight:500">${totalHours.toFixed(0)}</td>
    <td></td>
    <td style="text-align:right;font-weight:500;color:var(--blue)">${totalRevenue.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
    <td></td>
    <td></td>
  </tr>`;

  body.innerHTML = rows.join('') + totalRow;
}

function renderRevUtil() {
  const body = document.getElementById('rev-util-body');
  const teams = ALL_TEAMS().filter(t => t !== 'Selfhosting' && developers.some(d => (d.assignments||[]).some(a => a.team === t)));
  body.innerHTML = teams.map(team => {
    const tu = teamUtilization[team] || {};
    const cells = MTHS.map(m => {
      const val = tu[m] != null ? Math.round(tu[m]*100) : '';
      return `<td style="text-align:center;cursor:pointer" onclick="editUtilCell('${team}','${m}',this)">
        ${val !== '' ? val+'%' : '<span style="color:#ccc">—</span>'}
      </td>`;
    }).join('');
    return `<tr><td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500">${team}</td>${cells}</tr>`;
  }).join('');
}

function editUtilCell(team, month, cell) {
  const existing = document.getElementById('util-popup');
  if (existing) existing.remove();

  const tu = teamUtilization[team] || {};
  const cur = tu[month] != null ? Math.round(tu[month]*100) : '';

  const rect = cell.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.id = 'util-popup';
  popup.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1rem;z-index:500;box-shadow:0 4px 16px rgba(0,0,0,0.12);min-width:220px`;
  const mthIdx = MTHS.indexOf(month);
  const remaining = MTHS.slice(mthIdx+1);
  popup.innerHTML = `
    <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">${team} — ${MTH_NAMES[mthIdx]} utilization %</div>
    <input type="text" id="util-input" value="${cur}" placeholder="e.g. 90"
      style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:14px;margin-bottom:10px"
      onkeydown="if(event.key==='Enter')saveUtilCell('${team}','${month}');if(event.key==='Escape')closeUtilPopup();">
    <div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Enter 0-100 (percent)</div>
    <div style="display:flex;gap:8px">
      <button class="btn" onclick="closeUtilPopup()">Cancel</button>
      <button class="btn btn-primary" onclick="saveUtilCell('${team}','${month}')">Save</button>
    </div>`;
  document.body.appendChild(popup);
  document.getElementById('util-input').focus();
  document.getElementById('util-input').select();

  setTimeout(() => {
    document.addEventListener('mousedown', function handler(e) {
      if (!popup.contains(e.target)) { closeUtilPopup(); document.removeEventListener('mousedown', handler); }
    });
  }, 100);
}

function closeUtilPopup() {
  const p = document.getElementById('util-popup');
  if (p) p.remove();
}

async function saveUtilCell(team, month) {
  const val = parseInt(document.getElementById('util-input').value);
  closeUtilPopup();
  if (isNaN(val) || val < 0 || val > 100) return;

  const mthIdx = MTHS.indexOf(month);
  const applyAll = mthIdx < 11 ? confirm(`Apply ${val}% to ${MTH_NAMES[mthIdx]} only, or remaining months too?\nOK = all remaining, Cancel = this month only.`) : false;
  const monthsToUpdate = applyAll ? MTHS.slice(mthIdx) : [month];
  const updateObj = {};
  monthsToUpdate.forEach(m => updateObj[m] = val/100);

  const existing = teamUtilization[team];
  if (existing?.id) {
    await db.from('team_utilization').update(updateObj).eq('id', existing.id);
    monthsToUpdate.forEach(m => teamUtilization[team][m] = val/100);
  } else {
    const {data} = await db.from('team_utilization').insert({team, year: 2026, ...updateObj}).select().single();
    teamUtilization[team] = data;
  }
  showToast('Utilization updated');
  renderRevUtil();
  renderRevOverview();
}

function exportRevenue() {
  const teams = ALL_TEAMS().filter(t => developers.some(d => (d.assignments||[]).some(a => a.team === t)));
  const rows = [];
  teams.forEach(team => {
    const devs = developers.filter(d => (d.assignments||[]).some(a => a.team === team));
    devs.forEach(d => {
      const row = {'Team': team, 'Developer': d.firstname+' '+d.lastname, 'NESS ID': d.nessid};
      MTHS.forEach((m, mi) => {
        const {revenue, type} = calcRevenue(d, mi, team);
        row[MTH_NAMES[mi]] = revenue != null ? Math.round(revenue) : '';
        row[MTH_NAMES[mi]+' type'] = type || '';
      });
      rows.push(row);
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Revenue 2026');
  XLSX.writeFile(wb, 'HERE_Revenue_2026.xlsx');
}

function changeSettingsView(dir) {
  const sel = document.getElementById('settings-select');
  const opts = [...sel.options];
  const idx = opts.findIndex(o => o.value === sel.value);
  const newIdx = Math.max(0, Math.min(opts.length - 1, idx + dir));
  sel.value = opts[newIdx].value;
  switchSettingsView(sel.value);
}

function switchSettingsView(v) {
  ['settings-teamorder', 'settings-locations', 'settings-utilization', 'settings-discounts', 'settings-teamdiscounts', 'settings-extrainvoicing', 'settings-lockedmonths', 'settings-eurusd', 'settings-invgroups', 'settings-devcosts', 'settings-salaries'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('settings-' + v);
  if (el) el.style.display = '';
  if (v === 'teamorder') renderTeamOrder();
  if (v === 'locations') { renderLocations(); populatePhLocSelect(); renderPhList(); }
  if (v === 'utilization') renderRevUtil();
  if (v === 'discounts') renderDiscounts();
  if (v === 'teamdiscounts') renderTeamDiscounts();
  if (v === 'extrainvoicing') renderExtraInvoicing();
  if (v === 'lockedmonths') renderLockedMonths();
  if (v === 'eurusd') renderEurUsd();
  if (v === 'invgroups') renderInvGroups();
  if (v === 'devcosts') renderDevCosts();
  if (v === 'salaries') renderSalaries();
}

function switchInfoView(v) {
  ['info-rates2026'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('info-' + v);
  if (el) el.style.display = '';
}

// INVOICING MODULE → invoicing.js
// ============================================================
// REVENUE EXPORT VIEW
// ============================================================

function openRevExport() {
  const allTeams = ALL_TEAMS().filter(t =>
    t === 'Selfhosting' || t === 'CVS Oncall' ||
    developers.some(d => (d.assignments||[]).some(a => a.team === t))
  );

  const MTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build team checkboxes
  const teamsEl = document.getElementById('rev-export-teams');
  teamsEl.innerHTML = allTeams.map(t => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 0">
      <input type="checkbox" class="rev-export-team-cb" value="${t}" checked>
      <span style="font-size:13px">${t}</span>
    </label>`).join('');

  // Build month checkboxes
  const monthsEl = document.getElementById('rev-export-months');
  monthsEl.innerHTML = MTH_SHORT.map((m, i) => `
    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;padding:2px 0">
      <input type="checkbox" class="rev-export-month-cb" value="${i+1}" checked>
      <span style="font-size:13px">${m}</span>
    </label>`).join('');

  document.getElementById('rev-export-combine-3d').checked = false;
  document.getElementById('rev-export-combine-lumiere').checked = false;

  document.getElementById('rev-export-modal').classList.add('open');
}

function revExportSelectAll() {
  document.querySelectorAll('.rev-export-team-cb').forEach(cb => cb.checked = true);
}
function revExportSelectNone() {
  document.querySelectorAll('.rev-export-team-cb').forEach(cb => cb.checked = false);
}
function revExportSelectAllMonths() {
  document.querySelectorAll('.rev-export-month-cb').forEach(cb => cb.checked = true);
}
function revExportSetQuarter(q) {
  const ranges = { 1:[1,2,3], 2:[4,5,6], 3:[7,8,9], 4:[10,11,12] };
  document.querySelectorAll('.rev-export-month-cb').forEach(cb => {
    cb.checked = ranges[q].includes(parseInt(cb.value));
  });
}

function generateRevExport() {
  const MTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Get selected teams
  const selectedTeams = [...document.querySelectorAll('.rev-export-team-cb:checked')].map(cb => cb.value);
  // Get selected months (0-based indices)
  const selectedMonths = [...document.querySelectorAll('.rev-export-month-cb:checked')].map(cb => parseInt(cb.value) - 1);
  const combine3d = document.getElementById('rev-export-combine-3d').checked;
  const combineLumiere = document.getElementById('rev-export-combine-lumiere').checked;

  if (!selectedTeams.length) { showToast('Select at least one team'); return; }
  if (!selectedMonths.length) { showToast('Select at least one month'); return; }

  // Build logical rows — handle combine options
  const rows = [];
  const processed = new Set();

  selectedTeams.forEach(team => {
    if (processed.has(team)) return;

    if (combine3d && team === '3D Visuals EU' && selectedTeams.includes('3D Visuals IN')) {
      rows.push({ label: '3D Visuals EU + IN', teams: ['3D Visuals EU', '3D Visuals IN'] });
      processed.add('3D Visuals EU');
      processed.add('3D Visuals IN');
    } else if (combine3d && team === '3D Visuals IN' && selectedTeams.includes('3D Visuals EU')) {
      // already handled
      processed.add('3D Visuals IN');
    } else if (combineLumiere && team === 'Lumiere program EU' && selectedTeams.includes('Lumiere program IN')) {
      rows.push({ label: 'Lumiere EU + IN', teams: ['Lumiere program EU', 'Lumiere program IN'] });
      processed.add('Lumiere program EU');
      processed.add('Lumiere program IN');
    } else if (combineLumiere && team === 'Lumiere program IN' && selectedTeams.includes('Lumiere program EU')) {
      processed.add('Lumiere program IN');
    } else {
      rows.push({ label: team, teams: [team] });
      processed.add(team);
    }
  });

  // Calculate revenue per row per selected month
  const getTeamMonthRevenue = (team, mi) => {
    if (team === 'Selfhosting') return calcSelfhostingRevenue(mi).revenue || 0;
    if (team === 'CVS Oncall') return calcCvsOncallRevenue(mi).revenue || 0;
    const devs = developers.filter(d => (d.assignments||[]).some(a => a.team === team));
    let sum = 0;
    devs.forEach(d => {
      const {revenue, discountAmt} = calcRevenue(d, mi, team);
      if (revenue != null) sum += revenue + (discountAmt || 0);
    });
    teamDiscounts.filter(d => d.team === team).forEach(d => {
      const active = getActiveTeamDiscounts(team, 2026, mi+1).some(td => td.id === d.id);
      if (active) sum += teamDiscountAmounts[d.id]?.[mi+1]?.amount || 0;
    });
    extraInvoicing.filter(e => e.team === team && e.month === mi+1 && e.year === 2026).forEach(e => {
      sum += parseFloat(e.value || 0);
    });
    return sum;
  };

  const getTeamMonthSrc = (team, mi) => {
    if (team === 'Selfhosting') return calcSelfhostingRevenue(mi).type;
    if (team === 'CVS Oncall') return calcCvsOncallRevenue(mi).type;
    const devs = developers.filter(d => (d.assignments||[]).some(a => a.team === team));
    return getTeamMonthSource(devs, mi, team);
  };

  // Build HTML table
  const colTotals = new Array(selectedMonths.length).fill(0);

  const headerCells = selectedMonths.map(mi =>
    `<th style="text-align:right;padding:8px 12px;white-space:nowrap;background:var(--surface);font-weight:600">${MTH_SHORT[mi]}</th>`
  ).join('');

  let tableRows = rows.map(row => {
    const monthCells = selectedMonths.map((mi, ci) => {
      const total = row.teams.reduce((s, t) => s + getTeamMonthRevenue(t, mi), 0);
      // Source: use first team's source for color
      const src = getTeamMonthSrc(row.teams[0], mi);
      const bg = src === 'tmsh' ? 'background:var(--green-lt);'
        : src === 'manual' ? 'background:var(--amber-lt);'
        : src === 'utilization' ? 'background:var(--blue-lt);' : '';
      colTotals[ci] += total;
      return `<td style="text-align:right;padding:8px 12px;white-space:nowrap;${bg}">${fmtRevVal(total, mi+1)}</td>`;
    }).join('');
    const rowTotal = selectedMonths.reduce((s, mi) => s + row.teams.reduce((rs, t) => rs + getTeamMonthRevenue(t, mi), 0), 0);
    return `<tr>
      <td style="padding:8px 12px;font-weight:500;white-space:nowrap;position:sticky;left:0;background:var(--surface);border-right:1px solid var(--border)">${row.label}</td>
      ${monthCells}
      <td style="text-align:right;padding:8px 12px;font-weight:600;color:var(--blue);white-space:nowrap">${fmtRevVal(rowTotal, null)}</td>
    </tr>`;
  }).join('');

  // Total row
  const totalCells = colTotals.map((v, ci) =>
    `<td style="text-align:right;padding:8px 12px;font-weight:600;border-top:2px solid var(--border);white-space:nowrap">${fmtRevVal(v, selectedMonths[ci]+1)}</td>`
  ).join('');
  const grandTotal = colTotals.reduce((a,b) => a+b, 0);
  tableRows += `<tr style="background:var(--bg)">
    <td style="padding:8px 12px;font-weight:700;border-top:2px solid var(--border);position:sticky;left:0;background:#F8FAFC;border-right:1px solid var(--border)">Total</td>
    ${totalCells}
    <td style="text-align:right;padding:8px 12px;font-weight:700;color:var(--blue);border-top:2px solid var(--border);white-space:nowrap">${fmtRevVal(grandTotal, null)}</td>
  </tr>`;

  const tableHtml = `
    <table id="rev-export-table" style="border-collapse:collapse;font-size:13px;width:100%">
      <thead>
        <tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:8px 12px;white-space:nowrap;position:sticky;left:0;background:var(--surface);border-right:1px solid var(--border)">Team</th>
          ${headerCells}
          <th style="text-align:right;padding:8px 12px;white-space:nowrap;background:var(--surface)">Total</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`;

  document.getElementById('rev-export-preview').innerHTML = tableHtml;
  closeModal('rev-export-modal');
  document.getElementById('rev-export-preview-modal').classList.add('open');
}

function copyRevExportToClipboard() {
  const table = document.getElementById('rev-export-table');
  if (!table) return;

  // Build plain text table for clipboard
  const rows = table.querySelectorAll('tr');
  const lines = [];
  rows.forEach(row => {
    const cells = [...row.querySelectorAll('th, td')].map(c => c.textContent.trim());
    lines.push(cells.join('\t'));
  });
  const text = lines.join('\n');

  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard — paste into Word, Excel or email');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard');
  });
}
