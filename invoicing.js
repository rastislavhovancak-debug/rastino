// ============================================================
// INVOICING MODULE
// ============================================================

let invMonth = null;       // selected month number 1-12

function selectInvMonth(val) {
  const monthNum = parseInt(val);
  if (!monthNum) {
    document.getElementById('inv-no-file').style.display = '';
    document.getElementById('inv-content').style.display = 'none';
    return;
  }
  invMonth = monthNum;
  const monthName = MONTH_NAMES_FULL[monthNum - 1];
  const tmshDevs = developers.filter(d => actualHours[String(d.id)]?.[monthNum]?.source === 'tmsh');
  document.getElementById('inv-month-label').textContent = `Invoicing period: ${monthName} 2026`;
  document.getElementById('inv-file-info').textContent = tmshDevs.length
    ? `${tmshDevs.length} developers with TMSH actuals`
    : 'No TMSH actuals found for this month';
  document.getElementById('inv-no-file').style.display = 'none';
  document.getElementById('inv-content').style.display = '';
  switchInvView('preview');
}

// Team config: invoice display name + PO (derived from assignments)
function getTeamInvoiceConfig(team) {
  // Get PO from developer assignments for this team
  const devs = developers.filter(d => (d.assignments||[]).some(a => a.team === team));
  let po = '';
  for (const d of devs) {
    const asgn = (d.assignments||[]).find(a => a.team === team);
    if (asgn?.po) { po = asgn.po; break; }
  }
  // Special: CVS Oncall uses same PO as Connected veh. ser.
  if (team === 'CVS Oncall') {
    const cvsDev = developers.find(d => (d.assignments||[]).some(a => a.team === 'Connected veh. ser.'));
    const cvsAsgn = (cvsDev?.assignments||[]).find(a => a.team === 'Connected veh. ser.');
    po = cvsAsgn?.po || po;
  }
  return { po };
}

function getInvoiceFileName(team, monthName, year) {
  const cfg = getTeamInvoiceConfig(team);
  const teamSlug = team.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  return `HERE_InvData_${monthName}-${year}_${teamSlug}_PO${cfg.po}.xlsx`;
}

function renderInvoicing() {
  // Reset if no month selected
  if (!invMonth) {
    document.getElementById('inv-no-file').style.display = '';
    document.getElementById('inv-content').style.display = 'none';
    document.getElementById('inv-month-select').value = '';
  }
}

function switchInvView(v) {
  document.getElementById('btn-inv-preview').classList.toggle('active', v === 'preview');
  document.getElementById('btn-inv-generate').classList.toggle('active', v === 'generate');
  document.getElementById('inv-preview-view').style.display = v === 'preview' ? '' : 'none';
  document.getElementById('inv-generate-view').style.display = v === 'generate' ? '' : 'none';
  if (v === 'preview') renderInvPreview();
  if (v === 'generate') renderInvGenerate();
}

// Get billable hours per developer from actual_hours (tmsh)
function getSapHoursByNessId() {
  const map = {};
  developers.forEach(d => {
    const entry = actualHours[String(d.id)]?.[invMonth];
    if (entry && entry.hours != null) {
      map[d.nessid] = parseFloat(entry.hours); // include both tmsh and manual
    }
  });
  return map;
}

// Get revenue hours for a developer in a month (from actual_hours)
function getRevenueHours(dev, monthNum) {
  const entry = actualHours[String(dev.id)]?.[monthNum];
  return entry ? parseFloat(entry.hours) : null;
}

function getTmshHours(dev, monthNum) {
  const entry = actualHours[String(dev.id)]?.[monthNum];
  return entry && entry.source === 'tmsh' ? parseFloat(entry.hours) : null;
}

// Get billable teams ordered by invoiceGroups settings
function getInvoiceTeams() {
  // Use invoice groups order if available
  let allTeams;
  if (invoiceGroups && invoiceGroups.length) {
    const ordered = invoiceGroups.flatMap(g => g.teams);
    const remaining = [...EU_TEAMS, ...IND_TEAMS].filter(t => !ordered.includes(t));
    allTeams = [...ordered, ...remaining];
  } else {
    const euOrdered = teamOrder.europe.length ? teamOrder.europe : EU_TEAMS;
    const indOrdered = teamOrder.india.length ? teamOrder.india : IND_TEAMS;
    allTeams = [...euOrdered, ...indOrdered];
  }
  return allTeams.filter(team => {
    if (team === 'CVS Oncall') return false;
    if (team === 'Selfhosting') return true; // fixed price always shown
    // Show team if it has active billable assignments for this month
    const monthStart = new Date(2026, invMonth - 1, 1);
    const monthEnd = new Date(2026, invMonth, 0);
    const devs = developers.filter(d =>
      (d.assignments||[]).some(a => {
        if (a.team !== team) return false;
        if (a.billable === false) return false;
        const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return s <= monthEnd && e >= monthStart;
      })
    );
    if (!devs.length) return false;
    // Show if any developer has actual hours OR forecast revenue for this month
    const monthIdx = invMonth - 1;
    return devs.some(d => {
      const ah = actualHours[String(d.id)]?.[invMonth];
      if (ah && parseFloat(ah.hours) > 0) return true;
      const r = calcRevenue(d, monthIdx, team);
      return r.revenue != null && r.revenue > 0;
    });
  });
}

