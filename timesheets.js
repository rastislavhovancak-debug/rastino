// ============================================================
// TIMESHEETS MODULE
// ============================================================
let tsData = null; // parsed rows from SAP export
let tsIssues = []; // [{nessid, name, date, day, type, details}]
let tsImportData = {}; // keyed by month -> [{nessid, name, hours}]

const BILLABLE_ACTS = new Set(['1004']);
const ONCALL_ACT = '1007';
const EU_EXPECTED_HOURS = 8;
const IND_EXPECTED_HOURS = 9;
const ONCALL_HOURS = 16;
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isEuDev(nessid) {
  const dev = developers.find(d => d.nessid === nessid);
  if (!dev) return null;
  const team = getDevCurrentTeam(dev);
  if (EU_TEAMS.includes(team)) return true;
  if (IND_TEAMS.includes(team)) return false;
  // Check assignments for any EU team
  if ((dev.assignments||[]).some(a => EU_TEAMS.includes(a.team))) return true;
  return false;
}

function isContractor(nessid) {
  const dev = developers.find(d => d.nessid === nessid);
  return dev?.workertype === 'Contractor';
}

function getDevWbsCodes(nessid) {
  const dev = developers.find(d => d.nessid === nessid);
  if (!dev) return new Set();
  const codes = new Set();
  (dev.assignments||[]).forEach(a => {
    (a.wbs||[]).forEach(w => codes.add(w.code));
  });
  return codes;
}

// Returns WBS codes that belong to fixed-price (Selfhosting) assignments
function getDevFixedPriceWbs(nessid) {
  const dev = developers.find(d => d.nessid === nessid);
  if (!dev) return new Set();
  const codes = new Set();
  (dev.assignments||[]).forEach(a => {
    if (a.team === 'Selfhosting') {
      (a.wbs||[]).forEach(w => codes.add(w.code));
    }
  });
  return codes;
}

// Check if a SAP row is a fixed-price (Selfhosting) row for a developer
function isFixedPriceRow(nessid, wbsCode) {
  return getDevFixedPriceWbs(nessid).has(wbsCode);
}

function clearTsData() {
  tsData = null;
  tsIssues = [];
  tsImportData = {};
  document.getElementById('ts-no-file').style.display = '';
  document.getElementById('ts-content').style.display = 'none';
  document.getElementById('btn-ts-clear').style.display = 'none';
  document.getElementById('ts-file-input').value = '';
  document.getElementById('ts-file-info').textContent = '';
}

function closeTsSidebar() {} // kept for compatibility

function showTsSidebar(nessid) {
  if (!tsData) return;
  const rows = tsData.filter(r => r.nessid === nessid);
  if (!rows.length) return;

  const name = rows[0].name;
  document.getElementById('ts-detail-title').textContent = name;

  const sorted = [...rows].sort((a, b) => a.date - b.date || a.wbs.localeCompare(b.wbs));
  const assignedWbs = getDevWbsCodes(nessid);
  const DAY_FULL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let grandTotal = 0;

  const rowsHtml = sorted.map(r => {
    const dow = r.date.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dateStr = localDateStr(r.date);
    const dayStr = DAY_FULL[dow];
    const isBillableWbs = r.wbs.endsWith('-B') && !r.wbs.endsWith('-NB');
    const isBillableAct = r.activity === '1004';
    const isOncall = r.activity === '1007' && r.classification === 'On-Call';

    let rowBg;
    if (isWeekend) {
      rowBg = '#eeeeee';
    } else if ((assignedWbs.size > 0 && !assignedWbs.has(r.wbs)) ||
               (isBillableAct && !isBillableWbs) ||
               (!isBillableAct && !isOncall && isBillableWbs)) {
      rowBg = '#fff0f0';
    } else if (isBillableWbs) {
      rowBg = '#e8f5e9';
    } else {
      rowBg = '#f9f9f9';
    }

    grandTotal += r.hours;

    return `<tr style="background:${rowBg};border-bottom:1px solid rgba(0,0,0,0.05)">
      <td style="padding:7px 10px;font-size:13px;white-space:nowrap">${dateStr}</td>
      <td style="padding:7px 4px;font-size:11px;font-weight:${isWeekend?'600':'400'};color:${isWeekend?'#c62828':'#888'};text-align:center">${dayStr}</td>
      <td style="padding:7px 6px;font-size:12px;font-family:monospace;word-break:break-all">${r.wbs}</td>
      <td style="padding:7px 6px;font-size:13px">${r.activity}</td>
      <td style="padding:7px 6px;font-size:13px">${r.actDesc.trim()}</td>
      <td style="padding:7px 6px;font-size:11px;color:var(--text-2)">${r.classification}</td>
      <td style="padding:7px 4px;text-align:center">${
        r.status === '10' ? '<span style="background:var(--bg);color:var(--text-3);padding:2px 5px;border-radius:4px;font-size:11px">10</span>' :
        r.status === '20' ? '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 5px;border-radius:4px;font-size:11px">20</span>' :
        r.status === '30' ? '<span style="background:var(--green-lt);color:var(--green);padding:2px 5px;border-radius:4px;font-size:11px">30</span>' :
        `<span style="color:var(--text-3);font-size:11px">${r.status}</span>`
      }</td>
      <td style="padding:7px 10px;font-size:13px;text-align:right;font-weight:500">${r.hours}h</td>
    </tr>`;
  }).join('');

  document.getElementById('ts-detail-body').innerHTML = rowsHtml;
  document.getElementById('ts-detail-total').textContent = grandTotal + 'h';
  document.getElementById('ts-detail-modal').classList.add('open');
}

async function checkKnownIssues() {
  const MTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Find which month has records in ts_seen
  const { data, error } = await db.from('ts_seen')
    .select('month').eq('year', 2026).limit(1);
  if (error) { showToast('Error: ' + error.message); return; }
  if (!data || !data.length) {
    alert('No known issues found in database for 2026.');
    return;
  }

  const month = data[0].month;
  const monthName = MTH_FULL[month - 1];

  const confirmed = confirm(`${monthName} records recognized in database.\n\nDo you want to load?`);
  if (!confirmed) return;

  window.tsMonth = month;
  await loadTsTracking(month, 2026);

  const seenCount = Object.keys(tsSeen).length;
  const ackCount = Object.keys(tsAcknowledged).length;

  document.getElementById('ts-file-info').textContent =
    `${monthName} — loaded from database (${seenCount} known issues, ${ackCount} acknowledged)`;
  document.getElementById('ts-no-file').style.display = 'none';
  document.getElementById('ts-content').style.display = '';
  document.getElementById('btn-ts-clear').style.display = '';

  if (tsData) {
    // SAP data already loaded — re-analyze and apply tracking
    analyzeTimesheets();
    tsIssues.forEach(i => { i._isNew = !tsSeen[tsIssueKey(i)]; });
    switchTsView('check');
    renderTsCheck();
  } else {
    // No SAP data — show DB-only summary in check view
    switchTsView('check');
    renderTsCheckDbOnly(month, monthName);
  }
  showToast(`${monthName} records loaded`);
}


