// ============================================================
// DASHBOARD MODULE
// ============================================================

function switchDashView(v) {
  ['dash-readiness-view', 'dash-developers-view'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const el = document.getElementById('dash-' + v + '-view');
  if (el) el.style.display = '';
  document.getElementById('btn-dash-readiness')?.classList.toggle('active', v === 'readiness');
  document.getElementById('btn-dash-developers')?.classList.toggle('active', v === 'developers');
  if (v === 'readiness') renderReadiness();
  if (v === 'developers') renderDevCharts();
}

// ============================================================
// HOME PAGE
// ============================================================

function renderHome() {
  const container = document.getElementById('home-chart-inner');
  if (!container) return;

  const year = 2026;
  const mi = new Date().getMonth(); // current month, 0-based
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  const monthStart = new Date(year, mi, 1);
  const monthEnd = new Date(year, mi + 1, 0);

  // Helper: get dev ID set per team for a given month range
  const getTeamDevSets = (mStart, mEnd) => {
    const sets = {};
    allTeams.forEach(t => {
      sets[t] = new Set(developers.filter(d =>
        (d.assignments||[]).some(a => {
          if (a.team !== t || a.billable === false) return false;
          const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
          const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
          return s <= mEnd && e >= mStart;
        })
      ).map(d => d.id));
    });
    return sets;
  };

  const teamDevSets = getTeamDevSets(monthStart, monthEnd);

  // Previous month
  const prevMi = (mi - 1 + 12) % 12;
  const prevMonthStart = new Date(year, prevMi, 1);
  const prevMonthEnd = new Date(year, prevMi + 1, 0);
  const prevTeamDevSets = getTeamDevSets(prevMonthStart, prevMonthEnd);

  const teamCounts = {};
  const prevTeamCounts = {};
  allTeams.forEach(t => {
    teamCounts[t] = teamDevSets[t].size;
    prevTeamCounts[t] = prevTeamDevSets[t].size;
  });

  const totalBillable = Object.values(teamCounts).reduce((a, b) => a + b, 0);
  const prevTotalBillable = Object.values(prevTeamCounts).reduce((a, b) => a + b, 0);
  const trendDiff = totalBillable - prevTotalBillable;

  // Joiners / leavers
  const joiners = [];
  const leavers = [];
  allTeams.forEach(t => {
    const cur = teamDevSets[t];
    const prev = prevTeamDevSets[t];
    developers.filter(d => cur.has(d.id) && !prev.has(d.id))
      .forEach(d => joiners.push({ team: t, name: d.firstname + ' ' + d.lastname }));
    developers.filter(d => prev.has(d.id) && !cur.has(d.id))
      .forEach(d => leavers.push({ team: t, name: d.firstname + ' ' + d.lastname }));
  });

  // ── Stat header ───────────────────────────────────────────────────────────
  const trendColor = trendDiff > 0 ? 'var(--green)' : trendDiff < 0 ? 'var(--red)' : 'var(--text-2)';
  const trendArrow = trendDiff > 0 ? '↑' : trendDiff < 0 ? '↓' : '→';
  const trendLabel = trendDiff === 0 ? 'no change' : (trendDiff > 0 ? '+' : '') + trendDiff;
  const statHtml = `<div style="font-size:15px;font-weight:600;margin-bottom:16px">
    Billable devs: ${totalBillable}
    <span style="font-size:13px;font-weight:500;color:${trendColor};margin-left:10px">${trendArrow} ${trendLabel} vs ${MTH_SHORT[prevMi]}</span>
  </div>`;

  // ── Movement legend ───────────────────────────────────────────────────────
  const renderGroup = (title, items, color) => {
    if (!items.length) return '';
    return `<div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">${title}</div>
      ${items.map(i => `
        <div style="margin-bottom:4px">
          <div style="font-size:12px;font-weight:500">${i.name}</div>
          <div style="font-size:11px;color:var(--text-3)">${i.team}</div>
        </div>`).join('')}
    </div>`;
  };
  const movementHtml = (joiners.length || leavers.length) ? `
    <div style="min-width:180px;max-width:220px;border-left:1px solid var(--border);padding-left:16px;flex-shrink:0">
      ${renderGroup('Joined this month', joiners, 'var(--green)')}
      ${renderGroup('Left previous month', leavers, 'var(--red)')}
    </div>` : '';

  const tLabels = allTeams.filter(t => teamCounts[t] > 0 || prevTeamCounts[t] > 0);
  const tData = tLabels.map(t => teamCounts[t]);
  const tPrev = tLabels.map(t => prevTeamCounts[t] || 0);
  const tJoined = tLabels.map(t => [...teamDevSets[t]].filter(id => !prevTeamDevSets[t].has(id)).length);
  const tLeft = tLabels.map(t => [...prevTeamDevSets[t]].filter(id => !teamDevSets[t].has(id)).length);
  const chartHeight = tLabels.length * 28 + 40;

  // Location counts using project_start/project_end for current month
  const locCounts = {};
  developers.filter(d => {
    const ps = d.project_start ? new Date(d.project_start) : null;
    const pe = d.project_end ? new Date(d.project_end) : new Date('2099-12-31');
    return ps && ps <= monthEnd && pe >= monthStart;
  }).forEach(d => {
    const loc = locations.find(l => l.id === d.location_id);
    const ln = loc?.name || 'Unknown';
    locCounts[ln] = (locCounts[ln] || 0) + 1;
  });

  container.innerHTML = `
    ${statHtml}
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div style="flex:2;display:flex;flex-direction:column;gap:0">
        <div style="display:flex;gap:16px;align-items:flex-start">
          <div style="flex:1;position:relative;height:${chartHeight}px">
            <canvas id="home-chart-canvas"></canvas>
          </div>
          ${movementHtml}
        </div>
      </div>
      <div style="flex:1;position:relative;height:${chartHeight}px">
        <canvas id="home-loc-canvas"></canvas>
      </div>
    </div>`;

  const render = () => {
    if (window._homeChartInstance) { window._homeChartInstance.destroy(); window._homeChartInstance = null; }
    const ctx = document.getElementById('home-chart-canvas')?.getContext('2d');
    if (!ctx) return;
    window._homeChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: tLabels.map(t => t.length > 22 ? t.substring(0,22)+'…' : t),
        datasets: [{ data: tData, backgroundColor: '#1D9E75', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { stepSize: 1 }, beginAtZero: true, max: Math.max(...tData, 1) + 1 },
          y: { ticks: { font: { size: 11 } } }
        },
        animation: {
          onComplete: function() {
            const chart = this;
            const chartCtx = chart.ctx;
            chartCtx.save();
            chart.data.datasets.forEach((dataset, i) => {
              const meta = chart.getDatasetMeta(i);
              meta.data.forEach((bar, index) => {
                const value = dataset.data[index];
                const joined = tJoined[index];
                const left = tLeft[index];
                chartCtx.font = 'bold 11px Arial';
                chartCtx.textBaseline = 'middle';
                if (bar.x > bar.base + 18) {
                  chartCtx.fillStyle = '#ffffff';
                  chartCtx.textAlign = 'right';
                  chartCtx.fillText(value, bar.x - 6, bar.y);
                } else {
                  chartCtx.fillStyle = '#1D9E75';
                  chartCtx.textAlign = 'left';
                  chartCtx.fillText(value, bar.x + 5, bar.y);
                }
                if (joined > 0 || left > 0) {
                  let offsetX = bar.x + (bar.x > bar.base + 18 ? 6 : 22);
                  chartCtx.font = 'bold 10px Arial';
                  chartCtx.textAlign = 'left';
                  if (joined > 0) {
                    chartCtx.fillStyle = '#1D9E75';
                    chartCtx.fillText('+' + joined, offsetX, bar.y);
                    offsetX += chartCtx.measureText('+' + joined).width + 3;
                  }
                  if (left > 0) {
                    chartCtx.fillStyle = '#E53935';
                    chartCtx.fillText('-' + left, offsetX, bar.y);
                  }
                }
              });
            });
            chartCtx.restore();
          }
        }
      }
    });
  };

  if (window.Chart) { render(); renderHomeLocation(locCounts); }
  else {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    s.onload = () => { render(); renderHomeLocation(locCounts); };
    document.head.appendChild(s);
  }
}