function renderInvPreview() {
  const body = document.getElementById('inv-preview-body');
  const sapHours = getSapHoursByNessId();
  const teams = getInvoiceTeams();
  const monthNum = invMonth;

  // Also add Connected veh. ser. + CVS Oncall as one combined row
  const rows = [];

  teams.forEach(team => {
    if (team === 'Selfhosting') {
      const sr = calcSelfhostingRevenue(monthNum - 1);
      rows.push({ team: 'Selfhosting', revTotal: 0, tmshTotal: 0, allTmsh: sr.isLocked, someTmsh: sr.hasActuals, amount: sr.revenue || 0, isCVS: false, cvsOncallAmt: 0, devCount: 0, isSelfhosting: true, selfType: sr.type });
      return;
    }
    const isCVS = team === 'Connected veh. ser.';
    const devs = developers.filter(d => {
      const monthStart = new Date(2026, monthNum - 1, 1);
      const monthEnd = new Date(2026, monthNum, 0);
      return (d.assignments||[]).some(a => {
        if (a.team !== team) return false;
        const start = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const end = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return start <= monthEnd && end >= monthStart;
      });
    });

    let revTotal = 0, tmshTotal = 0, tmshCount = 0, amount = 0;
    devs.forEach(d => {
      const revH = getRevenueHours(d, monthNum);
      revTotal += revH || 0;
      const tmshH = getTmshHours(d, monthNum);
      if (tmshH != null) { tmshTotal += tmshH; tmshCount++; }
      const r = calcRevenue(d, monthNum - 1, team);
      amount += (r.revenue || 0) + (r.discountAmt || 0);
    });
    const allTmsh = devs.length > 0 && tmshCount === devs.length;
    const someTmsh = tmshCount > 0 && tmshCount < devs.length;

    let cvsOncallAmt = 0;
    if (isCVS) {
      const cvsRev = calcCvsOncallRevenue(monthNum - 1);
      cvsOncallAmt = cvsRev.revenue || 0;
      amount += cvsOncallAmt;
    }

    rows.push({ team, revTotal, tmshTotal, allTmsh, someTmsh, amount, isCVS, cvsOncallAmt, devCount: devs.length });
  });

  // Also add Selfhosting as info row
  const selfRev = calcSelfhostingRevenue(monthNum - 1);

  // Store teams in lookup
  window._invPreviewTeams = {};
  rows.forEach((r, i) => { window._invPreviewTeams[i] = r.team; });

  body.innerHTML = rows.map((r, i) => {
    const badge = r.isSelfhosting
      ? (r.selfType === 'tmsh' ? '<span style="background:var(--green-lt);color:var(--green);padding:2px 10px;border-radius:99px;font-size:11px;font-weight:500">✅ Ready</span>'
        : r.selfType === 'manual' ? '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 10px;border-radius:99px;font-size:11px;font-weight:500">⚠️ Manual</span>'
        : '<span style="background:var(--blue-lt);color:var(--blue);padding:2px 10px;border-radius:99px;font-size:11px;font-weight:500">ℹ️ Forecast</span>')
      : r.allTmsh ? '<span style="background:var(--green-lt);color:var(--green);padding:2px 10px;border-radius:99px;font-size:11px;font-weight:500">✅ Ready</span>'
        : r.someTmsh ? '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 10px;border-radius:99px;font-size:11px;font-weight:500">⚠️ Partial actuals</span>'
        : r.revTotal > 0 ? '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 10px;border-radius:99px;font-size:11px;font-weight:500">⚠️ Manual only</span>'
        : '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 10px;border-radius:99px;font-size:11px;font-weight:500">⚠️ No actuals</span>';
    const teamLabel = r.isSelfhosting
      ? 'Selfhosting <span style="font-size:11px;font-weight:400;color:var(--text-3)">(fixed price)</span>'
      : r.team + (r.isCVS ? '<br><span style="font-size:11px;color:var(--text-3)">+ CVS Oncall fixed fee</span>' : '');
    const hoursDisplay = r.isSelfhosting ? '<span style="color:var(--text-3)">—</span>' : (r.revTotal > 0 ? r.revTotal.toFixed(2) : '—');
    return `<tr onclick="openInvPreviewModal(window._invPreviewTeams[${i}])" style="cursor:pointer">
      <td style="font-weight:500">${teamLabel}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:500">${hoursDisplay}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;font-weight:500">€${r.amount.toFixed(2)}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');
}

function renderInvGenerate() {
  const body = document.getElementById('inv-generate-body');
  const sapHours = getSapHoursByNessId();
  const teams = getInvoiceTeams();
  const monthNum = invMonth;
  const monthName = MONTH_NAMES_FULL[monthNum - 1].substring(0, 3);
  const year = 2026;

  body.innerHTML = teams.map(team => {
    if (team === 'Selfhosting') {
      const sr = calcSelfhostingRevenue(monthNum - 1);
      const sfn = `HERE_InvData_${monthName}-${year}_Selfhosting_PO50019177.xlsx`;
      const badge = sr.type === 'tmsh' ? '<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px">✅ Ready</span>'
        : sr.type === 'manual' ? '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">⚠️ Manual</span>'
        : '<span style="background:var(--blue-lt);color:var(--blue);padding:2px 8px;border-radius:99px;font-size:11px">ℹ️ Forecast</span>';
      return `<tr>
        <td style="text-align:center"><input type="checkbox" class="inv-cb" data-team="Selfhosting" onchange="updateInvSelectedCount()"></td>
        <td style="font-weight:500">Selfhosting</td>
        <td style="font-size:11px;color:var(--text-2);font-family:monospace">${sfn}</td>
        <td style="text-align:right;font-weight:500">€${(sr.revenue||0).toFixed(2)}</td>
        <td style="text-align:center">${badge}</td>
      </tr>`;
    }
    const cfg = getTeamInvoiceConfig(team);
    const fileName = getInvoiceFileName(team, monthName, year);
    const devs = developers.filter(d => {
      const monthStart = new Date(2026, monthNum - 1, 1);
      const monthEnd = new Date(2026, monthNum, 0);
      return (d.assignments||[]).some(a => {
        if (a.team !== team) return false;
        const start = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const end = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return start <= monthEnd && end >= monthStart;
      });
    });
    let tmshTotal = 0, revTotal = 0;
    devs.forEach(d => {
      tmshTotal += getTmshHours(d, monthNum) || 0;
      const r = calcRevenue(d, monthNum - 1, team);
      revTotal += (r.revenue||0) + (r.discountAmt||0);
    });
    if (team === 'Connected veh. ser.') revTotal += calcCvsOncallRevenue(monthNum - 1).revenue || 0;
    const allTmsh = devs.length > 0 && devs.every(d => getTmshHours(d, monthNum) > 0);
    const someTmsh = tmshTotal > 0;
    const badge = allTmsh
      ? '<span style="background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px;font-size:11px">✅ Ready</span>'
      : someTmsh
        ? '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">⚠️ Partial actuals</span>'
        : revTotal > 0
          ? '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">⚠️ Manual only</span>'
          : '<span style="background:var(--amber-lt);color:var(--amber);padding:2px 8px;border-radius:99px;font-size:11px">⚠️ No actuals</span>';

    return `<tr>
      <td style="text-align:center">
        <input type="checkbox" class="inv-cb" data-team="${team}" onchange="updateInvSelectedCount()">
      </td>
      <td style="font-weight:500">${team}</td>
      <td style="font-size:11px;color:var(--text-2);font-family:monospace">${fileName}</td>
      <td style="text-align:right;font-weight:500">€${revTotal.toFixed(2)}</td>
      <td style="text-align:center">${badge}</td>
    </tr>`;
  }).join('');

  updateInvSelectedCount();
}

function toggleAllInv(checked) {
  document.querySelectorAll('.inv-cb').forEach(cb => cb.checked = checked);
  updateInvSelectedCount();
}

function updateInvSelectedCount() {
  const n = document.querySelectorAll('.inv-cb:checked').length;
  document.getElementById('inv-selected-count').textContent = `${n} file${n !== 1 ? 's' : ''} selected`;
}

async function generateInvoices() {
  const selected = [...document.querySelectorAll('.inv-cb:checked')].map(cb => cb.dataset.team);
  if (!selected.length) { showToast('Select at least one team'); return; }

  const monthNum = invMonth;
  const monthNameFull = MONTH_NAMES_FULL[monthNum - 1];
  const monthNameShort = monthNameFull.substring(0, 3);
  const year = 2026;
  const sapHours = getSapHoursByNessId();

  // Get last day of month
  const lastDay = new Date(year, monthNum, 0).getDate();
  const periodStr = `${monthNameFull} ${year}`;
  const dateStr = `${lastDay}-${monthNameShort} ${year}`;

  // Process downloads in batches of 5 with pause between batches
  // Chrome blocks >10 simultaneous programmatic downloads
  const BATCH_SIZE = 5;
  for (let i = 0; i < selected.length; i++) {
    if (i > 0 && i % BATCH_SIZE === 0) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2s pause between batches
    } else if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 300)); // 300ms between files
    }
    await generateInvoiceFile(selected[i], monthNum, monthNameShort, year, periodStr, dateStr, sapHours);
  }

  showToast(`Generated ${selected.length} file${selected.length !== 1 ? 's' : ''}`);
}

async function generateOverviewFile() {
  if (!invMonth) { showToast('Select a month first'); return; }

  const monthNum = invMonth;
  const monthNameFull = MONTH_NAMES_FULL[monthNum - 1];
  const monthNameShort = monthNameFull.substring(0, 3);
  const year = 2026;
  const sapHours = getSapHoursByNessId();
  const lastDay = new Date(year, monthNum, 0).getDate();
  const periodStr = `${monthNameFull} ${year}`;
  const dateStr = `${lastDay}-${monthNameShort} ${year}`;

  showToast('Building overview file...');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DM App';

  // ── Sheet 1: Overview ────────────────────────────────────────────────────
  const wsOv = wb.addWorksheet('Overview');
  wsOv.columns = [
    { key: 'a', width: 30 },
    { key: 'b', width: 16 },
    { key: 'c', width: 14 },
    { key: 'd', width: 18 },
    { key: 'e', width: 38 },
  ];

  const eurFmt = '#,##0.00 "EUR"';
  const border = {
    top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  };
  const BOLD = { name: 'Arial', size: 10, bold: true };
  const NORMAL = { name: 'Arial', size: 10 };
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
  const DISC_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };

  // Header row
  const hdr = wsOv.addRow(['Project', 'Total EUR', 'PO number', 'Amount', 'Attachments']);
  hdr.height = 20;
  hdr.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > 5) return;
    cell.font = BOLD;
    cell.fill = HEADER_FILL;
    cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: col >= 2 && col <= 4 ? 'right' : 'left' };
  });

  // Build poGroups in invoice order (same as email preview)
  const poGroups = {};
  const invTeams = getInvoiceTeams();
  const monthStart = new Date(year, monthNum - 1, 1);
  const monthEnd = new Date(year, monthNum, 0);

  invTeams.forEach(team => {
    if (team === 'Selfhosting') {
      const srData = calcSelfhostingRevenue(monthNum - 1);
      if (srData.revenue) {
        const po = '50019177';
        const key = 'po_' + po;
        if (!poGroups[key]) poGroups[key] = { teams: [], po, totalAmount: 0, rows: [], order: Object.keys(poGroups).length };
        poGroups[key].teams.push('Selfhosting');
        poGroups[key].totalAmount += srData.revenue;
        poGroups[key].rows.push({ label: 'Selfhosting', amount: srData.revenue, fileName: `HERE_InvData_${monthNameShort}-${year}_Selfhosting_PO${po}.xlsx` });
      }
      return;
    }
    const lookup = invoiceGroups.find(g => g.teams.includes(team));
    const groupKey = lookup ? 'group_' + lookup.id : 'team_' + team;
    const po = lookup?.po || getTeamInvoiceConfig(team).po || '';

    const devs = developers.filter(d =>
      (d.assignments||[]).some(a => {
        if (a.team !== team || a.billable === false) return false;
        const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return s <= monthEnd && e >= monthStart;
      })
    );

    let grossAmount = devs.reduce((sum, d) => { const r = calcRevenue(d, monthNum-1, team); return sum + (r.revenue||0); }, 0);
    const rateDiscAmt = devs.reduce((sum, d) => { const r = calcRevenue(d, monthNum-1, team); return sum + (r.discountAmt||0); }, 0);
    if (team === 'Connected veh. ser.') grossAmount += calcCvsOncallRevenue(monthNum-1).revenue || 0;
    grossAmount += extraInvoicing.filter(e => e.team === team && e.month === monthNum && e.year === year).reduce((s,e2) => s + parseFloat(e2.value||0), 0);
    const teamDisc = teamDiscounts.find(td => {
      if (td.team !== team) return false;
      const ds = new Date(td.start_date); const de = td.end_date ? new Date(td.end_date) : new Date('2099-12-31');
      return monthStart >= ds && monthStart <= de;
    });
    const discAmt = teamDisc ? (teamDiscountAmounts[teamDisc.id]?.[monthNum]?.amount || 0) : 0;
    const netAmount = grossAmount + rateDiscAmt;

    if (!poGroups[groupKey]) poGroups[groupKey] = { teams: [], po, totalAmount: 0, rows: [] };
    if (!poGroups[groupKey].teams.includes(team)) poGroups[groupKey].teams.push(team);
    poGroups[groupKey].totalAmount += netAmount + discAmt;
    poGroups[groupKey].rows.push({ label: team, amount: grossAmount, fileName: getInvoiceFileName(team, monthNameShort, year) });
    if (rateDiscAmt !== 0) poGroups[groupKey].rows.push({ label: 'Discount (rate)', amount: rateDiscAmt, isDiscount: true });
    if (discAmt !== 0) poGroups[groupKey].rows.push({ label: 'Discount', amount: discAmt, isDiscount: true });
  });

  // Write overview rows
  let grandTotal = 0;
  Object.values(poGroups).forEach(grp => {
    grandTotal += grp.totalAmount;
    const n = grp.rows.length;
    grp.rows.forEach((row, ri) => {
      const rowData = ['', '', '', row.amount, row.isDiscount ? '' : (row.fileName || '')];
      if (ri === 0) {
        rowData[0] = grp.teams.join(' + ');
        rowData[1] = grp.totalAmount;
        rowData[2] = '#' + grp.po;
      }
      const exRow = wsOv.addRow(rowData);
      exRow.height = 18;
      exRow.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 5) return;
        if (row.isDiscount) {
          cell.fill = DISC_FILL;
          cell.font = { name: 'Arial', size: 10, color: { argb: 'FF854F0B' } };
        } else {
          cell.font = NORMAL;
        }
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: [2,3,4].includes(col) ? 'right' : 'left' };
        if (col === 1 && ri === 0) cell.font = BOLD;
        if ((col === 2 || col === 4) && typeof cell.value === 'number') cell.numFmt = eurFmt;
      });
    });
  });

  // Grand total row
  const gtRow = wsOv.addRow(['Total', grandTotal, '', '', '']);
  gtRow.height = 20;
  gtRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > 5) return;
    cell.font = BOLD;
    cell.border = border;
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: col === 2 ? 'right' : 'left' };
    if (col === 2) cell.numFmt = eurFmt;
  });

  // ── Sheet 2: Details ────────────────────────────────────────────────────
  const wsDet = wb.addWorksheet('Details');
  wsDet.columns = [
    { key: 'a', width: 14 },
    { key: 'b', width: 22 },
    { key: 'c', width: 16 },
    { key: 'd', width: 16 },
    { key: 'e', width: 18 },
  ];

  const detTeams = [...getInvoiceTeams()];

  for (let ti = 0; ti < detTeams.length; ti++) {
    const team = detTeams[ti];

    // 3 blank rows between invoices (except before first)
    if (ti > 0) {
      wsDet.addRow([]); wsDet.addRow([]); wsDet.addRow([]);
    }

    if (team === 'Selfhosting') {
      const sr2 = calcSelfhostingRevenue(monthNum - 1);
      const fixed2 = selfhostingServices.filter(s => s.type === 'fixed');
      const releases2 = selfhostingServices.filter(s => s.type === 'release');
      const releaseRate2 = releases2.length ? parseFloat(releases2[0].rate) : 3930;
      const hasActuals2 = releases2.some(s => (selfhostingActuals[s.id]?.[monthNum] || 0) > 0);
      const fcst2 = selfhostingForecast[monthNum] || { releases: 0 };
      const BLUE_BG2 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      const GREY_BG2 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      const WHITE_BG2 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
      const GRAND_BG2 = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
      const WHITE_BOLD2 = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };

      // Period + PO rows
      const shP = wsDet.addRow(['Invoicing period:', periodStr, '', '', '']);
      shP.height = 18; shP.getCell(1).font = BOLD; shP.getCell(2).font = NORMAL;
      const shPo = wsDet.addRow(['PO number', '50019177', '', '', '']);
      shPo.height = 18; shPo.getCell(1).font = BOLD; shPo.getCell(2).font = NORMAL;
      wsDet.addRow([]);

      // Column headers
      const shColHdr = wsDet.addRow(['Service / Description', 'Qty', 'Amount', '', '']);
      shColHdr.height = 22;
      shColHdr.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 3) return;
        cell.fill = BLUE_BG2; cell.font = WHITE_BOLD2; cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: col >= 2 ? 'right' : 'left' };
      });

      let shTotal = 0; let shIdx = 0;
      fixed2.forEach(s => {
        const amt = parseFloat(s.rate); shTotal += amt;
        const shRow2 = wsDet.addRow([s.name, 1, amt, '', '']);
        shRow2.height = 18;
        shRow2.eachCell({ includeEmpty: true }, (cell, col) => {
          if (col > 3) return;
          cell.fill = shIdx % 2 === 0 ? WHITE_BG2 : GREY_BG2;
          cell.font = NORMAL; cell.border = border;
          cell.alignment = { vertical: 'middle', horizontal: col >= 2 ? 'right' : 'left' };
          if (col === 3) cell.numFmt = eurFmt;
        });
        shIdx++;
      });
      releases2.forEach(s => {
        const count = hasActuals2 ? (selfhostingActuals[s.id]?.[monthNum] || 0) : (fcst2.releases || 0);
        if (count === 0) return;
        const amt = count * releaseRate2; shTotal += amt;
        const shRow2 = wsDet.addRow([s.name, count, amt, '', '']);
        shRow2.height = 18;
        shRow2.eachCell({ includeEmpty: true }, (cell, col) => {
          if (col > 3) return;
          cell.fill = shIdx % 2 === 0 ? WHITE_BG2 : GREY_BG2;
          cell.font = NORMAL; cell.border = border;
          cell.alignment = { vertical: 'middle', horizontal: col >= 2 ? 'right' : 'left' };
          if (col === 3) cell.numFmt = eurFmt;
        });
        shIdx++;
      });
      wsDet.addRow([]);
      const shGt = wsDet.addRow(['Grand Total', '', shTotal, '', '']);
      shGt.height = 22;
      shGt.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 3) return;
        cell.fill = GRAND_BG2;
        cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: col === 3 ? 'right' : 'left' };
        if (col === 3) cell.numFmt = eurFmt;
      });
      continue;
    }

    // T&M section
    const cfg2 = getTeamInvoiceConfig(team);
    const po2 = cfg2.po || '';
    const teamDevs = developers.filter(d =>
      (d.assignments||[]).some(a => {
        if (a.team !== team || a.billable === false) return false;
        const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return s <= monthEnd && e >= monthStart;
      })
    ).sort((a,b) => getDevPosition(a.id) - getDevPosition(b.id) || a.lastname.localeCompare(b.lastname));

    // Section header
    const secHdr = wsDet.addRow([`${team} — ${periodStr}  |  PO: ${po2}`]);
    secHdr.height = 18;
    secHdr.getCell(1).font = BOLD;
    secHdr.getCell(1).fill = HEADER_FILL;

    // Column headers
    const colHdr = wsDet.addRow(['Employee Id', 'Employee Name', 'Billable Hours', 'Standard Rate', 'Service Billing']);
    colHdr.height = 18;
    colHdr.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 5) return;
      cell.font = BOLD;
      cell.fill = HEADER_FILL;
      cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: [3,4,5].includes(col) ? 'right' : 'left' };
    });

    // Dev rows
    const teamDisc2 = teamDiscounts.find(td => {
      if (td.team !== team) return false;
      const ds = new Date(td.start_date); const de = td.end_date ? new Date(td.end_date) : new Date('2099-12-31');
      return monthStart >= ds && monthStart <= de;
    });
    const teamDiscAmt2 = teamDisc2 ? (teamDiscountAmounts[teamDisc2.id]?.[monthNum]?.amount || 0) : 0;
    const isCVS2 = team === 'Connected veh. ser.';
    const cvsOncall2 = isCVS2 ? calcCvsOncallRevenue(monthNum - 1) : null;
    let serviceBilling2 = 0;

    teamDevs.forEach(d => {
      const hours = sapHours[d.nessid] || 0;
      const monthKey = MTHS[monthNum - 1];
      const rate = rates[d.id]?.[monthKey] ? parseFloat(rates[d.id][monthKey]) : 0;
      const amount = hours * rate;
      const disc = developerDiscounts.find(dd => {
        if (dd.developer_id !== d.id) return false;
        const dStart = new Date(dd.start_date);
        const dEnd = dd.end_date ? new Date(dd.end_date) : new Date('2099-12-31');
        return monthStart >= dStart && monthStart <= dEnd;
      });
      const discRate = disc?.rate || null;
      serviceBilling2 += amount + (discRate ? (discRate - rate) * hours : 0);

      const devRow = wsDet.addRow([d.nessid, `${d.firstname} ${d.lastname}`, hours, rate, amount]);
      devRow.height = 18;
      devRow.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 5) return;
        cell.font = NORMAL; cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: [3,4,5].includes(col) ? 'right' : 'left' };
        if (col === 3) cell.numFmt = '#,##0.00';
        if (col === 4 || col === 5) cell.numFmt = eurFmt;
      });

      if (discRate) {
        const discAmt2 = (discRate - rate) * hours;
        const discRow = wsDet.addRow(['', `  ↳ Rate discount (${d.firstname} ${d.lastname})`, hours, discRate - rate, discAmt2]);
        discRow.height = 18;
        discRow.eachCell({ includeEmpty: true }, (cell, col) => {
          if (col > 5) return;
          cell.font = { name: 'Arial', size: 10, color: { argb: 'FF854F0B' } };
          cell.fill = DISC_FILL; cell.border = border;
          cell.alignment = { vertical: 'middle', horizontal: [3,4,5].includes(col) ? 'right' : 'left' };
          if (col === 3) cell.numFmt = '#,##0.00';
          if (col === 4 || col === 5) cell.numFmt = eurFmt;
        });
      }
    });

    if (cvsOncall2?.revenue) {
      serviceBilling2 += cvsOncall2.revenue;
      const cvsRow = wsDet.addRow(['', 'CVS Oncall – Fixed fee', '', '', cvsOncall2.revenue]);
      cvsRow.height = 18;
      cvsRow.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 5) return;
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF185FA5' } };
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
        if (col === 5) cell.numFmt = eurFmt;
      });
    }

    // Service Billing total
    const sbRow2 = wsDet.addRow(['Service Billing', '', '', 'Total:', serviceBilling2]);
    sbRow2.height = 18;
    sbRow2.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 5) return;
      cell.font = BOLD; cell.border = border;
      cell.fill = HEADER_FILL;
      cell.alignment = { vertical: 'middle', horizontal: [4,5].includes(col) ? 'right' : 'left' };
      if (col === 5) cell.numFmt = eurFmt;
    });

    // Team discount
    if (teamDiscAmt2 !== 0) {
      const tdLabel2 = teamDisc2?.note ? `Discount (${teamDisc2.note})` : 'Discount';
      const tdRow2 = wsDet.addRow([tdLabel2, '', '', '', teamDiscAmt2]);
      tdRow2.height = 18;
      tdRow2.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 5) return;
        cell.font = NORMAL; cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
        if (col === 5) cell.numFmt = eurFmt;
      });

      const dtRow2 = wsDet.addRow(['Discount Total', '', '', '', teamDiscAmt2]);
      dtRow2.height = 18;
      dtRow2.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 5) return;
        cell.font = BOLD; cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
        if (col === 5) cell.numFmt = eurFmt;
      });
    }

    // Grand total
    const gt2 = serviceBilling2 + teamDiscAmt2;
    const gtRow2 = wsDet.addRow(['Grand Total', '', '', '', gt2]);
    gtRow2.height = 20;
    gtRow2.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 5) return;
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF185FA5' } };
      cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
      if (col === 5) cell.numFmt = eurFmt;
    });
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fileName = `HERE_InvOverview_${monthNameShort}-${year}.xlsx`;
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded: ${fileName}`);
}


async function generateInvoiceFile(team, monthNum, monthNameShort, year, periodStr, dateStr, sapHours) {
  if (team === 'Selfhosting') {
    const mNameFull = MONTH_NAMES_FULL[monthNum - 1];
    await generateSelfhostingInvoiceFile(monthNum, monthNameShort, year, `${mNameFull} ${year}`);
    return;
  }
  const cfg = getTeamInvoiceConfig(team);
  const monthStart = new Date(year, monthNum - 1, 1);
  const monthEnd = new Date(year, monthNum, 0);

  // Get active developers
  const devs = developers.filter(d =>
    (d.assignments||[]).some(a => {
      if (a.team !== team) return false;
      if (a.billable === false) return false; // exclude non-billable (e.g. On-Call only assignments)
      const start = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
      const end = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
      return start <= monthEnd && end >= monthStart;
    })
  ).sort((a,b) => getDevPosition(a.id) - getDevPosition(b.id) || a.lastname.localeCompare(b.lastname));

  const devRows = devs.map((d, i) => {
    const hours = sapHours[d.nessid] || 0;
    const monthKey = MTHS[monthNum - 1];
    const rate = rates[d.id]?.[monthKey] ? parseFloat(rates[d.id][monthKey]) : 0;
    const amount = hours * rate;
    const disc = developerDiscounts.find(dd => {
      if (dd.developer_id !== d.id) return false;
      const dStart = new Date(dd.start_date);
      const dEnd = dd.end_date ? new Date(dd.end_date) : new Date('2099-12-31');
      return monthStart >= dStart && monthStart <= dEnd;
    });
    return { nessid: d.nessid, name: `${d.firstname} ${d.lastname}`, hours, rate, amount, discRate: disc?.rate || null };
  });

  const teamDisc = teamDiscounts.find(td => {
    if (td.team !== team) return false;
    const dStart = new Date(td.start_date);
    const dEnd = td.end_date ? new Date(td.end_date) : new Date('2099-12-31');
    return monthStart >= dStart && monthStart <= dEnd;
  });
  const teamDiscAmt = teamDisc ? (teamDiscountAmounts[teamDisc.id]?.[monthNum]?.amount || 0) : 0;
  const isCVS = team === 'Connected veh. ser.';
  const cvsOncall = isCVS ? calcCvsOncallRevenue(monthNum - 1) : null;

  const serviceBilling = devRows.reduce((s,r) => s + r.amount, 0)
    + devRows.reduce((s,r) => r.discRate ? s + ((r.discRate - r.rate) * r.hours) : s, 0)
    + (cvsOncall?.revenue || 0);
  const discountTotal = teamDiscAmt;
  // Extra invoicing lines for this team/month
  const extraLines = extraInvoicing.filter(e => e.team === team && e.month === monthNum && e.year === year);
  const extraTotal = extraLines.reduce((s,e) => s + parseFloat(e.value || 0), 0);
  const grandTotal = serviceBilling + discountTotal + extraTotal;

  // ── ExcelJS workbook ────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HERE DM Tools';
  const ws = wb.addWorksheet('Invoice');

  // Column definitions (no Sr. No.)
  ws.columns = [
    { key: 'a', width: 16 },   // Employee Id
    { key: 'b', width: 36 },   // Employee Name (wide enough for full names)
    { key: 'c', width: 16 },   // Billable Hours
    { key: 'd', width: 16 },   // Standard Rate
    { key: 'e', width: 18 },   // Service Billing
  ];
  const eurFmt = '#,##0.00 €;-#,##0.00 €';

  // ── Style helpers ────────────────────────────────────────────────────────
  const BLUE_BG  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  const GREY_BG  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  const WHITE_BG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  const TOTAL_BG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F1FB' } };
  const GRAND_BG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };

  const WHITE_BOLD = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  const NORMAL     = { name: 'Arial', size: 10 };
  const BOLD       = { name: 'Arial', bold: true, size: 10 };
  const BOLD_BLUE  = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  const MUTED      = { name: 'Arial', size: 10, color: { argb: 'FF6B7280' } };
  const AMBER_F    = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF854F0B' } };
  const CVS_F      = { name: 'Arial', size: 10, color: { argb: 'FF185FA5' } };

  const numFmt = '#,##0.00';
  const thin = { style: 'thin', color: { argb: 'FFE5E7EB' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  function styleRow(row, fill, font, numCols) {
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > numCols) return;
      cell.fill = fill;
      cell.font = font;
      cell.border = border;
      cell.alignment = { vertical: 'middle' };
    });
  }

  // ── Row 1-2: Period + PO ─────────────────────────────────────────────────
  const r1 = ws.addRow(['Invoicing period:', periodStr, '', '', '', '']);
  r1.getCell(1).font = BOLD;
  r1.getCell(2).font = NORMAL;
  r1.height = 18;

  const r2 = ws.addRow(['PO number', cfg.po, '', '', '', '']);
  r2.getCell(1).font = BOLD;
  r2.getCell(2).font = NORMAL;
  r2.height = 18;

  ws.addRow([]); // row 3
  ws.addRow([]); // row 4

  // ── Row 5: Column headers ────────────────────────────────────────────────
  const hdrRow = ws.addRow(['Employee Id', 'Employee Name', 'Billable Hours', 'Standard Rate', 'Service Billing']);
  hdrRow.height = 22;
  hdrRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > 5) return;
    cell.fill = BLUE_BG;
    cell.font = WHITE_BOLD;
    cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: col >= 3 ? 'right' : 'left' };
  });

  // ── Developer rows ───────────────────────────────────────────────────────
  devRows.forEach((r, i) => {
    const fill = i % 2 === 0 ? WHITE_BG : GREY_BG;
    const row = ws.addRow([r.nessid, r.name, r.hours, r.rate, r.amount]);
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 5) return;
      cell.fill = fill;
      cell.font = NORMAL;
      cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: col >= 3 ? 'right' : 'left' };
      if (col === 3) cell.numFmt = '#,##0';
      if (col === 4) cell.numFmt = eurFmt;
      if (col === 5) cell.numFmt = eurFmt;
    });
    // Discount line
    if (r.discRate !== null) {
      const discAmt = (r.discRate - r.rate) * r.hours;
      const dRow = ws.addRow(['', `  ↳ Rate discount (${r.name})`, r.hours, r.discRate - r.rate, discAmt]);
      dRow.height = 17;
      dRow.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 5) return;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9F0' } };
        cell.font = AMBER_F;
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: col >= 3 ? 'right' : 'left' };
        if (col === 3) cell.numFmt = '#,##0';
        if (col === 4) cell.numFmt = eurFmt;
        if (col === 5) cell.numFmt = eurFmt;
      });
    }
  });

  // ── CVS Oncall lines ─────────────────────────────────────────────────────
  if (isCVS && cvsOncall) {
    const addCvsRow = (label, amt) => {
      const row = ws.addRow(['', label, '', '', amt]);
      row.height = 18;
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 5) return;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7FF' } };
        cell.font = CVS_F;
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
        if (col === 5) cell.numFmt = eurFmt;
      });
    };
    addCvsRow('CVS Oncall – Fixed fee', 2200);
    if (cvsOncall.incidents > 0) addCvsRow(`CVS Oncall – Incidents (${cvsOncall.incidents} × €240)`, cvsOncall.incidents * 240);
  }

  // ── Service Billing subtotal ─────────────────────────────────────────────
  const sbRow = ws.addRow(['Service Billing', '', '', 'Total:', serviceBilling]);
  sbRow.height = 20;
  sbRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > 5) return;
    cell.fill = TOTAL_BG;
    cell.font = BOLD;
    cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: col >= 4 ? 'right' : 'left' };
    if (col === 5) cell.numFmt = eurFmt;
  });

  // ── Extra invoicing lines ─────────────────────────────────────────────────
  const EXTRA_BG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3DE' } };
  if (extraLines.length) {
    ws.addRow([]); // blank
    extraLines.forEach(ei => {
      const eiRow = ws.addRow([`Extra: ${ei.description}`, '', '', '', parseFloat(ei.value || 0)]);
      eiRow.height = 18;
      eiRow.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col > 5) return;
        cell.fill = EXTRA_BG;
        cell.font = { name: 'Arial', size: 10, color: { argb: 'FF3B6D11' } };
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
        if (col === 5) cell.numFmt = eurFmt;
      });
    });
  }

  // ── Discount + Discount Total — only if non-zero ──────────────────────────
  if (teamDiscAmt !== 0) {
    ws.addRow([]); // blank
    const discLabel = teamDisc ? `Discount (${teamDisc.note})` : 'Discount';
    const discRow = ws.addRow([discLabel, '', '', '', teamDiscAmt]);
    discRow.height = 18;
    discRow.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 5) return;
      cell.font = NORMAL;
      cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
      if (col === 5) cell.numFmt = eurFmt;
    });

    ws.addRow([]); // blank

    const dtRow = ws.addRow(['Discount Total', '', '', '', discountTotal]);
    dtRow.height = 18;
    dtRow.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 5) return;
      cell.font = BOLD;
      cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
      if (col === 5) cell.numFmt = eurFmt;
    });
  }

  // ── Grand Total ───────────────────────────────────────────────────────────
  const gtRow = ws.addRow(['Grand Total', '', '', '', grandTotal]);
  gtRow.height = 22;
  gtRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > 5) return;
    cell.fill = GRAND_BG;
    cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: col === 5 ? 'right' : 'left' };
    if (col === 5) cell.numFmt = eurFmt;
  });

  // ── Appendix C (TMSH) ─────────────────────────────────────────────────────
  if (false) { // Appendix C removed — actuals-only mode
    const devNessIds = new Set(devs.map(d => d.nessid));
    const tmshRows = invData.filter(r => devNessIds.has(r.nessid) && r.status === '30' && r.activity === '1004');
    if (tmshRows.length) {
      const wsTmsh = wb.addWorksheet('Appendix C (TMSH)');
      wsTmsh.columns = [{key:'a',width:16},{key:'b',width:30},{key:'c',width:14},{key:'d',width:10}];
      const th = wsTmsh.addRow(['Employee Id','Employee Name','Date','Hours']);
      th.eachCell(cell => { cell.fill = BLUE_BG; cell.font = WHITE_BOLD; cell.border = border; cell.alignment = { vertical:'middle' }; });
      const grouped = {};
      tmshRows.forEach(r => { if (!grouped[r.nessid]) grouped[r.nessid]=[]; grouped[r.nessid].push(r); });
      devs.forEach((d, di) => {
        const dRows = grouped[d.nessid]; if (!dRows) return;
        const total = dRows.reduce((s,r)=>s+r.hours,0);
        const fill = di%2===0 ? WHITE_BG : GREY_BG;
        const subRow = wsTmsh.addRow([d.nessid, d.firstname+' '+d.lastname, '', total]);
        subRow.eachCell({includeEmpty:true},(cell,col)=>{ if(col>4)return; cell.fill=fill; cell.font=BOLD; cell.border=border; cell.alignment={vertical:'middle',horizontal:col>=4?'right':'left'}; if(col===4)cell.numFmt=numFmt; });
        dRows.sort((a,b)=>a.date-b.date).forEach(r => {
          const dr = wsTmsh.addRow(['','',localDateStr(r.date),r.hours]);
          dr.eachCell({includeEmpty:true},(cell,col)=>{ if(col>4)return; cell.fill=fill; cell.font=NORMAL; cell.border=border; cell.alignment={vertical:'middle',horizontal:col>=3?'right':'left'}; if(col>=3)cell.numFmt=col===3?'yyyy-mm-dd':numFmt; });
        });
      });
    }
  }

  // ── Download ──────────────────────────────────────────────────────────────
  const fileName = getInvoiceFileName(team, monthNameShort, year);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}


