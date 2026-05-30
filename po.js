// ============================================================
// PURCHASE ORDERS MODULE
// ============================================================

let purchaseOrders = [];
let purchaseOrderLines = [];
let poView = 'hours';   // 'hours' | 'value'
let poScope = 'invoiced'; // 'invoiced' | 'forecasted'

function switchPOView(v) {
  poView = v;
  document.getElementById('btn-po-hours').classList.toggle('active', v === 'hours');
  document.getElementById('btn-po-value').classList.toggle('active', v === 'value');
  const th = document.getElementById('po-th-used');
  if (th) th.textContent = v === 'hours' ? 'Hours Used / Auth.' : 'Value Used / Auth.';
  expandedDrillLineId = null;
  renderPOList();
}

function switchPOScope(s) {
  poScope = s;
  document.getElementById('btn-po-invoiced').classList.toggle('active', s === 'invoiced');
  document.getElementById('btn-po-forecasted').classList.toggle('active', s === 'forecasted');
  expandedDrillLineId = null;
  renderPOList();
}

// Returns all teams covered by this PO (primary + linked)
function getPoTeams(po) {
  const extra = (po.linked_teams || '').split(',').map(t => t.trim()).filter(Boolean);
  return [po.team, ...extra];
}

// A month is "invoiced" (locked) if any active developer has tmsh hours for it
function isMonthInvoiced(month) {
  return developers.some(d =>
    (d.assignments||[]).some(a => a.team) &&
    actualHours[String(d.id)]?.[month]?.source === 'tmsh'
  );
}

// Get hours for a developer for a month in a team — invoiced or forecasted
// Invoiced: only tmsh actual hours
// Forecasted: actual hours if present, else calcRevenue forecast
function getDevHoursForMonth(dev, month, team) {
  if (poScope === 'invoiced') {
    if (!isMonthInvoiced(month)) return 0;
    const ah = actualHours[String(dev.id)]?.[month];
    return (ah?.source === 'tmsh' && ah.hours) ? parseFloat(ah.hours) : 0;
  } else {
    // Forecasted: use calcRevenue which handles actual/manual/forecast fallback
    const result = calcRevenue(dev, month - 1, team);
    return result.hours != null ? parseFloat(result.hours) : 0;
  }
}

async function loadPurchaseOrders() {
  const [r1, r2] = await Promise.all([
    db.from('purchase_orders').select('*').order('po_date', { ascending: false }),
    db.from('purchase_order_lines').select('*').order('line_number')
  ]);
  purchaseOrders = r1.data || [];
  purchaseOrderLines = r2.data || [];
}

function getPOLines(poId) {
  return purchaseOrderLines.filter(l => l.po_id === poId);
}


// Get hours for a PO line — respects poScope (invoiced/forecasted)
function getInvoicedHours(po, line) {
  if (!line.qty_hours) return 0;
  const poTeams = getPoTeams(po);
  const loc = line.location;
  const lineRate = parseFloat(line.unit_price);

  const poStart = new Date(po.start_date);
  const poEnd = new Date(po.end_date);
  const year2026Start = new Date('2026-01-01');
  const year2026End = new Date('2026-12-31');
  const trackStart = poStart < year2026Start ? year2026Start : poStart;
  const trackEnd = poEnd > year2026End ? year2026End : poEnd;
  const startMonth = trackStart.getMonth() + 1;
  const endMonth = trackEnd.getMonth() + 1;

  let totalHours = 0;
  developers.forEach(dev => {
    const bl = dev.billing_location || (() => {
      const l2 = locations.find(l => l.id === dev.location_id);
      const n = l2?.name || '';
      if (n === 'Slovakia') return 'SVK';
      if (n === 'Romania') return 'ROM';
      if (n === 'Latvia') return 'LAT';
      if (n.startsWith('India')) return 'IND';
      return 'SVK';
    })();
    if (bl !== loc) return;

    const devRates = rates[dev.id] || {};
    for (let m = startMonth; m <= endMonth; m++) {
      const active = getActiveAssignments(dev, 2026, m)
        .filter(a => a.billable !== false && poTeams.includes(a.team));
      if (!active.length) continue;
      const devRate = parseFloat(devRates[MTHS[m-1]]);
      if (isNaN(devRate) || Math.round(devRate * 100) !== Math.round(lineRate * 100)) continue;
      totalHours += getDevHoursForMonth(dev, m, active[0].team);
    }
  });

  return Math.round(totalHours * 100) / 100;
}

// Get hours broken down per developer per month — respects poScope
function getInvoicedHoursPerDev(po, line) {
  if (!line.qty_hours) return [];
  const poTeams = getPoTeams(po);
  const loc = line.location;
  const lineRate = parseFloat(line.unit_price);

  const poStart = new Date(po.start_date);
  const poEnd = new Date(po.end_date);
  const year2026Start = new Date('2026-01-01');
  const year2026End = new Date('2026-12-31');
  const trackStart = poStart < year2026Start ? year2026Start : poStart;
  const trackEnd = poEnd > year2026End ? year2026End : poEnd;
  const startMonth = trackStart.getMonth() + 1;
  const endMonth = trackEnd.getMonth() + 1;

  const result = [];
  developers.forEach(dev => {
    const bl = dev.billing_location || (() => {
      const l2 = locations.find(l => l.id === dev.location_id);
      const n = l2?.name || '';
      if (n === 'Slovakia') return 'SVK';
      if (n === 'Romania') return 'ROM';
      if (n === 'Latvia') return 'LAT';
      if (n.startsWith('India')) return 'IND';
      return 'SVK';
    })();
    if (bl !== loc) return;

    const devRates = rates[dev.id] || {};
    const monthHours = {};
    for (let m = startMonth; m <= endMonth; m++) {
      const active = getActiveAssignments(dev, 2026, m)
        .filter(a => a.billable !== false && poTeams.includes(a.team));
      if (!active.length) { monthHours[m] = 0; continue; }
      const devRate = parseFloat(devRates[MTHS[m-1]]);
      if (isNaN(devRate) || Math.round(devRate * 100) !== Math.round(lineRate * 100)) { monthHours[m] = 0; continue; }
      monthHours[m] = Math.round(getDevHoursForMonth(dev, m, active[0].team) * 100) / 100;
    }
    const total = Object.values(monthHours).reduce((s, h) => s + h, 0);
    if (total > 0) result.push({ dev, monthHours, total });
  });
  return result;
}