function renderHomeLocation(locCounts) {
  if (window._homeLocInstance) { window._homeLocInstance.destroy(); window._homeLocInstance = null; }
  const ctx = document.getElementById('home-loc-canvas')?.getContext('2d');
  if (!ctx) return;

  const EU_LOCATIONS = ['Slovakia', 'Romania', 'Latvia'];
  const IND_LOCATIONS = ['India Pune', 'India Bangalore'];
  const LOC_ORDER = [...EU_LOCATIONS, ...IND_LOCATIONS];
  const LOC_COLORS_MAP = { 'Slovakia': '#9B93F0', 'Romania': '#6DBFA0', 'Latvia': '#7DD4DB', 'India Pune': '#F0956A', 'India Bangalore': '#E0B040' };
  const LOC_COLORS_DEFAULT_EU = ['#B0A8F5', '#85D4B8'];
  const LOC_COLORS_DEFAULT_IN = ['#F5A882', '#ECC050'];
  const INNER_COLORS = { 'Europe': '#4A6FE3', 'India': '#E84B3A' };

  const allLocLabels = [
    ...LOC_ORDER.filter(l => locCounts[l] > 0),
    ...Object.keys(locCounts).filter(l => !LOC_ORDER.includes(l) && l !== 'Unknown' && locCounts[l] > 0)
  ];
  if (locCounts['Unknown']) allLocLabels.push('Unknown');

  const outerData = allLocLabels.map(l => locCounts[l] || 0);
  const outerColors = allLocLabels.map(l => LOC_COLORS_MAP[l] || (l.startsWith('India') ? LOC_COLORS_DEFAULT_IN[0] : LOC_COLORS_DEFAULT_EU[0]));
  const euTotal = allLocLabels.filter(l => !l.startsWith('India') && l !== 'Unknown').reduce((s, l) => s + (locCounts[l]||0), 0);
  const inTotal = allLocLabels.filter(l => l.startsWith('India')).reduce((s, l) => s + (locCounts[l]||0), 0);

  window._homeLocInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [
        { data: outerData, backgroundColor: outerColors, borderWidth: 2, borderColor: '#fff', weight: 1 },
        { data: [euTotal, inTotal], backgroundColor: [INNER_COLORS['Europe'], INNER_COLORS['India']], borderWidth: 2, borderColor: '#fff', weight: 1 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '0%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const value = c.parsed;
              const total = c.dataset.data.reduce((a, b) => a + b, 0);
              const pct = Math.round(value / total * 100);
              const label = c.datasetIndex === 0 ? allLocLabels[c.dataIndex] : ['Europe', 'India'][c.dataIndex];
              return ` ${label}: ${value} (${pct}%)`;
            }
          }
        }
      }
    },
    plugins: [{
      id: 'homeRingLabels',
      afterDraw(chart) {
        const { ctx: c } = chart;
        c.save();
        c.textBaseline = 'middle';
        c.textAlign = 'center';
        chart.data.datasets.forEach((dataset, di) => {
          const meta = chart.getDatasetMeta(di);
          meta.data.forEach((arc, i) => {
            const value = dataset.data[i];
            if (!value) return;
            const total = dataset.data.reduce((a, b) => a + b, 0);
            const pct = Math.round(value / total * 100);
            if (pct < 8) return;
            const midAngle = (arc.startAngle + arc.endAngle) / 2;
            const midR = (arc.innerRadius + arc.outerRadius) / 2;
            const x = arc.x + Math.cos(midAngle) * midR;
            const y = arc.y + Math.sin(midAngle) * midR;
            c.fillStyle = '#ffffff';
            if (di === 1) {
              const shortLabel = i === 0 ? 'EU' : 'IN';
              c.font = 'bold 16px Arial'; c.fillText(shortLabel, x, y - 10);
              c.font = 'bold 15px Arial'; c.fillText(value, x, y + 10);
            } else {
              const fullLabel = allLocLabels[i] || '';
              const shortLabel = fullLabel.replace('India ', 'IN ').replace('Slovakia', 'SK').replace('Romania', 'RO').replace('Latvia', 'LV');
              c.font = 'bold 13px Arial'; c.fillText(shortLabel, x, y - 8);
              c.font = '12px Arial'; c.fillText(value, x, y + 8);
            }
          });
        });
        c.restore();
      }
    }]
  });
}

