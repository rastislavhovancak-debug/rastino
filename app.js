
const { createClient } = supabase;
let db = null; // initialized after config is fetched

async function loadConfig() {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('config.json not found');
    const cfg = await res.json();
    if (!cfg.url || !cfg.key) throw new Error('Invalid config.json');
    db = createClient(cfg.url, cfg.key);
    return true;
  } catch (e) {
    document.getElementById('login-error').textContent =
      'Configuration error: ' + e.message;
    return false;
  }
}

let developers = [];
let devTab = 'ness';      // 'ness' | 'here'
let devLayout = 'team';   // 'list' | 'team'
let editingId = null;
let detailId = null;

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const navBtn = document.getElementById('nav-' + name);
  if (navBtn) navBtn.classList.add('active');
  if (name === 'revenue') renderRevenue();
  if (name === 'attendance') {
    renderAttendance();
  }
  if (name === 'rates') renderRates();
  if (name === 'timesheets') {
    renderTimesheets();
    // Load tracking records if we have a month but no data yet loaded
    if (!tsData && window.tsMonth) {
      loadTsTracking(window.tsMonth, 2026).then(() => renderTsCheck());
    }
  }
  if (name === 'info') { const sel = document.getElementById('info-select'); switchInfoView(sel ? sel.value : 'rates2026'); }
  if (name === 'settings') { switchSettingsView(document.getElementById('settings-select')?.value || 'teamorder'); }
  if (name === 'grossmargin') { renderGmStats(); switchGmView('split'); }
  if (name === 'costs') switchCostsView('salaries');
  if (name === 'dashboard') { switchDashView('readiness'); renderReadiness(); }
  if (name === 'po') renderPO();
  if (name === 'invoicing') renderInvoicing();
}

function showLogin() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('signup-form').style.display = 'none';
}
function showSignup() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('signup-form').style.display = 'block';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  document.getElementById('login-error').textContent = '';
  if (!db) {
    const ok = await loadConfig();
    if (!ok) return;
  }
  const { error } = await db.auth.signInWithPassword({ email, password: pass });
  if (error) { document.getElementById('login-error').textContent = error.message; return; }
  startApp(email);
}

async function doSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const pass = document.getElementById('signup-password').value;
  document.getElementById('signup-error').textContent = '';
  const { error } = await db.auth.signUp({ email, password: pass });
  if (error) { document.getElementById('signup-error').textContent = error.message; return; }
  document.getElementById('signup-error').style.color = '#1a7340';
  document.getElementById('signup-error').textContent = 'Account created! Check your email to confirm, then sign in.';
}

async function doLogout() {
  await db.auth.signOut();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-wrap').style.display = 'flex';
  developers = [];
}

function startApp(email) {
  document.getElementById('login-wrap').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-email').textContent = email;
  loadAllData();
}

async function loadAllData() {
  await loadTeams(); // must be first — EU_TEAMS/IND_TEAMS needed by all other modules
  await Promise.all([loadDevs(), loadLocations(), loadRates(), loadSelfhosting(), loadCvsOncall(), loadDiscounts(), loadTeamDiscounts(), loadExtraInvoicing(), loadLockedMonths(), loadEurUsd(), loadInvGroups(), loadPublicHolidays(), loadOverheadRates(), loadTeamCosts(), loadSalaries(), loadCtc(), loadDevOrder(), loadPurchaseOrders(), loadRateCatalog()]);
  await loadRevenue();
  await loadGmImprovements();
  renderHome();
}

async function loadTeams() {
  const { data, error } = await db.from('teams').select('*').order('region', {ascending: true}).order('position');
  if (error) { console.warn('Teams not loaded:', error.message); return; }
  EU_TEAMS = (data||[]).filter(t => t.region === 'europe').map(t => t.name);
  IND_TEAMS = (data||[]).filter(t => t.region === 'india').map(t => t.name);
}

function getOrderedTeams() {
  return [...EU_TEAMS, ...IND_TEAMS];
}

// DEVELOPERS MODULE → developers.js
// SETTINGS MODULE → settings.js

(async()=>{
  const ok = await loadConfig();
  if (!ok) return;
  const {data:{session}}=await db.auth.getSession();
  if(session){startApp(session.user.email);}
})();