function renderTsCheckDbOnly(month, monthName) {
  const body = document.getElementById('ts-check-body');
  const MTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Update counters
  const hiddenCount = document.getElementById('ts-count-hidden');
  if (hiddenCount) hiddenCount.textContent = Object.keys(tsAcknowledged).length;
  document.getElementById('ts-count-hours').textContent = '—';
  document.getElementById('ts-count-wbs').textContent = '—';
  document.getElementById('ts-count-ok').textContent = '—';

  const ackEntries = Object.values(tsAcknowledged);
  const seenKeys = Object.keys(tsSeen);

  if (!seenKeys.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No known issues in database for this month</td></tr>';
    return;
  }

  // Group by nessid
  const byDev = {};
  seenKeys.forEach(key => {
    const [nessid, date, type] = key.split('_');
    if (!byDev[nessid]) byDev[nessid] = [];
    const ack = tsAcknowledged[key];
    byDev[nessid].push({ date, type, ack });
  });

  const typeColors = { hours: '#fff0f0', wbs: '#fff8e1', info: '#f1f8e9' };
  const typeBadge = {
    hours: '<span style="background:#fff0f0;color:#c62828;padding:2px 8px;border-radius:99px;font-size:11px">Daily hours</span>',
    wbs: '<span style="background:#fff8e1;color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">Wrong WBS</span>',
    info: '<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px">Info</span>'
  };

  const rows = [];
  Object.entries(byDev).sort(([a],[b]) => a.localeCompare(b)).forEach(([nessid, issues]) => {
    const dev = developers.find(d => d.nessid === nessid);
    const name = dev ? `${dev.firstname} ${dev.lastname}` : nessid;
    issues.sort((a,b) => a.date.localeCompare(b.date)).forEach((issue, idx) => {
      const isAcked = !!issue.ack;
      const rowBg = isAcked ? 'background:#f8f8f8;opacity:0.6' : `background:${typeColors[issue.type]||'white'}`;
      const noteBadge = issue.ack?.note ? `<span style="font-size:11px;color:var(--text-2);margin-left:6px;font-style:italic">📝 ${issue.ack.note}</span>` : '';
      rows.push(`<tr style="${rowBg}">
        <td style="text-align:center;padding:6px 8px">
          <input type="checkbox" ${isAcked?'checked':''} title="Acknowledged" disabled>
        </td>
        <td style="font-weight:${idx===0?'500':'400'};color:${idx===0?'var(--blue)':'#bbb'}">${idx===0?name:''}</td>
        <td style="font-size:13px">${issue.date}</td>
        <td style="font-size:13px;color:var(--text-2)">—</td>
        <td>—</td>
        <td>${typeBadge[issue.type]||issue.type}</td>
        <td style="font-size:13px">${isAcked?'Acknowledged':'Known issue'}${noteBadge}
          ${isAcked?'<span style="margin-left:6px;font-size:11px;background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px">✓ Acked</span>':''}
        </td>
      </tr>`);
    });
  });

  body.innerHTML = rows.join('') ||
    '<tr><td colspan="7" class="empty" style="color:var(--green)">No issues to show</td></tr>';

  // Show info banner
  const info = document.getElementById('ts-file-info');
  if (info) info.innerHTML = `<span style="color:var(--amber);font-weight:500">⚠️ DB view only</span> — ${monthName}: ${seenKeys.length} known issues, ${ackEntries.length} acknowledged. Upload SAP export to see full details.`;
}


async function renderTimesheets() {
  if (!tsData) return;
  // Reload tracking if month changed or not loaded yet
  if (window.tsMonth && window.tsMonth !== tsMonth_ack) {
    await loadTsTracking(window.tsMonth, 2026);
  }
  renderTsCheck();
}

function switchTsView(v) {
  document.getElementById('btn-ts-check').classList.toggle('active', v === 'check');
  document.getElementById('btn-ts-overview').classList.toggle('active', v === 'overview');
  document.getElementById('btn-ts-import').classList.toggle('active', v === 'import');
  document.getElementById('ts-check-view').style.display = v === 'check' ? '' : 'none';
  document.getElementById('ts-overview-view').style.display = v === 'overview' ? '' : 'none';
  document.getElementById('ts-import-view').style.display = v === 'import' ? '' : 'none';
  if (v === 'import') renderTsImport();
  if (v === 'overview') renderTsOverview();
}

async function loadTsFile(input) {
  const file = input.files[0];
  if (!file) return;

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, {type: 'array', cellDates: true});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {header: 1, raw: false, dateNF: 'yyyy-mm-dd'});

  if (!rows.length || rows[0][0] !== 'Personnel Number') {
    showToast('Invalid file format — expected SAP export');
    return;
  }

  // Parse rows
  tsData = [];
  const months = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const dateRaw = r[6];
    let date;
    if (dateRaw instanceof Date) {
      date = dateRaw;
    } else if (typeof dateRaw === 'string') {
      date = new Date(dateRaw);
    } else {
      continue;
    }
    if (isNaN(date.getTime())) continue;
    months.add(date.getMonth() + 1);
    tsData.push({
      nessid: String(r[0]).trim(),
      name: String(r[1]).trim(),
      wbs: String(r[2]).trim(),
      activity: String(r[3]).trim(),
      actDesc: String(r[4]).trim(),
      classification: String(r[5]).trim(),
      date,
      hours: parseFloat(r[7]) || 0,
      status: String(r[8]).trim()
    });
  }

  // Detect month
  const monthsSorted = [...months].sort();
  const detectedMonth = monthsSorted[monthsSorted.length - 1];
  const monthName = MONTH_NAMES_FULL[detectedMonth - 1];

  // Warn if multiple months found
  let confirmMsg = '';
  if (monthsSorted.length > 1) {
    const monthNames = monthsSorted.map(m => MONTH_NAMES_FULL[m-1]).join(', ');
    confirmMsg = `⚠️ Multiple months detected in this file: ${monthNames}\n\nOnly ${monthName} (latest) will be used for analysis. Rows from other months will be ignored.\n\nContinue?`;
  } else {
    confirmMsg = `${monthName} was recognized in this SAP export.\n\nContinue with ${monthName}?`;
  }

  const confirmed = confirm(confirmMsg);
  if (!confirmed) {
    document.getElementById('ts-file-input').value = '';
    return;
  }

  // Store detected month globally
  window.tsMonth = detectedMonth;

  // Update import month label
  const label = document.getElementById('ts-import-month-label');
  if (label) label.textContent = monthName;

  // Reset import done state
  const doneEl = document.getElementById('ts-import-done');
  const btnEl = document.getElementById('ts-import-btn');
  if (doneEl) doneEl.style.display = 'none';
  if (btnEl) { btnEl.style.display = ''; btnEl.disabled = false; btnEl.textContent = 'Import actuals'; }

  document.getElementById('ts-file-info').textContent =
    `${file.name} — ${tsData.length} rows, ${[...new Set(tsData.map(r=>r.nessid))].length} developers, ${monthName}`;

  document.getElementById('ts-no-file').style.display = 'none';
  document.getElementById('ts-content').style.display = '';
  document.getElementById('btn-ts-clear').style.display = '';

  analyzeTimesheets();
  populateTsDevSelect();
  // Load acknowledged records then reconcile and mark new issues
  await loadTsTracking(detectedMonth, 2026);
  await reconcileTsAcknowledged();
  // Mark issues not in ts_seen as NEW, then save new ones to ts_seen
  const newIssues = tsIssues.filter(i => !tsSeen[tsIssueKey(i)]);
  newIssues.forEach(i => { i._isNew = true; });
  if (newIssues.length) await saveNewToSeen(newIssues, detectedMonth, 2026);
  renderTsCheck();
  if (document.getElementById('ts-import-view').style.display !== 'none') {
    renderTsImport();
  }
}

