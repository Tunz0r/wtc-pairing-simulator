// ===========================
// Firebase Realtime Sync
// ===========================
//
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Click "Create a project" (name it e.g. "wtc-pairing")
// 3. Disable Google Analytics (not needed), click Create
// 4. Go to "Build" → "Realtime Database" → "Create Database"
// 5. Choose any location → "Start in test mode" → Enable
// 6. Go to Project Settings (gear icon) → "Your apps" → click Web icon (</>)
// 7. Register app (any nickname) → copy the firebaseConfig values below
// 8. Set Database Rules (Realtime Database → Rules tab):
//    {
//      "rules": {
//        "dk-team": {
//          ".read": true,
//          ".write": true
//        }
//      }
//    }

const firebaseConfig = {
  apiKey: "AIzaSyAM6q7KLfaO3Yn74OzbKPixiw5XhCn4cFw",
  authDomain: "wtc-pairing.firebaseapp.com",
  databaseURL: "https://wtc-pairing-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "wtc-pairing",
  storageBucket: "wtc-pairing.firebasestorage.app",
  messagingSenderId: "1031169146432",
  appId: "1:1031169146432:web:969d344b95e3571eb469a5"
};

// ── Internal state ──
let _db = null;
let _syncEnabled = false;
let _lastStateWrite = 0;
let _lastCoachingWrite = 0;
let _stateTimer = null;
let _coachingTimer = null;
const DEBOUNCE = 600;
const COOLDOWN = 2000; // ignore echoes of own writes

function initSync() {
  if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL) {
    console.log('[Sync] Firebase not configured — running in local-only mode.');
    updateSyncBadge(false);
    return;
  }

  try {
    firebase.initializeApp(firebaseConfig);
    _db = firebase.database();
    _syncEnabled = true;
    console.log('[Sync] Firebase connected ✓');
    updateSyncBadge(true);

    // ── Listen: appState ──
    _db.ref('dk-team/state').on('value', snap => {
      if (Date.now() - _lastStateWrite < COOLDOWN) return;
      const remote = snap.val();
      if (!remote) return;

      // Don't clobber if user is actively typing
      const el = document.activeElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

      appState = mergeState(appState, remote);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));

      if (!typing) rerenderCurrentView();
    });

    // ── Listen: coaching data ──
    _db.ref('dk-team/coaching').on('value', snap => {
      if (Date.now() - _lastCoachingWrite < COOLDOWN) return;
      const remote = snap.val();
      if (!remote) return;

      localStorage.setItem(COACHING_STORAGE_KEY, JSON.stringify(remote));

      const activePhase = document.querySelector('.phase.active');
      if (activePhase && activePhase.id === 'phase-coaching') {
        const el = document.activeElement;
        if (!el || !el.classList.contains('coaching-br-input')) {
          renderCoachingTab();
        }
      }
    });

    // ── Initial push: seed Firebase if empty ──
    _db.ref('dk-team/state').once('value', snap => {
      if (!snap.val()) {
        console.log('[Sync] Seeding Firebase with local state...');
        _db.ref('dk-team/state').set(JSON.parse(JSON.stringify(appState)));
      }
    });

  } catch (e) {
    console.error('[Sync] Init failed:', e);
    _syncEnabled = false;
    updateSyncBadge(false);
  }
}

// ── Write: debounced appState push ──
function syncState() {
  if (!_syncEnabled) return;
  clearTimeout(_stateTimer);
  _stateTimer = setTimeout(() => {
    _lastStateWrite = Date.now();
    _db.ref('dk-team/state').set(JSON.parse(JSON.stringify(appState)));
  }, DEBOUNCE);
}

// ── Write: debounced coaching push ──
function syncCoaching() {
  if (!_syncEnabled) return;
  clearTimeout(_coachingTimer);
  _coachingTimer = setTimeout(() => {
    _lastCoachingWrite = Date.now();
    const data = JSON.parse(localStorage.getItem(COACHING_STORAGE_KEY) || '{}');
    _db.ref('dk-team/coaching').set(data);
  }, DEBOUNCE);
}