function openInvEmailWindow() {
  if (!invMonth) { showToast('Select a month first'); return; }
  const monthNum = invMonth;
  const monthNameFull = MONTH_NAMES_FULL[monthNum - 1];
  const monthNameShort = monthNameFull.substring(0, 3);
  const year = 2026;
  const teams = getInvoiceTeams();

  const poGroups = {};
  // Use invoiceGroups to determine PO groupings and order
  const groupLookup = {}; // team -> {po, groupKey}
  invoiceGroups.forEach((g, gi) => {
    g.teams.forEach(t => { groupLookup[t] = { po: g.po, groupKey: 'g_' + gi }; });
  });

  teams.forEach(team => {
    const lookup = groupLookup[team];
    const po = (lookup && lookup.po) || (team === 'Selfhosting' ? '50019177' : (getTeamInvoiceConfig(team).po || ''));
    const groupKey = (lookup && lookup.groupKey) || team;
    if (!po) return;

    // Selfhosting is fixed price — use calcSelfhostingRevenue
    if (team === 'Selfhosting') {
      const sr = calcSelfhostingRevenue(monthNum - 1);
      if (!poGroups[groupKey]) poGroups[groupKey] = { teams: [], po, totalAmount: 0, rows: [] };
      if (!poGroups[groupKey].teams.includes(team)) poGroups[groupKey].teams.push(team);
      poGroups[groupKey].totalAmount += sr.revenue || 0;
      poGroups[groupKey].rows.push({ label: 'Selfhosting', amount: sr.revenue || 0, fileName: 'HERE_InvData_' + monthNameShort + '-' + year + '_Selfhosting_PO' + po + '.xlsx' });
      return;
    }

    const monthStart = new Date(year, monthNum-1, 1);
    const monthEnd = new Date(year, monthNum, 0);
    const devs = developers.filter(d => (d.assignments||[]).some(a => {
      if (a.team !== team) return false;
      const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
      const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
      return s <= monthEnd && e >= monthStart;
    }));
    // Gross amount (before any discounts) + rate discounts separately
    let grossAmount = devs.reduce((sum, d) => { const r = calcRevenue(d, monthNum-1, team); return sum + (r.revenue||0); }, 0);
    const rateDiscAmt = devs.reduce((sum, d) => { const r = calcRevenue(d, monthNum-1, team); return sum + (r.discountAmt||0); }, 0);
    if (team === 'Connected veh. ser.') grossAmount += calcCvsOncallRevenue(monthNum-1).revenue || 0;
    grossAmount += extraInvoicing.filter(e => e.team === team && e.month === monthNum && e.year === year).reduce((s,e2) => s + parseFloat(e2.value||0), 0);
    const teamDisc = teamDiscounts.find(td => { if (td.team !== team) return false; const ds = new Date(td.start_date); const de = td.end_date ? new Date(td.end_date) : new Date('2099-12-31'); return monthStart >= ds && monthStart <= de; });
    const discAmt = teamDisc ? (teamDiscountAmounts[teamDisc.id]?.[monthNum]?.amount || 0) : 0;
    const amount = grossAmount + rateDiscAmt;
    if (!poGroups[groupKey]) poGroups[groupKey] = { teams: [], po, totalAmount: 0, rows: [] };
    if (!poGroups[groupKey].teams.includes(team)) poGroups[groupKey].teams.push(team);
    poGroups[groupKey].totalAmount += amount + discAmt;
    poGroups[groupKey].rows.push({ label: team, amount: grossAmount, fileName: getInvoiceFileName(team, monthNameShort, year) });
    if (rateDiscAmt !== 0) poGroups[groupKey].rows.push({ label: 'Discount (rate)', amount: rateDiscAmt, isDiscount: true });
    if (discAmt !== 0) poGroups[groupKey].rows.push({ label: 'Discount', amount: discAmt, isDiscount: true });
  });

  localStorage.setItem('invEmailData', JSON.stringify({ poGroups, monthNameFull, monthNameShort, year }));

  const w = window.open('email.html', '_blank', 'width=1000,height=800,resizable=yes');
  if (!w) showToast('Please allow popups for this site');
}