function analyzeTimesheets() {
  if (!tsData) return;
  tsIssues = [];

  // Only analyze rows from the detected month
  const month = window.tsMonth;
  const monthData = month ? tsData.filter(r => r.date.getMonth() + 1 === month) : tsData;

  // Build public holiday lookup: nessid -> Set of dateStr
  function isPublicHoliday(nessid, dateStr) {
    const dev = developers.find(d => d.nessid === nessid);
    if (!dev || !dev.location_id) return false;
    return publicHolidays.some(h => h.location_id === dev.location_id && String(h.date).substring(0, 10) === dateStr);
  }

  // Group by nessid -> date -> rows
  const byPersonDay = {};
  monthData.forEach(r => {
    const key = r.nessid;
    if (!byPersonDay[key]) byPersonDay[key] = {};
    const dateKey = localDateStr(r.date);
    if (!byPersonDay[key][dateKey]) byPersonDay[key][dateKey] = [];
    byPersonDay[key][dateKey].push(r);
  });

  // Check 1 — daily hours
  Object.entries(byPersonDay).forEach(([nessid, days]) => {
    const isEU = isEuDev(nessid);
    const contractor = isContractor(nessid);
    const name = tsData.find(r => r.nessid === nessid)?.name || nessid;

    Object.entries(days).forEach(([dateKey, rows]) => {
      const date = new Date(dateKey);
      const dow = date.getDay();

      // Weekend check — any non-On-Call hours on weekend = issue
      if (dow === 0 || dow === 6) {
        const nonOncallRows = rows.filter(r => !(r.activity === ONCALL_ACT && r.classification === 'On-Call'));
        if (nonOncallRows.length > 0) {
          const totalH = nonOncallRows.reduce((s,r) => s+r.hours, 0);
          const dayStatus = rows.map(r=>r.status).sort().pop();
          tsIssues.push({nessid, name, date, type: 'hours', subtype: 'weekend_work', status: dayStatus,
            details: `Weekend: ${totalH}h logged on ${dow===0?'Sunday':'Saturday'} (${nonOncallRows.map(r=>r.activity+' '+r.hours+'h').join(', ')})`});
        }
        return; // skip normal checks for weekends
      }

      // Contractor — any hours OK, just log as info
      if (contractor) {
        const billable = rows.filter(r => r.activity === '1004').reduce((s,r) => s+r.hours, 0);
        const total = rows.reduce((s,r) => s+r.hours, 0);
        if (billable > 0 && billable !== (isEU === false ? 8 : 8)) {
          const cStatus = rows.map(r=>r.status).sort().pop();
          tsIssues.push({nessid, name, date, type: 'info', subtype: 'contractor', status: cStatus,
            details: `Contractor: ${billable}h billable, ${total}h total`});
        }
        return;
      }

      // ── Public holiday rules ────────────────────────────────────────────
      const dayDateStr = localDateStr(date);
      const devObj2 = developers.find(d => d.nessid === nessid);
      const devLocId = devObj2?.location_id;
      const isHoliday = isPublicHoliday(nessid, dayDateStr);

      if (isHoliday) {
        const oncallRows = rows.filter(r => r.activity === ONCALL_ACT && r.classification === 'On-Call');
        const otherRows = rows.filter(r => !(r.activity === ONCALL_ACT && r.classification === 'On-Call'));
        const oncallH = oncallRows.reduce((s,r) => s+r.hours, 0);
        const dayStatus = rows.map(r=>r.status).sort().pop();

        if (otherRows.length > 0) {
          // Rule 3: non-oncall hours on public holiday → investigation
          tsIssues.push({nessid, name, date, type: 'hours', subtype: 'holiday_work', status: dayStatus,
            details: (() => {
              const ph = publicHolidays.find(h => {
                const loc = locations.find(l => l.id === devLocId);
                return h.date === dayDateStr && h.location_id === loc?.id;
              });
              const phName = ph?.name || 'Public holiday';
              return `${phName}: regular billable work logged (${otherRows.map(r=>r.activity+' '+r.hours+'h').join(', ')})`;
            })()});
        }
        if (oncallH > 0 && oncallH !== 24) {
          // Rule 2: oncall on holiday must be 24h
          tsIssues.push({nessid, name, date, type: 'hours', subtype: 'oncall_issue', status: dayStatus,
            details: `Public holiday On-Call should be 24h, got ${oncallH}h`});
        }
        // Rule 1 & 2 OK cases: no entry or 24h oncall → no issue, skip normal checks
        return;
      }

      // India: no On-Call expected
      if (isEU === false) {
        const hasOncall = rows.some(r => r.classification === 'On-Call' || r.activity === ONCALL_ACT);
        if (hasOncall) {
          const ocStatus = rows.map(r=>r.status).sort().pop();
          tsIssues.push({nessid, name, date, type: 'hours', subtype: 'oncall_issue', status: ocStatus, details: `India developer has On-Call entry — not expected`});
          return;
        }
        const total = rows.reduce((s, r) => s + r.hours, 0);
        const billable = rows.filter(r => r.activity === '1004').reduce((s,r) => s+r.hours, 0);
        const nonBill = rows.filter(r => r.activity !== '1004').reduce((s,r) => s+r.hours, 0);
        const indDayStatus = rows.map(r=>r.status).sort().pop();
        if (total !== 9 && total !== 8) {
          tsIssues.push({nessid, name, date, type: 'hours', subtype: 'wrong_hours', status: indDayStatus,
            details: `Expected 9h (or 8h leave), got ${total}h (billable: ${billable}h, non-bill: ${nonBill}h)`});
        } else if (total === 8 && billable > 0) {
          tsIssues.push({nessid, name, date, type: 'hours', subtype: 'leave_day', status: indDayStatus,
            details: `8h day but has ${billable}h billable — leave day should be non-billable only`});
        }
        return;
      }

      // EU developer
      const oncallHours = rows.filter(r => r.activity === ONCALL_ACT && r.classification === 'On-Call')
        .reduce((s,r) => s+r.hours, 0);
      const regularHours = rows.filter(r => !(r.activity === ONCALL_ACT && r.classification === 'On-Call'))
        .reduce((s,r) => s+r.hours, 0);

      const euDayStatus = rows.map(r=>r.status).sort().pop();
      if (regularHours !== EU_EXPECTED_HOURS && regularHours !== 0) {
        tsIssues.push({nessid, name, date, type: 'hours', subtype: 'wrong_hours', status: euDayStatus,
          details: `Expected ${EU_EXPECTED_HOURS}h regular, got ${regularHours}h${oncallHours > 0 ? ` + ${oncallHours}h On-Call` : ''}`});
      }

      if (oncallHours > 0 && oncallHours !== ONCALL_HOURS) {
        tsIssues.push({nessid, name, date, type: 'hours', subtype: 'oncall_issue', status: euDayStatus,
          details: `On-Call should be ${ONCALL_HOURS}h, got ${oncallHours}h`});
      }
    });
  });

  // Check 2 — wrong WBS
  tsData.forEach(r => {
    const wbsCodes = getDevWbsCodes(r.nessid);
    const name = r.name;
    const date = r.date;
    const isNonBillableWbs = r.wbs.endsWith('-NB');
    const isBillableWbs = r.wbs.endsWith('-B') && !r.wbs.endsWith('-NB');
    const isBillableAct = r.activity === '1004' || (r.activity === ONCALL_ACT && r.classification === 'On-Call');
    const isNonBillableAct = !isBillableAct;

    // WBS not assigned
    if (wbsCodes.size > 0 && !wbsCodes.has(r.wbs)) {
      tsIssues.push({nessid: r.nessid, name, date, type: 'wbs', subtype: 'wrong_wbs', status: r.status,
        details: `WBS ${r.wbs} not assigned (activity: ${r.activity} ${r.actDesc})`});
      return;
    }

    // Billable activity on non-billable WBS
    if (isBillableAct && isNonBillableWbs) {
      tsIssues.push({nessid: r.nessid, name, date, type: 'wbs', subtype: 'wbs_mismatch', status: r.status,
        details: `Billable activity ${r.activity} on non-billable WBS ${r.wbs}`});
    }

    // Non-billable activity on billable WBS
    if (isNonBillableAct && isBillableWbs) {
      tsIssues.push({nessid: r.nessid, name, date, type: 'wbs', subtype: 'wbs_mismatch', status: r.status,
        details: `Non-billable activity ${r.activity} (${r.actDesc}) on billable WBS ${r.wbs}`});
    }
  });

  // Check 3 — missing days (developer in SAP but no entry for a working day)
  const year = 2026;
  const daysInMonth = new Date(year, month, 0).getDate();

  Object.entries(byPersonDay).forEach(([nessid, days]) => {
    const dev = developers.find(d => d.nessid === nessid);
    if (!dev) return;

    // Skip developers with no active assignment in this month
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    const hasActiveAssignment = (dev.assignments||[]).some(a => {
      if (a.team === 'Selfhosting') return false; // fixed price — skip
      const start = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
      const end = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
      return start <= monthEnd && end >= monthStart;
    });
    if (!hasActiveAssignment) return;

    const name = tsData.find(r => r.nessid === nessid)?.name || nessid;
    const contractor = isContractor(nessid);

    // Check each working day in the month
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends

      const dateKey = localDateStr(date);
      if (!days[dateKey]) {
        // Rule 1: public holiday + no entry = not an issue
        if (isPublicHoliday(nessid, dateKey)) continue;
        tsIssues.push({
          nessid, name, date,
          type: contractor ? 'info' : 'hours',
          subtype: contractor ? 'contractor' : 'missing_day',
          status: '10',
          details: `No timesheet entry for ${dateKey}${contractor ? ' (contractor — informational)' : ' (missing day)'}`
        });
      }
    }
  });

  // Check 4 — total billable hours exceed location max for the month
  const MONTHS_KEY = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const monthKey = MONTHS_KEY[month - 1];

  // Get all unique nessids from SAP data
  const allNessids4 = [...new Set(monthData.map(r => r.nessid))];
  allNessids4.forEach(nessid => {
    const dev = developers.find(d => d.nessid === nessid);
    if (!dev) return;

    // Get location max hours
    const loc = locations.find(l => l.id === dev.location_id);
    if (!loc) return;
    const maxHours = loc[monthKey] || 0;
    if (!maxHours) return;

    // Sum all billable hours (activity 1004) — exclude fixed-price WBS rows
    const billableRows = monthData.filter(r => r.nessid === nessid && r.activity === '1004' && !isFixedPriceRow(nessid, r.wbs));
    const totalBillable = billableRows.reduce((s, r) => s + r.hours, 0);

    if (totalBillable > maxHours) {
      const name = monthData.find(r => r.nessid === nessid)?.name || nessid;
      // Use last date of month as issue date (summary issue)
      const issueDate = new Date(year, month - 1, new Date(year, month, 0).getDate());
      tsIssues.push({
        nessid, name, date: issueDate,
        type: 'hours', subtype: 'over_hours',
        status: '10',
        details: `Total billable ${totalBillable}h exceeds location max ${maxHours}h for ${loc.name} (over by ${(totalBillable - maxHours).toFixed(1)}h)`
      });
    }
  });

  // Update stats
  const hoursIssues = tsIssues.filter(i => i.type === 'hours').length;
  const wbsIssues = tsIssues.filter(i => i.type === 'wbs').length;
  const infoIssues = tsIssues.filter(i => i.type === 'info').length;
  const allNessids = new Set(tsData.map(r => r.nessid));
  const issueNessids = new Set(tsIssues.filter(i => i.type !== 'info').map(i => i.nessid));
  const okCount = [...allNessids].filter(n => !issueNessids.has(n)).length;

  document.getElementById('ts-count-hours').textContent = hoursIssues;
  document.getElementById('ts-count-wbs').textContent = wbsIssues;
  document.getElementById('ts-count-ok').textContent = okCount;
}

