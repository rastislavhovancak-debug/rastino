async function loadDevs() {
  document.getElementById('table-body').innerHTML = '<tr><td colspan="7" class="loading">Loading...</td></tr>';
  const { data: devs, error } = await db.from('developers').select('*').order('lastname');
  if (error) { showToast('Error loading data: ' + error.message); return; }
  const { data: assignments } = await db.from('developer_assignments')
    .select('*, assignment_wbs_codes(*)').order('start_date');
  developers = devs.map(d => ({
    ...d,
    project_start: d.project_start || null,
    project_end: d.project_end || null,
    assignments: (assignments||[])
      .filter(a => a.developer_id === d.id)
      .map(a => ({...a, wbs: a.assignment_wbs_codes || []}))
  }));
  renderDevs();
}

function getAvatarClass(c) {
  if (c === 'Slovakia') return 'avatar av-sk';
  if (c === 'Romania') return 'avatar av-ro';
  if (c === 'Latvia') return 'avatar av-lv';
  if (c === 'India') return 'avatar av-in';
  return 'avatar av-other';
}
function getInitials(d) { return (d.firstname[0]||'')+(d.lastname[0]||''); }

let devSelectedTeam = null; // null = all teams view

function switchDevTab(tab) {
  devTab = tab;
  document.getElementById('btn-tab-ness').classList.toggle('active', tab==='ness');
  document.getElementById('btn-tab-here').classList.toggle('active', tab==='here');
  const n2 = document.getElementById('btn-tab-ness2');
  const h2 = document.getElementById('btn-tab-here2');
  if (n2) n2.classList.toggle('active', tab==='ness');
  if (h2) h2.classList.toggle('active', tab==='here');
  renderDevs();
}