// ── Discount lines ────────────────────────────────────────────────────────
// Aggregate developer + team discounts for all teams in PO for a given month
function getDiscountForPOMonth(po, month) {
  const poTeams = getPoTeams(po);
  let total = 0;

  poTeams.forEach(team => {
    // Developer rate discounts
    developers.forEach(dev => {
      const active = getActiveAssignments(dev, 2026, month)
        .filter(a => a.billable !== false && a.team === team);
      if (!active.length) return;
      const r = calcRevenue(dev, month - 1, team);
      if (r.discountAmt) total += r.discountAmt;
    });

    // Team discounts
    getActiveTeamDiscounts(team, 2026, month).forEach(disc => {
      const val = teamDiscountAmounts[disc.id]?.[month]?.amount || 0;
      if (val) total += val;
    });
  });

  return Math.round(total * 100) / 100;
}

// Get total discount value for a PO line with catalog_role='discount'
function getDiscountValue(po) {
  const poStart = new Date(po.start_date);
  const poEnd = new Date(po.end_date);
  const year2026Start = new Date('2026-01-01');
  const year2026End = new Date('2026-12-31');
  const trackStart = poStart < year2026Start ? year2026Start : poStart;
  const trackEnd = poEnd > year2026End ? year2026End : poEnd;
  const startMonth = trackStart.getMonth() + 1;
  const endMonth = trackEnd.getMonth() + 1;

  let total = 0;
  for (let m = startMonth; m <= endMonth; m++) {
    if (poScope === 'invoiced' && !isMonthInvoiced(m)) continue;
    total += getDiscountForPOMonth(po, m);
  }
  return Math.round(total * 100) / 100;
}

// Get discount per month — for drill-down
function getDiscountValuePerMonth(po) {
  const poStart = new Date(po.start_date);
  const poEnd = new Date(po.end_date);
  const year2026Start = new Date('2026-01-01');
  const year2026End = new Date('2026-12-31');
  const trackStart = poStart < year2026Start ? year2026Start : poStart;
  const trackEnd = poEnd > year2026End ? year2026End : poEnd;
  const startMonth = trackStart.getMonth() + 1;
  const endMonth = trackEnd.getMonth() + 1;

  const monthValues = {};
  for (let m = startMonth; m <= endMonth; m++) {
    if (poScope === 'invoiced' && !isMonthInvoiced(m)) { monthValues[m] = 0; continue; }
    monthValues[m] = getDiscountForPOMonth(po, m);
  }
  return monthValues;
}

// Get CVS Oncall value for a month range — respects poScope
function getOncallValue(po, line) {
  const poStart = new Date(po.start_date);
  const poEnd = new Date(po.end_date);
  const year2026Start = new Date('2026-01-01');
  const year2026End = new Date('2026-12-31');
  const trackStart = poStart < year2026Start ? year2026Start : poStart;
  const trackEnd = poEnd > year2026End ? year2026End : poEnd;
  const startMonth = trackStart.getMonth() + 1;
  const endMonth = trackEnd.getMonth() + 1;

  let total = 0;
  for (let m = startMonth; m <= endMonth; m++) {
    if (poScope === 'invoiced' && !isMonthInvoiced(m)) continue;
    total += calcCvsOncallRevenue(m - 1).revenue;
  }
  return Math.round(total * 100) / 100;
}

// Get CVS Oncall value broken down per month — for drill-down
function getOncallValuePerMonth(po, line) {
  const poStart = new Date(po.start_date);
  const poEnd = new Date(po.end_date);
  const year2026Start = new Date('2026-01-01');
  const year2026End = new Date('2026-12-31');
  const trackStart = poStart < year2026Start ? year2026Start : poStart;
  const trackEnd = poEnd > year2026End ? year2026End : poEnd;
  const startMonth = trackStart.getMonth() + 1;
  const endMonth = trackEnd.getMonth() + 1;

  const monthValues = {};
  for (let m = startMonth; m <= endMonth; m++) {
    if (poScope === 'invoiced' && !isMonthInvoiced(m)) { monthValues[m] = 0; continue; }
    monthValues[m] = Math.round(calcCvsOncallRevenue(m - 1).revenue * 100) / 100;
  }
  return monthValues;
}

function getInvoicedValue(po, line) {
  if (line.catalog_role === 'oncall') return getOncallValue(po, line);
  if (line.catalog_role === 'discount') return getDiscountValue(po);
  const lineRate = parseFloat(line.unit_price) || 0;
  return getInvoicedHours(po, line) * lineRate;
}

function getInvoicedValuePerDev(po, line) {
  // Oncall — single row with month values
  if (line.catalog_role === 'oncall') {
    const monthValues = getOncallValuePerMonth(po, line);
    const total = Object.values(monthValues).reduce((s, v) => s + v, 0);
    if (total === 0) return [];
    return [{ dev: { firstname: 'CVS', lastname: 'Oncall' }, monthValues, total }];
  }
  // Discount — single row with month values
  if (line.catalog_role === 'discount') {
    const monthValues = getDiscountValuePerMonth(po);
    const total = Object.values(monthValues).reduce((s, v) => s + v, 0);
    if (total === 0) return [];
    return [{ dev: { firstname: 'Discount', lastname: '' }, monthValues, total }];
  }
  const lineRate = parseFloat(line.unit_price) || 0;
  return getInvoicedHoursPerDev(po, line).map(r => {
    const monthValues = {};
    Object.entries(r.monthHours).forEach(([m, h]) => { monthValues[m] = Math.round(h * lineRate * 100) / 100; });
    const total = Math.round(r.total * lineRate * 100) / 100;
    return { dev: r.dev, monthValues, total };
  });
}

let expandedPoId = null;
let expandedDrillLineId = null;

async function renderPO() {
  const container = document.getElementById('po-content');
  if (!container) return;
  if (!purchaseOrders.length) await loadPurchaseOrders();
  renderPOList();
}