// Set of issue keys acknowledged by user (persists during session)
// ts_acknowledged: { key: { id, note } }
// ts_seen: { key: true } — all issues ever detected for this month
let tsAcknowledged = {};
let tsSeen = {};
let tsMonth_ack = null;
function localDateStr(date) {
  return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
}


function tsIssueKey(i) {
  return `${i.nessid}_${localDateStr(i.date)}_${i.type}`;
}

function tsIssueKeyRaw(nessid, dateStr, type) {
  return `${nessid}_${dateStr}_${type}`;
}

async function loadTsTracking(month, year) {
  tsMonth_ack = month;

  // Load acknowledged
  const { data: ackData, error: ackErr } = await db
    .from('ts_acknowledged').select('*').eq('year', year).eq('month', month);
  if (ackErr) console.error('loadTsAcknowledged:', ackErr);
  tsAcknowledged = {};
  (ackData || []).forEach(r => {
    const dateStr = String(r.issue_date).substring(0, 10);
    const key = tsIssueKeyRaw(r.nessid, dateStr, r.issue_type);
    tsAcknowledged[key] = { id: r.id, note: r.note || '', nessid: r.nessid, issue_date: dateStr, issue_type: r.issue_type };
  });

  // Load seen
  const { data: seenData, error: seenErr } = await db
    .from('ts_seen').select('nessid, issue_date, issue_type').eq('year', year).eq('month', month);
  if (seenErr) console.error('loadTsSeen:', seenErr);
  tsSeen = {};
  (seenData || []).forEach(r => {
    const dateStr = String(r.issue_date).substring(0, 10);
    const key = tsIssueKeyRaw(r.nessid, dateStr, r.issue_type);
    tsSeen[key] = true;
  });
}

async function saveNewToSeen(newIssues, month, year) {
  if (!newIssues.length) return;
  const rows = newIssues.map(i => ({
    year, month,
    nessid: i.nessid,
    issue_date: localDateStr(i.date),
    issue_type: i.type
  }));
  const { error } = await db.from('ts_seen')
    .upsert(rows, { onConflict: 'year,month,nessid,issue_date,issue_type', ignoreDuplicates: true });
  if (error) console.error('saveNewToSeen:', error);
  // Update local tsSeen
  newIssues.forEach(i => { tsSeen[tsIssueKey(i)] = true; });
}

