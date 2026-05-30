// ============================================================
// GROSS MARGIN MODULE
// ============================================================
let gmView = 'split';
let gmDetailTeam = '';
let gmDevDetailTeam = '';
let gmDevDetailMonth = 1;
const MTHS_GM = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MTHS_GM_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MTHS_GM_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const year_GM = 2026;

function switchGmView(v) {
  gmView = v;
  ['split','detail','devdetail','levers'].forEach(x => {
    document.getElementById('btn-gm-'+x)?.classList.toggle('active', x===v);
    const el = document.getElementById('gm-'+x+'-view');
    if (el) el.style.display = x===v ? '' : 'none';
  });
  if (v==='split') renderGmSplit();
  if (v==='detail') { populateGmDetailTeams(); renderGmDetail(); }
  if (v==='devdetail') { renderGmDevDetail(); }
  if (v==='levers') renderGmLevers();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function getGmRevForDev(dev, mi) {
  const month = mi + 1;
  const monthStart = new Date(year_GM, mi, 1);
  const monthEnd = new Date(year_GM, mi + 1, 0);
  const allTeams = [...EU_TEAMS, ...IND_TEAMS].filter(t => t !== 'Selfhosting');

  // Sum revenue across all active billable assignments for this month
  let totalRev = 0;
  let hasActiveAssign = false;
  (dev.assignments || []).forEach(a => {
    if (!allTeams.includes(a.team)) return;
    if (a.billable === false) return;
    const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
    const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
    if (s > monthEnd || e < monthStart) return;
    hasActiveAssign = true;
    const r = calcRevenue(dev, mi, a.team);
    totalRev += (r.revenue || 0) + (r.discountAmt || 0);
  });

  // If has active assignment but revenue=0, may be missing rate — fall through to rate fallback
  if (hasActiveAssign && totalRev > 0) return totalRev;

  // No revenue — either no active assignment or missing rate
  // Use last known billable assignment + last known non-null rate
  const billableAssigns = (dev.assignments || []).filter(a =>
    allTeams.includes(a.team) && a.billable !== false
  ).sort((a, b) => {
    const ae = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
    const be = b.end_date ? new Date(b.end_date) : new Date('2099-12-31');
    return be - ae;
  });
  if (!billableAssigns.length) return 0;

  const activeOrLastAssign = billableAssigns.find(a => {
    const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
    const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
    return s <= monthEnd && e >= monthStart;
  }) || billableAssigns[0];

  // Find last non-null rate — check months backwards from mi
  const r = rates[dev.id];
  let stdRate = null;
  for (let m = mi; m >= 0; m--) {
    const v = r ? parseFloat(r[MTHS[m]]) : null;
    if (v && !isNaN(v)) { stdRate = v; break; }
  }
  if (!stdRate) return 0;

  const mKey = MTHS[mi];
  const loc = locations.find(l => l.id === dev.location_id);
  const maxH = loc ? (loc[mKey] || 0) : 0;
  const tu = teamUtilization[activeOrLastAssign.team] || {};
  const util = tu[mKey] != null ? parseFloat(tu[mKey]) : 1;
  const forecastHours = maxH * util;
  return forecastHours * stdRate;
}

function getGmCogs(dev, month) {
  return calcDevCogs(dev, month, year_GM) || 0;
}

function fmtGmPct(v) {
  if (v == null || isNaN(v)) return '—';
  return (v*100).toFixed(1)+'%';
}

function gmPctColor(v) {
  if (v == null) return '';
  if (v >= 0.30) return 'color:var(--green)';
  if (v >= 0.15) return 'color:var(--amber)';
  return 'color:var(--red)';
}

function fmtGmEur(v) {
  if (v == null) return '—';
  return '€' + Math.round(v).toLocaleString('de-DE');
}

function getTeamDevs(team) {
  return developers.filter(d => (d.assignments||[]).some(a => a.team === team));
}

function calcTeamMonthGm(team, mi) {
  const devs = getTeamDevs(team);
  let rev = 0, cogs = 0;
  devs.forEach(d => {
    rev += getGmRevForDev(d, mi);
    cogs += getGmCogs(d, mi+1);
  });
  return { rev, cogs, gm: rev-cogs, gmPct: rev>0 ? (rev-cogs)/rev : null };
}

// ── Stat cards ────────────────────────────────────────────────────────────
function renderGmStats() {
  const allDevs = developers.filter(d => d.status==='active');
  let ytdRev=0, ytdCogs=0, fullRev=0, fullCogs=0;
  const now = new Date();
  const ytdMonths = now.getFullYear() > year_GM ? 12 : now.getMonth();

  allDevs.forEach(d => {
    for (let mi=0; mi<12; mi++) {
      const r = getGmRevForDev(d, mi);
      const c = getGmCogs(d, mi+1);
      fullRev += r; fullCogs += c;
      if (mi < ytdMonths) { ytdRev += r; ytdCogs += c; }
    }
  });

  const ytdGm = ytdRev - ytdCogs;
  const ytdPct = ytdRev>0 ? ytdGm/ytdRev : null;
  const fullGm = fullRev - fullCogs;

  document.getElementById('gm-stat-rev').textContent = '€' + Math.round(ytdRev/1000) + 'K';
  document.getElementById('gm-stat-rev-sub').textContent = ytdMonths + ' months actuals/forecast';
  document.getElementById('gm-stat-cogs').textContent = '€' + Math.round(ytdCogs/1000) + 'K';
  const gmEl = document.getElementById('gm-stat-gm');
  gmEl.textContent = '€' + Math.round(ytdGm/1000) + 'K';
  gmEl.style.color = ytdGm >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('gm-stat-gm-sub').textContent = ytdPct != null ? fmtGmPct(ytdPct) : '';
  document.getElementById('gm-stat-forecast').textContent = '€' + Math.round(fullGm/1000) + 'K';
}

// ── EU / India split ──────────────────────────────────────────────────────
function renderGmSplit() {
  renderGmStats();
  const body = document.getElementById('gm-split-body');
  if (!body) return;

  const EU_LOCS = ['Slovakia', 'Romania', 'Latvia'];
  const IN_LOCS = ['India Pune', 'India Bangalore', 'India'];

  function isEuDev(d) {
    const loc = locations.find(l => l.id === d.location_id);
    return loc && EU_LOCS.some(n => loc.name.startsWith(n));
  }

  const allDevs = developers.filter(d => d.status === 'active' &&
    (d.assignments||[]).some(a => [...EU_TEAMS, ...IND_TEAMS].filter(t=>t!=='Selfhosting').includes(a.team)));

  const euDevs = allDevs.filter(d => isEuDev(d));
  const inDevs = allDevs.filter(d => !isEuDev(d));

  function buildSection(devs, label) {
    const rows = [];
    const secRevByMonth = new Array(12).fill(0);
    const secCogsByMonth = new Array(12).fill(0);

    rows.push(`<tr style="background:#f0f4ff">
      <td colspan="14" style="font-weight:600;font-size:13px;color:var(--blue);padding:8px 12px;border-top:2px solid #dde4f5">${label}</td>
    </tr>`);

    devs.forEach(dev => {
      const monthData = MTHS_GM_NAMES.map((_, mi) => {
        const rev = getGmRevForDev(dev, mi);
        const cogs = getGmCogs(dev, mi+1);
        const gm = rev - cogs;
        const gmPct = rev > 0 ? gm/rev : null;
        return { rev, cogs, gm, gmPct };
      });

      const yearRev = monthData.reduce((s,v)=>s+v.rev, 0);
      const yearCogs = monthData.reduce((s,v)=>s+v.cogs, 0);
      const yearGm = yearRev - yearCogs;
      const yearPct = yearRev > 0 ? yearGm/yearRev : null;

      monthData.forEach((v,i) => { secRevByMonth[i] += v.rev; secCogsByMonth[i] += v.cogs; });

      const cells = monthData.map(v => {
        if (v.rev === 0) return `<td style="text-align:right;padding:8px 8px;white-space:nowrap"><span style="color:#ccc">—</span></td>`;
        const bg = v.gmPct >= 0.30 ? 'background:var(--green-lt);' : v.gmPct >= 0.15 ? 'background:#fff8e1;' : 'background:#fff0f0;';
        return `<td style="text-align:right;padding:8px 8px;white-space:nowrap;${bg}">
          <span style="font-size:12px;${gmPctColor(v.gmPct)}">${fmtGmPct(v.gmPct)}</span>
        </td>`;
      }).join('');

      rows.push(`<tr style="border-bottom:1px solid var(--border)">
        <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500;white-space:nowrap;padding:8px 12px">${dev.firstname} ${dev.lastname}</td>
        ${cells}
        <td style="text-align:right;padding:8px 8px;font-weight:500;${gmPctColor(yearPct)}">${fmtGmPct(yearPct)}</td>
      </tr>`);
    });

    // Section total
    const secRevTotal = secRevByMonth.reduce((s,v)=>s+v,0);
    const secCogsTotal = secCogsByMonth.reduce((s,v)=>s+v,0);
    const secGm = secRevTotal - secCogsTotal;
    const secPct = secRevTotal>0 ? secGm/secRevTotal : null;
    const totalCells = secRevByMonth.map((rev,i) => {
      const cogs = secCogsByMonth[i];
      const pct = rev>0 ? (rev-cogs)/rev : null;
      return `<td style="text-align:right;padding:8px 8px;font-weight:500;border-top:2px solid #e5e5e5;${gmPctColor(pct)}">${pct!=null?fmtGmPct(pct):'—'}</td>`;
    }).join('');
    rows.push(`<tr class="tbl-total" style="background:var(--bg)">
      <td style="position:sticky;left:0;background:#F8FAFC;z-index:1;font-weight:600;border-top:2px solid var(--border);padding:8px 12px">${label} Total</td>
      ${totalCells}
      <td style="text-align:right;padding:8px 8px;font-weight:600;border-top:2px solid var(--border);${gmPctColor(secPct)}">${fmtGmPct(secPct)}</td>
    </tr>`);

    return { rows, secRevByMonth, secCogsByMonth };
  }

  const eu = buildSection(euDevs, 'Europe');
  const ind = buildSection(inDevs, 'India');

  // Grand total
  const grandRev = eu.secRevByMonth.map((v,i) => v + ind.secRevByMonth[i]);
  const grandCogs = eu.secCogsByMonth.map((v,i) => v + ind.secCogsByMonth[i]);
  const grandRevTotal = grandRev.reduce((s,v)=>s+v,0);
  const grandCogsTotal = grandCogs.reduce((s,v)=>s+v,0);
  const grandGm = grandRevTotal - grandCogsTotal;
  const grandPct = grandRevTotal>0 ? grandGm/grandRevTotal : null;
  const grandCells = grandRev.map((rev,i) => {
    const cogs=grandCogs[i]; const pct=rev>0?(rev-cogs)/rev:null;
    return `<td style="text-align:right;padding:8px 8px;font-weight:500;border-top:2px solid #e5e5e5;${gmPctColor(pct)}">${pct!=null?fmtGmPct(pct):'—'}</td>`;
  }).join('');

  body.innerHTML = [...eu.rows, ...ind.rows, `<tr class="tbl-total" style="background:var(--bg)">
    <td style="position:sticky;left:0;background:#F8FAFC;z-index:1;font-weight:600;border-top:2px solid var(--border);padding:8px 12px">Grand Total</td>
    ${grandCells}
    <td style="text-align:right;padding:8px 8px;font-weight:600;border-top:2px solid var(--border);${gmPctColor(grandPct)}">${fmtGmPct(grandPct)}</td>
  </tr>`].join('');
}


function clickGmTeamRow(team) {
  gmDetailTeam = team;
  switchGmView('detail');
  document.getElementById('gm-detail-team').value = team;
  renderGmDetail();
}

// ── Team detail ───────────────────────────────────────────────────────────
function populateGmDetailTeams() {
  // Not needed for developer list view — kept for compatibility
}

function changeGmDetailTeam(dir) {
  // Not needed for developer list view
}

function renderGmDetail() {
  const body = document.getElementById('gm-detail-body');
  if (!body) return;

  const EU_LOCS = ['Slovakia', 'Romania', 'Latvia'];
  const allDevs = developers.filter(d => d.status === 'active' &&
    (d.assignments||[]).some(a => [...EU_TEAMS, ...IND_TEAMS].filter(t=>t!=='Selfhosting').includes(a.team))
  );
  allDevs.sort((a,b) => {
    const al = locations.find(l=>l.id===a.location_id)?.name||'';
    const bl = locations.find(l=>l.id===b.location_id)?.name||'';
    return al.localeCompare(bl) || (a.lastname||'').localeCompare(b.lastname||'');
  });

  let rows = '';
  let curRegion = null;

  allDevs.forEach(dev => {
    const loc = locations.find(l => l.id === dev.location_id);
    const locName = loc?.name || '—';
    const isEu = EU_LOCS.some(n => locName.startsWith(n));
    const region = isEu ? 'Europe' : 'India';

    if (region !== curRegion) {
      curRegion = region;
      rows += `<tr style="background:#f0f4ff">
        <td colspan="14" style="font-weight:600;font-size:13px;color:var(--blue);padding:8px 12px;border-top:2px solid #dde4f5">${region}</td>
      </tr>`;
    }

    const monthData = MTHS_GM_NAMES.map((_, mi) => {
      const rev = getGmRevForDev(dev, mi);
      const cogs = getGmCogs(dev, mi+1);
      const gm = rev - cogs;
      const gmPct = rev > 0 ? gm/rev : null;
      return { rev, cogs, gm, gmPct };
    });

    const yearRev = monthData.reduce((s,v)=>s+v.rev,0);
    const yearCogs = monthData.reduce((s,v)=>s+v.cogs,0);
    const yearGm = yearRev - yearCogs;
    const yearPct = yearRev > 0 ? yearGm/yearRev : null;

    const cells = monthData.map(v => {
      if (v.rev === 0) return `<td style="text-align:right;padding:8px 8px"><span style="color:#ccc">—</span></td>`;
      const bg = v.gmPct >= 0.30 ? 'background:var(--green-lt);' : v.gmPct >= 0.15 ? 'background:#fff8e1;' : 'background:#fff0f0;';
      return `<td style="text-align:right;padding:8px 8px;${bg}"><span style="font-size:12px;${gmPctColor(v.gmPct)}">${fmtGmPct(v.gmPct)}</span></td>`;
    }).join('');

    rows += `<tr style="border-bottom:1px solid var(--border)">
      <td style="position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500;white-space:nowrap;padding:8px 12px">${dev.firstname} ${dev.lastname}</td>
      ${cells}
      <td style="text-align:right;padding:8px 8px;font-weight:600;${gmPctColor(yearPct)}">${fmtGmPct(yearPct)}</td>
    </tr>`;
  });

  body.innerHTML = rows || '<tr><td colspan="14" class="empty">No data</td></tr>';
}


function setGmDevDetailRegion(region) {
  gmDevDetailTeam = region;
  document.getElementById('btn-gm-dd-eu').classList.toggle('active', region==='eu');
  document.getElementById('btn-gm-dd-in').classList.toggle('active', region==='india');
  renderGmDevDetail();
}

function changeGmDevDetailTeam(dir) {
  // Not used - replaced by EU/India toggle
}

function changeGmDevDetailMonth(dir) {
  gmDevDetailMonth = Math.max(1, Math.min(12, gmDevDetailMonth + dir));
  renderGmDevDetail();
}

function renderGmDevDetail() {
  const body = document.getElementById('gm-devdetail-body');
  const label = document.getElementById('gm-devdetail-month-label');
  if (!body) return;

  if (!gmDevDetailTeam) gmDevDetailTeam = 'eu';
  const mi = gmDevDetailMonth - 1;
  if (label) label.textContent = MTHS_GM_FULL[mi] + ' ' + year_GM;

  const EU_LOCS = ['Slovakia', 'Romania', 'Latvia'];
  const region = gmDevDetailTeam;

  const allTeams = [...EU_TEAMS.filter(t=>t!=='Selfhosting'), ...IND_TEAMS];
  let devs = developers.filter(d => d.status==='active' &&
    (d.assignments||[]).some(a => allTeams.includes(a.team))
  );
  devs = devs.filter(d => {
    const loc = locations.find(l => l.id === d.location_id);
    const locName = loc?.name || '';
    const isEu = EU_LOCS.some(n => locName.startsWith(n));
    return region === 'eu' ? isEu : !isEu;
  });
  devs = sortDevsByOrder(devs);
  if (!devs.length) { body.innerHTML = '<tr><td colspan="7" class="empty">No developers found</td></tr>'; return; }

  const SRC = { tmsh:'Actuals', manual:'Manual', utilization:'Forecast' };
  let rows = '';
  let totRev=0, totCogs=0, totHours=0;

  devs.forEach(dev => {
    const rev = getGmRevForDev(dev, mi);
    const cogs = getGmCogs(dev, mi+1);
    const gm = rev - cogs;
    const pct = rev>0 ? gm/rev : null;
    const hours = actualHours[String(dev.id)]?.[gmDevDetailMonth];
    const hoursVal = hours ? parseFloat(hours.hours) : null;
    const src = hours?.source || 'utilization';
    const srcLabel = SRC[src] || src;
    const srcBg = src==='tmsh'?'var(--green-lt)':src==='manual'?'var(--amber-lt)':'var(--blue-lt)';
    const srcColor = src==='tmsh'?'var(--green)':src==='manual'?'var(--amber)':'var(--blue)';
    const cogsKnown = getCtc(dev.id, year_GM, mi+1);

    totRev+=rev; totCogs+=cogs;
    if (hoursVal) totHours+=hoursVal;

    rows += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:7px 12px;font-weight:500;position:sticky;left:0;background:var(--surface);z-index:1;white-space:nowrap">${dev.firstname} ${dev.lastname}</td>
      <td style="text-align:right;padding:7px 10px">${hoursVal != null ? hoursVal+'h' : '—'}</td>
      <td style="text-align:right;padding:7px 10px">${fmtGmEur(rev)}</td>
      <td style="text-align:right;padding:7px 10px">${cogsKnown ? fmtGmEur(cogs) : '<span style="color:var(--amber)">'+fmtGmEur(cogs)+' ⚠</span>'}</td>
      <td style="text-align:right;padding:7px 10px;font-weight:500;${gmPctColor(pct)}">${fmtGmEur(gm)}</td>
      <td style="text-align:right;padding:7px 10px;font-weight:600;${gmPctColor(pct)}">${fmtGmPct(pct)}</td>
      <td style="text-align:center;padding:7px 8px"><span style="background:${srcBg};color:${srcColor};padding:2px 8px;border-radius:99px;font-size:11px">${srcLabel}</span></td>
    </tr>`;
  });

  const totGm = totRev-totCogs;
  const totPct = totRev>0?totGm/totRev:null;
  rows += `<tr class="tbl-total" style="background:var(--bg)">
    <td style="padding:8px 12px;font-weight:600;position:sticky;left:0;background:#F8FAFC;z-index:1;border-top:2px solid var(--border)">Team Total</td>
    <td style="text-align:right;padding:8px 10px;border-top:2px solid var(--border)">${totHours>0?totHours+'h':'—'}</td>
    <td style="text-align:right;padding:8px 10px;font-weight:600;border-top:2px solid var(--border)">${fmtGmEur(totRev)}</td>
    <td style="text-align:right;padding:8px 10px;font-weight:600;border-top:2px solid var(--border)">${fmtGmEur(totCogs)}</td>
    <td style="text-align:right;padding:8px 10px;font-weight:700;border-top:2px solid var(--border);${gmPctColor(totPct)}">${fmtGmEur(totGm)}</td>
    <td style="text-align:right;padding:8px 10px;font-weight:700;border-top:2px solid var(--border);${gmPctColor(totPct)}">${fmtGmPct(totPct)}</td>
    <td style="border-top:2px solid var(--border)"></td>
  </tr>`;

  body.innerHTML = rows;
}


// ============================================================
// GM IMPROVEMENTS MODULE
// ============================================================

let gmImprovements = []; // all rows from gm_improvements table
let dec2025Rates = {};   // developer_id → dec 2025 rate
let colaSetupData = [];  // working data for COLA bulk setup form

const IMPROVEMENT_TYPES = [
  'COLA / Annual Rate Escalation',
  'Bill rate Adjustment',
  'Low Margin to High Margin Replacement',
  'Subcontractor Cost Optimization',
  'Leave Loss Reduction for Daily and Hourly Billing',
  '9th Hour Billing',
  'Utilization Improvement',
  'Pyramid Correction / N-1 Rotation',
  'T&M Resource Client Interview',
  'Offshoring / Flex-Shoring',
  'Automation / AI'
];

const IMP_COLORS = {
  'COLA / Annual Rate Escalation':                    '#7F77DD',
  'Bill rate Adjustment':                             '#1D9E75',
  'Low Margin to High Margin Replacement':            '#D85A30',
  'Subcontractor Cost Optimization':                  '#BA7517',
  'Leave Loss Reduction for Daily and Hourly Billing':'#378ADD',
  '9th Hour Billing':                                 '#D4537E',
  'Utilization Improvement':                          '#639922',
  'Pyramid Correction / N-1 Rotation':                '#185FA5',
  'T&M Resource Client Interview':                    '#888780',
  'Offshoring / Flex-Shoring':                        '#E24B4A',
  'Automation / AI':                                  '#4AB8C1'
};

const CURRENT_MI = new Date().getMonth(); // 0-based
const MTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

async function loadGmImprovements() {
  const [r1, r2] = await Promise.all([
    db.from('gm_improvements').select('*').eq('year', 2026),
    db.from('rates').select('developer_id, dec').eq('year', 2025)
  ]);
  gmImprovements = r1.data || [];
  dec2025Rates = {};
  (r2.data || []).forEach(r => { if (r.dec) dec2025Rates[r.developer_id] = parseFloat(r.dec); });
}

function getDevHoursGm(dev, month) {
  const actual = actualHours[String(dev.id)]?.[month];
  if (actual && actual.hours) return parseFloat(actual.hours);
  const mKey = MTHS[month - 1];
  const loc = locations.find(l => l.id === dev.location_id);
  const maxH = loc ? (parseFloat(loc[mKey]) || 0) : 0;
  const asgn = (dev.assignments || []).find(a => {
    const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
    const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
    const mStart = new Date(2026, month - 1, 1);
    const mEnd = new Date(2026, month, 0);
    return s <= mEnd && e >= mStart && a.billable !== false;
  });
  const tu = asgn ? (teamUtilization[asgn.team] || {}) : {};
  const util = tu[mKey] != null ? parseFloat(tu[mKey]) : 1;
  return maxH * util;
}

// ── Auto-recalculate unlocked months for COLA ────────────────────────────
async function recalcUnlockedColaMonths(year) {
  // Get locked months from settings module
  const locked = new Set();
  for (let m = 1; m <= 12; m++) {
    if (isMonthLocked(m, year)) locked.add(m);
  }

  // Find all unique COLA dev rows
  const colaRows = gmImprovements.filter(r =>
    r.improvement_type === 'COLA / Annual Rate Escalation' &&
    r.year === year &&
    !locked.has(r.month)
  );

  if (!colaRows.length) return;

  // Recalculate each unlocked row
  const updates = [];
  const devsSeen = new Set();

  // Get unique devs from COLA rows
  const uniqueDevIds = [...new Set(colaRows.map(r => r.developer_id))];

  for (const devId of uniqueDevIds) {
    const dev = developers.find(d => d.id === devId);
    if (!dev) continue;

    const rate2025 = dec2025Rates[devId];
    const rate2026 = parseFloat(rates[devId]?.jan);
    if (!rate2025 || !rate2026) continue;

    const diff = Math.round((rate2026 - rate2025) * 100) / 100;
    if (diff <= 0) continue;

    // Get from/to months from existing rows for this dev
    const devRows = colaRows.filter(r => r.developer_id === devId);
    const months = devRows.map(r => r.month);

    for (const month of months) {
      if (locked.has(month)) continue;
      const hours = getDevHoursGm(dev, month);
      const newAmount = Math.round(diff * hours * 100) / 100;

      // Only update if amount changed
      const existing = gmImprovements.find(r =>
        r.developer_id === devId && r.year === year &&
        r.month === month && r.improvement_type === 'COLA / Annual Rate Escalation'
      );
      if (existing && Math.abs(existing.amount - newAmount) < 0.01) continue; // no change

      updates.push({ devId, month, newAmount, existing });
    }
  }

  if (!updates.length) return;

  // Save updates to DB
  for (const u of updates) {
    const row = {
      year, month: u.month,
      developer_id: u.devId,
      improvement_type: 'COLA / Annual Rate Escalation',
      lever_name: u.existing?.lever_name || 'COLA Europe',
      eu_in: u.existing?.eu_in || 'EU',
      amount: u.newAmount,
      description: u.existing?.description || '',
      is_manual: false
    };
    const { error } = await db.from('gm_improvements')
      .upsert(row, { onConflict: 'developer_id,year,month,improvement_type,lever_name' });
    if (error) { console.warn('recalc error:', error.message); continue; }

    // Update local cache
    const idx = gmImprovements.findIndex(r =>
      r.developer_id === u.devId && r.year === year &&
      r.month === u.month && r.improvement_type === 'COLA / Annual Rate Escalation'
    );
    if (idx >= 0) gmImprovements[idx].amount = u.newAmount;
  }
}

// ── Render GM Levers main view ────────────────────────────────────────────
async function renderGmLevers() {
  const container = document.getElementById('gm-levers-view');
  if (!container) return;
  if (!gmImprovements.length) await loadGmImprovements();

  const year = 2026;

  // Auto-recalculate unlocked months for COLA rows
  await recalcUnlockedColaMonths(year);

  const catFilter = document.getElementById('gm-levers-filter')?.value || 'all';

  // Get all rows for selected filter
  let rows = gmImprovements.filter(r => r.year === year);
  if (catFilter !== 'all') rows = rows.filter(r => r.improvement_type === catFilter);

  // Group by improvement_type → lever_name → month → sum
  const typeMap = {}; // {improvement_type: {lever_name: {month: total, eu_in: string}}}
  const typeTotals = {};
  const monthTotals = new Array(12).fill(0);

  rows.forEach(r => {
    if (!typeMap[r.improvement_type]) typeMap[r.improvement_type] = {};
    const lname = r.lever_name || r.improvement_type;
    if (!typeMap[r.improvement_type][lname]) typeMap[r.improvement_type][lname] = { months: {}, eu_in: r.eu_in || 'EU' };
    typeMap[r.improvement_type][lname].months[r.month] = (typeMap[r.improvement_type][lname].months[r.month] || 0) + r.amount;
    typeTotals[r.improvement_type] = (typeTotals[r.improvement_type] || 0) + r.amount;
    monthTotals[r.month - 1] += r.amount;
  });

  const grandTotal = monthTotals.reduce((a, b) => a + b, 0);
  const ytdTotal = monthTotals.slice(0, CURRENT_MI).reduce((a, b) => a + b, 0);

  // Stat cards
  const statsEl = document.getElementById('gm-levers-stats');
  if (statsEl) {
    const topType = Object.entries(typeTotals).sort((a,b) => b[1]-a[1])[0];
    statsEl.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem">
        <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">YTD Impact (Jan–${MTH_LABELS[CURRENT_MI-1]})</div>
        <div style="font-size:22px;font-weight:600;color:var(--green)">€${Math.round(ytdTotal).toLocaleString('de-DE')}</div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem">
        <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">Full Year Forecast</div>
        <div style="font-size:22px;font-weight:600">€${Math.round(grandTotal).toLocaleString('de-DE')}</div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem">
        <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">Improvement types</div>
        <div style="font-size:22px;font-weight:600">${Object.keys(typeMap).length}</div>
      </div>
      ${topType ? `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem">
        <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">Top type</div>
        <div style="font-size:13px;font-weight:600;color:${IMP_COLORS[topType[0]]||'inherit'}">${topType[0]}</div>
        <div style="font-size:12px;color:var(--text-2)">€${Math.round(topType[1]).toLocaleString('de-DE')}</div>
      </div>` : ''}`;
  }

  // Table body
  const tbody = document.getElementById('gm-levers-body');
  if (!tbody) return;

  if (!Object.keys(typeMap).length) {
    tbody.innerHTML = '<tr><td colspan="16" class="empty">No improvements recorded yet — use the setup buttons to get started</td></tr>';
    return;
  }

  let html = '';
  Object.entries(typeMap).forEach(([type, levers]) => {
    const color = IMP_COLORS[type] || '#888';
    const typeTotal = typeTotals[type] || 0;

    // Type header row
    const typeCells = Array.from({length:12}, (_,mi) => {
      const v = Object.values(levers).reduce((s, l) => s + (l.months[mi+1] || 0), 0);
      return `<td style="text-align:right;padding:5px 8px;font-size:12px;font-weight:600;color:${color}">${v ? '€'+Math.round(v).toLocaleString('de-DE') : '—'}</td>`;
    }).join('');

    html += `<tr style="background:var(--bg);cursor:pointer" onclick="toggleImprovementDetail('${type}')">
      <td style="position:sticky;left:0;background:var(--bg);z-index:1;padding:8px 12px">
        <div style="font-size:13px;font-weight:600;color:${color}">▸ ${type}</div>
      </td>
      <td></td>
      ${typeCells}
      <td style="text-align:right;padding:6px 8px;font-weight:700;color:${color}">€${Math.round(typeTotal).toLocaleString('de-DE')}</td>
      <td style="text-align:center;padding:6px 4px">
        <button class="btn" onclick="event.stopPropagation();openImprovementSetup('${type}')" style="padding:3px 8px;font-size:11px">Setup</button>
      </td>
    </tr>`;

    // Lever sub-rows
    Object.entries(levers).forEach(([leverName, leverData]) => {
      const leverTotal = Object.values(leverData.months).reduce((a,b)=>a+b, 0);
      const euIn = leverData.eu_in;
      const cells = Array.from({length:12}, (_,mi) => {
        const v = leverData.months[mi+1] || 0;
        const isPast = (mi+1) <= CURRENT_MI;
        return `<td style="text-align:right;padding:4px 8px;font-size:12px;cursor:pointer;${isPast&&v?'color:var(--green)':!isPast&&v?'color:var(--text-3);font-style:italic':'color:var(--text-3)'}" onclick="toggleLeverNameDetail('${type}','${leverName}')">${v ? '€'+Math.round(v).toLocaleString('de-DE') : '—'}</td>`;
      }).join('');

      html += `<tr id="imp-sub-${(type+leverName).replace(/[^a-z0-9]/gi,'_')}" style="border-bottom:1px solid var(--border)">
        <td style="position:sticky;left:0;background:var(--surface);z-index:1;padding:6px 12px 6px 24px">
          <div style="font-size:13px;font-weight:500">${leverName}</div>
        </td>
        <td style="text-align:center;padding:4px 8px">
          <span style="font-size:11px;padding:2px 6px;border-radius:99px;background:${euIn==='EU'?'#EEF2FF':'#FFF7ED'};color:${euIn==='EU'?'#4338CA':'#C2410C'}">${euIn}</span>
        </td>
        ${cells}
        <td style="text-align:right;padding:6px 8px;font-weight:600;color:var(--green)">€${Math.round(leverTotal).toLocaleString('de-DE')}</td>
        <td></td>
      </tr>
      <tr id="imp-detail-${(type+leverName).replace(/[^a-z0-9]/gi,'_')}" style="display:none">
        <td colspan="16" style="padding:0;background:var(--bg)">
          ${renderImprovementDevDetail(type, leverName, 2026)}
        </td>
      </tr>`;
    });
  });

  // Grand total row
  const grandCells = monthTotals.map(v => `<td style="text-align:right;padding:7px 8px;font-weight:700;border-top:2px solid var(--border)">€${Math.round(v).toLocaleString('de-DE')}</td>`).join('');
  html += `<tr style="background:#F8FAFC">
    <td style="position:sticky;left:0;background:#F8FAFC;z-index:1;padding:8px 12px;font-weight:700;border-top:2px solid var(--border)">Grand Total</td>
    <td style="border-top:2px solid var(--border)"></td>
    ${grandCells}
    <td style="text-align:right;padding:8px;font-weight:700;color:var(--green);border-top:2px solid var(--border)">€${Math.round(grandTotal).toLocaleString('de-DE')}</td>
    <td style="border-top:2px solid var(--border)"></td>
  </tr>`;

  tbody.innerHTML = html;
}

function toggleImprovementDetail(type) {
  // Toggle all lever sub-rows for this type
  const allLevers = [...document.querySelectorAll(`tr[id^="imp-sub-${type.replace(/[^a-z0-9]/gi,'_')}"]`)];
  // Actually just find them by data or id pattern — simpler: toggle visibility of sub+detail rows
  // Re-render is simplest here
  renderGmLevers();
}

function toggleLeverNameDetail(type, leverName) {
  const id = 'imp-detail-' + (type + leverName).replace(/[^a-z0-9]/gi,'_');
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function renderImprovementDevDetail(type, leverName, year) {
  const detailRows = gmImprovements.filter(r =>
    r.improvement_type === type &&
    (r.lever_name || r.improvement_type) === leverName &&
    r.year === year
  );
  if (!detailRows.length) return '<div style="padding:12px 24px;font-size:12px;color:var(--text-3)">No data</div>';

  const devMap = {};
  detailRows.forEach(r => {
    if (!devMap[r.developer_id]) devMap[r.developer_id] = {};
    devMap[r.developer_id][r.month] = r.amount;
  });

  const color = IMP_COLORS[type] || '#888';
  const allTeams = [...EU_TEAMS, ...IND_TEAMS];
  const sortedDevIds = Object.keys(devMap).sort((a,b) => {
    const da = developers.find(d => d.id == a);
    const db2 = developers.find(d => d.id == b);
    const ta = allTeams.indexOf(getDevTeam(da));
    const tb = allTeams.indexOf(getDevTeam(db2));
    return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb) || (da?.lastname||'').localeCompare(db2?.lastname||'');
  });

  let html = `<div style="overflow-x:auto"><table style="width:100%;font-size:12px;table-layout:fixed">
    <thead><tr style="color:var(--text-3);font-size:11px">
      <th style="text-align:left;padding:4px 12px 4px 32px;font-weight:400;width:200px">Developer</th>
      ${MTH_LABELS.map(m=>`<th style="text-align:right;padding:4px 8px;font-weight:400;width:70px">${m}</th>`).join('')}
      <th style="text-align:right;padding:4px 8px;font-weight:400;width:80px">Total</th>
      <th style="width:50px"></th>
    </tr></thead><tbody>`;

  sortedDevIds.forEach(devId => {
    const dev = developers.find(d => d.id == devId);
    const monthData = devMap[devId];
    const devTotal = Object.values(monthData).reduce((a,b)=>a+b, 0);
    const cells = Array.from({length:12},(_,mi) => {
      const v = monthData[mi+1];
      const isPast = (mi+1) <= CURRENT_MI;
      return `<td style="text-align:right;padding:4px 8px;${isPast&&v?'color:var(--green)':'color:var(--text-3)'}">${v ? '€'+Math.round(v).toLocaleString('de-DE') : '—'}</td>`;
    }).join('');
    html += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 12px 5px 32px">${dev ? dev.firstname+' '+dev.lastname : devId}</td>
      ${cells}
      <td style="text-align:right;padding:4px 8px;font-weight:600;color:${color}">€${Math.round(devTotal).toLocaleString('de-DE')}</td>
      <td style="text-align:center;padding:4px">
        <button class="btn" onclick="removeDevFromLever(${devId},'${type}','${leverName}')" style="padding:2px 7px;font-size:11px;color:var(--red)" title="Remove developer">✕</button>
      </td>
    </tr>`;
  });

  html += `<tr><td colspan="${14+2}" style="padding:6px 12px 6px 32px">
    <button class="btn" onclick="openAddDevToLever('${type}','${leverName}')" style="padding:3px 10px;font-size:11px">+ Add developer</button>
  </td></tr>`;

  html += '</tbody></table></div>';
  return html;
}

function getDevTeam(dev) {
  if (!dev) return '';
  const a = (dev.assignments||[]).find(a => a.billable !== false);
  return a?.team || '';
}

// ── COLA Setup Form ───────────────────────────────────────────────────────
function openImprovementSetup(type) {
  if (type === 'COLA / Annual Rate Escalation') openColaSetup();
  else showToast('Setup form for "'+type+'" coming soon');
}

function openColaSetup(euIn) {
  const modal = document.getElementById('cola-setup-modal');
  // Set title and store euIn
  document.getElementById('cola-setup-title').textContent = euIn === 'EU'
    ? 'Add COLA Europe' : 'Add COLA India';
  modal.dataset.euIn = euIn;

  // Populate team selector
  const teams = euIn === 'EU'
    ? EU_TEAMS.filter(t => t !== 'Selfhosting')
    : IND_TEAMS;
  const sel = document.getElementById('cola-team-select');
  sel.innerHTML = teams.map(t => `<option value="${t}">${t}</option>`).join('');

  modal.classList.add('open');
  renderColaDevTable();
}

function renderColaDevTable() {
  const modal = document.getElementById('cola-setup-modal');
  const euIn = modal.dataset.euIn;
  const leverName = euIn === 'EU' ? 'COLA Europe' : 'COLA India';
  const team = document.getElementById('cola-team-select').value;
  const tbody = document.getElementById('cola-setup-tbody');
  if (!tbody) return;

  // Get devs for this team with both rates
  const teamDevs = developers.filter(d => {
    const hasTeam = (d.assignments||[]).some(a => a.team === team && a.billable !== false);
    if (!hasTeam) return false;
    return dec2025Rates[d.id] && rates[d.id]?.jan;
  });

  if (!teamDevs.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No developers with rate data found for this team</td></tr>';
    return;
  }

  let html = '';
  teamDevs.forEach(dev => {
    const rate2025 = dec2025Rates[dev.id] || 0;
    const rate2026 = parseFloat(rates[dev.id]?.jan) || 0;
    const diff = Math.round((rate2026 - rate2025) * 100) / 100;
    const ps = dev.project_start ? dev.project_start.substring(0,7) : '2026-01';
    const pe = dev.project_end ? dev.project_end.substring(0,7) : '2026-12';

    // Check if already saved
    const alreadySaved = gmImprovements.some(r =>
      r.developer_id === dev.id &&
      r.improvement_type === 'COLA / Annual Rate Escalation' &&
      r.lever_name === leverName &&
      r.year === 2026
    );

    const savedBadge = alreadySaved
      ? '<span style="font-size:10px;color:var(--green);margin-left:6px">✓ saved</span>'
      : '';

    const fromMonth = parseInt(ps.split('-')[1]);
    const toMonth = parseInt(pe.split('-')[1]);

    html += `<tr style="border-bottom:1px solid var(--border)" data-dev-id="${dev.id}" data-eu-in="${euIn}" data-lever-name="${leverName}">
      <td style="padding:6px 12px;font-size:13px">${dev.firstname} ${dev.lastname}${savedBadge}</td>
      <td style="padding:4px 6px">
        <select class="cola-from" style="font-size:12px;padding:4px 6px">
          ${MTH_LABELS.map((m,i) => `<option value="${i+1}" ${i+1===fromMonth?'selected':''}>${m}</option>`).join('')}
        </select>
      </td>
      <td style="padding:4px 6px">
        <select class="cola-to" style="font-size:12px;padding:4px 6px">
          ${MTH_LABELS.map((m,i) => `<option value="${i+1}" ${i+1===toMonth?'selected':''}>${m}</option>`).join('')}
        </select>
      </td>
      <td style="padding:4px 6px">
        <input type="number" class="cola-rate2025" value="${rate2025}" step="0.01" style="font-size:12px;padding:4px 6px;width:75px" oninput="updateColaDiff(this)">
      </td>
      <td style="padding:4px 6px">
        <input type="number" class="cola-rate2026" value="${rate2026}" step="0.01" style="font-size:12px;padding:4px 6px;width:75px" oninput="updateColaDiff(this)">
      </td>
      <td class="cola-diff" style="padding:4px 12px;font-size:13px;font-weight:500;color:${diff>0?'var(--green)':'var(--red)'}">
        ${diff > 0 ? '+' : ''}${diff}
      </td>
      <td style="padding:4px 6px;text-align:center">
        <button class="btn btn-primary" onclick="saveColaDevRow(this)" style="padding:4px 10px;font-size:12px">Save</button>
      </td>
    </tr>`;
  });

  tbody.innerHTML = html;
}

async function saveColaDevRow(btn) {
  const row = btn.closest('tr');
  const devId = parseInt(row.dataset.devId);
  const euIn = row.dataset.euIn;
  const leverName = row.dataset.leverName;
  const dev = developers.find(d => d.id === devId);
  if (!dev) return;

  const fromMonth = parseInt(row.querySelector('.cola-from').value);
  const toMonth = parseInt(row.querySelector('.cola-to').value);
  const rate2025 = parseFloat(row.querySelector('.cola-rate2025').value) || 0;
  const rate2026 = parseFloat(row.querySelector('.cola-rate2026').value) || 0;
  const diff = Math.round((rate2026 - rate2025) * 100) / 100;

  if (diff <= 0) { showToast('Rate diff must be positive'); return; }

  btn.textContent = '...';
  btn.disabled = true;

  for (let month = fromMonth; month <= toMonth; month++) {
    const hours = getDevHoursGm(dev, month);
    const amount = Math.round(diff * hours * 100) / 100;
    const impRow = {
      year: 2026, month, developer_id: devId,
      improvement_type: 'COLA / Annual Rate Escalation',
      lever_name: leverName, eu_in: euIn,
      amount,
      description: `Rate escalation: €${rate2025} → €${rate2026} (+€${diff}/hr)`,
      is_manual: false
    };
    const { error } = await db.from('gm_improvements')
      .upsert(impRow, { onConflict: 'developer_id,year,month,improvement_type,lever_name' });
    if (error) {
      showToast('Error: ' + error.message);
      btn.textContent = 'Save';
      btn.disabled = false;
      return;
    }
  }

  // Update local cache
  await loadGmImprovements();

  // Mark row as saved
  btn.textContent = '✓';
  btn.style.background = 'var(--green)';
  btn.disabled = true;
  const nameCell = row.querySelector('td:first-child');
  if (nameCell && !nameCell.querySelector('.saved-badge')) {
    const badge = document.createElement('span');
    badge.className = 'saved-badge';
    badge.style.cssText = 'font-size:10px;color:var(--green);margin-left:6px';
    badge.textContent = '✓ saved';
    nameCell.appendChild(badge);
  }

  showToast(`${dev.firstname} ${dev.lastname} saved`);
}

async function removeDevFromLever(devId, type, leverName) {
  const dev = developers.find(d => d.id == devId);
  const name = dev ? `${dev.firstname} ${dev.lastname}` : devId;
  if (!confirm(`Remove ${name} from "${leverName}"? This will delete all their monthly entries.`)) return;

  const { error } = await db.from('gm_improvements')
    .delete()
    .eq('developer_id', devId)
    .eq('improvement_type', type)
    .eq('lever_name', leverName)
    .eq('year', 2026);

  if (error) { showToast('Error: ' + error.message); return; }

  gmImprovements = gmImprovements.filter(r =>
    !(r.developer_id == devId && r.improvement_type === type && (r.lever_name || r.improvement_type) === leverName && r.year === 2026)
  );
  showToast(`${name} removed from ${leverName}`);
  renderGmLevers();
}

let addDevLeverContext = null;

function openAddDevToLever(type, leverName) {
  addDevLeverContext = { type, leverName };
  const euIn = leverName.includes('India') ? 'IN' : 'EU';

  // Filter devs not already in this lever
  const existingDevIds = new Set(
    gmImprovements
      .filter(r => r.improvement_type === type && (r.lever_name || r.improvement_type) === leverName && r.year === 2026)
      .map(r => r.developer_id)
  );

  const availableDevs = sortDevsByOrder(developers.filter(d => !existingDevIds.has(d.id)));

  const devOptions = availableDevs
    .map(d => `<option value="${d.id}">${d.firstname} ${d.lastname}</option>`)
    .join('');

  document.getElementById('add-dev-lever-title').textContent = `Add developer to ${leverName}`;
  document.getElementById('add-dev-lever-select').innerHTML = devOptions;
  document.getElementById('add-dev-lever-from').value = '2026-01';
  document.getElementById('add-dev-lever-to').value = '2026-12';
  document.getElementById('add-dev-lever-modal').classList.add('open');
}

async function saveAddDevToLever() {
  if (!addDevLeverContext) return;
  const { type, leverName } = addDevLeverContext;
  const devId = parseInt(document.getElementById('add-dev-lever-select').value);
  const fromMonth = parseInt(document.getElementById('add-dev-lever-from').value.split('-')[1]);
  const toMonth = parseInt(document.getElementById('add-dev-lever-to').value.split('-')[1]);
  const dev = developers.find(d => d.id === devId);
  if (!dev) return;

  const euIn = leverName.includes('India') ? 'IN' : 'EU';
  const rate2025 = dec2025Rates[devId];
  const rate2026 = parseFloat(rates[devId]?.jan);

  if (!rate2025 || !rate2026) { showToast('No rate data found for this developer'); return; }
  const diff = Math.round((rate2026 - rate2025) * 100) / 100;
  if (diff <= 0) { showToast('No positive rate difference for this developer'); return; }

  let count = 0;
  for (let month = fromMonth; month <= toMonth; month++) {
    const hours = getDevHoursGm(dev, month);
    const amount = Math.round(diff * hours * 100) / 100;
    const row = {
      year: 2026, month, developer_id: devId,
      improvement_type: type, lever_name: leverName, eu_in: euIn,
      amount,
      description: `Rate escalation: €${rate2025} → €${rate2026} (+€${diff}/hr)`,
      is_manual: false
    };
    const { error } = await db.from('gm_improvements')
      .upsert(row, { onConflict: 'developer_id,year,month,improvement_type,lever_name' });
    if (error) { showToast('Error: ' + error.message); return; }
    count++;
  }

  await loadGmImprovements();
  closeModal('add-dev-lever-modal');
  showToast(`${dev.firstname} ${dev.lastname} added — ${count} months saved`);
  renderGmLevers();
}
