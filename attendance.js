// ============================================================
// ATTENDANCE BULK UPDATE
// ============================================================
let attBulkChanges = {};
let attSelectedTeam = null;
let attCurrentTab = 'overview';

function getAttStatusFilter() {
  if (attSelectedTeam) return document.getElementById('att-filter-status2').value;
  return document.getElementById('att-filter-status').value;
}

function getAttBulkMonth() {
  const id = attSelectedTeam ? 'att-bulk-month2' : 'att-bulk-month';
  return parseInt(document.getElementById(id).value);
}

function getOrderedAttTeams() {
  const status = getAttStatusFilter();
  const today = new Date(); today.setHours(0,0,0,0);
  const visibleDevs = developers.filter(d => status === 'all' || d.status === status);
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

function attSelectTeam(team, keepFilter) {
  attSelectedTeam = team;
  document.getElementById('att-toolbar-all').style.display = 'none';
  document.getElementById('att-toolbar-team').style.display = '';
  document.getElementById('att-team-title-row').style.display = '';
  document.getElementById('att-team-title').textContent = team;
  if (!keepFilter) {
    document.getElementById('att-filter-status2').value = document.getElementById('att-filter-status').value;
    document.getElementById('att-bulk-month2').value = document.getElementById('att-bulk-month').value;
  }
  // sync tab state
  document.getElementById('btn-att-overview2').classList.toggle('active', attCurrentTab === 'overview');
  document.getElementById('btn-att-bulk2').classList.toggle('active', attCurrentTab === 'bulk');
  document.getElementById('att-bulk-month2').style.display = attCurrentTab === 'overview' ? 'none' : '';
  if (attCurrentTab === 'overview') renderAttendance();
  else renderAttBulk();
}

function attBackToAll() {
  attSelectedTeam = null;
  document.getElementById('att-toolbar-all').style.display = '';
  document.getElementById('att-toolbar-team').style.display = 'none';
  document.getElementById('att-team-title-row').style.display = 'none';
  if (attCurrentTab === 'overview') renderAttendance();
  else renderAttBulk();
}

function attPrevTeam() {
  const teams = getOrderedAttTeams();
  const idx = teams.indexOf(attSelectedTeam);
  attSelectTeam(teams[(idx - 1 + teams.length) % teams.length], true);
}

function attNextTeam() {
  const teams = getOrderedAttTeams();
  const idx = teams.indexOf(attSelectedTeam);
  attSelectTeam(teams[(idx + 1) % teams.length], true);
}

function switchAttLayout(layout) { /* removed - no longer used */ }

function switchAttTab(tab) {
  attCurrentTab = tab;
  const isOverview = tab === 'overview';
  // sync both toolbars
  document.getElementById('btn-att-overview').classList.toggle('active', isOverview);
  document.getElementById('btn-att-bulk').classList.toggle('active', !isOverview);
  const o2 = document.getElementById('btn-att-overview2');
  const b2 = document.getElementById('btn-att-bulk2');
  if (o2) o2.classList.toggle('active', isOverview);
  if (b2) b2.classList.toggle('active', !isOverview);
  document.getElementById('att-overview-view').style.display = isOverview ? '' : 'none';
  document.getElementById('att-bulk-view').style.display = isOverview ? 'none' : '';
  document.getElementById('att-bulk-month').style.display = isOverview ? 'none' : '';
  const m2 = document.getElementById('att-bulk-month2');
  if (m2) m2.style.display = isOverview ? 'none' : '';
  document.getElementById('btn-att-import').style.display = isOverview ? '' : 'none';
  const i2 = document.getElementById('btn-att-import2');
  if (i2) i2.style.display = isOverview ? '' : 'none';
  if (!isOverview) {
    const monthSel = document.getElementById('att-bulk-month');
    if (!monthSel.value) monthSel.value = new Date().getMonth() + 1;
    const monthSel2 = document.getElementById('att-bulk-month2');
    if (monthSel2 && !monthSel2.value) monthSel2.value = monthSel.value;
    renderAttBulk();
  } else renderAttendance();
}

function calcForecastHoursOnly(dev, monthIdx) {
  // Returns ONLY the utilization-based forecast — ignores actual_hours completely
  const mKey = MTHS[monthIdx];
  const m = monthIdx + 1;
  const activeAssignments = getActiveAssignments(dev, 2026, m).filter(a => a.billable !== false);
  if (!activeAssignments.length) return null;
  const team = activeAssignments[activeAssignments.length - 1].team;
  if (isPartialMonth(dev, 2026, m)) {
    // Partial month — return max hours as reference
    const loc = locations.find(l => l.id === dev.location_id);
    return loc ? loc[mKey] : 160;
  }
  const tu = teamUtilization[team];
  const util = tu ? parseFloat(tu[mKey]) : null;
  if (util == null) return Math.round(loc ? (loc[mKey] || 160) : 160); // fallback 100%
  const loc = locations.find(l => l.id === dev.location_id);
  const maxHours = loc ? loc[mKey] : 160;
  return Math.round(maxHours * util);
}


function renderAttBulk() {
  const monthNum = getAttBulkMonth();
  const statusFilter = getAttStatusFilter();
  const MTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = monthNum - 1;

  attBulkChanges = {};
  document.getElementById('btn-bulk-save').style.display = 'none';

  if (!monthNum) {
    document.getElementById('att-bulk-no-month').style.display = '';
    document.getElementById('att-bulk-content').style.display = 'none';
    return;
  }
  if (isMonthLocked(monthNum)) {
    document.getElementById('att-bulk-no-month').style.display = '';
    document.getElementById('att-bulk-no-month').textContent = `🔒 ${MONTH_NAMES_FULL[monthNum-1]} is locked — no changes allowed`;
    document.getElementById('att-bulk-content').style.display = 'none';
    return;
  }
  document.getElementById('att-bulk-no-month').textContent = 'Select a month above to load developers';

  document.getElementById('att-bulk-no-month').style.display = 'none';
  document.getElementById('att-bulk-content').style.display = '';

  const monthStart = new Date(2026, mi, 1);
  const monthEnd = new Date(2026, monthNum, 0);

  // Exclude fixed-price teams (Selfhosting) — no T&M hours apply
  const FIXED_PRICE_TEAMS = ['Selfhosting'];

  let devs = developers.filter(d => {
    if (statusFilter === 'active' && d.status !== 'active') return false;
    // Must have at least one active T&M assignment this month (not fixed price)
    return (d.assignments||[]).some(a => {
      if (FIXED_PRICE_TEAMS.includes(a.team)) return false;
      const start = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
      const end = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
      return start <= monthEnd && end >= monthStart;
    });
  });

  if (attSelectedTeam) {
    devs = devs.filter(d => (d.assignments||[]).some(a => a.team === attSelectedTeam));
  }

  devs.sort((a, b) => {
    const ta = getDevCurrentTeam(a) || '';
    const tb = getDevCurrentTeam(b) || '';
    return ta.localeCompare(tb) || parseInt(a.nessid||0) - parseInt(b.nessid||0);
  });
  const _bth = document.getElementById('bulk-team-header');
  if (_bth) _bth.style.display = 'none';



  // Hide team header and cells in team view


  const SRC = {
    tmsh:     { label: 'Actuals',  color: 'var(--green)', bg: 'var(--green-lt)' },
    manual:   { label: 'Manual',   color: 'var(--amber)', bg: 'var(--amber-lt)' },
    forecast: { label: 'Forecast', color: 'var(--blue)',  bg: 'var(--blue-lt)'  },
  };

  const body = document.getElementById('att-bulk-body');
  const buildBulkRow = d => {
    const entry = actualHours[String(d.id)]?.[monthNum];
    const currentSource = entry?.source || 'forecast';
    const currentHours = entry ? parseFloat(entry.hours) : null;
    const team = getDevCurrentTeam(d) || '—';

    // Calculate PURE forecast hours (ignores actuals)
    const forecastHours = calcForecastHoursOnly(d, mi);

    // Hours column: show current stored hours, or forecast if no record
    const hoursDisplay = currentHours != null
      ? `<span style="font-weight:500;color:${SRC[currentSource].color}">${Math.round(currentHours)}</span>`
      : `<span style="color:var(--text-3)">${forecastHours ?? '—'}</span>`;

    const forecastDisplay = forecastHours != null
      ? `<span style="color:var(--blue)">${forecastHours}</span>`
      : `<span style="color:var(--text-3)">—</span>`;

    const teamCell = '';

    // Build radio buttons as plain string (avoid nested template literals)
    const fh = forecastHours != null ? forecastHours + 'h' : '—';
    const radioHtml = ['tmsh','manual','forecast'].map(src => {
      const isActive = currentSource === src;
      const isDisabled = false; // always show all options
      const lbl = SRC[src].label + (src === 'forecast' ? ' (' + fh + ')' : '');
      const bg = isActive ? SRC[src].bg : 'transparent';
      const col = isActive ? SRC[src].color : 'var(--text-2)';
      return '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;cursor:' + (isDisabled?'not-allowed':'pointer') + ';opacity:' + (isDisabled?0.4:1) + '">'
        + '<input type="radio" name="src-' + d.id + '" value="' + src + '"'
        + (isActive ? ' checked' : '') + (isDisabled ? ' disabled' : '')
        + ' onchange="onBulkChange(' + d.id + ', \'' + src + '\', ' + monthNum + ')">'
        + '<span style="font-size:12px;padding:2px 8px;border-radius:99px;background:' + bg + ';color:' + col + '" id="bulk-label-' + d.id + '-' + src + '">' + lbl + '</span>'
        + '</label>';
    }).join('');

    return `<tr id="bulk-row-${d.id}">
      <td style="padding:8px 13px;font-weight:500">${d.firstname} ${d.lastname}</td>
      ${teamCell}
      <td style="padding:8px 13px;text-align:right">${hoursDisplay}</td>
      <td style="padding:4px 8px">
        <input type="number" min="0" max="300" step="1"
          id="bulk-input-${d.id}"
          placeholder="—"
          style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;text-align:right;background:var(--surface)"
          oninput="onBulkInputChange(${d.id}, ${monthNum}, this.value)">
      </td>
      <td style="padding:4px 8px;white-space:nowrap">${radioHtml}</td>
    </tr>`;
  };

  if (attSelectedTeam) {
    body.innerHTML = devs.map(buildBulkRow).join('') || '<tr><td colspan="5" class="empty">No developers found</td></tr>';
  } else {
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
    body.innerHTML = orderedTeams.map(team => {
      const tDevs = teamDevs[team];
      const teamRow = `<tr style="background:#f0f4ff;cursor:pointer" onclick="attSelectTeam('${team}')">
        <td colspan="6" style="font-weight:600;font-size:13px;color:var(--blue);padding:8px 13px;border-top:2px solid #dde4f5">
          ${team}
          <span style="font-weight:400;font-size:12px;color:var(--text-2);margin-left:8px">${tDevs.length} developer${tDevs.length!==1?'s':''}</span>
          <span style="float:right;font-size:11px;color:var(--text-3);font-weight:400">›</span>
        </td>
      </tr>`;
      return teamRow + sortDevsByOrder(tDevs).map(buildBulkRow).join('');
    }).join('') || '<tr><td colspan="5" class="empty">No developers found</td></tr>';
  }
}

function onBulkInputChange(devId, monthNum, val) {
  const key = `${devId}_${monthNum}`;
  const trimmed = val.trim();

  if (trimmed === '' || isNaN(parseFloat(trimmed))) {
    // Clear custom value — if source also changed, keep change but without customHours
    const existing = attBulkChanges[key];
    if (existing) {
      const entry = actualHours[devId]?.[monthNum];
      const originalSource = entry?.source || 'forecast';
      if (existing.newSource !== originalSource) {
        // Source is still different — keep change but clear customHours
        attBulkChanges[key] = { devId, monthNum: parseInt(monthNum), newSource: existing.newSource };
      } else {
        // Source is back to original and no custom hours — remove change
        delete attBulkChanges[key];
      }
    }
    // Re-enable forecast radio
    const forecastRadio = document.querySelector(`input[name="src-${devId}"][value="forecast"]`);
    if (forecastRadio) forecastRadio.disabled = false;
    const forecastLabel = document.getElementById(`bulk-label-${devId}-forecast`);
    if (forecastLabel) forecastLabel.closest('label').style.opacity = '1';
  } else {
    const hours = parseFloat(trimmed);
    // Disable forecast option — custom hours must be manual or actuals
    const forecastRadio = document.querySelector(`input[name="src-${devId}"][value="forecast"]`);
    if (forecastRadio) {
      forecastRadio.disabled = true;
      forecastRadio.closest('label').style.opacity = '0.4';
      // If forecast was selected, switch to manual
      if (forecastRadio.checked) {
        const manualRadio = document.querySelector(`input[name="src-${devId}"][value="manual"]`);
        if (manualRadio) { manualRadio.checked = true; onBulkChange(devId, 'manual', monthNum); }
      }
    }
    // Store change with custom hours
    const entry = actualHours[devId]?.[monthNum];
    const currentSource = entry?.source || 'forecast';
    const selectedRadio = document.querySelector(`input[name="src-${devId}"]:checked`);
    const source = selectedRadio?.value || (currentSource !== 'forecast' ? currentSource : 'manual');
    attBulkChanges[`${devId}_${monthNum}`] = { devId, monthNum, newSource: source, customHours: hours };
    document.getElementById('btn-bulk-save').style.display = '';
  }

  const hasChanges = Object.keys(attBulkChanges).length > 0;
  document.getElementById('btn-bulk-save').style.display = hasChanges ? '' : 'none';
}

function onBulkChange(devId, newSource, monthNum) {
  const key = `${devId}_${monthNum}`;
  const entry = actualHours[devId]?.[monthNum];
  const originalSource = entry?.source || 'forecast';
  const existingChange = attBulkChanges[key];
  const existingCustomHours = existingChange?.customHours ?? null;

  // Only remove change if source is back to original AND no custom hours set
  if (newSource === originalSource && existingCustomHours == null) {
    delete attBulkChanges[key];
  } else {
    // Preserve any existing customHours when switching source
    attBulkChanges[key] = { devId, monthNum, newSource, ...(existingCustomHours != null ? { customHours: existingCustomHours } : {}) };
  }

  // Update label styling
  const SRC_COLORS = {
    tmsh:     { color: 'var(--green)', bg: 'var(--green-lt)' },
    manual:   { color: 'var(--amber)', bg: 'var(--amber-lt)' },
    forecast: { color: 'var(--blue)',  bg: 'var(--blue-lt)'  },
  };
  ['tmsh','manual','forecast'].forEach(src => {
    const label = document.getElementById(`bulk-label-${devId}-${src}`);
    if (!label) return;
    const isActive = src === newSource;
    label.style.background = isActive ? SRC_COLORS[src].bg : 'transparent';
    label.style.color = isActive ? SRC_COLORS[src].color : 'var(--text-2)';
  });

  const hasChanges = Object.keys(attBulkChanges).length > 0;
  document.getElementById('btn-bulk-save').style.display = hasChanges ? '' : 'none';
}

function saveAllBulkUpdates() {
  const changes = Object.values(attBulkChanges);
  if (!changes.length) return;

  const SRC_LABELS = { tmsh: 'Actuals', manual: 'Manual', forecast: 'Forecast' };
  const SRC_COLORS = {
    tmsh:     { color: 'var(--green)', bg: 'var(--green-lt)' },
    manual:   { color: 'var(--amber)', bg: 'var(--amber-lt)' },
    forecast: { color: 'var(--blue)',  bg: 'var(--blue-lt)'  },
  };

  const body = document.getElementById('bulk-confirm-body');
  body.innerHTML = changes.map(change => {
    const { devId, monthNum, newSource, customHours } = change;
    const dev = developers.find(d => d.id === devId);
    const name = dev ? `${dev.firstname} ${dev.lastname}` : `Dev ${devId}`;
    const entry = actualHours[devId]?.[monthNum];
    const oldSource = entry?.source || 'forecast';

    // Determine hours to display
    let hoursDisplay;
    if (customHours != null) {
      hoursDisplay = `<strong>${customHours}</strong> <span style="font-size:11px;color:var(--text-3)">(custom)</span>`;
    } else if (entry?.hours != null) {
      hoursDisplay = `${Math.round(parseFloat(entry.hours))}`;
    } else {
      const mi = monthNum - 1;
      const team = dev ? getDevCurrentTeam(dev) : null;
      const fh = dev && team ? calcForecastHoursOnly(dev, mi) : null;
      hoursDisplay = fh != null ? `${fh} <span style="font-size:11px;color:var(--text-3)">(forecast)</span>` : '—';
    }

    const sc = SRC_COLORS[newSource];
    const oldLabel = `<span style="font-size:11px;color:${SRC_COLORS[oldSource].color}">${SRC_LABELS[oldSource]}</span>`;
    const newLabel = `<span style="padding:2px 8px;border-radius:99px;font-size:11px;font-weight:500;background:${sc.bg};color:${sc.color}">${SRC_LABELS[newSource]}</span>`;

    return `<tr>
      <td style="padding:8px 13px;font-weight:500">${name}</td>
      <td style="padding:8px 13px;text-align:right">${hoursDisplay}</td>
      <td style="padding:8px 13px;white-space:nowrap">
        ${oldSource !== newSource ? `${oldLabel} → ${newLabel}` : newLabel}
      </td>
    </tr>`;
  }).join('');

  document.getElementById('bulk-confirm-modal').classList.add('open');
}

async function confirmAndSave() {
  document.getElementById('bulk-confirm-modal').classList.remove('open');
  const changes = Object.values(attBulkChanges);
  if (!changes.length) return;

  const btn = document.getElementById('btn-bulk-save');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  let saved = 0, errors = 0;
  const now = new Date().toISOString();

  for (const change of changes) {
    const { devId, monthNum, newSource, customHours = null } = change;
    const dev = developers.find(d => d.id === devId);
    if (!dev) { errors++; continue; }
    if (isMonthLocked(monthNum)) { errors++; continue; }

    const entry = actualHours[devId]?.[monthNum] || null;

    if (newSource === 'forecast' && customHours == null) {
      // Delete record → falls back to forecast calculation
      if (entry?.id) {
        const { error } = await db.from('actual_hours').delete().eq('id', entry.id);
        if (error) { console.error('delete error:', error); errors++; continue; }
        delete actualHours[devId][monthNum];
      }
      // If no record existed, nothing to do — already forecast
    } else if (entry?.id) {
      // Update existing record
      const payload = { source: newSource, updated_at: now };
      if (customHours != null) payload.hours = customHours;
      const { error } = await db.from('actual_hours').update(payload).eq('id', entry.id);
      if (error) { console.error('update error:', error); errors++; continue; }
      actualHours[devId][monthNum].source = newSource;
      if (customHours != null) actualHours[devId][monthNum].hours = customHours;
    } else {
      // No existing record — create new
      const mi = monthNum - 1;
      let hoursToSave = customHours;
      if (hoursToSave == null) {
        // Use pure forecast calculation (not calcRevenue which reads actual_hours)
        const team = getDevCurrentTeam(dev);
        hoursToSave = calcForecastHoursOnly(dev, mi);
      }
      if (!hoursToSave) { console.warn('No hours to save for', dev.firstname, dev.lastname); errors++; continue; }
      const { data: newEntry, error } = await db.from('actual_hours')
        .insert({ developer_id: devId, year: 2026, month: monthNum, hours: hoursToSave, source: newSource })
        .select().single();
      if (error) { console.error('insert error:', error); errors++; continue; }
      if (!actualHours[devId]) actualHours[devId] = {};
      actualHours[devId][monthNum] = { hours: newEntry.hours, source: newEntry.source, id: newEntry.id };
    }
    saved++;
  }

  attBulkChanges = {};
  btn.textContent = 'Save changes';
  btn.disabled = false;
  btn.style.display = 'none';

  if (errors) showToast(`Saved ${saved}, ${errors} error${errors !== 1 ? 's' : ''}`);
  else showToast(`✓ Saved ${saved} change${saved !== 1 ? 's' : ''}`);

  renderAttBulk();
}