async function reconcileTsAcknowledged() {
  if (!Object.keys(tsAcknowledged).length) return;
  const currentKeys = new Set(tsIssues.map(i => tsIssueKey(i)));
  const potentiallySolved = Object.entries(tsAcknowledged)
    .filter(([key]) => !currentKeys.has(key))
    .map(([key, val]) => ({ key, ...val }));
  if (!potentiallySolved.length) return;

  const msgLines = potentiallySolved.map(i => '• ' + i.nessid + ' — ' + i.issue_date + ' — ' + i.issue_type + (i.note ? ' (' + i.note + ')' : ''));
  const msg = potentiallySolved.length + ' previously acknowledged issue' + (potentiallySolved.length!==1?'s are':' is') + ' no longer in this upload:\n\n' + msgLines.join('\n') + '\n\nDelete these? (They appear to be solved)';
  if (confirm(msg)) {
    for (const item of potentiallySolved) {
      if (item.id) await db.from('ts_acknowledged').delete().eq('id', item.id);
      delete tsAcknowledged[item.key];
    }
    showToast(`Removed ${potentiallySolved.length} solved issue${potentiallySolved.length!==1?'s':''}`);
  }
}

async function clearAllTsAcknowledged() {
  const month = window.tsMonth;
  if (!month) return;
  if (!confirm('Remove all acknowledged issues AND seen history for this month? This cannot be undone.')) return;
  await Promise.all([
    db.from('ts_acknowledged').delete().eq('year', 2026).eq('month', month),
    db.from('ts_seen').delete().eq('year', 2026).eq('month', month)
  ]);
  tsAcknowledged = {};
  tsSeen = {};
  renderTsCheck();
  showToast('All cleared — fresh start');
}

async function toggleAllTsHidden(checked) {
  const visibleIssues = window._tsVisibleIssues || [];
  for (const i of visibleIssues) {
    const key = tsIssueKey(i);
    if (checked && !tsAcknowledged[key]) await saveTsAcknowledged(i, '');
    else if (!checked && tsAcknowledged[key]) await deleteTsAcknowledged(key);
  }
  renderTsCheck();
}

async function saveTsAcknowledged(issue, note) {
  const key = tsIssueKey(issue);
  if (tsAcknowledged[key]) {
    const { error } = await db.from('ts_acknowledged').update({ note }).eq('id', tsAcknowledged[key].id);
    if (!error) tsAcknowledged[key].note = note;
    return;
  }
  const dateStr = localDateStr(issue.date);
  const { data, error } = await db.from('ts_acknowledged').insert({
    year: 2026, month: window.tsMonth,
    nessid: issue.nessid, issue_date: dateStr,
    issue_type: issue.type, note
  }).select().single();
  if (error) { console.error('saveTsAcknowledged:', error); return; }
  tsAcknowledged[key] = { id: data.id, note: data.note||'', nessid: issue.nessid, issue_date: dateStr, issue_type: issue.type };
}

async function deleteTsAcknowledged(key) {
  const rec = tsAcknowledged[key];
  if (!rec?.id) { delete tsAcknowledged[key]; return; }
  const { error } = await db.from('ts_acknowledged').delete().eq('id', rec.id);
  if (!error) delete tsAcknowledged[key];
}

async function toggleTsHidden(key, checked, issueIdx) {
  const issue = (window._tsVisibleIssues||[])[issueIdx];
  if (!issue) return;
  if (checked) await saveTsAcknowledged(issue, '');
  else await deleteTsAcknowledged(key);
  const hiddenCount = document.getElementById('ts-count-hidden');
  if (hiddenCount) hiddenCount.textContent = Object.keys(tsAcknowledged).length;
  const hiddenFilter = document.getElementById('ts-filter-hidden')?.value || 'visible';
  if (hiddenFilter === 'visible') renderTsCheck();
}

async function openTsNoteModal(key, issueIdx) {
  const rec = tsAcknowledged[key];
  const issue = (window._tsVisibleIssues||[])[issueIdx];
  const current = rec?.note || '';
  const note = prompt('Note for this issue (optional):', current);
  if (note === null) return;
  if (rec) {
    const { error } = await db.from('ts_acknowledged').update({ note }).eq('id', rec.id);
    if (!error) { tsAcknowledged[key].note = note; renderTsCheck(); }
  } else if (issue) {
    await saveTsAcknowledged(issue, note);
    renderTsCheck();
  }
}