let invModalTeam = null;

function closeInvModal() {
  document.getElementById('inv-preview-modal').classList.remove('open');
  invModalTeam = null;
}

function openInvPreviewModal(team) {
  invModalTeam = team;
  if (team === 'Selfhosting') {
    openSelfhostingPreviewModal();
    return;
  }
  const cfg = getTeamInvoiceConfig(team);
  const monthNum = invMonth;
  const monthNameFull = MONTH_NAMES_FULL[monthNum - 1];
  const monthNameShort = monthNameFull.substring(0, 3);
  const year = 2026;
  const fileName = getInvoiceFileName(team, monthNameShort, year);

  document.getElementById('inv-modal-title').textContent = team;
  document.getElementById('inv-modal-filename').textContent = fileName;

  // Build preview data (same logic as generateInvoiceFile)
  const sapHours = getSapHoursByNessId();
  const monthStart = new Date(year, monthNum - 1, 1);
  const monthEnd = new Date(year, monthNum, 0);

  const devs = developers.filter(d =>
    (d.assignments||[]).some(a => {
      if (a.team !== team) return false;
      if (a.billable === false) return false; // exclude non-billable (e.g. On-Call only assignments)
      const start = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
      const end = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
      return start <= monthEnd && end >= monthStart;
    })
  ).sort((a,b) => getDevPosition(a.id) - getDevPosition(b.id) || a.lastname.localeCompare(b.lastname));

  const devRows = devs.map((d, i) => {
    const hours = sapHours[d.nessid] || 0;
    const monthKey = MTHS[monthNum - 1];
    const rate = rates[d.id]?.[monthKey] ? parseFloat(rates[d.id][monthKey]) : 0;
    const amount = hours * rate;
    const disc = developerDiscounts.find(dd => {
      if (dd.developer_id !== d.id) return false;
      const dStart = new Date(dd.start_date);
      const dEnd = dd.end_date ? new Date(dd.end_date) : new Date('2099-12-31');
      return monthStart >= dStart && monthStart <= dEnd;
    });
    return { idx: i + 1, nessid: d.nessid, name: `${d.firstname} ${d.lastname}`, hours, rate, amount, discRate: disc?.rate || null };
  });

  const isCVS = team === 'Connected veh. ser.';
  const cvsOncall = isCVS ? calcCvsOncallRevenue(monthNum - 1) : null;
  const teamDisc = teamDiscounts.find(td => {
    if (td.team !== team) return false;
    const dStart = new Date(td.start_date);
    const dEnd = td.end_date ? new Date(td.end_date) : new Date('2099-12-31');
    return monthStart >= dStart && monthStart <= dEnd;
  });
  const teamDiscAmt = teamDisc ? (teamDiscountAmounts[teamDisc.id]?.[monthNum]?.amount || 0) : 0;

  const serviceBilling = devRows.reduce((s,r) => s + r.amount, 0)
    + devRows.reduce((s,r) => r.discRate ? s + ((r.discRate - r.rate) * r.hours) : s, 0)
    + (cvsOncall?.revenue || 0);
  const modalExtraLines = extraInvoicing.filter(e => e.team === team && e.month === monthNum && e.year === 2026);
  const modalExtraTotal = modalExtraLines.reduce((s,e) => s + parseFloat(e.value || 0), 0);
  const grandTotal = serviceBilling + teamDiscAmt + modalExtraTotal;

  // Render table
  const C = 'border:1px solid #e5e7eb;padding:7px 12px;';
  const CH = C + 'background:#f8fafc;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;';
  const CB = C + 'background:#f0f7ff;font-weight:500;';
  const CT = C + 'background:#f8fafc;font-weight:600;text-align:right;';

  let html = '';

  // Header rows
  html += `<tr><td style="${CB}color:var(--text-2)">Invoicing period:</td><td colspan="3" style="${C}font-weight:500">${monthNameFull} ${year}</td></tr>`;
  html += `<tr><td style="${CB}color:var(--text-2)">PO number</td><td colspan="3" style="${C}font-weight:500">${cfg.po}</td></tr>`;
  html += `<tr><td colspan="5" style="padding:4px;border:none;background:white"></td></tr>`;

  // Column headers
  html += `<tr>
    <th style="${CH}width:120px">Employee Id</th>
    <th style="${CH}">Employee Name</th>
    <th style="${CH}width:110px;text-align:right">Billable Hours</th>
    <th style="${CH}width:110px;text-align:right">Standard Rate</th>
    <th style="${CH}width:120px;text-align:right">Service Billing</th>
  </tr>`;

  // Developer rows
  devRows.forEach(r => {
    html += `<tr>
      <td style="${C}">${r.nessid}</td>
      <td style="${C}">${r.name}</td>
      <td style="${C}text-align:right">${r.hours.toFixed(2)}</td>
      <td style="${C}text-align:right">€${r.rate.toFixed(2)}</td>
      <td style="${C}text-align:right">€${r.amount.toFixed(2)}</td>
    </tr>`;
    if (r.discRate !== null) {
      const discAmt = (r.discRate - r.rate) * r.hours;
      html += `<tr style="background:#fff9f0">
        <td style="${C}"></td>
        <td style="${C}color:var(--amber);font-style:italic">↳ Rate discount (${r.name})</td>
        <td style="${C}text-align:right;color:var(--amber)">${r.hours.toFixed(2)}</td>
        <td style="${C}text-align:right;color:var(--amber)">€${(r.discRate - r.rate).toFixed(2)}</td>
        <td style="${C}text-align:right;color:var(--amber)">€${discAmt.toFixed(2)}</td>
      </tr>`;
    }
  });

  // CVS Oncall lines
  if (isCVS && cvsOncall) {
    html += `<tr style="background:#f5f9ff">
      <td style="${C}color:var(--blue)" colspan="2">CVS Oncall – Fixed fee</td>
      <td style="${C}"></td>
      <td style="${C}"></td>
      <td style="${C}text-align:right;color:var(--blue)">€2,200.00</td>
    </tr>`;
    if (cvsOncall.incidents > 0) {
      html += `<tr style="background:#f5f9ff">
        <td style="${C}color:var(--blue)" colspan="2">CVS Oncall – Incidents (${cvsOncall.incidents} × €240)</td>
        <td style="${C}"></td>
        <td style="${C}"></td>
        <td style="${C}text-align:right;color:var(--blue)">€${(cvsOncall.incidents * 240).toFixed(2)}</td>
      </tr>`;
    }
  }

  // Subtotal row
  html += `<tr>
    <td colspan="3" style="${CB}font-weight:600">Service Billing</td>
    <td style="${CT}">Total:</td>
    <td style="${CT}color:var(--text)">€${serviceBilling.toFixed(2)}</td>
  </tr>`;

  // Extra invoicing lines
  modalExtraLines.forEach(ei => {
    html += `<tr><td colspan="5" style="padding:4px;border:none;background:white"></td></tr>`;
    html += `<tr style="background:var(--green-lt)">
      <td colspan="3" style="${C}color:var(--green);font-style:italic">Extra: ${ei.description}</td>
      <td style="${C}"></td>
      <td style="${C}text-align:right;color:var(--green);font-weight:500">€${parseFloat(ei.value||0).toFixed(2)}</td>
    </tr>`;
  });

  // Discount section — only show if there is a non-zero discount
  if (teamDiscAmt !== 0) {
    html += `<tr><td colspan="5" style="padding:4px;border:none;background:white"></td></tr>`;
    html += `<tr>
      <td colspan="3" style="${C}">${teamDisc ? `Discount (${teamDisc.note})` : 'Discount'}</td>
      <td style="${C}"></td>
      <td style="${C}text-align:right;color:${teamDiscAmt < 0 ? 'var(--red)' : 'var(--text-3)'}">€${teamDiscAmt.toFixed(2)}</td>
    </tr>`;
    html += `<tr><td colspan="5" style="padding:4px;border:none;background:white"></td></tr>`;
    html += `<tr>
      <td colspan="4" style="${CB}font-weight:600">Discount Total</td>
      <td style="${CT}color:${teamDiscAmt < 0 ? 'var(--red)' : 'var(--text-3)'}">€${teamDiscAmt.toFixed(2)}</td>
    </tr>`;
  }

  // Grand Total
  html += `<tr style="background:#f0f7ff">
    <td colspan="4" style="${CB}font-size:13px;font-weight:700;color:var(--blue)">Grand Total</td>
    <td style="${CT}font-size:13px;color:var(--blue)">€${grandTotal.toFixed(2)}</td>
  </tr>`;

  document.getElementById('inv-modal-table').innerHTML = html;
  document.getElementById('inv-preview-modal').classList.add('open');
}