// ── Merge remote state into local (preserves structure) ──
function mergeState(local, remote) {
  const merged = JSON.parse(JSON.stringify(remote));
  // Ensure arrays/defaults
  if (!merged.rounds) merged.rounds = Array(7).fill(null);
  while (merged.rounds.length < 7) merged.rounds.push(null);
  if (!merged.tableTags) merged.tableTags = {};
  if (!merged.armyTablePrefs) merged.armyTablePrefs = {};
  if (!merged.opponents) merged.opponents = {};
  if (!merged.myTeam) merged.myTeam = { name: 'Denmark', players: Array.from({ length: 8 }, () => ({ faction: '', armyList: '' })) };
  // Firebase drops empty objects — ensure every opponent has matchups + tablePrefs
  for (const key of Object.keys(merged.opponents)) {
    const opp = merged.opponents[key];
    if (!opp.matchups) opp.matchups = {};
    if (!opp.tablePrefs) opp.tablePrefs = {};
    if (!opp.players) opp.players = Array.from({ length: 8 }, () => ({ faction: '', armyList: '' }));
  }
  return merged;
}

// ── Re-render whichever tab is active ──
function rerenderCurrentView() {
  const activePhase = document.querySelector('.phase.active');
  if (!activePhase) return;
  const id = activePhase.id.replace('phase-', '');

  // Don't re-render if user is actively editing an input/textarea
  const active = document.activeElement;
  const isEditing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');

  try {
    // My Team: only re-render if user is NOT on this tab or not editing
    // (rebuilding DOM while editing loses focus, army-list toggle state, etc.)
    if (id === 'myteam' && !isEditing) buildMyTeamInputs();
    if (id === 'tableprefs' && !isEditing) renderTablePrefsTab();
    if (id === 'prep') {
      populateCountryDropdown();
      if (currentPrepCountry && !isEditing) renderPrepMatrix();
    }
    if (id === 'round' && !isEditing) { populateRoundOpponents(); buildRoundMatrix(); updateTablesPreview(); }
    if (id === 'coaching') {
      populateCoachingRoundSelect();
      if (!isEditing) renderCoachingTab();
    }
    if (id === 'overview') renderOverview();
  } catch (e) {
    console.warn('[Sync] Re-render error:', e);
  }
}

// ── Sync status badge ──
function updateSyncBadge(connected) {
  const badge = document.getElementById('sync-badge');
  if (!badge) return;
  if (connected) {
    badge.textContent = '🟢 Synced';
    badge.className = 'sync-badge sync-on';
  } else {
    badge.textContent = '⚪ Local Only';
    badge.className = 'sync-badge sync-off';
  }
}

// ── Login gate ──
function checkLogin() {
  return sessionStorage.getItem('wtc_auth') === 'dk40k';
}

function doLogin(user, pass) {
  if (user.toUpperCase() === 'DK' && pass === '40k') {
    sessionStorage.setItem('wtc_auth', 'dk40k');
    return true;
  }
  return false;
}

function initLoginGate() {
  const overlay = document.getElementById('login-overlay');
  const app = document.getElementById('app');

  if (checkLogin()) {
    overlay.style.display = 'none';
    app.style.display = '';
    return true;
  }

  overlay.style.display = '';
  app.style.display = 'none';

  document.getElementById('login-btn').addEventListener('click', attemptLogin);
  document.getElementById('login-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptLogin();
  });
  document.getElementById('login-user').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-pass').focus();
  });

  return false;
}

function attemptLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const err = document.getElementById('login-error');

  if (doLogin(user, pass)) {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app').style.display = '';
    // Now boot the app
    init();
    initSync();
  } else {
    err.textContent = 'Invalid credentials.';
    err.style.display = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
  }
}