function getOrderedDevTeams() {
  const status = getStatusFilter();
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

function devSelectTeam(team, keepFilter) {
  devSelectedTeam = team;
  document.getElementById('dev-toolbar-all').style.display = 'none';
  document.getElementById('dev-toolbar-team').style.display = '';
  document.getElementById('dev-team-title-row').style.display = '';
  document.getElementById('dev-team-title').textContent = team;
  if (!keepFilter) {
    const s = document.getElementById('filter-status').value;
    document.getElementById('filter-status2').value = s;
  }
  renderDevs();
}

function devBackToAll() {
  devSelectedTeam = null;
  document.getElementById('dev-toolbar-all').style.display = '';
  document.getElementById('dev-toolbar-team').style.display = 'none';
  document.getElementById('dev-team-title-row').style.display = 'none';
  renderDevs();
}

function devPrevTeam() {
  const teams = getOrderedDevTeams();
  const idx = teams.indexOf(devSelectedTeam);
  const prev = teams[(idx - 1 + teams.length) % teams.length];
  devSelectTeam(prev, true);
}

function devNextTeam() {
  const teams = getOrderedDevTeams();
  const idx = teams.indexOf(devSelectedTeam);
  const next = teams[(idx + 1) % teams.length];
  devSelectTeam(next, true);
}

function switchDevLayout(layout) { renderDevs(); }

let devSort = {field: 'lastname', dir: 'asc'}; // default sort

function setDevSort(field) {
  if (devSort.field === field) {
    devSort.dir = devSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    devSort.field = field;
    devSort.dir = 'asc';
  }
  renderDevs();
}

function sortArrow(field) {
  if (devSort.field !== field) return '<span style="color:#ccc;font-size:10px"> ⇅</span>';
  return devSort.dir === 'asc' ? '<span style="font-size:10px"> ▲</span>' : '<span style="font-size:10px"> ▼</span>';
}

function getSorted(arr, forceId) {
  const field = forceId ? 'nessid' : devSort.field;
  const dir = forceId ? 'asc' : devSort.dir;
  return [...arr].sort((a, b) => {
    if (field === 'nessid') {
      const diff = parseInt(a.nessid||0) - parseInt(b.nessid||0);
      return dir === 'asc' ? diff : -diff;
    }
    if (field === 'hereid') {
      const diff = parseInt(a.hereid||0) - parseInt(b.hereid||0);
      return dir === 'asc' ? diff : -diff;
    }
    // Default: use dev order position, fallback to lastname
    const pa = getDevPosition(a.id);
    const pb = getDevPosition(b.id);
    const diff = pa !== pb ? pa - pb : (a.lastname||'').localeCompare(b.lastname||'');
    return dir === 'asc' ? diff : -diff;
  });
}

let EU_TEAMS = ['3D Visuals EU','MOM10 Visuals','Connected veh. ser.','EarthCore dep.','EV dev.','MOM transition','Tour planning','Lumiere program EU','Selfhosting'];
let IND_TEAMS = ['3D Visuals IN','Lumiere program IN','CSTR Places','Curvature at junction','Japan Roadmap'];

const MTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Get all active assignments for a developer in a given month (1-based)
function getActiveAssignments(dev, year, month) {
  if (!dev.assignments || !dev.assignments.length) return [];
  const date = new Date(year, month - 1, 1); // first of month
  const dateEnd = new Date(year, month, 0);  // last of month
  return dev.assignments.filter(a => {
    const start = a.start_date ? new Date(a.start_date) : null;
    const end = a.end_date ? new Date(a.end_date) : null;
    if (start && start > dateEnd) return false;
    if (end && end < date) return false;
    return true;
  });
}

// Get developer's current team (most recent active assignment as of today)
function getDevCurrentTeam(dev) {
  if (!dev.assignments || !dev.assignments.length) return dev.team || null;
  const today = new Date();
  const active = dev.assignments.filter(a => {
    const start = a.start_date ? new Date(a.start_date) : null;
    const end = a.end_date ? new Date(a.end_date) : null;
    if (start && start > today) return false;
    if (end && end < today) return false;
    return true;
  });
  // Prefer billable assignments for team display
  const billableActive = active.filter(a => a.billable !== false);
  if (billableActive.length) return billableActive[billableActive.length - 1].team;
  if (active.length) return active[active.length - 1].team;
  // fallback to latest billable assignment
  const billable = dev.assignments.filter(a => a.billable !== false);
  if (billable.length) return billable[billable.length - 1].team;
  return dev.assignments[dev.assignments.length - 1].team;
}

// Check if month is a partial month (start or end within that month) — billable assignments only
function isPartialMonth(dev, year, month) {
  if (!dev.assignments || !dev.assignments.length) return false;
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  return dev.assignments.filter(a => a.billable !== false).some(a => {
    const start = a.start_date ? new Date(a.start_date) : null;
    const end = a.end_date ? new Date(a.end_date) : null;
    const startPartial = start && start >= firstDay && start <= lastDay && start.getDate() > 1;
    const endPartial = end && end >= firstDay && end <= lastDay && end.getDate() < lastDay.getDate();
    return startPartial || endPartial;
  });
}

function getStatusFilter() {
  if (devSelectedTeam) return document.getElementById('filter-status2').value;
  return document.getElementById('filter-status').value;
}

function getFiltered() {
  const status = getStatusFilter();
  return developers.filter(d => {
    const devTeam = getDevCurrentTeam(d);
    const matchTeam = devSelectedTeam ? (d.assignments||[]).some(a => a.team === devSelectedTeam) : true;
    const matchStatus = status === 'all' || d.status === status;
    return matchTeam && matchStatus;
  });
}

function renderDevs() {
  const filtered = getSorted(getFiltered());
  const allTeams = [...new Set(developers.flatMap(d=>(d.assignments||[]).map(a=>a.team)).filter(Boolean))].sort();
  const tl = document.getElementById('team-list');
  if (tl) tl.innerHTML = allTeams.map(t=>`<option value="${t}">`).join('');
  const head = document.getElementById('table-head');
  const body = document.getElementById('table-body');
  const totalWbs = d => (d.assignments||[]).reduce((s,a)=>s+(a.wbs||[]).length,0);

  // ── helper: build grouped team HTML ──────────────────────────────────
  function buildTeamGroups(devsList, colCount, rowFn) {
    const teamDevs = {};
    const allDevsSorted = getSorted(devsList);
    allDevsSorted.forEach(d => {
      const team = getDevCurrentTeam(d) || 'Unassigned';
      if (!teamDevs[team]) teamDevs[team] = [];
      teamDevs[team].push(d);
    });
    const orderedTeams = [
      ...getOrderedTeams().filter(t => teamDevs[t]),
      ...Object.keys(teamDevs).filter(t => !EU_TEAMS.includes(t) && !IND_TEAMS.includes(t))
    ];
    return orderedTeams.map(team => {
      const devs = teamDevs[team];
      const activeCount = devs.filter(d => d.status === 'active').length;
      const teamRow = `<tr style="background:#f0f4ff;cursor:pointer" onclick="devSelectTeam('${team}')">
        <td colspan="${colCount}" style="font-weight:600;font-size:13px;color:var(--blue);padding:8px 12px;border-top:2px solid #dde4f5">
          ${team}
          <span style="font-weight:400;font-size:12px;color:var(--text-2);margin-left:8px">${activeCount} active${devs.length !== activeCount ? ` / ${devs.length} total` : ''}</span>
          <span style="float:right;font-size:11px;color:var(--text-3);font-weight:400">›</span>
        </td>
      </tr>`;
      return teamRow + devs.map(rowFn).join('');
    }).join('');
  }

  const thS = 'cursor:pointer;user-select:none;';

  if (devTab === 'ness') {
    // ── NESS view ─────────────────────────────────────────────────────────
    head.innerHTML = `<tr>
      <th style="width:20%">Name</th>
      <th style="width:8%">NESS ID</th>
      <th style="width:14%">Job Title</th>
      <th style="width:8%">Job Level</th>
      <th style="width:19%">Email</th>
      <th style="width:10%">Country</th>
      <th style="width:9%">Worker Type</th>
      <th style="width:7%">Assignments</th>
      <th style="width:8%">Status</th>
    </tr>`;
    const rowFnNess = d => `<tr onclick="openDetail(${d.id})" style="background:var(--surface)">
      <td><div class="name-cell"><div class="${getAvatarClass(d.country)}">${getInitials(d)}</div><div><div>${d.firstname} ${d.lastname}</div></div></div></td>
      <td style="font-size:12px">${d.nessid}</td>
      <td style="font-size:12px">${d.job_title||'—'}</td>
      <td style="font-size:12px">${d.job_level||'—'}</td>
      <td style="font-size:12px">${d.nessemail||'—'}</td>
      <td style="font-size:12px">${d.country||'—'}</td>
      <td style="font-size:12px">${d.workertype||'—'}</td>
      <td style="font-size:12px;text-align:center">${(d.assignments||[]).length}</td>
      <td><span class="badge ${d.status==='active'?'badge-active':'badge-inactive'}">${d.status}</span></td>
    </tr>`;
    if (devSelectedTeam) {
      body.innerHTML = filtered.length ? filtered.map(rowFnNess).join('') : '<tr><td colspan="9" class="empty">No developers found</td></tr>';
    } else {
      body.innerHTML = buildTeamGroups(filtered, 9, rowFnNess);
    }

  } else {
    // ── HERE view ─────────────────────────────────────────────────────────
    const curTeam = d => getDevCurrentTeam(d) || '—';
    head.innerHTML = `<tr>
      <th style="width:24%">Name</th>
      <th style="width:9%">HERE ID</th>
      <th style="width:21%">HERE email</th>
      <th style="width:18%">Team</th>
      <th style="width:15%">HERE Role</th>
      <th style="width:13%">Status</th>
    </tr>`;
    const rowFnHere = d => `<tr onclick="openDetail(${d.id})" style="background:var(--surface)">
      <td><div class="name-cell"><div class="${getAvatarClass(d.country)}">${getInitials(d)}</div><div><div>${d.firstname} ${d.lastname}</div><div class="name-sub">${d.country||''}</div></div></div></td>
      <td style="font-size:12px">${d.hereid||'—'}</td>
      <td style="font-size:12px">${d.hereemail||'—'}</td>
      <td><span class="badge-team">${curTeam(d)}</span></td>
      <td style="font-size:12px">${getRoleFromRate(d)}</td>
      <td><span class="badge ${d.status==='active'?'badge-active':'badge-inactive'}">${d.status}</span></td>
    </tr>`;
    if (devSelectedTeam) {
      body.innerHTML = filtered.length ? filtered.map(rowFnHere).join('') : '<tr><td colspan="6" class="empty">No developers found</td></tr>';
    } else {
      body.innerHTML = buildTeamGroups(filtered, 6, rowFnHere);
    }
  }
}

function openDetail(id) {
  detailId = id;
  const d = developers.find(x=>x.id===id);
  if (!d) return;
  const locName = locations.find(l=>l.id===d.location_id)?.name||'—';
  const statusText = `<span style="color:${d.status==='active'?'#1a7340':'#666'};font-weight:500">${d.status}</span>`;

  // Build assignments section
  const assignmentsHtml = (d.assignments||[]).length ? (d.assignments||[]).map(a => {
    const start = a.start_date ? a.start_date.substring(0,10) : '—';
    const end = a.end_date ? a.end_date.substring(0,10) : 'present';
    const billableBadge = a.billable === false
      ? '<span style="font-size:11px;color:var(--amber);background:var(--amber-lt);padding:2px 8px;border-radius:99px">Not billable</span>'
      : '<span style="font-size:11px;color:var(--green);background:var(--green-lt);padding:2px 8px;border-radius:99px">Billable T&M</span>';
    const wbs = (a.wbs||[]).length
      ? (a.wbs||[]).map(w=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;color:#444"><span>${w.code}</span><span style="color:#888">${w.type}</span></div>`).join('')
      : '<div style="font-size:12px;color:var(--text-3)">No WBS codes</div>';
    return `<div style="background:#f9f9f9;border-radius:var(--radius-sm);padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:500;font-size:13px">${a.team}</span>
        <div style="display:flex;gap:6px;align-items:center">
          ${billableBadge}
          <span style="font-size:11px;color:var(--text-2);background:#eee;padding:2px 8px;border-radius:99px">${start} → ${end}</span>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">PO: ${a.po||'—'}</div>
      ${wbs}
    </div>`;
  }).join('') : '<div style="font-size:13px;color:var(--text-3);padding:6px 0">No assignments</div>';

  document.getElementById('detail-name').textContent = d.firstname+' '+d.lastname;
  document.getElementById('detail-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem">
      <div>
        <div class="detail-section"><h3>NESS info</h3>
          <div class="detail-row"><span>NESS ID</span><span>${d.nessid}</span></div>
          <div class="detail-row"><span>Ness email</span><span style="font-size:12px">${d.nessemail||'—'}</span></div>
          <div class="detail-row"><span>Status</span><span>${statusText}</span></div>
          <div class="detail-row"><span>Project start</span><span>${d.project_start||'—'}</span></div>
          <div class="detail-row"><span>Project end</span><span>${d.project_end||'<span style="color:var(--green);font-size:12px">Active</span>'}</span></div>
          <div class="detail-row"><span>Country</span><span>${d.country||'—'}</span></div>
          <div class="detail-row"><span>Location calendar</span><span>${locName}</span></div>
          <div class="detail-row"><span>Worker type</span><span>${d.workertype||'—'}</span></div>
          <div class="detail-row"><span>Job Title</span><span>${d.job_title||'—'}</span></div>
          <div class="detail-row"><span>Job Level</span><span>${d.job_level||'—'}</span></div>
        </div>
      </div>
      <div>
        <div class="detail-section"><h3>HERE info</h3>
          <div class="detail-row"><span>HERE ID</span><span>${d.hereid||'—'}</span></div>
          <div class="detail-row"><span>HERE account</span><span>${d.hereaccount||'—'}</span></div>
          <div class="detail-row"><span>HERE email</span><span style="font-size:12px">${d.hereemail||'—'}</span></div>
          <div class="detail-row"><span>HERE Role</span><span>${getRoleFromRate(d)}</span></div>
          <div class="detail-row"><span>Billing rate</span><span>${getStandardRate(d) != null ? '€'+getStandardRate(d).toFixed(2)+'/h' : '—'}</span></div>
        </div>
        <div class="detail-section"><h3>Assignments & WBS codes</h3>
          ${assignmentsHtml}
        </div>
      </div>
    </div>`;
  document.getElementById('detail-modal').classList.add('open');
}

function editFromDetail() { closeModal('detail-modal'); openEdit(detailId); }

let assignmentCount = 0;

function openAdd() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add developer';
  document.getElementById('btn-delete').style.display = 'none';
  ['firstname','lastname','nessid','hereid','hereaccount','nessemail','hereemail','job-title','job-level'].forEach(f => document.getElementById('f-'+f).value='');
  document.getElementById('f-status').value='active';
  document.getElementById('f-project-start').value='';
  document.getElementById('f-project-end').value='';
  document.getElementById('f-country').value='';
  document.getElementById('f-location').value='';
  document.getElementById('f-workertype').value='';

  assignmentCount=0;
  document.getElementById('assignments-list').innerHTML='';
  addAssignmentRow();
  document.getElementById('add-modal').classList.add('open');
}

function openEdit(id) {
  const d = developers.find(x=>x.id===id);
  if (!d) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'Edit developer';
  document.getElementById('btn-delete').style.display = 'block';
  ['firstname','lastname','nessid','hereid','hereaccount','nessemail','hereemail'].forEach(f => document.getElementById('f-'+f).value=d[f]||'');
  document.getElementById('f-job-title').value=d.job_title||'';
  document.getElementById('f-job-level').value=d.job_level||'';
  document.getElementById('f-status').value=d.status||'active';
  document.getElementById('f-project-start').value=d.project_start||'';
  document.getElementById('f-project-end').value=d.project_end||'';
  document.getElementById('f-country').value=d.country||'';
  document.getElementById('f-location').value=d.location_id||'';
  document.getElementById('f-billing-location').value=d.billing_location||'';
  document.getElementById('f-workertype').value=d.workertype||'';

  assignmentCount=0;
  document.getElementById('assignments-list').innerHTML='';
  if ((d.assignments||[]).length) {
    d.assignments.forEach(a => addAssignmentRow(a));
  } else {
    addAssignmentRow();
  }
  document.getElementById('add-modal').classList.add('open');
}

function addAssignmentRow(a={}) {
  const i = assignmentCount++;
  const allTeams = [...EU_TEAMS, ...IND_TEAMS];
  const teamOptions = allTeams.map(t => `<option value="${t}"${a.team===t?' selected':''}>${t}</option>`).join('');
  const wbsHtml = (a.wbs||[]).map((w,wi) => `
    <div class="wbs-row" id="wbs-${i}-${wi}">
      <input type="text" value="${w.code}" id="wbs-code-${i}-${wi}" placeholder="UK-TM-00022-ENG-KES-B">
      <select id="wbs-type-${i}-${wi}"><option${w.type==='Billable'?' selected':''}>Billable</option><option${w.type==='Non-Billable'?' selected':''}>Non-Billable</option></select>
      <button class="btn" onclick="document.getElementById('wbs-${i}-${wi}').remove()" style="padding:4px 8px">×</button>
    </div>`).join('');

  const div = document.createElement('div');
  div.id = `assignment-${i}`;
  div.style.cssText = 'background:#f9f9f9;border-radius:var(--radius-sm);padding:12px;margin-bottom:10px;border:1px solid var(--border)';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-weight:500;font-size:13px">Assignment ${i+1}</span>
      <div style="display:flex;align-items:center;gap:10px">
        <label style="font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer">
          <input type="checkbox" id="asgn-billable-${i}" ${a.billable===false?'':'checked'} style="cursor:pointer">
          <span>Billable (T&M)</span>
        </label>
        <button class="btn" onclick="document.getElementById('assignment-${i}').remove()" style="padding:3px 8px;font-size:12px">Remove</button>
      </div>
    </div>
    <input type="hidden" id="asgn-id-${i}" value="${a.id||''}">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div class="form-group" style="margin:0"><label>Team *</label>
        <select id="asgn-team-${i}" style="width:100%"><option value="">Select team...</option>${teamOptions}</select>
      </div>
      <div class="form-group" style="margin:0"><label>PO #</label>
        <input type="text" id="asgn-po-${i}" value="${a.po||''}" placeholder="50019236">
      </div>
      <div class="form-group" style="margin:0"><label>Start date</label>
        <input type="date" id="asgn-start-${i}" value="${a.start_date?a.start_date.substring(0,10):''}">
      </div>
      <div class="form-group" style="margin:0"><label>End date <span style="color:var(--text-3);font-weight:400">(leave empty if active)</span></label>
        <input type="date" id="asgn-end-${i}" value="${a.end_date?a.end_date.substring(0,10):''}">
      </div>
    </div>
    <div style="font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:6px">WBS codes</div>
    <div id="wbs-list-${i}">${wbsHtml}</div>
    <button class="btn" onclick="addWbsToAssignment(${i})" style="font-size:12px;padding:4px 10px;margin-top:4px">+ Add WBS code</button>`;
  document.getElementById('assignments-list').appendChild(div);
}

function addWbsToAssignment(i, code='', type='Billable') {
  const list = document.getElementById(`wbs-list-${i}`);
  const wi = list.children.length;
  const div = document.createElement('div');
  div.className = 'wbs-row';
  div.id = `wbs-${i}-${wi}`;
  div.innerHTML = `
    <input type="text" value="${code}" id="wbs-code-${i}-${wi}" placeholder="UK-TM-00022-ENG-KES-B">
    <select id="wbs-type-${i}-${wi}"><option${type==='Billable'?' selected':''}>Billable</option><option${type==='Non-Billable'?' selected':''}>Non-Billable</option></select>
    <button class="btn" onclick="this.parentElement.remove()" style="padding:4px 8px">×</button>`;
  list.appendChild(div);
}

// Auto-set status based on assignments
function calcAutoStatus(assignments) {
  if (!assignments || !assignments.length) return 'inactive';
  const today = new Date();
  today.setHours(0,0,0,0);
  const hasActive = assignments.some(a => {
    const start = a.start_date ? new Date(a.start_date) : null;
    const end = a.end_date ? new Date(a.end_date) : null;
    if (start && start > today) return false;
    if (end && end < today) return false;
    return true;
  });
  return hasActive ? 'active' : 'inactive';
}

async function saveDev() {
  const firstname = document.getElementById('f-firstname').value.trim();
  const lastname = document.getElementById('f-lastname').value.trim();
  const nessid = document.getElementById('f-nessid').value.trim();
  if (!firstname||!lastname||!nessid) { alert('First name, last name and NESS ID are required.'); return; }

  // Collect assignments from form
  const newAssignments = [];
  document.querySelectorAll('[id^="assignment-"]').forEach(el => {
    const i = el.id.replace('assignment-','');
    const team = document.getElementById(`asgn-team-${i}`)?.value;
    if (!team) return;
    const wbs = [];
    el.querySelectorAll('[id^="wbs-code-"]').forEach(inp => {
      const wi = inp.id.split('-').pop();
      const code = inp.value.trim();
      if (code) wbs.push({code, type: document.getElementById(`wbs-type-${i}-${wi}`)?.value || 'Billable'});
    });
    newAssignments.push({
      id: document.getElementById(`asgn-id-${i}`)?.value || null,
      team,
      po: document.getElementById(`asgn-po-${i}`)?.value.trim()||null,
      start_date: document.getElementById(`asgn-start-${i}`)?.value||null,
      end_date: document.getElementById(`asgn-end-${i}`)?.value||null,
      billable: document.getElementById(`asgn-billable-${i}`)?.checked !== false,
      wbs
    });
  });

  // Auto-calculate status
  const autoStatus = calcAutoStatus(newAssignments);

  const data = {
    firstname, lastname, nessid,
    hereid: document.getElementById('f-hereid').value.trim()||null,
    hereaccount: document.getElementById('f-hereaccount').value.trim()||null,
    nessemail: document.getElementById('f-nessemail').value.trim()||null,
    hereemail: document.getElementById('f-hereemail').value.trim()||null,
    status: autoStatus,
    country: document.getElementById('f-country').value||null,
    location_id: document.getElementById('f-location').value||null,
    billing_location: document.getElementById('f-billing-location').value||null,
    workertype: document.getElementById('f-workertype').value||null,
    job_title: document.getElementById('f-job-title').value.trim()||null,
    job_level: document.getElementById('f-job-level').value.trim()||null,
    project_start: document.getElementById('f-project-start').value||null,
    project_end: document.getElementById('f-project-end').value||null,
  };

  let devId = editingId;
  if (editingId) {
    const {error} = await db.from('developers').update(data).eq('id', editingId);
    if (error) { showToast('Error: '+error.message); return; }
  } else {
    const {data:nd, error} = await db.from('developers').insert(data).select().single();
    if (error) { showToast('Error: '+error.message); return; }
    devId = nd.id;
  }

  // Save assignments — delete removed ones, upsert existing
  const existingIds = newAssignments.map(a => a.id).filter(Boolean);
  if (editingId) {
    // Delete assignments not in the new list
    const dev = developers.find(d => d.id === editingId);
    const oldIds = (dev?.assignments||[]).map(a => String(a.id));
    const toDelete = oldIds.filter(id => !existingIds.includes(id));
    for (const id of toDelete) {
      await db.from('developer_assignments').delete().eq('id', id);
    }
  }

  for (const a of newAssignments) {
    let assignmentId = a.id;
    const aData = {developer_id: devId, team: a.team, po: a.po, start_date: a.start_date||null, end_date: a.end_date||null, billable: a.billable !== false};
    if (a.id) {
      await db.from('developer_assignments').update(aData).eq('id', a.id);
    } else {
      const {data:na} = await db.from('developer_assignments').insert(aData).select().single();
      assignmentId = na?.id;
    }
    if (assignmentId) {
      await db.from('assignment_wbs_codes').delete().eq('assignment_id', assignmentId);
      if (a.wbs.length) {
        await db.from('assignment_wbs_codes').insert(a.wbs.map(w => ({assignment_id: assignmentId, code: w.code, type: w.type})));
      }
    }
  }

  closeModal('add-modal');
  showToast(`${editingId?'Developer updated':'Developer added'} — status set to ${autoStatus}`);
  await loadDevs();
}

async function deleteDev() {
  if (!confirm('Delete this developer? This cannot be undone.')) return;
  const {error} = await db.from('developers').delete().eq('id', editingId);
  if (error) { showToast('Error: '+error.message); return; }
  closeModal('add-modal');
  showToast('Developer deleted');
  await loadDevs();
}

function closeModal(id){document.getElementById(id).classList.remove('open');}

function exportDevs() {
  const rows=developers.map(d=>({
    'First Name':d.firstname,'Last Name':d.lastname,
    'NESS ID':d.nessid,'HERE ID':d.hereid||'','HERE Account':d.hereaccount||'',
    'Ness Email':d.nessemail||'','HERE Email':d.hereemail||'',
    'Status':d.status,'Start Billing Date':d.startdate||'','Last Billing Date':d.enddate||'',
    'Country':d.country||'','Worker Type':d.workertype||'','Job Title':d.job_title||'','Job Level':d.job_level||'','HERE Role':getRoleFromRate(d),'Team':getDevCurrentTeam(d)||'',
    'Job Title':d.job_title||'','Job Level':d.job_level||'',
    'HERE Role':getRoleFromRate(d),'PO #':d.po||'',
    'WBS Codes':(d.wbs||[]).map(w=>w.code+' ('+w.type+')').join('; ')
  }));
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Developers');
  XLSX.writeFile(wb,'HERE_Developers.xlsx');
}

// RATES MODULE → rates.js

// ── Developer order utilities (used across all modules) ──────────────────
let devOrderData = {}; // developer_id → position

async function loadDevOrder() {
  const { data, error } = await db.from('developer_order').select('*');
  if (error) { console.error('loadDevOrder:', error); return; }
  devOrderData = {};
  (data || []).forEach(r => { devOrderData[r.developer_id] = r.position; });
}

function getDevPosition(devId) {
  return devOrderData[devId] ?? 999;
}

function sortDevsByOrder(devArray) {
  return [...devArray].sort((a, b) => {
    const pa = getDevPosition(a.id);
    const pb = getDevPosition(b.id);
    if (pa !== pb) return pa - pb;
    return (a.lastname||'').localeCompare(b.lastname||'');
  });
}

function sortDevsByName(devArray) {
  return [...devArray].sort((a, b) =>
    (a.lastname||'').localeCompare(b.lastname||'') ||
    (a.firstname||'').localeCompare(b.firstname||'')
  );
}

// REVENUE MODULE → revenue.js

// ATTENDANCE MODULE → attendance.js