function openSelfhostingPreviewModal() {
  const monthNum = invMonth;
  const monthNameFull = MONTH_NAMES_FULL[monthNum - 1];
  const monthNameShort = monthNameFull.substring(0, 3);
  const year = 2026;
  const fileName = `HERE_InvData_${monthNameShort}-${year}_Selfhosting_PO50019177.xlsx`;

  document.getElementById('inv-modal-title').textContent = 'Selfhosting';
  document.getElementById('inv-modal-filename').textContent = fileName;

  const fixed = selfhostingServices.filter(s => s.type === 'fixed');
  const releases = selfhostingServices.filter(s => s.type === 'release');
  const releaseRate = releases.length ? parseFloat(releases[0].rate) : 3930;
  const m = monthNum;
  const fcst = selfhostingForecast[m] || {releases: 0};
  const hasActuals = releases.some(s => (selfhostingActuals[s.id]?.[m] || 0) > 0);

  const C  = 'border:1px solid #e5e7eb;padding:7px 12px;';
  const CH = C + 'background:#f8fafc;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;';
  const CB = C + 'background:#f0f7ff;font-weight:500;';

  let html = '';
  html += `<tr><td style="${CB}color:var(--text-2)">Invoicing period:</td><td colspan="2" style="${C}font-weight:500">${monthNameFull} ${year}</td></tr>`;
  html += `<tr><td style="${CB}color:var(--text-2)">PO number</td><td colspan="2" style="${C}font-weight:500">50019177</td></tr>`;
  html += `<tr><td colspan="3" style="padding:4px;border:none;background:white"></td></tr>`;
  html += `<tr>
    <th style="${CH}">Service / Description</th>
    <th style="${CH}width:80px;text-align:right">Qty</th>
    <th style="${CH}width:140px;text-align:right">Amount</th>
  </tr>`;

  let total = 0;

  fixed.forEach((s, idx) => {
    const amt = parseFloat(s.rate);
    total += amt;
    const bg = idx % 2 === 0 ? '' : 'background:#f9fafb;';
    html += `<tr style="${bg}">
      <td style="${C}">${s.name}</td>
      <td style="${C}text-align:right">1</td>
      <td style="${C}text-align:right;font-weight:500">€${amt.toFixed(2)}</td>
    </tr>`;
  });

  let relIdx = fixed.length;
  releases.forEach(s => {
    const count = hasActuals ? (selfhostingActuals[s.id]?.[m] || 0) : (fcst.releases || 0);
    if (count === 0) return;
    const amt = count * releaseRate;
    total += amt;
    const bg = relIdx % 2 === 0 ? '' : 'background:#f9fafb;';
    html += `<tr style="${bg}">
      <td style="${C}">${s.name}</td>
      <td style="${C}text-align:right">${count}</td>
      <td style="${C}text-align:right;font-weight:500">€${amt.toFixed(2)}</td>
    </tr>`;
    relIdx++;
  });

  html += `<tr><td colspan="3" style="padding:4px;border:none;background:white"></td></tr>`;
  html += `<tr style="background:#f0f7ff">
    <td colspan="2" style="${CB}font-size:13px;font-weight:700;color:var(--blue)">Grand Total</td>
    <td style="${C}text-align:right;font-size:13px;font-weight:700;color:var(--blue)">€${total.toFixed(2)}</td>
  </tr>`;

  document.getElementById('inv-modal-table').innerHTML = html;
  document.getElementById('inv-preview-modal').classList.add('open');
}