// Graph order: 0=teams, 1=headcount, 2=location, 3=rates, 4=workertype
let devChartsGraphIndex = 0;
let devChartsMonth = new Date().getMonth(); // 0-based

const GRAPH_NAMES = ['Developers per team', 'Headcount over time', 'Location distribution', 'Billing rate brackets', 'Worker type'];
const MTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function devChartsNavGraph(dir) {
  devChartsGraphIndex = (devChartsGraphIndex + dir + GRAPH_NAMES.length) % GRAPH_NAMES.length;
  renderDevCharts();
}

function devChartsNavMonth(dir) {
  devChartsMonth = (devChartsMonth + dir + 12) % 12;
  renderDevCharts();
}

function renderDevCharts() {
  const container = document.getElementById('dash-dev-charts');
  if (!container) return;

  const active = developers.filter(d => d.status === 'active');
  const year = 2026;
  const mi = devChartsMonth;
  const graphIdx = devChartsGraphIndex;

  // month-dependent: only graphs 0, 3 use month
  const monthUsed = [0, 3].includes(graphIdx);
  const monthLabel = MTH_SHORT[mi] + ' ' + year;

  // ── Data ─────────────────────────────────────────────────────────────────
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  const monthStart = new Date(year, mi, 1);
  const monthEnd = new Date(year, mi + 1, 0);

  // Devs per team — track dev ID sets for accurate join/leave trend
  // Use ALL developers (not just active) — status reflects today, not historical reality
  const teamDevSets = {};
  const prevTeamDevSets = {};
  allTeams.forEach(t => {
    teamDevSets[t] = new Set(developers.filter(d =>
      (d.assignments||[]).some(a => {
        if (a.team !== t || a.billable === false) return false;
        const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return s <= monthEnd && e >= monthStart;
      })
    ).map(d => d.id));
  });

  const prevMi = (mi - 1 + 12) % 12;
  const prevMonthStart = new Date(year, prevMi, 1);
  const prevMonthEnd = new Date(year, prevMi + 1, 0);
  allTeams.forEach(t => {
    prevTeamDevSets[t] = new Set(developers.filter(d =>
      (d.assignments||[]).some(a => {
        if (a.team !== t || a.billable === false) return false;
        const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return s <= prevMonthEnd && e >= prevMonthStart;
      })
    ).map(d => d.id));
  });

  const teamCounts = {};
  const prevTeamCounts = {};
  allTeams.forEach(t => {
    teamCounts[t] = teamDevSets[t].size;
    prevTeamCounts[t] = prevTeamDevSets[t].size;
  });

  const totalBillable = Object.values(teamCounts).reduce((a, b) => a + b, 0);
  const prevTotalBillable = Object.values(prevTeamCounts).reduce((a, b) => a + b, 0);
  const trendDiff = totalBillable - prevTotalBillable;

  // Headcount over time
  const headcountByMonth = MTHS.map((mKey2, mii) => {
    const mStart = new Date(year, mii, 1);
    const mEnd = new Date(year, mii + 1, 0);
    return developers.filter(d => {
      if (d.project_start) {
        const ps = new Date(d.project_start);
        const pe = d.project_end ? new Date(d.project_end) : new Date('2099-12-31');
        return ps <= mEnd && pe >= mStart;
      }
      return (d.assignments||[]).some(a => {
        const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return s <= mEnd && e >= mStart;
      });
    }).length;
  });

  // Location
  const locCounts = {};
  developers.filter(d => {
    const ps = d.project_start ? new Date(d.project_start) : null;
    const pe = d.project_end ? new Date(d.project_end) : new Date('2099-12-31');
    return ps && ps <= monthEnd && pe >= monthStart;
  }).forEach(d => {
    const loc = locations.find(l => l.id === d.location_id);
    const ln = loc?.name || 'Unknown';
    locCounts[ln] = (locCounts[ln] || 0) + 1;
  });

  // Rate brackets — 5 seniority groups based on catalog rates
  const ENGINEER_RATES   = [28.92, 29.50, 36.05, 38.40];
  const SENIOR_RATES     = [34.48, 35.17, 46.35, 49.37];
  const LEAD_RATES       = [41.16, 41.99, 51.50, 54.85];
  const PM_RATES         = [46.72, 47.66, 54.59, 58.14];

  const mKey = MTHS[mi];
  const brackets = { 'Engineer': 0, 'Sr. Engineer': 0, 'Lead': 0, 'PM': 0, 'Special rate': 0 };
  active.forEach(d => {
    const r = rates[d.id]?.[mKey];
    if (!r) return;
    const v = Math.round(parseFloat(r) * 100) / 100;
    if (ENGINEER_RATES.includes(v))    brackets['Engineer']++;
    else if (SENIOR_RATES.includes(v)) brackets['Sr. Engineer']++;
    else if (LEAD_RATES.includes(v))   brackets['Lead']++;
    else if (PM_RATES.includes(v))     brackets['PM']++;
    else                               brackets['Special rate']++;
  });

  // Worker type
  const typeCounts = {};
  active.forEach(d => {
    const t = d.workertype || 'Not set';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  // ── Chart height ──────────────────────────────────────────────────────────
  const chartHeight = graphIdx === 0
    ? allTeams.filter(t => teamCounts[t] > 0).length * 28 + 40
    : 300;

  // ── Subtitle ──────────────────────────────────────────────────────────────
  const subtitles = [
    `${monthLabel} · billable assignments`,
    `${year} — all developers on project`,
    `Active developers by location`,
    `${monthLabel} · billing rates`,
    `Active developers by worker type`
  ];

  // ── Legend HTML (for donuts) ──────────────────────────────────────────────
  // Fixed location order: EU locations first, then India
  const EU_LOCATIONS = ['Slovakia', 'Romania', 'Latvia'];
  const IND_LOCATIONS = ['India Pune', 'India Bangalore'];
  const LOC_ORDER = [...EU_LOCATIONS, ...IND_LOCATIONS];
  const LOC_COLORS_MAP = {
    'Slovakia':        '#9B93F0',
    'Romania':         '#6DBFA0',
    'Latvia':          '#7DD4DB',
    'India Pune':      '#F0956A',
    'India Bangalore': '#E0B040',
  };
  const LOC_COLORS_DEFAULT_EU = ['#B0A8F5', '#85D4B8'];
  const LOC_COLORS_DEFAULT_IN = ['#F5A882', '#ECC050'];
  const INNER_COLORS = { 'Europe': '#4A6FE3', 'India': '#E84B3A' };
  const TYPE_COLORS = ['#378ADD','#1D9E75','#D85A30'];
  const BRACKET_COLORS_LEGEND = ['#378ADD','#7F77DD','#1D9E75','#D85A30','#BA7517'];
  let legendHtml = '';
  if (graphIdx === 3) {
    const bKeys = Object.keys(brackets).filter(k => brackets[k] > 0);
    legendHtml = bKeys.map((k, i) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2)"><span style="width:10px;height:10px;border-radius:2px;background:${BRACKET_COLORS_LEGEND[Object.keys(brackets).indexOf(k)]}"></span>${k} ${brackets[k]}</span>`).join('');
  } else if (graphIdx === 2) {
    // Build ordered labels
    const allLocLabels = [
      ...LOC_ORDER.filter(l => locCounts[l] > 0),
      ...Object.keys(locCounts).filter(l => !LOC_ORDER.includes(l) && l !== 'Unknown')
    ];
    if (locCounts['Unknown']) allLocLabels.push('Unknown');
    const euTotal = allLocLabels.filter(l => !IND_LOCATIONS.includes(l) && l !== 'Unknown' && !l.startsWith('India')).reduce((s, l) => s + (locCounts[l]||0), 0);
    const inTotal = allLocLabels.filter(l => IND_LOCATIONS.includes(l) || l.startsWith('India')).reduce((s, l) => s + (locCounts[l]||0), 0);

    legendHtml = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;margin-bottom:4px">Europe (${euTotal})</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${allLocLabels.filter(l => !l.startsWith('India') && l !== 'Unknown').map(l => {
              const color = LOC_COLORS_MAP[l] || LOC_COLORS_DEFAULT_EU[0];
              return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2)"><span style="width:10px;height:10px;border-radius:2px;background:${color}"></span>${l} ${locCounts[l]||0}</span>`;
            }).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;margin-bottom:4px">India (${inTotal})</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${allLocLabels.filter(l => l.startsWith('India')).map(l => {
              const color = LOC_COLORS_MAP[l] || LOC_COLORS_DEFAULT_IN[0];
              return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2)"><span style="width:10px;height:10px;border-radius:2px;background:${color}"></span>${l} ${locCounts[l]||0}</span>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  } else if (graphIdx === 4) {
    const labels = Object.keys(typeCounts);
    legendHtml = labels.map((l, i) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2)"><span style="width:10px;height:10px;border-radius:2px;background:${TYPE_COLORS[i%TYPE_COLORS.length]}"></span>${l} ${typeCounts[l]}</span>`).join('');
  }

  // ── Stat header for teams chart ───────────────────────────────────────────
  let teamsStatHtml = '';
  if (graphIdx === 0) {
    let trendHtml = '';
    if (mi > 0) {
      const trendColor = trendDiff > 0 ? 'var(--green)' : trendDiff < 0 ? 'var(--red)' : 'var(--text-2)';
      const trendArrow = trendDiff > 0 ? '↑' : trendDiff < 0 ? '↓' : '→';
      const trendLabel = trendDiff === 0 ? 'no change' : (trendDiff > 0 ? '+' : '') + trendDiff;
      trendHtml = `<span style="font-size:13px;font-weight:500;color:${trendColor};margin-left:10px">${trendArrow} ${trendLabel} vs ${MTH_SHORT[prevMi]}</span>`;
    }
    teamsStatHtml = `<div style="font-size:15px;font-weight:600;margin-bottom:16px">
      Billable devs: ${totalBillable}${trendHtml}
    </div>`;
  }

  // ── Joiner/leaver legend for teams chart ─────────────────────────────────
  let teamsMovementHtml = '';
  if (graphIdx === 0 && mi > 0) {
    const joiners = []; // { team, name }
    const leavers = [];
    allTeams.forEach(t => {
      const cur = teamDevSets[t] || new Set();
      const prev = prevTeamDevSets[t] || new Set();
      developers.filter(d => cur.has(d.id) && !prev.has(d.id))
        .forEach(d => joiners.push({ team: t, name: d.firstname + ' ' + d.lastname }));
      developers.filter(d => prev.has(d.id) && !cur.has(d.id))
        .forEach(d => leavers.push({ team: t, name: d.firstname + ' ' + d.lastname }));
    });

    const renderGroup = (title, items, color) => {
      if (!items.length) return '';
      return `<div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">${title}</div>
        ${items.map(i => `
          <div style="margin-bottom:4px">
            <div style="font-size:12px;font-weight:500">${i.name}</div>
            <div style="font-size:11px;color:var(--text-3)">${i.team}</div>
          </div>`).join('')}
      </div>`;
    };

    const hasAny = joiners.length || leavers.length;
    teamsMovementHtml = hasAny ? `
      <div style="min-width:180px;max-width:220px;border-left:1px solid var(--border);padding-left:16px;flex-shrink:0">
        ${renderGroup('Joined this month', joiners, 'var(--green)')}
        ${renderGroup('Left previous month', leavers, 'var(--red)')}
      </div>` : '';
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:10px">
      <!-- Month nav -->
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn" onclick="devChartsNavMonth(-1)" style="padding:4px 10px;font-size:13px">&#8592;</button>
        <span style="font-size:13px;font-weight:500;min-width:60px;text-align:center">${monthLabel}</span>
        <button class="btn" onclick="devChartsNavMonth(1)" style="padding:4px 10px;font-size:13px">&#8594;</button>
        ${!monthUsed ? '<span style="font-size:11px;color:var(--text-3);margin-left:4px">month n/a for this chart</span>' : ''}
      </div>
      <!-- Graph nav -->
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn" onclick="devChartsNavGraph(-1)" style="padding:4px 10px;font-size:13px">&#8592;</button>
        <span style="font-size:13px;font-weight:500;min-width:160px;text-align:center">${GRAPH_NAMES[graphIdx]}</span>
        <button class="btn" onclick="devChartsNavGraph(1)" style="padding:4px 10px;font-size:13px">&#8594;</button>
      </div>
    </div>

    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem">
      <div style="font-size:12px;color:var(--text-2);margin-bottom:${legendHtml || teamsStatHtml ? '8px' : '16px'}">${subtitles[graphIdx]}</div>
      ${teamsStatHtml}
      ${legendHtml ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">${legendHtml}</div>` : ''}
      <div style="display:flex;gap:16px;align-items:flex-start">
        <div style="flex:1;position:relative;height:${chartHeight}px">
          <canvas id="dash-chart-canvas"></canvas>
        </div>
        ${teamsMovementHtml}
      </div>
    </div>
  `;

  const chartData = { teamCounts, prevTeamCounts, teamDevSets, prevTeamDevSets, headcountByMonth, locCounts, brackets, typeCounts, allTeams, LOC_ORDER, LOC_COLORS_MAP, LOC_COLORS_DEFAULT_EU, LOC_COLORS_DEFAULT_IN, INNER_COLORS };
  if (window.Chart) {
    _renderSingleChart(graphIdx, mi, chartData);
  } else {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    s.onload = () => _renderSingleChart(graphIdx, mi, chartData);
    document.head.appendChild(s);
  }
}

function _renderSingleChart(graphIdx, mi, data) {
  const { teamCounts, prevTeamCounts, teamDevSets, prevTeamDevSets, headcountByMonth, locCounts, brackets, typeCounts, allTeams, LOC_ORDER, LOC_COLORS_MAP, LOC_COLORS_DEFAULT_EU, LOC_COLORS_DEFAULT_IN, INNER_COLORS } = data;
  const ctx = document.getElementById('dash-chart-canvas')?.getContext('2d');
  if (!ctx) return;

  if (window._dashChartInstance) {
    window._dashChartInstance.destroy();
    window._dashChartInstance = null;
  }

  const LOC_COLORS = ['#7F77DD','#1D9E75','#D85A30','#BA7517','#D4537E'];
  const TYPE_COLORS = ['#378ADD','#1D9E75','#D85A30'];

  if (graphIdx === 0) {
    const showTrend = mi > 0;
    const tLabels = allTeams.filter(t => teamCounts[t] > 0 || (showTrend && prevTeamCounts[t] > 0));
    const tData = tLabels.map(t => teamCounts[t]);
    const tPrev = tLabels.map(t => prevTeamCounts[t] || 0);

    // Per-team joined/left counts using dev ID sets
    const tJoined = tLabels.map(t => {
      if (!showTrend) return 0;
      const cur = teamDevSets[t] || new Set();
      const prev = prevTeamDevSets[t] || new Set();
      return [...cur].filter(id => !prev.has(id)).length;
    });
    const tLeft = tLabels.map(t => {
      if (!showTrend) return 0;
      const cur = teamDevSets[t] || new Set();
      const prev = prevTeamDevSets[t] || new Set();
      return [...prev].filter(id => !cur.has(id)).length;
    });

    window._dashChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: tLabels.map(t => t.length > 22 ? t.substring(0,22)+'…' : t),
        datasets: [{ data: tData, backgroundColor: '#1D9E75', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: {
          x: { ticks: { stepSize: 1 }, beginAtZero: true, max: Math.max(...tData, 1) + 1 },
          y: { ticks: { font: { size: 11 } } }
        },
        animation: {
          onComplete: function() {
            const chart = this;
            const chartCtx = chart.ctx;
            chartCtx.save();
            chart.data.datasets.forEach((dataset, i) => {
              const meta = chart.getDatasetMeta(i);
              meta.data.forEach((bar, index) => {
                const value = dataset.data[index];
                const joined = tJoined[index];
                const left = tLeft[index];
                const hasChange = showTrend && (joined > 0 || left > 0);

                // Value label INSIDE bar, near right edge
                chartCtx.font = 'bold 11px Arial';
                chartCtx.fillStyle = '#ffffff';
                chartCtx.textBaseline = 'middle';
                chartCtx.textAlign = 'right';
                if (bar.x > bar.base + 18) {
                  chartCtx.fillText(value, bar.x - 6, bar.y);
                } else {
                  chartCtx.fillStyle = '#1D9E75';
                  chartCtx.textAlign = 'left';
                  chartCtx.fillText(value, bar.x + 5, bar.y);
                }

                // Trend: +joined -left outside bar
                if (hasChange) {
                  let offsetX = bar.x + (bar.x > bar.base + 18 ? 6 : 22);
                  chartCtx.font = 'bold 10px Arial';
                  chartCtx.textAlign = 'left';
                  if (joined > 0) {
                    chartCtx.fillStyle = '#1D9E75';
                    chartCtx.fillText('+' + joined, offsetX, bar.y);
                    offsetX += chartCtx.measureText('+' + joined).width + 3;
                  }
                  if (left > 0) {
                    chartCtx.fillStyle = '#E53935';
                    chartCtx.fillText('-' + left, offsetX, bar.y);
                  }
                }
              });
            });
            chartCtx.restore();
          }
        }
      }
    });

  } else if (graphIdx === 1) {
    // Headcount over time — line
    window._dashChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: MTH_SHORT,
        datasets: [{
          data: headcountByMonth,
          borderColor: '#7F77DD', backgroundColor: 'rgba(127,119,221,0.1)',
          fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#7F77DD'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { stepSize: 1 }, beginAtZero: false }, x: { ticks: { autoSkip: false } } }
      }
    });

  } else if (graphIdx === 2) {
    // Location — nested donut: outer=locations, inner=EU vs India
    const allLocLabels = [
      ...LOC_ORDER.filter(l => locCounts[l] > 0),
      ...Object.keys(locCounts).filter(l => !LOC_ORDER.includes(l) && l !== 'Unknown' && locCounts[l] > 0)
    ];
    if (locCounts['Unknown']) allLocLabels.push('Unknown');

    const outerData = allLocLabels.map(l => locCounts[l] || 0);
    const outerColors = allLocLabels.map(l => LOC_COLORS_MAP[l] || (l.startsWith('India') ? LOC_COLORS_DEFAULT_IN[0] : LOC_COLORS_DEFAULT_EU[0]));

    const euTotal = allLocLabels.filter(l => !l.startsWith('India') && l !== 'Unknown').reduce((s, l) => s + (locCounts[l]||0), 0);
    const inTotal = allLocLabels.filter(l => l.startsWith('India')).reduce((s, l) => s + (locCounts[l]||0), 0);

    window._dashChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [
          {
            data: outerData,
            backgroundColor: outerColors,
            borderWidth: 2,
            borderColor: '#fff',
            weight: 1
          },
          {
            data: [euTotal, inTotal],
            backgroundColor: [INNER_COLORS['Europe'], INNER_COLORS['India']],
            borderWidth: 2,
            borderColor: '#fff',
            weight: 1
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '0%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const value = ctx.parsed;
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = Math.round(value / total * 100);
                const label = ctx.datasetIndex === 0
                  ? allLocLabels[ctx.dataIndex]
                  : ['Europe', 'India'][ctx.dataIndex];
                return ` ${label}: ${value} (${pct}%)`;
              }
            }
          }
        }
      },
      plugins: [{
        id: 'ringLabels',
        afterDraw(chart) {
          const { ctx: c } = chart;
          c.save();
          c.textBaseline = 'middle';
          c.textAlign = 'center';

          chart.data.datasets.forEach((dataset, di) => {
            const meta = chart.getDatasetMeta(di);
            meta.data.forEach((arc, i) => {
              const value = dataset.data[i];
              if (!value) return;
              const total = dataset.data.reduce((a, b) => a + b, 0);
              const pct = Math.round(value / total * 100);

              // midpoint angle
              const startAngle = arc.startAngle;
              const endAngle = arc.endAngle;
              const midAngle = (startAngle + endAngle) / 2;
              const midR = (arc.innerRadius + arc.outerRadius) / 2;
              const x = arc.x + Math.cos(midAngle) * midR;
              const y = arc.y + Math.sin(midAngle) * midR;

              // skip tiny segments (less than 8% of total)
              if (pct < 8) return;

              if (di === 1) {
                // Inner circle — "EU 32" / "IN 18"
                const shortLabel = i === 0 ? 'EU' : 'IN';
                c.font = 'bold 16px Arial';
                c.fillStyle = '#ffffff';
                c.fillText(shortLabel, x, y - 10);
                c.font = 'bold 15px Arial';
                c.fillText(value, x, y + 10);
              } else {
                // Outer ring — location abbrev + count
                const fullLabel = allLocLabels[i] || '';
                const shortLabel = fullLabel.replace('India ', 'IN ').replace('Slovakia', 'SK').replace('Romania', 'RO').replace('Latvia', 'LV');
                c.font = 'bold 13px Arial';
                c.fillStyle = '#ffffff';
                c.fillText(shortLabel, x, y - 8);
                c.font = '12px Arial';
                c.fillText(value, x, y + 8);
              }
            });
          });
          c.restore();
        }
      }]
    });

  } else if (graphIdx === 3) {
    // Billing rate brackets — pie chart
    const BRACKET_COLORS = ['#378ADD','#7F77DD','#1D9E75','#D85A30','#BA7517'];
    const bLabels = Object.keys(brackets).filter(k => brackets[k] > 0);
    const bData = bLabels.map(k => brackets[k]);
    const bColors = bLabels.map((k, i) => BRACKET_COLORS[Object.keys(brackets).indexOf(k)]);
    window._dashChartInstance = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: bLabels,
        datasets: [{ data: bData, backgroundColor: bColors, borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => {
                const total = c.dataset.data.reduce((a, b) => a + b, 0);
                const pct = Math.round(c.parsed / total * 100);
                return ` ${c.label}: ${c.parsed} (${pct}%)`;
              }
            }
          }
        }
      },
      plugins: [{
        id: 'pieLabels',
        afterDraw(chart) {
          const { ctx: c } = chart;
          c.save();
          c.textBaseline = 'middle';
          c.textAlign = 'center';
          chart.data.datasets.forEach((dataset, di) => {
            const meta = chart.getDatasetMeta(di);
            const total = dataset.data.reduce((a, b) => a + b, 0);
            meta.data.forEach((arc, i) => {
              const value = dataset.data[i];
              const pct = Math.round(value / total * 100);
              if (pct < 5) return;
              const midAngle = (arc.startAngle + arc.endAngle) / 2;
              const midR = arc.innerRadius + (arc.outerRadius - arc.innerRadius) * 0.60;
              const x = arc.x + Math.cos(midAngle) * midR;
              const y = arc.y + Math.sin(midAngle) * midR;
              c.fillStyle = '#ffffff';
              c.font = 'bold 13px Arial';
              c.fillText(bLabels[i], x, y - 8);
              c.font = 'bold 12px Arial';
              c.fillText(value, x, y + 8);
            });
          });
          c.restore();
        }
      }]
    });

  } else if (graphIdx === 4) {
    // Worker type — donut
    const typeLabels = Object.keys(typeCounts);
    window._dashChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: typeLabels, datasets: [{ data: Object.values(typeCounts), backgroundColor: TYPE_COLORS.slice(0, typeLabels.length), borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  }
}

// ============================================================
// MONTH READINESS CHECK
// ============================================================

function checkDevReadiness(dev, month, year) {
  const red = [];
  const amber = [];
  const mKey = MTHS[month - 1];
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];

  const hasAssignment = (dev.assignments || []).some(a => {
    if (!allTeams.includes(a.team) || a.billable === false) return false;
    const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
    const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
    return s <= monthEnd && e >= monthStart;
  });
  if (!hasAssignment) { red.push('No active billable assignment'); return { red, amber }; }

  const rate = rates[dev.id]?.[mKey];
  if (!rate || parseFloat(rate) <= 0) red.push('No billing rate');

  const ah = actualHours[String(dev.id)]?.[month];
  const hours = ah ? parseFloat(ah.hours) : 0;
  if (!ah || hours <= 0) red.push('No actuals imported (hours > 0)');

  const sal = salariesData.find(s => s.developer_id === dev.id && s.year === year && s.month === month);
  if (!sal?.salary) amber.push('Salary missing');

  const ctc = ctcData.find(c => c.developer_id === dev.id && c.year === year && c.month === month);
  if (!ctc?.amount) amber.push('CTC missing');

  const loc = locations.find(l => l.id === dev.location_id);
  const workerType = dev.workertype === 'Contractor' ? 'Contractor' : 'FTE';
  const oh = overheadRates.find(r => r.location === loc?.name && r.worker_type === workerType && r.year === year && r.month === month);
  if (!oh?.amount && oh?.amount !== 0) amber.push('Overhead not defined');

  return { red, amber };
}

function renderReadiness() {
  const month = parseInt(document.getElementById('dash-month')?.value) || 1;
  const year = 2026;
  const summaryEl = document.getElementById('dash-summary');
  const teamsEl = document.getElementById('dash-teams');
  if (!summaryEl || !teamsEl) return;

  summaryEl.innerHTML = '<div style="color:var(--text-3);font-size:13px">Checking...</div>';
  teamsEl.innerHTML = '';

  const allTeams = [...EU_TEAMS.filter(t => t !== 'Selfhosting'), ...IND_TEAMS];
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);

  let totalGreen = 0, totalAmber = 0, totalRed = 0;
  const teamResults = [];

  allTeams.forEach(team => {
    const devs = developers.filter(d =>
      d.status === 'active' &&
      (d.assignments || []).some(a => {
        if (a.team !== team || a.billable === false) return false;
        const s = a.start_date ? new Date(a.start_date) : new Date('2000-01-01');
        const e = a.end_date ? new Date(a.end_date) : new Date('2099-12-31');
        return s <= monthEnd && e >= monthStart;
      })
    );
    if (!devs.length) return;

    const devResults = devs.map(dev => {
      const { red, amber } = checkDevReadiness(dev, month, year);
      return { dev, red, amber };
    });

    const hasRed = devResults.some(r => r.red.length > 0);
    const hasAmber = devResults.some(r => r.amber.length > 0);
    const status = hasRed ? 'red' : hasAmber ? 'amber' : 'green';

    if (status === 'green') totalGreen++;
    else if (status === 'amber') totalAmber++;
    else totalRed++;

    teamResults.push({ team, devResults, status });
  });

  const sr = calcSelfhostingRevenue(month - 1);
  const shStatus = sr.revenue > 0 ? 'green' : 'red';
  if (shStatus === 'green') totalGreen++; else totalRed++;
  teamResults.push({ team: 'Selfhosting', status: shStatus, devResults: [],
    specialMsg: shStatus === 'green' ? `Revenue configured: €${Math.round(sr.revenue).toLocaleString('de-DE')}` : 'No selfhosting revenue configured' });

  summaryEl.innerHTML = [
    totalRed ? `<div style="background:#fff0f0;border:1px solid #fca5a5;border-radius:var(--radius);padding:10px 16px;font-size:13px;font-weight:500;color:var(--red)">🔴 ${totalRed} team${totalRed!==1?'s':''} with errors</div>` : '',
    totalAmber ? `<div style="background:#fff8e1;border:1px solid #fcd34d;border-radius:var(--radius);padding:10px 16px;font-size:13px;font-weight:500;color:var(--amber)">🟡 ${totalAmber} team${totalAmber!==1?'s':''} with warnings</div>` : '',
    totalGreen ? `<div style="background:var(--green-lt);border:1px solid #86efac;border-radius:var(--radius);padding:10px 16px;font-size:13px;font-weight:500;color:var(--green)">🟢 ${totalGreen} team${totalGreen!==1?'s':''} ready</div>` : '',
  ].join('');

  teamsEl.innerHTML = teamResults.map(tr => {
    const icon = tr.status === 'green' ? '🟢' : tr.status === 'amber' ? '🟡' : '🔴';
    const redCount = tr.devResults.filter(r => r.red.length > 0).length;
    const amberCount = tr.devResults.filter(r => r.amber.length > 0 && r.red.length === 0).length;
    const badge = tr.devResults.length
      ? `<span style="font-size:12px;color:var(--text-2);margin-left:8px">${tr.devResults.length} dev${tr.devResults.length!==1?'s':''}</span>`
        + (redCount ? `<span style="font-size:12px;color:var(--red);margin-left:8px">● ${redCount} error${redCount!==1?'s':''}</span>` : '')
        + (amberCount ? `<span style="font-size:12px;color:var(--amber);margin-left:8px">● ${amberCount} warning${amberCount!==1?'s':''}</span>` : '')
      : tr.specialMsg ? `<span style="font-size:12px;color:${tr.status==='green'?'var(--green)':'var(--red)'};margin-left:8px">${tr.specialMsg}</span>` : '';

    const devRows = tr.devResults.length ? tr.devResults.map(dr => {
      if (dr.red.length === 0 && dr.amber.length === 0) {
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 16px;border-bottom:1px solid var(--border)">
          <span>🟢</span>
          <span style="font-size:13px;min-width:180px">${dr.dev.firstname} ${dr.dev.lastname}</span>
          <span style="font-size:12px;color:var(--green)">All checks passed</span>
        </div>`;
      }
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 16px;border-bottom:1px solid var(--border);background:${dr.red.length?'#fff8f8':'#fffdf0'}">
        <span style="margin-top:1px">${dr.red.length ? '🔴' : '🟡'}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">${dr.dev.firstname} ${dr.dev.lastname}</div>
          ${dr.red.map(e => `<div style="font-size:12px;color:var(--red);margin-top:2px">✗ ${e}</div>`).join('')}
          ${dr.amber.map(e => `<div style="font-size:12px;color:var(--amber);margin-top:2px">⚠ ${e}</div>`).join('')}
        </div>
      </div>`;
    }).join('') : '';

    return `<div style="border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface);cursor:${tr.devResults.length?'pointer':'default'}"
        onclick="${tr.devResults.length?`toggleDashTeam(this)`:''}">
        <span style="font-size:16px">${icon}</span>
        <span style="font-weight:600;font-size:14px;flex:1">${tr.team}</span>
        ${badge}
        ${tr.devResults.length ? '<span style="color:var(--text-3);font-size:12px">▼</span>' : ''}
      </div>
      ${devRows ? `<div style="display:none">${devRows}</div>` : ''}
    </div>`;
  }).join('');
}

function toggleDashTeam(headerEl) {
  const detail = headerEl.nextElementSibling;
  if (!detail) return;
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : '';
  const arrow = headerEl.querySelector('span:last-child');
  if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
}

function openChecksInfo() {
  document.getElementById('checks-info-modal').classList.add('open');
}

function openTsChecksInfo() {
  document.getElementById('ts-checks-info-modal').classList.add('open');
}