function renderTsOverview() {
  const head = document.getElementById('ts-overview-head');
  const body = document.getElementById('ts-overview-body');
  if (!head || !body) return;

  if (!tsData || !window.tsMonth) {
    body.innerHTML = '<tr><td class="loading">Upload SAP export first</td></tr>';
    return;
  }

  const month = window.tsMonth;
  const year = 2026;
  const daysInMonth = new Date(year, month, 0).getDate();
  const DAY_ABBR = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  // Build list of all days
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dow = date.getDay();
    // Use local date to avoid UTC timezone shift
    const mm = String(month).padStart(2,'0');
    const dd = String(d).padStart(2,'0');
    const dateStr = `${year}-${mm}-${dd}`;
    days.push({ d, date, dow, dateStr, isWeekend: dow === 0 || dow === 6 });
  }

  // Build issue lookup: nessid -> dateStr -> {hasIssue, allAcked}
  const issueMap = {};
  tsIssues.forEach(i => {
    const _id = i.date; const ds = `${_id.getFullYear()}-${String(_id.getMonth()+1).padStart(2,'0')}-${String(_id.getDate()).padStart(2,'0')}`;
    if (!issueMap[i.nessid]) issueMap[i.nessid] = {};
    if (!issueMap[i.nessid][ds]) issueMap[i.nessid][ds] = { hasIssue: false, allAcked: true };
    issueMap[i.nessid][ds].hasIssue = true;
    if (!tsAcknowledged[tsIssueKey(i)]) issueMap[i.nessid][ds].allAcked = false;
  });

  // Build SAP data lookup: nessid -> dateStr -> {billable, total}
  const sapMap = {};
  tsData.forEach(r => {
    const _d = r.date; const ds = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
    if (!sapMap[r.nessid]) sapMap[r.nessid] = {};
    if (!sapMap[r.nessid][ds]) sapMap[r.nessid][ds] = { billable: 0, total: 0 };
    sapMap[r.nessid][ds].total += r.hours;
    if (r.activity === '1004' && !isFixedPriceRow(r.nessid, r.wbs)) sapMap[r.nessid][ds].billable += r.hours;
  });

  // Get ordered developers (same as bulk update — active, non-selfhosting)
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  let devs = developers.filter(d => {
    if (d.status !== 'active') return false;
    return (d.assignments||[]).some(a => {
      if (a.team === 'Selfhosting') return false;
      const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
      const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
      return s <= monthEnd && e >= monthStart;
    });
  });

  // Order by team then name (using teamOrder)
  const orderedTeams = [...(teamOrder.europe.length ? teamOrder.europe : EU_TEAMS),
                        ...(teamOrder.india.length ? teamOrder.india : IND_TEAMS)]
                        .filter(t => t !== 'Selfhosting');
  devs = sortDevsByOrder(devs);

  // ── Header ────────────────────────────────────────────────────────────
  const C = 'border:1px solid #e5e7eb;';
  const dayHeaders = days.map(day => {
    const bg = day.isWeekend ? 'background:#f0f0f0;' : '';
    return `<th style="${C}${bg}padding:4px 3px;text-align:center;min-width:38px;max-width:38px">
      <div style="font-size:10px;color:#999">${DAY_ABBR[day.dow]}</div>
      <div style="font-size:11px;font-weight:600">${day.d}</div>
    </th>`;
  }).join('');

  head.innerHTML = `<tr>
    <th style="${C}padding:6px 12px;text-align:left;min-width:180px;width:180px;position:sticky;left:0;top:0;background:var(--bg);z-index:4">Developer</th>
    ${dayHeaders}
  </tr>`;

  // ── Rows ──────────────────────────────────────────────────────────────
  let currentTeam = null;
  const rowsHtml = devs.map(dev => {
    const nessid = dev.nessid;
    const team = getDevCurrentTeam(dev) || '';
    const contractor = isContractor(nessid);

    // Team separator row
    let teamRow = '';
    if (team !== currentTeam) {
      currentTeam = team;
      teamRow = `<tr style="background:#f0f4ff">
        <td colspan="${days.length + 2}" style="${C}font-weight:600;font-size:11px;color:var(--blue);padding:5px 10px;text-transform:uppercase;letter-spacing:0.05em">${team}</td>
      </tr>`;
    }

    const cells = days.map(day => {
      const ds = day.dateStr;
      const sap = sapMap[nessid]?.[ds];
      const issues = issueMap[nessid]?.[ds];

      let bg, text, title = '';

      if (day.isWeekend) {
        bg = '#f5f5f5'; text = '';
      } else if (!sap) {
        // No SAP entry for this working day
        if (contractor) {
          bg = '#f5f5f5'; text = ''; // OK for contractors
        } else {
          // Check if dev was active this day
          const dayDate = day.date;
          const hasAssign = (dev.assignments||[]).some(a => {
            if (a.team === 'Selfhosting') return false;
            const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
            const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
            return s <= dayDate && e >= dayDate;
          });
          if (!hasAssign) { bg = '#f5f5f5'; text = ''; }
          else if (issues?.hasIssue && !issues.allAcked) { bg = '#ffebee'; text = '—'; title = 'Missing entry'; }
          else if (issues?.hasIssue && issues.allAcked) { bg = '#fff8e1'; text = '—'; }
          else { bg = '#ffebee'; text = '—'; title = 'Missing entry'; } // FTE missing = red
        }
      } else {
        const fmtH = v => v % 1 === 0 ? String(v) : v.toFixed(1);
        const b = fmtH(sap.billable);
        const t = fmtH(sap.total);
        text = b === t ? b : `${b}/${t}`;
        if (issues?.hasIssue && !issues.allAcked) { bg = '#ffebee'; title = 'Has unacknowledged issues'; }
        else if (issues?.hasIssue && issues.allAcked) { bg = '#fff8e1'; title = 'Issues acknowledged'; }
        else { bg = '#e8f5e9'; }
      }

      const clickHandler = sap || (issues?.hasIssue) ? `onclick="showTsCell(event,'${nessid}','${ds}')"` : '';
      const cursor = sap || (issues?.hasIssue) ? 'cursor:pointer;' : '';
      return `<td ${clickHandler} style="${C}background:${bg};${cursor}text-align:center;padding:3px 2px;font-size:11px;font-weight:500" title="${title}">${text}</td>`;
    }).join('');

    return teamRow + `<tr>
      <td style="${C}padding:5px 12px;font-size:12px;font-weight:500;position:sticky;left:0;background:var(--surface);z-index:1;white-space:nowrap;min-width:180px;width:180px">${dev.firstname} ${dev.lastname}</td>
      ${cells}
    </tr>`;
  }).join('');

  body.innerHTML = rowsHtml ||
    '<tr><td colspan="33" class="empty">No active developers found</td></tr>';
}