async function generateSelfhostingInvoiceFile(monthNum, monthNameShort, year, periodStr) {
  const fixed = selfhostingServices.filter(s => s.type === 'fixed');
  const releases = selfhostingServices.filter(s => s.type === 'release');
  const releaseRate = releases.length ? parseFloat(releases[0].rate) : 3930;
  const m = monthNum;
  const fcst = selfhostingForecast[m] || {releases: 0};
  const hasActuals = releases.some(s => (selfhostingActuals[s.id]?.[m] || 0) > 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'HERE DM Tools';
  const ws = wb.addWorksheet('Invoice');
  ws.columns = [{ key: 'a', width: 40 }, { key: 'b', width: 12 }, { key: 'c', width: 18 }];

  const BLUE_BG  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  const GREY_BG  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  const WHITE_BG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  const GRAND_BG = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  const WHITE_BOLD = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  const NORMAL = { name: 'Arial', size: 10 };
  const BOLD   = { name: 'Arial', bold: true, size: 10 };
  const thin = { style: 'thin', color: { argb: 'FFE5E7EB' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const eurFmt = '#,##0.00 €;-#,##0.00 €';

  const r1 = ws.addRow(['Invoicing period:', periodStr, '']);
  r1.getCell(1).font = BOLD; r1.getCell(2).font = NORMAL; r1.height = 18;
  const r2 = ws.addRow(['PO number', '50019177', '']);
  r2.getCell(1).font = BOLD; r2.getCell(2).font = NORMAL; r2.height = 18;
  ws.addRow([]); ws.addRow([]);

  const hdr = ws.addRow(['Service / Description', 'Qty', 'Amount']);
  hdr.height = 22;
  hdr.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > 3) return;
    cell.fill = BLUE_BG; cell.font = WHITE_BOLD; cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: col >= 2 ? 'right' : 'left' };
  });

  let total = 0;
  let rowIdx = 0;

  fixed.forEach(s => {
    const amt = parseFloat(s.rate);
    total += amt;
    const row = ws.addRow([s.name, 1, amt]);
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 3) return;
      cell.fill = rowIdx % 2 === 0 ? WHITE_BG : GREY_BG;
      cell.font = NORMAL; cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: col >= 2 ? 'right' : 'left' };
      if (col === 3) cell.numFmt = eurFmt;
    });
    rowIdx++;
  });

  releases.forEach(s => {
    const count = hasActuals ? (selfhostingActuals[s.id]?.[m] || 0) : (fcst.releases || 0);
    if (count === 0) return;
    const amt = count * releaseRate;
    total += amt;
    const row = ws.addRow([s.name, count, amt]);
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > 3) return;
      cell.fill = rowIdx % 2 === 0 ? WHITE_BG : GREY_BG;
      cell.font = NORMAL; cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: col >= 2 ? 'right' : 'left' };
      if (col === 3) cell.numFmt = eurFmt;
    });
    rowIdx++;
  });

  ws.addRow([]);
  const gt = ws.addRow(['Grand Total', '', total]);
  gt.height = 22;
  gt.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > 3) return;
    cell.fill = GRAND_BG;
    cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.border = border;
    cell.alignment = { vertical: 'middle', horizontal: col === 3 ? 'right' : 'left' };
    if (col === 3) cell.numFmt = eurFmt;
  });

  const fileName = `HERE_InvData_${monthNameShort}-${year}_Selfhosting_PO50019177.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}


async function generateSingleInvoice() {
  if (!invModalTeam) return;
  const monthNum = invMonth;
  const monthNameFull = MONTH_NAMES_FULL[monthNum - 1];
  const monthNameShort = monthNameFull.substring(0, 3);
  const lastDay = new Date(2026, monthNum, 0).getDate();
  const periodStr = `${monthNameFull} 2026`;
  const dateStr = `${lastDay}-${monthNameShort} 2026`;
  if (invModalTeam === 'Selfhosting') {
    await generateSelfhostingInvoiceFile(monthNum, monthNameShort, 2026, periodStr);
    showToast(`Downloaded: HERE_InvData_${monthNameShort}-2026_Selfhosting_PO50019177.xlsx`);
    return;
  }
  const sapHours = getSapHoursByNessId();
  await generateInvoiceFile(invModalTeam, monthNum, monthNameShort, 2026, periodStr, dateStr, sapHours);
  showToast(`Downloaded: ${getInvoiceFileName(invModalTeam, monthNameShort, 2026)}`);
}


// ============================================================
// EXTRA INVOICING MODULE
// ============================================================
let extraInvoicing = [];
let editingExtraInvoicingId = null;

async function loadExtraInvoicing() {
  const { data, error } = await db.from('extra_invoicing').select('*').order('month').order('team');
  if (error) { console.error('loadExtraInvoicing:', error); return; }
  extraInvoicing = data || [];
}

function renderExtraInvoicing() {
  const body = document.getElementById('extra-invoicing-body');
  if (!body) return;
  if (!extraInvoicing.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No extra invoicing lines yet</td></tr>';
    return;
  }
  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  body.innerHTML = extraInvoicing.map(e => `
    <tr>
      <td style="font-weight:500">${e.team}</td>
      <td>${MTH[(e.month||1)-1]} 2026</td>
      <td>${e.description||'—'}</td>
      <td style="text-align:right;font-weight:500">€${parseFloat(e.value||0).toFixed(2)}</td>
      <td style="text-align:right">
        <button class="btn" style="font-size:11px;padding:3px 10px" onclick="openExtraInvoicingModal('${e.id}')">Edit</button>
      </td>
    </tr>
  `).join('');
}

function openExtraInvoicingModal(id) {
  editingExtraInvoicingId = id;
  const e = id ? extraInvoicing.find(x => x.id === id) : null;

  document.getElementById('extra-invoicing-modal-title').textContent = id ? 'Edit extra invoicing line' : 'Add extra invoicing line';
  document.getElementById('btn-ei-delete').style.display = id ? '' : 'none';

  // Populate team dropdown
  const sel = document.getElementById('ei-team');
  const allTeams = [...EU_TEAMS, ...IND_TEAMS].filter(t => t !== 'Selfhosting');
  sel.innerHTML = '<option value="">Select team...</option>' +
    allTeams.map(t => `<option value="${t}"${e?.team === t ? ' selected' : ''}>${t}</option>`).join('');

  document.getElementById('ei-month').value = e?.month || '';
  document.getElementById('ei-description').value = e?.description || '';
  document.getElementById('ei-value').value = e?.value || '';

  document.getElementById('extra-invoicing-modal').classList.add('open');
}

async function saveExtraInvoicing() {
  const team = document.getElementById('ei-team').value;
  const month = parseInt(document.getElementById('ei-month').value);
  const description = document.getElementById('ei-description').value.trim();
  const value = parseFloat(document.getElementById('ei-value').value);

  if (!team) { showToast('Please select a team'); return; }
  if (!month) { showToast('Please select a month'); return; }
  if (!description) { showToast('Please enter a description'); return; }
  if (isNaN(value)) { showToast('Please enter a valid value'); return; }

  const payload = { team, month, description, value, year: 2026 };

  if (editingExtraInvoicingId) {
    const { error } = await db.from('extra_invoicing').update(payload).eq('id', editingExtraInvoicingId);
    if (error) { showToast('Error saving: ' + error.message); return; }
    const idx = extraInvoicing.findIndex(x => x.id === editingExtraInvoicingId);
    if (idx >= 0) extraInvoicing[idx] = { ...extraInvoicing[idx], ...payload };
  } else {
    const { data, error } = await db.from('extra_invoicing').insert(payload).select().single();
    if (error) { showToast('Error saving: ' + error.message); return; }
    extraInvoicing.push(data);
  }

  document.getElementById('extra-invoicing-modal').classList.remove('open');
  renderExtraInvoicing();
  showToast('Saved');
}

async function deleteExtraInvoicing() {
  if (!editingExtraInvoicingId) return;
  if (!confirm('Delete this extra invoicing line?')) return;
  const { error } = await db.from('extra_invoicing').delete().eq('id', editingExtraInvoicingId);
  if (error) { showToast('Error: ' + error.message); return; }
  extraInvoicing = extraInvoicing.filter(x => x.id !== editingExtraInvoicingId);
  document.getElementById('extra-invoicing-modal').classList.remove('open');
  renderExtraInvoicing();
  showToast('Deleted');
}