function renderPOList() {
  const tbody = document.getElementById('po-tbody');
  if (!tbody) return;

  if (!purchaseOrders.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No purchase orders yet — click "+ Add PO" to start</td></tr>';
    return;
  }

  let html = '';
  const sorted = [...purchaseOrders].sort((a,b) => (a.position||999) - (b.position||999));
  sorted.forEach(po => {
    const lines = getPOLines(po.id);
    const isExpanded = expandedPoId === po.id;
    const pctColor = v => v >= 90 ? 'var(--red)' : v >= 75 ? 'var(--amber,#D97706)' : 'var(--green)';

    // Hours view totals
    const totalQtyHours = lines.reduce((s, l) => s + (parseFloat(l.qty_hours) || 0), 0);
    const totalBefore2026h = lines.reduce((s, l) => s + (parseFloat(l.hours_before_2026) || 0), 0);
    const totalInvoiced2026h = po.po_type === 'tm' ? lines.reduce((s, l) => s + getInvoicedHours(po, l), 0) : 0;
    const totalUsedH = totalBefore2026h + totalInvoiced2026h;
    const pctH = totalQtyHours > 0 ? Math.round(totalUsedH / totalQtyHours * 100) : 0;

    // Value view totals
    const tmLinesSum = lines.filter(l => l.catalog_role !== 'oncall' && l.catalog_role !== 'discount');
    const totalAuthorized = tmLinesSum.reduce((s, l) => s + ((parseFloat(l.qty_hours)||0) * (parseFloat(l.unit_price)||0)), 0);
    const totalBefore2026v = tmLinesSum.reduce((s, l) => s + ((parseFloat(l.hours_before_2026)||0) * (parseFloat(l.unit_price)||0)), 0)
      + lines.filter(l => l.catalog_role === 'discount').reduce((s,l) => s - (parseFloat(l.hours_before_2026)||0), 0);
    const totalInvoiced2026v = po.po_type === 'tm'
      ? lines.reduce((s, l) => s + getInvoicedValue(po, l), 0)
      : po.po_type === 'fixed' ? (() => {
          const poStart = new Date(po.start_date);
          const poEnd = new Date(po.end_date);
          const trackStart = poStart < new Date('2026-01-01') ? new Date('2026-01-01') : poStart;
          const trackEnd = poEnd > new Date('2026-12-31') ? new Date('2026-12-31') : poEnd;
          let tot = 0;
          for (let m = trackStart.getMonth()+1; m <= trackEnd.getMonth()+1; m++) {
            if (poScope === 'invoiced' && !isMonthInvoiced(m)) continue;
            tot += calcSelfhostingRevenue(m-1).revenue || 0;
          }
          return Math.round(tot * 100) / 100;
        })()
      : 0;
    const totalAuthorizedFixed = po.po_type === 'fixed' ? (parseFloat(po.total_value) || 0) : totalAuthorized;
    const totalUsedV = totalBefore2026v + totalInvoiced2026v;
    const pctV = totalAuthorizedFixed > 0 ? Math.round(totalUsedV / totalAuthorizedFixed * 100) : 0;

    const usedStr = poView === 'hours'
      ? (po.po_type === 'tm' ? `${totalUsedH.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}h / ${totalQtyHours.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}h` : '—')
      : `€${totalUsedV.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})} / €${totalAuthorizedFixed.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const pct = poView === 'hours' ? pctH : pctV;

    const periodStr = po.start_date && po.end_date
      ? `${po.start_date.substring(0,7)} → ${po.end_date.substring(0,7)}`
      : '—';

    const today = new Date(); today.setHours(0,0,0,0);
    const start = po.start_date ? new Date(po.start_date) : null;
    const end   = po.end_date   ? new Date(po.end_date)   : null;
    const poStatus = !start || !end ? null
      : today < start ? 'future'
      : today > end   ? 'expired'
      : 'active';
    const statusBadge = poStatus === 'active'
      ? `<span style="font-size:10px;padding:1px 7px;border-radius:99px;background:#DCFCE7;color:#15803D;font-weight:500;margin-left:6px">In execution</span>`
      : poStatus === 'future'
      ? `<span style="font-size:10px;padding:1px 7px;border-radius:99px;background:#DBEAFE;color:#1D4ED8;font-weight:500;margin-left:6px">Future</span>`
      : poStatus === 'expired'
      ? `<span style="font-size:10px;padding:1px 7px;border-radius:99px;background:#FEE2E2;color:#B91C1C;font-weight:500;margin-left:6px">Expired</span>`
      : '';

    html += `<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="togglePODetail('${po.id}')">
      <td style="padding:4px 8px;text-align:center;white-space:nowrap;width:60px" onclick="event.stopPropagation()">
        <button onclick="movePO('${po.id}','up')" style="border:none;background:none;cursor:pointer;padding:2px 3px;color:var(--text-2);font-size:13px">▲</button><button onclick="movePO('${po.id}','down')" style="border:none;background:none;cursor:pointer;padding:2px 3px;color:var(--text-2);font-size:13px">▼</button>
      </td>
      <td style="padding:8px 12px;font-weight:500">${po.po_number}${statusBadge}</td>
      <td style="padding:8px 12px">${po.team || '—'}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--text-2)">${periodStr}</td>
      <td style="padding:8px 12px;text-align:right">
        <span style="font-size:11px;padding:2px 7px;border-radius:99px;background:${po.po_type==='fixed'?'#FFF7ED':'#EEF2FF'};color:${po.po_type==='fixed'?'#C2410C':'#4338CA'}">${po.po_type==='fixed'?'Fixed':'T&M'}</span>
      </td>
      <td style="padding:8px 12px;text-align:right;font-weight:500">€${(po.total_value||0).toLocaleString('de-DE',{minimumFractionDigits:0,maximumFractionDigits:0})}</td>
      <td style="padding:8px 12px;text-align:right;color:var(--text-2)">
        ${usedStr}
      </td>
      <td style="padding:8px 12px;text-align:right">
        ${(po.po_type === 'tm' || (po.po_type === 'fixed' && poView === 'value')) ? `<span style="font-weight:600;color:${pctColor(pct)}">${pct}%</span>` : '—'}
      </td>
      <td style="padding:8px 12px;text-align:center">
        <button class="btn" onclick="event.stopPropagation();openEditPO('${po.id}')" style="padding:3px 8px;font-size:11px">Edit</button>
      </td>
    </tr>`;

    if (isExpanded) {
      html += renderPODetailRow(po);
    }
  });

  tbody.innerHTML = html;
}

function togglePODetail(poId) {
  expandedPoId = expandedPoId === poId ? null : poId;
  expandedDrillLineId = null;
  renderPOList();
}

function toggleDrillDown(lineId) {
  expandedDrillLineId = expandedDrillLineId === lineId ? null : lineId;
  renderPOList();
}

const PO_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderDrillDownRow(po, line, startMonth, endMonth) {
  const isValue = poView === 'value';
  const devRows = isValue ? getInvoicedValuePerDev(po, line) : getInvoicedHoursPerDev(po, line);
  const months = [];
  for (let m = startMonth; m <= endMonth; m++) months.push(m);

  if (!devRows.length) {
    return `<tr style="background:var(--bg-2,#F8FAFC)">
      <td colspan="10" style="padding:8px 24px;font-size:12px;color:var(--text-3);font-style:italic">
        No developers matched for this line
      </td>
    </tr>`;
  }

  const getVal = (row, m) => {
    if (isValue) return row.monthValues?.[m] ?? row.monthValues?.[String(m)] ?? 0;
    return row.monthHours?.[m] ?? row.monthHours?.[String(m)] ?? 0;
  };
  const fmt = v => isValue
    ? `€${v.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})}`
    : `${v.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})}h`;

  // Column totals per month
  const monthTotals = {};
  months.forEach(m => {
    monthTotals[m] = devRows.reduce((s, r) => s + getVal(r, m), 0);
  });
  const grandTotal = devRows.reduce((s, r) => s + r.total, 0);

  // Build header
  let th = `<tr style="background:var(--bg-2,#F0F4FF);font-size:11px;color:var(--text-3)">
    <td colspan="2" style="padding:5px 12px;font-weight:600;color:var(--blue);font-size:11px">
      🔍 ${line.description} — ${isValue ? 'value' : 'hours'} breakdown
    </td>`;
  months.forEach(m => {
    th += `<td style="text-align:right;padding:5px 8px;font-weight:500;min-width:52px">${PO_MONTH_NAMES[m-1]}</td>`;
  });
  th += `<td style="text-align:right;padding:5px 10px;font-weight:600">Total</td></tr>`;

  // Dev rows
  let rows = '';
  devRows.forEach(row => {
    const name = `${row.dev.firstname} ${row.dev.lastname}`;
    rows += `<tr style="border-top:1px solid var(--border);font-size:12px">
      <td colspan="2" style="padding:4px 12px 4px 24px;color:var(--text-2)">${name}</td>`;
    months.forEach(m => {
      const v = getVal(row, m);
      const nonZero = v !== 0;
      const color = v > 0 ? 'inherit' : v < 0 ? '#c62828' : 'var(--text-3)';
      rows += `<td style="text-align:right;padding:4px 8px;color:${color}">${nonZero ? fmt(v) : '—'}</td>`;
    });
    rows += `<td style="text-align:right;padding:4px 10px;font-weight:500">${fmt(row.total)}</td></tr>`;
  });

  // Totals row
  let totRow = `<tr style="border-top:2px solid var(--border);background:var(--bg-2,#F0F4FF);font-size:12px;font-weight:600">
    <td colspan="2" style="padding:5px 12px">Total</td>`;
  months.forEach(m => {
    const t = monthTotals[m];
    const tColor = t > 0 ? 'inherit' : t < 0 ? '#c62828' : 'var(--text-3)';
    totRow += `<td style="text-align:right;padding:5px 8px;color:${tColor}">${t !== 0 ? fmt(t) : '—'}</td>`;
  });
  totRow += `<td style="text-align:right;padding:5px 10px;color:var(--green)">${fmt(grandTotal)}</td></tr>`;

  return `<tr style="background:var(--bg-2,#F8FAFC)">
    <td colspan="10" style="padding:0;border-top:1px solid var(--blue)">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          ${th}${rows}${totRow}
        </table>
      </div>
    </td>
  </tr>`;
}

function renderPOSelfhostingDetail(po) {
  // Guard: selfhosting data must be loaded
  if (typeof calcSelfhostingRevenue !== 'function') {
    return '<tr><td colspan="9" style="padding:12px 24px;color:var(--text-2)">Selfhosting data not loaded. Try reloading.</td></tr>';
  }
  if (!selfhostingServices || !selfhostingServices.length) {
    return '<tr><td colspan="9" style="padding:12px 24px;color:var(--text-2)">No Selfhosting services configured.</td></tr>';
  }

  const poStart = new Date(po.start_date);
  const poEnd = new Date(po.end_date);
  const year2026Start = new Date('2026-01-01');
  const year2026End = new Date('2026-12-31');
  const trackStart = poStart < year2026Start ? year2026Start : poStart;
  const trackEnd = poEnd > year2026End ? year2026End : poEnd;
  const startMonth = trackStart.getMonth() + 1;
  const endMonth = trackEnd.getMonth() + 1;

  const fmtV = v => `€${v.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  const typeColor = t => t === 'tmsh' ? 'var(--green)' : t === 'manual' ? 'var(--amber,#D97706)' : 'var(--blue)';

  // Hours view — no data, just info message
  if (poView === 'hours') {
    return '<tr><td colspan="9" style="padding:12px 24px;font-size:13px;color:var(--text-2)">Fixed price PO — switch to <strong>Value</strong> view to see Selfhosting revenue.</td></tr>';
  }

  // Value view — month × revenue table
  const months = [];
  for (let m = startMonth; m <= endMonth; m++) months.push(m);

  let totalInvoiced = 0;
  let totalForecast = 0;

  // Build month data
  const monthData = months.map(m => {
    const result = calcSelfhostingRevenue(m - 1);
    const include = poScope === 'invoiced' ? result.isLocked : true;
    return {
      m,
      result: {
        revenue:    parseFloat(result.revenue)    || 0,
        fixedRev:   parseFloat(result.fixedRev)   || 0,
        releaseRev: parseFloat(result.releaseRev) || 0,
        type:       result.type || 'utilization',
        isLocked:   result.isLocked || false
      },
      include
    };
  });

  // Header
  let html = `<div style="overflow-x:auto;padding:8px 0">
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="color:var(--text-3);font-size:11px;background:var(--bg)">
          <th style="text-align:left;padding:6px 16px;width:160px">Component</th>`;
  months.forEach(m => {
    html += `<th style="text-align:right;padding:6px 8px;min-width:80px">${PO_MONTH_NAMES[m-1]}</th>`;
  });
  html += `<th style="text-align:right;padding:6px 16px;min-width:90px">Total</th></tr></thead><tbody>`;

  // Fixed fee row
  let fixedTotal = 0;
  html += `<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:6px 16px;color:var(--text-2)">Fixed fee</td>`;
  monthData.forEach(({m, result, include}) => {
    const v = include ? result.fixedRev : 0;
    fixedTotal += v;
    html += `<td style="text-align:right;padding:6px 8px;color:${include ? typeColor(result.type) : 'var(--text-3)'}">${include ? fmtV(v) : '—'}</td>`;
  });
  html += `<td style="text-align:right;padding:6px 16px;font-weight:500">${fmtV(fixedTotal)}</td></tr>`;

  // Releases row
  let relTotal = 0;
  html += `<tr style="border-bottom:1px solid var(--border)">
    <td style="padding:6px 16px;color:var(--text-2)">Releases</td>`;
  monthData.forEach(({m, result, include}) => {
    const v = include ? result.releaseRev : 0;
    relTotal += v;
    html += `<td style="text-align:right;padding:6px 8px;color:${include ? typeColor(result.type) : 'var(--text-3)'}">${include && v > 0 ? fmtV(v) : '—'}</td>`;
  });
  html += `<td style="text-align:right;padding:6px 16px;font-weight:500">${relTotal > 0 ? fmtV(relTotal) : '—'}</td></tr>`;

  // Total row
  let grandTotal = 0;
  html += `<tr style="background:var(--bg);font-weight:600;border-top:2px solid var(--border)">
    <td style="padding:6px 16px">Total</td>`;
  monthData.forEach(({m, result, include}) => {
    const v = include ? result.revenue : 0;
    grandTotal += v;
    html += `<td style="text-align:right;padding:6px 8px;color:${include ? typeColor(result.type) : 'var(--text-3)'}">${include ? fmtV(v) : '—'}</td>`;
  });
  html += `<td style="text-align:right;padding:6px 16px;color:var(--green)">${fmtV(grandTotal)}</td></tr>`;

  // Progress vs authorized
  const authorized = parseFloat(po.total_value) || 0;
  const pct = authorized > 0 ? Math.round(grandTotal / authorized * 100) : 0;
  const pctColor = pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--amber,#D97706)' : 'var(--green)';
  const barColor = pct >= 90 ? '#EF4444' : pct >= 75 ? '#D97706' : '#1D9E75';

  html += `</tbody></table>
    <div style="display:flex;align-items:center;gap:16px;padding:10px 16px;border-top:1px solid var(--border);font-size:12px">
      <div style="color:var(--text-2)">Authorized: <strong>${fmtV(authorized)}</strong></div>
      <div style="color:var(--text-2)">${poScope === 'invoiced' ? 'Invoiced' : 'Forecasted'}: <strong style="color:var(--green)">${fmtV(grandTotal)}</strong></div>
      <div style="color:var(--text-2)">Remaining: <strong style="color:${grandTotal > authorized ? 'var(--red)' : 'inherit'}">${fmtV(authorized - grandTotal)}</strong></div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:120px;height:6px;background:var(--border);border-radius:3px">
          <div style="height:6px;background:${barColor};border-radius:3px;width:${Math.min(pct,100)}%"></div>
        </div>
        <strong style="color:${pctColor}">${pct}%</strong>
      </div>
    </div>
  </div>`;

  return `<tr><td colspan="9" style="padding:0;background:var(--bg);border-bottom:2px solid var(--blue)">
    ${html}
  </td></tr>`;
}