function populateTsDevSelect() {
  const sel = document.getElementById('ts-dev-select');
  if (!sel || !tsData) return;

  // Get unique developers from SAP data, sorted by name
  const devMap = {};
  tsData.forEach(r => { devMap[r.nessid] = r.name; });
  const sorted = Object.entries(devMap).sort(([,a],[,b]) => a.localeCompare(b));

  sel.innerHTML = '<option value="">— select developer —</option>';
  sorted.forEach(([nessid, name]) => {
    const issueCount = tsIssues.filter(i => i.nessid === nessid).length;
    const unacked = tsIssues.filter(i => i.nessid === nessid && !tsAcknowledged[tsIssueKey(i)]).length;
    const label = unacked > 0
      ? `⚠️ ${name} (${unacked} issue${unacked!==1?'s':''})`
      : issueCount > 0
        ? `✓ ${name}`
        : `${name}`;
    const opt = document.createElement('option');
    opt.value = nessid;
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function onTsDevSelect(nessid) {
  if (!nessid) return;
  showTsSidebar(nessid);
  // Reset select after opening
  setTimeout(() => {
    const sel = document.getElementById('ts-dev-select');
    if (sel) sel.value = '';
  }, 100);
}


function showTsCell(event, nessid, dateStr) {
  event.stopPropagation();
  document.getElementById('ts-cell-popup')?.remove();

  const rows = tsData.filter(r => r.nessid === nessid && localDateStr(r.date) === dateStr);
  const dayIssues = tsIssues.filter(i => i.nessid === nessid && localDateStr(i.date) === dateStr);

  const dev = developers.find(d => d.nessid === nessid);
  const name = rows[0]?.name || (dev ? dev.firstname + ' ' + dev.lastname : nessid);

  const DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const date = new Date(dateStr);
  const title = `${name} — ${DAY_FULL[date.getDay()]} ${dateStr}`;

  let rowsHtml = '';
  if (!rows.length) {
    rowsHtml = '<div style="color:var(--text-3);font-size:12px;padding:4px 0">No SAP entries for this day</div>';
  } else {
    rowsHtml = rows.map(r => {
      const isBillable = r.activity === '1004';
      return `<div style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;background:${isBillable?'#f0fff4':'#fafafa'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-family:monospace;font-size:11px;background:var(--bg);padding:2px 6px;border-radius:4px">${r.wbs}</span>
          <span style="font-weight:600;font-size:13px">${r.hours}h</span>
        </div>
        <div style="font-size:11px;color:var(--text-2)">${r.activity} — ${r.actDesc}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">${r.classification} · Status ${r.status}</div>
      </div>`;
    }).join('');
  }

  let issuesHtml = '';
  if (dayIssues.length) {
    issuesHtml = '<div style="border-top:1px solid var(--border);margin-top:8px;padding-top:8px">';
    issuesHtml += '<div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">Issues:</div>';
    dayIssues.forEach(i => {
      const key = tsIssueKey(i);
      const acked = !!tsAcknowledged[key];
      const note = tsAcknowledged[key]?.note;
      issuesHtml += `<div style="font-size:11px;padding:4px 8px;border-radius:4px;margin-bottom:4px;background:${acked?'#f8f8f8':'#fff0f0'};color:${acked?'var(--text-3)':'var(--red)'}">
        ${acked?'✓':'⚠'} ${i.details}${note?` <span style="font-style:italic">(${note})</span>`:''}
      </div>`;
    });
    issuesHtml += '</div>';
  }

  const popup = document.createElement('div');
  popup.id = 'ts-cell-popup';
  const rect = event.target.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - 320);
  const top = rect.bottom + 4;
  popup.style.cssText = `position:fixed;top:${top}px;left:${left}px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px;z-index:600;box-shadow:0 4px 20px rgba(0,0,0,0.15);min-width:280px;max-width:320px`;
  popup.innerHTML = `
    <div style="font-weight:600;font-size:13px;margin-bottom:8px">${title}</div>
    ${rowsHtml}${issuesHtml}`;
  document.body.appendChild(popup);

  setTimeout(() => document.addEventListener('click', closeTsCellPopup), 50);
}

function closeTsCellPopup() {
  document.getElementById('ts-cell-popup')?.remove();
  document.removeEventListener('click', closeTsCellPopup);
}


function renderTsCheck() {
  if (!tsData) return;
  const checkFilter = document.getElementById('ts-filter-check').value;
  const statusFilter = document.getElementById('ts-filter-status').value;
  const hiddenFilter = document.getElementById('ts-filter-hidden')?.value || 'visible';

  let filtered = tsIssues;
  if (checkFilter !== 'all') {
    const subtypeMap = {
      'missing_day': s => s.subtype === 'missing_day',
      'wrong_hours': s => s.subtype === 'wrong_hours',
      'oncall_issue': s => s.subtype === 'oncall_issue',
      'leave_day': s => s.subtype === 'leave_day',
      'wrong_wbs': s => s.subtype === 'wrong_wbs',
      'wbs_mismatch': s => s.subtype === 'wbs_mismatch',
      'contractor': s => s.subtype === 'contractor',
      'holiday_work': s => s.subtype === 'holiday_work',
      'weekend_work': s => s.subtype === 'weekend_work',
      'over_hours': s => s.subtype === 'over_hours',
    };
    filtered = subtypeMap[checkFilter] ? filtered.filter(subtypeMap[checkFilter]) : filtered.filter(i => i.type === checkFilter);
  }
  if (statusFilter !== 'all') filtered = filtered.filter(i => i.status === statusFilter);
  // Apply hide/OK filter
  if (hiddenFilter === 'visible') filtered = filtered.filter(i => !tsAcknowledged[tsIssueKey(i)]);
  if (hiddenFilter === 'hidden') filtered = filtered.filter(i => !!tsAcknowledged[tsIssueKey(i)]);
  if (hiddenFilter === 'new') filtered = filtered.filter(i => i._isNew);

  // Sort by name then date
  filtered.sort((a, b) => a.name.localeCompare(b.name) || a.date - b.date);

  // Update acknowledged counter
  const hiddenCount = document.getElementById('ts-count-hidden');
  if (hiddenCount) hiddenCount.textContent = Object.keys(tsAcknowledged).length;

  // Store visible issues for select-all
  window._tsVisibleIssues = filtered;

  const body = document.getElementById('ts-check-body');
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty" style="color:var(--green)">✓ No issues found for selected filter</td></tr>';
    return;
  }

  const typeColors = {hours: '#fff0f0', wbs: '#fff8e1', info: '#f1f8e9'};
  const typeBadge = {
    hours: '<span style="background:#fff0f0;color:#c62828;padding:2px 8px;border-radius:99px;font-size:11px">Daily hours</span>',
    wbs: '<span style="background:#fff8e1;color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">Wrong WBS</span>',
    info: '<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px">Info</span>'
  };
  const statusBadge = s => {
    if (s === '10') return '<span style="background:var(--bg);color:var(--text-3);padding:2px 8px;border-radius:99px;font-size:11px">10 — Not released</span>';
    if (s === '20') return '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">20 — Released</span>';
    if (s === '30') return '<span style="background:#fff0f0;color:#c62828;padding:2px 8px;border-radius:99px;font-size:11px">30 — Approved</span>';
    return `<span style="color:var(--text-3);font-size:11px">${s||'—'}</span>`;
  };

  // Update header to include Status column
  const thead = document.querySelector('#ts-check-view thead tr');
  if (thead && thead.children.length < 6) {
    thead.innerHTML = `
      <th style="text-align:left;min-width:160px">Developer</th>
      <th style="text-align:left;width:80px">Date</th>
      <th style="text-align:left;width:60px">Day</th>
      <th style="text-align:left;width:120px">Status</th>
      <th style="text-align:left;width:100px">Issue type</th>
      <th style="text-align:left">Details</th>`;
  }

  let lastNessid = null;
  body.innerHTML = filtered.map(i => {
    const showName = i.nessid !== lastNessid;
    lastNessid = i.nessid;
    const dateStr = localDateStr(i.date);
    const dow = DAY_NAMES[i.date.getDay()];
    const key = tsIssueKey(i);
    const ackRec = tsAcknowledged[key];
    const isAcked = !!ackRec;
    const isNew = !isAcked && i._isNew;
    const rowBg = isAcked
      ? 'background:#f8f8f8;opacity:0.6'
      : isNew
        ? 'background:#fff8e1'
        : `background:${typeColors[i.type]||'white'}`;
    const rowIdx = (window._tsVisibleIssues||[]).indexOf(i);
    const newBadge = isNew ? '<span style="background:#FF6F00;color:#fff;padding:1px 7px;border-radius:99px;font-size:10px;font-weight:700;margin-left:6px">NEW</span>' : '';
    const noteBadge = ackRec?.note ? `<span style="font-size:11px;color:var(--text-2);margin-left:6px;font-style:italic" title="${ackRec.note}">📝 ${ackRec.note}</span>` : '';
    return `<tr style="${rowBg}">
      <td style="text-align:center;padding:6px 8px">
        <input type="checkbox" ${isAcked?'checked':''} title="Acknowledge"
          onchange="toggleTsHidden('${key}', this.checked, ${rowIdx})">
      </td>
      <td class="ts-name-cell" data-nessid="${i.nessid}" style="font-weight:${showName?'500':'400'};color:${showName?'var(--blue)':'#bbb'};cursor:${showName?'pointer':'default'}" onclick="${showName?`showTsSidebar('${i.nessid}')`:''}">
        ${showName ? i.name : ''}${newBadge}
      </td>
      <td style="font-size:13px">${dateStr}</td>
      <td style="font-size:13px;color:var(--text-2)">${dow}</td>
      <td>${statusBadge(i.status)}</td>
      <td>${typeBadge[i.type]||i.type}</td>
      <td style="font-size:13px">${i.details}${noteBadge}
        ${isAcked ? `<button onclick="openTsNoteModal('${key}',${rowIdx})" style="margin-left:8px;border:none;background:none;cursor:pointer;font-size:11px;color:var(--text-3)" title="Edit note">✏️</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function renderTsImport() {
  if (!tsData) return;
  const month = window.tsMonth;
  const body = document.getElementById('ts-import-body');

  if (!month) {
    body.innerHTML = '<tr><td colspan="3" class="empty">No month available</td></tr>';
    return;
  }

  // Sum billable hours (1004 only) per developer for selected month, status=30 only
  const billableByDev = {};
  tsData.forEach(r => {
    if (r.date.getMonth() + 1 !== month) return;
    if (r.status !== '30') return; // approved only
    if (r.activity !== '1004') return; // billable only
    if (isFixedPriceRow(r.nessid, r.wbs)) return; // exclude Selfhosting WBS
    if (!billableByDev[r.nessid]) billableByDev[r.nessid] = {name: r.name, hours: 0};
    billableByDev[r.nessid].hours += r.hours;
  });

  if (!Object.keys(billableByDev).length) {
    body.innerHTML = '<tr><td colspan="3" class="empty">No approved billable hours found for this month</td></tr>';
    return;
  }

  body.innerHTML = `<tr style="background:var(--bg)">
    <td style="padding:6px 10px">
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:500;color:var(--text-2)">Select:</span>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="ts-sel-all" onchange="applyTsImportSelection()"> All
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="ts-sel-clean" onchange="applyTsImportSelection()"> No issues
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="ts-sel-acked" onchange="applyTsImportSelection()"> Acked
        </label>
      </div>
    </td>
    <td style="text-align:right;font-size:12px;color:var(--text-3);padding:6px 10px">Billable hours</td>
    <td style="font-size:12px;color:var(--text-3);padding:6px 10px">Status in DB</td>
  </tr>` +
  Object.entries(billableByDev)
    .sort(([,a],[,b]) => a.name.localeCompare(b.name))
    .map(([nessid, {name, hours}]) => {
      const dev = developers.find(d => d.nessid === nessid);
      const existing = dev ? actualHours[String(dev.id)]?.[month] : null;
      const isSame = existing && parseFloat(existing.hours) === hours;
      const sourceLabel = src => src === 'tmsh' ? 'Actuals' : src === 'manual' ? 'Manual' : src === 'utilization' ? 'Forecast' : 'Unknown';
      let status;
      if (!dev) {
        status = '<span style="color:var(--text-3);font-size:12px">Not found in DB</span>';
      } else if (!existing) {
        status = '<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px">No data → Actuals</span>';
      } else if (isSame && existing.source === 'tmsh') {
        status = `<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px">Actuals (no change, ${existing.hours}h)</span>`;
      } else if (isSame) {
        status = `<span style="background:var(--bg);color:var(--text-3);padding:2px 8px;border-radius:99px;font-size:11px">${sourceLabel(existing.source)} → Actuals (${existing.hours}h, no change)</span>`;
      } else {
        status = `<span style="background:var(--amber-lt);color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">${sourceLabel(existing.source)} → Actuals (${existing.hours}h → ${hours}h)</span>`;
      }
      const disabled = !dev ? 'disabled' : '';

      // Check for unacknowledged issues
      const devIssues = tsIssues.filter(i => i.nessid === nessid);
      const unackedIssues = devIssues.filter(i => !tsAcknowledged[tsIssueKey(i)]);
      const hasUnacked = unackedIssues.length > 0;
      const issueTypes = [...new Set(unackedIssues.map(i => i.type))];
      const issueBadge = hasUnacked
        ? `<span style="background:var(--red-lt);color:var(--red);padding:2px 8px;border-radius:99px;font-size:11px;margin-left:6px" title="${unackedIssues.length} unacknowledged issue${unackedIssues.length!==1?'s':''}">
            ⚠️ ${unackedIssues.length} issue${unackedIssues.length!==1?'s':''}
          </span>`
        : devIssues.length > 0
          ? `<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px;margin-left:6px">✓ All acked</span>`
          : '';

      const rowBg = hasUnacked ? 'background:#fff8f8' : '';

      return `<tr style="${rowBg}">
        <td style="padding:6px 10px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" class="ts-import-cb" data-nessid="${nessid}" ${disabled}>
            <span class="ts-name-cell" data-nessid="${nessid}" style="font-weight:500;color:${dev?'var(--blue)':'#999'};cursor:${dev?'pointer':'default'}" onclick="${dev?`showTsSidebar('${nessid}')`:''}">
              ${name}
            </span>
            ${issueBadge}
          </label>
        </td>
        <td style="text-align:right;font-weight:600;padding:6px 10px;border-left:1px dashed #ddd;border-right:1px dashed #ddd">${hours}h</td>
        <td style="padding:6px 10px">${status}</td>
      </tr>`;
    }).join('');
}

function toggleAllTsImport(checked) {
  document.querySelectorAll('.ts-import-cb:not(:disabled)').forEach(cb => cb.checked = checked);
}

function applyTsImportSelection() {
  const selAll   = document.getElementById('ts-sel-all')?.checked;
  const selClean = document.getElementById('ts-sel-clean')?.checked;
  const selAcked = document.getElementById('ts-sel-acked')?.checked;

  document.querySelectorAll('.ts-import-cb:not(:disabled)').forEach(cb => {
    const nessid = cb.dataset.nessid;
    const devIssues = tsIssues.filter(i => i.nessid === nessid);
    const unacked = devIssues.filter(i => !tsAcknowledged[tsIssueKey(i)]);
    const allAcked = devIssues.length > 0 && unacked.length === 0;
    const noIssues = devIssues.length === 0;

    if (selAll) { cb.checked = true; return; }
    cb.checked = (selClean && noIssues) || (selAcked && allAcked);
  });
}

async function runTsImport() {
  const month = window.tsMonth;
  if (!month) { showToast('No month detected'); return; }

  // Get selected nessids
  const selected = new Set();
  document.querySelectorAll('.ts-import-cb:checked').forEach(cb => selected.add(cb.dataset.nessid));
  if (selected.size === 0) { showToast('Select at least one developer to import'); return; }

  const btn = document.getElementById('ts-import-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }

  // Collect billable hours — exclude fixed-price (Selfhosting) WBS rows
  const billableByDev = {};
  tsData.forEach(r => {
    if (r.date.getMonth() + 1 !== month) return;
    if (r.status !== '30') return;
    if (r.activity !== '1004') return;
    if (isFixedPriceRow(r.nessid, r.wbs)) return; // exclude Selfhosting WBS
    if (!billableByDev[r.nessid]) billableByDev[r.nessid] = {name: r.name, hours: 0};
    billableByDev[r.nessid].hours += r.hours;
  });

  let imported = 0, skipped = 0;
  for (const [nessid, {hours}] of Object.entries(billableByDev)) {
    if (!selected.has(nessid)) { skipped++; continue; }
    const dev = developers.find(d => d.nessid === nessid);
    if (!dev) { skipped++; continue; }
    await upsertActualHours(dev.id, month, hours, 'tmsh');
    imported++;
  }

  showToast(`Imported ${imported} developers for ${MTH_NAMES[month-1]}${skipped ? ` (${skipped} skipped — not in DB)` : ''}`);

  // Show done state
  const btnEl = document.getElementById('ts-import-btn');
  const doneEl = document.getElementById('ts-import-done');
  if (btnEl) { btnEl.style.display = 'none'; }
  if (doneEl) { doneEl.style.display = ''; doneEl.textContent = `✓ Imported ${imported} developers for ${MONTH_NAMES_FULL[month-1]}${skipped ? ` (${skipped} skipped)` : ''}`; }

  renderTsImport();
  renderRevOverview();
}

function openTsChecksInfo() {
  document.getElementById('ts-checks-info-modal').classList.add('open');
}