function renderPODetailRow(po) {
  const lines = getPOLines(po.id);
  const poType = (po.po_type || '').toLowerCase();
  if (poType === 'fixed') {
    return renderPOSelfhostingDetail(po);
  }
  const isValue = poView === 'value';
  const fmtH = h => `${h.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})}h`;
  const fmtV = v => `€${v.toLocaleString('de-DE', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  const pctColor = p => p >= 90 ? 'var(--red)' : p >= 75 ? 'var(--amber,#D97706)' : 'var(--green)';

  const authLabel  = isValue ? 'Authorized €' : 'Auth.h';
  const preLabel   = isValue ? 'Pre-2026 €'   : 'Pre-2026';
  const invLabel   = isValue ? '2026 inv. €'  : '2026 inv.';
  const usedLabel  = isValue ? 'Used €'       : 'Used';
  const remLabel   = isValue ? 'Remaining €'  : 'Remaining';

  let detailHtml = `<div style="overflow-x:auto;padding:0 0 8px 0">
    <table style="min-width:900px;width:100%;font-size:12px;border-collapse:collapse;table-layout:fixed">
      <thead><tr style="color:var(--text-3);font-size:11px;background:var(--bg)">
        <th style="width:70px;min-width:70px;padding:6px 8px;text-align:center">#</th>
        <th style="text-align:left;padding:6px 12px;font-weight:500;width:220px">Role</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500;width:70px">Rate</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500;width:100px">${authLabel}</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500;width:100px">${preLabel}</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500;width:100px">${invLabel}</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500;width:100px">${usedLabel}</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500;width:100px">${remLabel}</th>
        <th style="text-align:right;padding:6px 8px;font-weight:500;width:55px">%</th>
        <th style="width:40px"></th>
      </tr></thead><tbody>`;

  // Calculate 2026 month range for this PO once
  const poStart2026 = new Date(po.start_date) < new Date('2026-01-01') ? new Date('2026-01-01') : new Date(po.start_date);
  const poEnd2026 = new Date(po.end_date) > new Date('2026-12-31') ? new Date('2026-12-31') : new Date(po.end_date);
  const poStartMonth = poStart2026.getMonth() + 1;
  const poEndMonth = poEnd2026.getMonth() + 1;

  lines.forEach(line => {
    const isOncall = line.catalog_role === 'oncall';
    const isDiscount = line.catalog_role === 'discount';

    // Skip oncall and discount lines in Hours view
    if ((isOncall || isDiscount) && !isValue) return;

    // Discount line — special rendering
    if (isDiscount) {
      const discVal = getDiscountValue(po);
      const discFmt = fmtV(discVal);
      const discAuth = parseFloat(line.qty_hours) || 0;
      const discPre  = -(parseFloat(line.hours_before_2026) || 0);
      const discUsed = discVal + discPre; // both negative
      const discPct  = discAuth > 0 ? Math.round(Math.abs(discUsed) / discAuth * 100) : 0;
      const discRem  = discAuth > 0 ? fmtV(-(discAuth - Math.abs(discUsed))) : '—';
      detailHtml += `<tr style="border-bottom:1px solid var(--border);background:#fff8f8">
        <td style="padding:4px 8px;text-align:center;width:70px;min-width:70px">
          <span style="font-size:11px;color:var(--text-3)">${line.line_number}</span>
        </td>
        <td style="padding:6px 12px;width:220px">
          <div style="font-weight:500;color:#c62828">${line.description}</div>
        </td>
        <td style="text-align:right;padding:6px 8px">—</td>
        <td style="text-align:right;padding:6px 8px;color:#c62828">${discAuth > 0 ? fmtV(-discAuth) : '—'}</td>
        <td style="text-align:right;padding:6px 8px;color:#c62828">${discPre !== 0 ? fmtV(discPre) : '—'}</td>
        <td style="text-align:right;padding:6px 8px;color:#c62828">
          ${discVal !== 0 ? `<span style="display:inline-flex;align-items:center;gap:4px">
            ${discFmt}
            <button onclick="event.stopPropagation();toggleDrillDown('${line.id}')" title="Show discount breakdown"
              style="border:none;background:none;cursor:pointer;padding:1px 3px;font-size:11px;color:${expandedDrillLineId===line.id?'var(--blue)':'var(--text-3)'};line-height:1">🔍</button>
          </span>` : '—'}
        </td>
        <td style="text-align:right;padding:6px 8px;color:#c62828;font-weight:500">${fmtV(discUsed)}</td>
        <td style="text-align:right;padding:6px 8px;color:#c62828">${discRem}</td>
        <td style="text-align:right;padding:6px 8px;font-weight:600;color:${pctColor(discPct)}">${discAuth > 0 ? discPct+'%' : '—'}</td>
        <td style="text-align:center;padding:6px 4px">
          <button class="btn" onclick="openEditLine('${line.id}')" style="padding:2px 6px;font-size:10px">✏</button>
        </td>
      </tr>`;
      if (expandedDrillLineId === line.id) {
        detailHtml += renderDrillDownRow(po, line, poStartMonth, poEndMonth);
      }
      return;
    }

    const rate = parseFloat(line.unit_price) || 0;
    const qty  = parseFloat(line.qty_hours)  || 0;

    // Hours (oncall has none)
    const inv2026h  = isOncall ? 0 : getInvoicedHours(po, line);
    const beforeH   = isOncall ? 0 : (parseFloat(line.hours_before_2026) || 0);
    const usedH     = beforeH + inv2026h;
    const remH      = qty - usedH;

    // Value
    const authorized = isOncall ? qty * rate : qty * rate;
    const beforeV    = isOncall ? 0 : (parseFloat(line.hours_before_2026) || 0) * rate;
    const inv2026v   = isOncall ? getOncallValue(po, line) : inv2026h * rate;
    const usedV      = beforeV + inv2026v;
    const remV       = authorized - usedV;

    const inv2026    = isValue ? inv2026v  : inv2026h;
    const before     = isValue ? beforeV   : beforeH;
    const used       = isValue ? usedV     : usedH;
    const rem        = isValue ? remV      : remH;
    const auth       = isValue ? authorized : qty;
    const pct        = auth > 0 ? Math.round(used / auth * 100) : 0;

    const barWidth = Math.min(pct, 100);
    const barColor = pct >= 90 ? '#EF4444' : pct >= 75 ? '#D97706' : '#1D9E75';

    const authFmt  = isValue ? fmtV(auth)   : fmtH(auth);
    const beforeFmt= before > 0 ? (isValue ? fmtV(before) : fmtH(before)) : '—';
    const invFmt   = inv2026 > 0 ? (isValue ? fmtV(inv2026) : fmtH(inv2026)) : '—';
    const usedFmt  = isValue ? fmtV(used)   : fmtH(used);
    const remFmt   = isValue ? fmtV(rem)    : fmtH(rem);

    detailHtml += `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:4px 8px;text-align:center;white-space:nowrap;width:70px;min-width:70px">
        <button onclick="movePoLine('${po.id}','${line.id}','up')" style="border:none;background:none;cursor:pointer;padding:2px 3px;color:var(--text-2);font-size:13px">▲</button><span style="font-size:11px;color:var(--text-3);padding:0 2px">${line.line_number}</span><button onclick="movePoLine('${po.id}','${line.id}','down')" style="border:none;background:none;cursor:pointer;padding:2px 3px;color:var(--text-2);font-size:13px">▼</button>
      </td>
      <td style="padding:6px 12px;width:220px;overflow:hidden">
        <div style="font-weight:500">${line.description}${isOncall ? ' <span style="font-size:10px;color:var(--text-3);font-weight:400">(fixed fee)</span>' : ''}</div>
        <div style="height:4px;background:var(--border);border-radius:2px;margin-top:4px;width:120px">
          <div style="height:4px;background:${barColor};border-radius:2px;width:${barWidth}%"></div>
        </div>
      </td>
      <td style="text-align:right;padding:6px 8px">${isOncall ? '—' : `€${rate.toFixed(2)}`}</td>
      <td style="text-align:right;padding:6px 8px;font-weight:500">${authFmt}</td>
      <td style="text-align:right;padding:6px 8px;color:var(--text-2)">${beforeFmt}</td>
      <td style="text-align:right;padding:6px 8px;color:var(--green)">
        ${inv2026 > 0
          ? `<span style="display:inline-flex;align-items:center;gap:4px">
              ${invFmt}
              <button onclick="event.stopPropagation();toggleDrillDown('${line.id}')" title="Show breakdown"
                style="border:none;background:none;cursor:pointer;padding:1px 3px;font-size:11px;color:${expandedDrillLineId===line.id?'var(--blue)':'var(--text-3)'};line-height:1">🔍</button>
            </span>`
          : '—'}
      </td>
      <td style="text-align:right;padding:6px 8px;font-weight:500">${usedFmt}</td>
      <td style="text-align:right;padding:6px 8px;color:${rem < 0 ? 'var(--red)' : 'inherit'}">${remFmt}</td>
      <td style="text-align:right;padding:6px 8px;font-weight:600;color:${pctColor(pct)}">${pct}%</td>
      <td style="text-align:center;padding:6px 4px">
        <button class="btn" onclick="openEditLine('${line.id}')" style="padding:2px 6px;font-size:10px">✏</button>
      </td>
    </tr>`;

    // Drill-down row
    if (expandedDrillLineId === line.id) {
      detailHtml += renderDrillDownRow(po, line, poStartMonth, poEndMonth);
    }
  });

  // Totals — exclude oncall/discount from hours, include in value
  const tmLines    = lines.filter(l => l.catalog_role !== 'oncall' && l.catalog_role !== 'discount');
  const totQty     = tmLines.reduce((s,l) => s + (parseFloat(l.qty_hours)||0), 0);
  const totBeforeH = tmLines.reduce((s,l) => s + (parseFloat(l.hours_before_2026)||0), 0);
  const totInvH    = tmLines.reduce((s,l) => s + getInvoicedHours(po,l), 0);
  const totUsedH   = totBeforeH + totInvH;
  const totRemH    = totQty - totUsedH;
  const totAuth   = tmLines.reduce((s,l) => s + (parseFloat(l.qty_hours)||0)*(parseFloat(l.unit_price)||0), 0);
  const totBeforeV= tmLines.reduce((s,l) => s + (parseFloat(l.hours_before_2026)||0)*(parseFloat(l.unit_price)||0), 0)
    + lines.filter(l => l.catalog_role === 'discount').reduce((s,l) => s - (parseFloat(l.hours_before_2026)||0), 0);
  const totInvV   = lines.reduce((s,l) => s + getInvoicedValue(po,l), 0);
  const totUsedV  = totBeforeV + totInvV;
  const totRemV   = totAuth - totUsedV;

  const tAuth  = isValue ? fmtV(totAuth)   : fmtH(totQty);
  const tBef   = isValue ? (totBeforeV > 0 ? fmtV(totBeforeV) : '—') : (totBeforeH > 0 ? fmtH(totBeforeH) : '—');
  const tInv   = isValue ? fmtV(totInvV)   : fmtH(totInvH);
  const tUsed  = isValue ? fmtV(totUsedV)  : fmtH(totUsedH);
  const tRem   = isValue ? fmtV(totRemV)   : fmtH(totRemH);
  const tBase  = isValue ? totAuth : totQty;
  const tUsedN = isValue ? totUsedV : totUsedH;
  const totPct = tBase > 0 ? Math.round(tUsedN / tBase * 100) : 0;

  detailHtml += `<tr style="background:var(--bg);font-weight:600;border-top:2px solid var(--border)">
    <td colspan="3" style="padding:6px 12px">Total</td>
    <td style="text-align:right;padding:6px 8px">${tAuth}</td>
    <td style="text-align:right;padding:6px 8px;color:var(--text-2)">${tBef}</td>
    <td style="text-align:right;padding:6px 8px;color:var(--green)">${tInv}</td>
    <td style="text-align:right;padding:6px 8px">${tUsed}</td>
    <td style="text-align:right;padding:6px 8px;color:${totRemV < 0 || totRemH < 0 ? 'var(--red)' : 'inherit'}">${tRem}</td>
    <td style="text-align:right;padding:6px 8px;color:${pctColor(totPct)}">${totPct}%</td>
    <td></td>
  </tr>`;

  detailHtml += '</tbody></table></div>';

  return `<tr><td colspan="9" style="padding:0;background:var(--bg);border-bottom:2px solid var(--blue)">
    ${detailHtml}
    <div style="padding:6px 12px 10px 24px">
      <button class="btn btn-primary" onclick="openAddLine('${po.id}')" style="font-size:11px;padding:3px 10px">+ Add line</button>
    </div>
  </td></tr>`;
}

// ── Add / Edit PO Modal ───────────────────────────────────────────────────
let editingPoId = null;

async function movePoLine(poId, lineId, direction) {
  const lines = getPOLines(poId).sort((a, b) => a.line_number - b.line_number);
  const idx = lines.findIndex(l => l.id === lineId);
  if (idx === -1) return;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= lines.length) return;

  const lineA = lines[idx];
  const lineB = lines[swapIdx];
  const numA = lineA.line_number;
  const numB = lineB.line_number;
  const tempNum = 9999;

  // Step 1: move A to temp to avoid unique conflict
  await db.from('purchase_order_lines').update({ line_number: tempNum }).eq('id', lineA.id);
  // Step 2: move B to A's position
  const { error: e2 } = await db.from('purchase_order_lines').update({ line_number: numA }).eq('id', lineB.id);
  if (e2) { showToast('Error: ' + e2.message); return; }
  // Step 3: move A from temp to B's position
  const { error: e3 } = await db.from('purchase_order_lines').update({ line_number: numB }).eq('id', lineA.id);
  if (e3) { showToast('Error: ' + e3.message); return; }

  lineA.line_number = numB;
  lineB.line_number = numA;

  renderPOList();
}

async function movePO(poId, direction) {
  const sorted = [...purchaseOrders].sort((a,b) => (a.position||999) - (b.position||999));
  const idx = sorted.findIndex(p => p.id === poId);
  if (idx === -1) return;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return;

  const poA = sorted[idx];
  const poB = sorted[swapIdx];
  const posA = poA.position || idx + 1;
  const posB = poB.position || swapIdx + 1;
  const temp = 9999;

  await db.from('purchase_orders').update({ position: temp }).eq('id', poA.id);
  await db.from('purchase_orders').update({ position: posA }).eq('id', poB.id);
  const { error } = await db.from('purchase_orders').update({ position: posB }).eq('id', poA.id);
  if (error) { showToast('Error: ' + error.message); return; }

  poA.position = posB;
  poB.position = posA;
  renderPOList();
}

function openAddPO() {
  editingPoId = null;
  document.getElementById('po-modal-title').textContent = 'Add Purchase Order';
  document.getElementById('po-delete-btn').style.display = 'none';
  document.getElementById('po-number').value = '';
  document.getElementById('po-version').value = '1';
  document.getElementById('po-date').value = '';
  document.getElementById('po-team').value = '';
  document.getElementById('po-contract').value = '';
  document.getElementById('po-start').value = '';
  document.getElementById('po-end').value = '';
  document.getElementById('po-currency').value = 'EUR';
  document.getElementById('po-total').value = '';
  document.getElementById('po-type').value = 'tm';
  document.getElementById('po-notes').value = '';
  document.getElementById('po-linked-teams').value = '';
  document.getElementById('po-modal').classList.add('open');
}

function openEditPO(poId) {
  const po = purchaseOrders.find(p => p.id === poId);
  if (!po) return;
  editingPoId = poId;
  document.getElementById('po-modal-title').textContent = 'Edit Purchase Order';
  document.getElementById('po-delete-btn').style.display = '';
  document.getElementById('po-number').value = po.po_number || '';
  document.getElementById('po-version').value = po.po_version || 1;
  document.getElementById('po-date').value = po.po_date || '';
  document.getElementById('po-team').value = po.team || '';
  document.getElementById('po-contract').value = po.contract || '';
  document.getElementById('po-start').value = po.start_date || '';
  document.getElementById('po-end').value = po.end_date || '';
  document.getElementById('po-currency').value = po.currency || 'EUR';
  document.getElementById('po-total').value = po.total_value || '';
  document.getElementById('po-type').value = po.po_type || 'tm';
  document.getElementById('po-notes').value = po.notes || '';
  document.getElementById('po-linked-teams').value = po.linked_teams || '';
  document.getElementById('po-modal').classList.add('open');
}

async function savePO() {
  const row = {
    po_number: document.getElementById('po-number').value.trim(),
    po_version: parseInt(document.getElementById('po-version').value) || 1,
    po_date: document.getElementById('po-date').value || null,
    team: document.getElementById('po-team').value.trim(),
    contract: document.getElementById('po-contract').value.trim(),
    start_date: document.getElementById('po-start').value || null,
    end_date: document.getElementById('po-end').value || null,
    currency: document.getElementById('po-currency').value,
    total_value: parseFloat(document.getElementById('po-total').value) || null,
    po_type: document.getElementById('po-type').value,
    notes: document.getElementById('po-notes').value.trim() || null,
    linked_teams: document.getElementById('po-linked-teams').value.trim() || null
  };
  if (!row.po_number) { showToast('PO number is required'); return; }

  if (editingPoId) {
    const { error } = await db.from('purchase_orders').update(row).eq('id', editingPoId);
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = purchaseOrders.findIndex(p => p.id === editingPoId);
    if (idx >= 0) purchaseOrders[idx] = { ...purchaseOrders[idx], ...row };
  } else {
    const { data, error } = await db.from('purchase_orders').insert(row).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    purchaseOrders.unshift(data);
  }

  closeModal('po-modal');
  showToast(editingPoId ? 'PO updated' : 'PO added');
  renderPOList();
}

async function deletePO() {
  if (!editingPoId) return;
  if (!confirm('Delete this PO and all its lines?')) return;
  const { error } = await db.from('purchase_orders').delete().eq('id', editingPoId);
  if (error) { showToast('Error: ' + error.message); return; }
  purchaseOrders = purchaseOrders.filter(p => p.id !== editingPoId);
  purchaseOrderLines = purchaseOrderLines.filter(l => l.po_id !== editingPoId);
  closeModal('po-modal');
  showToast('PO deleted');
  renderPOList();
}

// ── Add / Edit PO Line Modal ──────────────────────────────────────────────
let editingLineId = null;
let editingLinePoId = null;

function openAddLine(poId) {
  editingLineId = null;
  editingLinePoId = poId;
  const lines = getPOLines(poId);
  document.getElementById('line-modal-title').textContent = 'Add PO Line';
  document.getElementById('line-delete-btn').style.display = 'none';
  document.getElementById('line-number').value = lines.length + 1;
  document.getElementById('line-description').value = '';
  document.getElementById('line-catalog-role').value = 'Senior';
  document.getElementById('line-location').value = 'SVK';
  document.getElementById('line-qty').value = '';
  document.getElementById('line-rate').value = '';
  document.getElementById('line-before2026').value = '0';
  document.getElementById('line-modal').classList.add('open');
}

function openEditLine(lineId) {
  const line = purchaseOrderLines.find(l => l.id === lineId);
  if (!line) return;
  editingLineId = lineId;
  editingLinePoId = line.po_id;
  document.getElementById('line-modal-title').textContent = 'Edit PO Line';
  document.getElementById('line-delete-btn').style.display = '';
  document.getElementById('line-number').value = line.line_number;
  document.getElementById('line-description').value = line.description || '';
  document.getElementById('line-catalog-role').value = line.catalog_role || 'Senior';
  document.getElementById('line-location').value = line.location || 'SVK';
  document.getElementById('line-qty').value = line.qty_hours || '';
  document.getElementById('line-rate').value = line.unit_price || '';
  document.getElementById('line-before2026').value = line.hours_before_2026 || 0;
  document.getElementById('line-modal').classList.add('open');
}

async function saveLine() {
  const qty = parseFloat(document.getElementById('line-qty').value) || 0;
  const rate = parseFloat(document.getElementById('line-rate').value) || 0;
  const row = {
    po_id: editingLinePoId,
    line_number: parseInt(document.getElementById('line-number').value) || 1,
    description: document.getElementById('line-description').value.trim(),
    catalog_role: document.getElementById('line-catalog-role').value,
    location: document.getElementById('line-location').value,
    qty_hours: qty,
    unit_price: rate,
    total: Math.round(qty * rate * 100) / 100,
    hours_before_2026: parseFloat(document.getElementById('line-before2026').value) || 0
  };
  if (!row.description) { showToast('Description is required'); return; }

  if (editingLineId) {
    const { error } = await db.from('purchase_order_lines').update(row).eq('id', editingLineId);
    if (error) { showToast('Error: ' + error.message); return; }
    const idx = purchaseOrderLines.findIndex(l => l.id === editingLineId);
    if (idx >= 0) purchaseOrderLines[idx] = { ...purchaseOrderLines[idx], ...row };
  } else {
    const { data, error } = await db.from('purchase_order_lines').insert(row).select().single();
    if (error) { showToast('Error: ' + error.message); return; }
    purchaseOrderLines.push(data);
  }

  closeModal('line-modal');
  showToast(editingLineId ? 'Line updated' : 'Line added');
  renderPOList();
}

async function deleteLine() {
  if (!editingLineId) return;
  if (!confirm('Delete this line?')) return;
  const { error } = await db.from('purchase_order_lines').delete().eq('id', editingLineId);
  if (error) { showToast('Error: ' + error.message); return; }
  purchaseOrderLines = purchaseOrderLines.filter(l => l.id !== editingLineId);
  closeModal('line-modal');
  showToast('Line deleted');
  renderPOList();
}
