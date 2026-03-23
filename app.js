// --- Data ---
const POSITIONS = ['Pitcher', 'Catcher', '1st', '2nd', '3rd', 'SS', 'LF', 'CF', 'RF'];
const BENCH_SLOTS = 3;
const BATTING_STATS_FIELDS = ['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'K', 'HBP', 'SAC', 'SB', 'ROE'];
const FIELDING_STATS_FIELDS = ['PO', 'A', 'E'];
const PITCHING_STATS_FIELDS = ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HB', 'PC'];

function loadData() {
    return JSON.parse(localStorage.getItem('baseballLineup') || '{"roster":[],"games":[],"nameMap":{}}');
}

// Save to localStorage AND Firebase
let _saveTimeout = null;
function saveData(d) {
    localStorage.setItem('baseballLineup', JSON.stringify(d));
    // Debounce Firebase writes (wait 500ms after last change)
    if (_saveTimeout) clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(() => {
        if (window.firebaseDB) {
            window.firebaseDB.ref('lineupData').set(d).catch(err => {
                console.warn('Firebase save failed:', err.message);
            });
        }
    }, 500);
}

let data = loadData();
let activeGameId = null;

// On startup, sync with Firebase
if (window.firebaseDB) {
    window.firebaseDB.ref('lineupData').once('value').then(snapshot => {
        const cloudData = snapshot.val();
        const localGames = data.games ? data.games.length : 0;
        const cloudGames = (cloudData && cloudData.games) ? cloudData.games.length : 0;

        if (cloudGames > localGames) {
            // Cloud has more data — download it
            data = cloudData;
            if (!data.nameMap) data.nameMap = {};
            localStorage.setItem('baseballLineup', JSON.stringify(data));
            renderRoster();
            renderGames();
            console.log('Downloaded from Firebase (' + cloudGames + ' games)');
        } else if (localGames > 0 && localGames > cloudGames) {
            // Local has more data — push it up to Firebase
            window.firebaseDB.ref('lineupData').set(data).then(() => {
                console.log('Uploaded to Firebase (' + localGames + ' games)');
            }).catch(err => console.warn('Firebase upload failed:', err.message));
        }
    }).catch(err => {
        console.warn('Firebase sync failed:', err.message);
    });
}

// --- Tab switching ---
function setupTabs(selector, contentClass, prefix) {
    document.querySelectorAll(selector).forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll(selector).forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.' + contentClass).forEach(tc => tc.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.dataset.tab || tab.dataset.statstab || tab.dataset.seasontab;
            document.getElementById(target + '-tab').classList.add('active');
        });
    });
}

setupTabs('#main-tabs .tab', 'tab-content', '');
setupTabs('.stats-sub-tab', 'stats-tab-content', '');
setupTabs('.season-sub-tab', 'season-tab-content', '');

// --- Roster ---
const rosterList = document.getElementById('roster-list');
const addPlayerForm = document.getElementById('add-player-form');
const playerNameInput = document.getElementById('player-name');

function renderRoster() {
    rosterList.innerHTML = '';
    data.roster.forEach((name, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${name}</span><button data-idx="${i}">&times;</button>`;
        rosterList.appendChild(li);
    });
    rosterList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            data.roster.splice(parseInt(btn.dataset.idx), 1);
            saveData(data);
            renderRoster();
            if (activeGameId) renderLineup();
        });
    });
}

addPlayerForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = playerNameInput.value.trim();
    if (name && !data.roster.includes(name)) {
        data.roster.push(name);
        saveData(data);
        renderRoster();
        if (activeGameId) renderLineup();
    }
    playerNameInput.value = '';
});

// --- Games ---
const gamesList = document.getElementById('games');
const addGameForm = document.getElementById('add-game-form');
const gameDateInput = document.getElementById('game-date');
const gameOpponentInput = document.getElementById('game-opponent');
const gameInningsSelect = document.getElementById('game-innings');
const noGameDiv = document.getElementById('no-game-selected');
const editorContent = document.getElementById('editor-content');
const editorTitle = document.getElementById('editor-title');
const deleteGameBtn = document.getElementById('delete-game-btn');

function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
}

function renderGames() {
    data.games.sort((a, b) => a.date.localeCompare(b.date));
    gamesList.innerHTML = '';
    data.games.forEach(g => {
        const li = document.createElement('li');
        li.dataset.id = g.id;
        if (g.id === activeGameId) li.classList.add('active');
        li.innerHTML = `<span class="game-date">${formatDate(g.date)}</span><span class="game-opp">vs ${g.opponent}</span>`;
        li.addEventListener('click', () => selectGame(g.id));
        gamesList.appendChild(li);
    });
}

addGameForm.addEventListener('submit', e => {
    e.preventDefault();
    const game = {
        id: Date.now().toString(),
        date: gameDateInput.value,
        opponent: gameOpponentInput.value.trim(),
        innings: parseInt(gameInningsSelect.value),
        fielding: {},
        batting: [],
        battingStats: {},
        fieldingStats: {},
        pitchingStats: []
    };
    data.games.push(game);
    saveData(data);
    renderGames();
    selectGame(game.id);
    gameDateInput.value = '';
    gameOpponentInput.value = '';
});

deleteGameBtn.addEventListener('click', () => {
    if (!activeGameId) return;
    if (!confirm('Delete this game?')) return;
    data.games = data.games.filter(g => g.id !== activeGameId);
    activeGameId = null;
    saveData(data);
    renderGames();
    noGameDiv.classList.remove('hidden');
    editorContent.classList.add('hidden');
});

function selectGame(id) {
    activeGameId = id;
    renderGames();
    noGameDiv.classList.add('hidden');
    editorContent.classList.remove('hidden');
    document.getElementById('season-tracker').classList.add('hidden');
    renderLineup();
}

function getGame() {
    return data.games.find(g => g.id === activeGameId);
}

// --- Main render ---
function renderLineup() {
    const game = getGame();
    if (!game) return;

    editorTitle.textContent = `${formatDate(game.date)} - vs ${game.opponent}`;

    if (!game.fielding) game.fielding = {};
    if (!game.batting) game.batting = [];
    if (!game.battingStats) game.battingStats = {};
    if (!game.fieldingStats) game.fieldingStats = {};
    if (!game.pitchingStats) game.pitchingStats = [];

    renderBattingFilter();
    renderBatting(game);
    renderFielding(game);
    renderTracker(game);
    renderGameStats(game);
}

// --- Player Colors ---
const PLAYER_COLORS = [
    '#d32f2f', // red
    '#1565c0', // blue
    '#2e7d32', // green
    '#f57f17', // gold
    '#7b1fa2', // purple
    '#00838f', // teal
    '#e65100', // burnt orange
    '#c2185b', // magenta
    '#37474f', // charcoal
    '#283593', // indigo
    '#4e342e', // brown
    '#ff1744', // hot pink
    '#ad1457', // raspberry
    '#ef6c00', // tangerine
    '#0277bd', // sky blue
];

const PLAYER_COLOR_MAP = {
    'Joseph':   '#d32f2f', // red
    'Jack':     '#e0e0e0', // white
    'Ollie':    '#2e7d32', // forest green
    'CH':       '#e65100', // burnt orange
    'Jackson':  '#7b1fa2', // purple
    'Myles':    '#00838f', // teal
    'Harrison': '#d4c630', // yellow
    'Randall':  '#5d4037', // brown
    'Henry':    '#9e9e9e', // grey
    'Kru':      '#c2185b', // magenta
    'Brody':    '#37474f', // charcoal
    'Dering':   '#283593', // indigo
};

function getPlayerColor(name) {
    if (PLAYER_COLOR_MAP[name]) return PLAYER_COLOR_MAP[name];
    const idx = data.roster.indexOf(name);
    if (idx < 0) return '#000';
    return PLAYER_COLORS[idx % PLAYER_COLORS.length];
}

function getTextColorForBg(hex) {
    // Return black or white text depending on background brightness
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 150 ? '#000' : '#fff';
}

// --- Season averages helper ---
function getSeasonBattingLine(playerName) {
    let ab = 0, h = 0, bb = 0, hbp = 0, sac = 0, sb = 0, gp = 0;
    let singles = 0, doubles = 0, triples = 0, hr = 0, rbi = 0;
    getBattingFilteredGames().forEach(game => {
        const s = game.battingStats?.[playerName];
        if (!s) return;
        const gab = s['AB'] || 0;
        const gbb = s['BB'] || 0;
        const ghbp = s['HBP'] || 0;
        const gsac = s['SAC'] || 0;
        if (gab + gbb + ghbp + gsac === 0) return;
        gp += s['_GP'] || 1; // Use actual GP from imported season CSVs
        ab += gab;
        h += s['H'] || 0;
        bb += gbb;
        hbp += ghbp;
        sac += gsac;
        sb += s['SB'] || 0;
        rbi += s['RBI'] || 0;
        doubles += s['2B'] || 0;
        triples += s['3B'] || 0;
        hr += s['HR'] || 0;
    });
    const pa = ab + bb + hbp + sac;
    const avg = ab > 0 ? (h / ab).toFixed(3) : '—';
    const obp = pa > 0 ? ((h + bb + hbp) / pa).toFixed(3) : '—';
    // Last 5 PA batting average: walk backwards through games by date
    // collecting PA until we hit 5, then compute BA from those PAs
    let l5ab = 0, l5h = 0, l5pa = 0;
    const sortedGames = getBattingFilteredGames(); // already sorted by date
    for (let i = sortedGames.length - 1; i >= 0 && l5pa < 5; i--) {
        const gs = sortedGames[i].battingStats?.[playerName];
        if (!gs) continue;
        const gab = gs['AB'] || 0;
        const gbb = gs['BB'] || 0;
        const ghbp = gs['HBP'] || 0;
        const gsac = gs['SAC'] || 0;
        const gpa = gab + gbb + ghbp + gsac;
        if (gpa === 0) continue;
        l5ab += gab;
        l5h += gs['H'] || 0;
        l5pa += gpa;
    }
    const l5avg = l5ab > 0 ? (l5h / l5ab).toFixed(3) : '—';

    const paG = gp > 0 ? (pa / gp).toFixed(1) : '—';
    const abG = gp > 0 ? (ab / gp).toFixed(1) : '—';
    singles = h - doubles - triples - hr;
    const bbG = gp > 0 ? (bb / gp).toFixed(1) : '—';
    const rbiG = gp > 0 ? (rbi / gp).toFixed(1) : '—';
    const hG = gp > 0 ? (h / gp).toFixed(1) : '—';
    const s1bG = gp > 0 ? (singles / gp).toFixed(1) : '—';
    const s2bG = gp > 0 ? (doubles / gp).toFixed(1) : '—';
    const s3bG = gp > 0 ? (triples / gp).toFixed(1) : '—';
    const hrG = gp > 0 ? (hr / gp).toFixed(1) : '—';
    const sbG = gp > 0 ? (sb / gp).toFixed(1) : '—';
    const tb = singles + (doubles * 2) + (triples * 3) + (hr * 4);
    const slg = ab > 0 ? (tb / ab).toFixed(3) : '—';

    return { pa, ab, avg, obp, slg, sb, l5avg, paG, abG, hG, bbG, rbiG, s1bG, s2bG, s3bG, hrG, sbG };
}

// --- Batting Order (fixed for entire game) ---
const battingBody = document.getElementById('batting-body');
const addBattingRowBtn = document.getElementById('add-batting-row');

function renderBatting(game) {
    activeTabFilter = 'batting';
    battingBody.innerHTML = '';
    // Collect per-game stat cells for top-30% highlighting
    const rankCells = { rbiG: [], hG: [], s1bG: [], s2bG: [], s3bG: [], hrG: [], sbG: [] };

    game.batting.forEach((entry, rowIdx) => {
        const tr = document.createElement('tr');

        // Order number
        const tdNum = document.createElement('td');
        tdNum.classList.add('order-num');
        tdNum.textContent = rowIdx + 1;
        tr.appendChild(tdNum);

        // Player dropdown
        const tdPlayer = document.createElement('td');
        tdPlayer.classList.add('pos-col');
        const sel = document.createElement('select');
        sel.classList.add('player-select');
        sel.innerHTML = '<option value="">-- Select Player --</option>';
        data.roster.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (entry.player === name) opt.selected = true;
            sel.appendChild(opt);
        });
        function applyColor() {
            const color = sel.value ? getPlayerColor(sel.value) : '';
            const textColor = color ? getTextColorForBg(color) : '';
            tdPlayer.style.backgroundColor = color;
            tdPlayer.style.color = textColor;
            tdPlayer.dataset.playerColor = color;
            sel.style.color = textColor;
        }
        sel.addEventListener('change', () => {
            entry.player = sel.value || '';
            applyColor();
            saveData(data);
            renderGameStats(game);
        });
        applyColor();
        tdPlayer.appendChild(sel);
        tr.appendChild(tdPlayer);

        // Season stat cells
        const tdPaG = document.createElement('td');
        tdPaG.classList.add('stat-col');
        const tdAbG = document.createElement('td');
        tdAbG.classList.add('stat-col');
        const tdBbG = document.createElement('td');
        tdBbG.classList.add('stat-col');
        const tdAvg = document.createElement('td');
        tdAvg.classList.add('stat-col');
        const tdObp = document.createElement('td');
        tdObp.classList.add('stat-col');
        const tdSlg = document.createElement('td');
        tdSlg.classList.add('stat-col');
        const tdRbiG = document.createElement('td');
        tdRbiG.classList.add('stat-col');
        const tdHG = document.createElement('td');
        tdHG.classList.add('stat-col');
        const td1bG = document.createElement('td');
        td1bG.classList.add('stat-col');
        const td2bG = document.createElement('td');
        td2bG.classList.add('stat-col');
        const td3bG = document.createElement('td');
        td3bG.classList.add('stat-col');
        const tdHrG = document.createElement('td');
        tdHrG.classList.add('stat-col');
        const tdSbG = document.createElement('td');
        tdSbG.classList.add('stat-col');
        const tdL5 = document.createElement('td');
        tdL5.classList.add('stat-col');

        function applyStatHighlight(td, value) {
            td.classList.remove('stat-low', 'stat-high');
            const num = parseFloat(value);
            if (isNaN(num)) return;
            if (num < 0.400) td.classList.add('stat-low');
            else if (num > 0.550) td.classList.add('stat-high');
        }

        function updateSeasonStats() {
            if (sel.value) {
                const line = getSeasonBattingLine(sel.value);
                tdPaG.textContent = line.paG;
                tdAbG.textContent = line.abG;
                tdBbG.textContent = line.bbG;
                tdAvg.textContent = line.avg;
                tdObp.textContent = line.obp;
                tdSlg.textContent = line.slg;
                tdRbiG.textContent = line.rbiG;
                tdHG.textContent = line.hG;
                td1bG.textContent = line.s1bG;
                td2bG.textContent = line.s2bG;
                td3bG.textContent = line.s3bG;
                tdHrG.textContent = line.hrG;
                tdSbG.textContent = line.sbG;
                tdL5.textContent = line.l5avg;
                applyStatHighlight(tdAvg, line.avg);
                applyStatHighlight(tdObp, line.obp);
                applyStatHighlight(tdSlg, line.slg);
                applyStatHighlight(tdL5, line.l5avg);
            } else {
                tdPaG.textContent = '';
                tdAbG.textContent = '';
                tdBbG.textContent = '';
                tdAvg.textContent = '';
                tdObp.textContent = '';
                tdSlg.textContent = '';
                tdRbiG.textContent = '';
                tdHG.textContent = '';
                td1bG.textContent = '';
                td2bG.textContent = '';
                td3bG.textContent = '';
                tdHrG.textContent = '';
                tdSbG.textContent = '';
                tdL5.textContent = '';
                tdAvg.classList.remove('stat-low', 'stat-high');
                tdObp.classList.remove('stat-low', 'stat-high');
                tdSlg.classList.remove('stat-low', 'stat-high');
                tdL5.classList.remove('stat-low', 'stat-high');
            }
        }
        updateSeasonStats();
        sel.addEventListener('change', updateSeasonStats);

        const sp1 = document.createElement('td');
        sp1.classList.add('spacer-col');
        const sp2 = document.createElement('td');
        sp2.classList.add('spacer-col');

        tr.appendChild(tdL5);
        tr.appendChild(tdAvg);
        tr.appendChild(tdObp);
        tr.appendChild(tdSlg);
        tr.appendChild(sp1);
        tr.appendChild(tdPaG);
        tr.appendChild(tdAbG);
        tr.appendChild(tdHG);
        tr.appendChild(tdBbG);
        // Track cells for top-30% highlighting
        rankCells.rbiG.push(tdRbiG);
        rankCells.hG.push(tdHG);
        rankCells.s1bG.push(td1bG);
        rankCells.s2bG.push(td2bG);
        rankCells.s3bG.push(td3bG);
        rankCells.hrG.push(tdHrG);
        rankCells.sbG.push(tdSbG);

        tr.appendChild(sp2);
        tr.appendChild(tdRbiG);
        tr.appendChild(td1bG);
        tr.appendChild(td2bG);
        tr.appendChild(td3bG);
        tr.appendChild(tdHrG);
        tr.appendChild(tdSbG);

        // Remove
        const tdRm = document.createElement('td');
        tdRm.style.borderLeft = 'none';
        const rmBtn = document.createElement('button');
        rmBtn.classList.add('remove-batter');
        rmBtn.textContent = '\u00d7';
        rmBtn.addEventListener('click', () => {
            game.batting.splice(rowIdx, 1);
            saveData(data);
            renderBatting(game);
            renderGameStats(game);
        });
        tdRm.appendChild(rmBtn);
        tr.appendChild(tdRm);

        battingBody.appendChild(tr);
    });

    // Top 30% highlighting for per-game stats
    Object.values(rankCells).forEach(cells => {
        const vals = cells.map(td => {
            const v = parseFloat(td.textContent);
            return isNaN(v) ? -1 : v;
        });
        const sorted = vals.filter(v => v > 0).sort((a, b) => b - a);
        if (sorted.length < 2) return;
        const cutoff = sorted[Math.max(0, Math.ceil(sorted.length * 0.3) - 1)];
        cells.forEach((td, i) => {
            if (vals[i] >= cutoff && vals[i] > 0) {
                td.classList.add('stat-top30');
            }
        });
    });
}

addBattingRowBtn.addEventListener('click', () => {
    const game = getGame();
    if (!game) return;
    game.batting.push({ player: '' });
    saveData(data);
    renderBatting(game);
    renderGameStats(game);
});

// --- Fielding Grid ---
const inningHeaderRow = document.getElementById('inning-header-row');
const fieldingBody = document.getElementById('fielding-body');
const trackerBody = document.getElementById('tracker-body');

function renderFielding(game) {
    inningHeaderRow.innerHTML = '<th class="pos-col">Position</th>';
    for (let i = 1; i <= game.innings; i++) {
        const th = document.createElement('th');
        th.textContent = i;
        inningHeaderRow.appendChild(th);
    }

    const allPositions = [...POSITIONS, ...Array.from({ length: BENCH_SLOTS }, (_, i) => `Bench ${i + 1}`)];
    allPositions.forEach(pos => { if (!game.fielding[pos]) game.fielding[pos] = {}; });

    fieldingBody.innerHTML = '';
    allPositions.forEach(pos => {
        const tr = document.createElement('tr');
        tr.dataset.pos = pos;
        if (pos.startsWith('Bench')) tr.classList.add('bench-row');

        const tdPos = document.createElement('td');
        tdPos.classList.add('pos-col');
        tdPos.textContent = pos;
        tr.appendChild(tdPos);

        for (let inn = 1; inn <= game.innings; inn++) {
            const td = document.createElement('td');
            const select = document.createElement('select');
            select.dataset.pos = pos;
            select.dataset.inning = inn;
            select.innerHTML = '<option value="">\u2014</option>';

            data.roster.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                if (game.fielding[pos][inn] === name) opt.selected = true;
                select.appendChild(opt);
            });

            function applyFieldColor() {
                const c = select.value ? getPlayerColor(select.value) : '';
                const tc = c ? getTextColorForBg(c) : '';
                td.style.backgroundColor = c;
                td.style.color = tc;
                td.dataset.playerColor = c;
                select.style.color = tc;
            }
            select.addEventListener('change', () => {
                game.fielding[pos][inn] = select.value || null;
                applyFieldColor();
                saveData(data);
                highlightDuplicates(game);
                renderTracker(game);
            });
            applyFieldColor();

            td.appendChild(select);
            tr.appendChild(td);
        }
        fieldingBody.appendChild(tr);
    });
    highlightDuplicates(game);
}

function highlightDuplicates(game) {
    const allPositions = [...POSITIONS, ...Array.from({ length: BENCH_SLOTS }, (_, i) => `Bench ${i + 1}`)];
    for (let inn = 1; inn <= game.innings; inn++) {
        const seen = {};
        allPositions.forEach(pos => {
            const player = game.fielding[pos]?.[inn];
            if (player) {
                if (!seen[player]) seen[player] = [];
                seen[player].push(pos);
            }
        });
        const dupes = new Set();
        Object.entries(seen).forEach(([p, arr]) => { if (arr.length > 1) dupes.add(p); });

        fieldingBody.querySelectorAll(`select[data-inning="${inn}"]`).forEach(sel => {
            const td = sel.parentElement;
            td.classList.toggle('dup-warning', !!(sel.value && dupes.has(sel.value)));
        });
    }
}

function renderTracker(game) {
    const counts = {};
    data.roster.forEach(name => { counts[name] = { inField: 0, onBench: 0 }; });

    for (let inn = 1; inn <= game.innings; inn++) {
        POSITIONS.forEach(pos => {
            const p = game.fielding[pos]?.[inn];
            if (p && counts[p]) counts[p].inField++;
        });
        for (let b = 0; b < BENCH_SLOTS; b++) {
            const p = game.fielding[`Bench ${b + 1}`]?.[inn];
            if (p && counts[p]) counts[p].onBench++;
        }
    }

    trackerBody.innerHTML = '';
    data.roster.forEach(name => {
        const c = counts[name];
        const total = c.inField + c.onBench;
        let cls = '';
        if (c.inField === game.innings) cls = 'full-innings';
        else if (c.inField > 0) cls = 'some-bench';
        else if (total > 0) cls = 'mostly-bench';

        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${name}</td><td class="${cls}">${c.inField}</td><td>${c.onBench}</td><td>${total}</td>`;
        trackerBody.appendChild(tr);
    });
}

// --- Game Stats ---
function renderGameStats(game) {
    renderBattingStats(game);
    renderFieldingStatsTable(game);
    renderPitchingStats(game);
}

function getBatters(game) {
    return game.batting.filter(b => b.player).map(b => b.player);
}

function renderBattingStats(game) {
    const body = document.getElementById('batting-stats-body');
    body.innerHTML = '';
    const batters = getBatters(game);
    if (!batters.length) {
        body.innerHTML = '<tr><td colspan="14" style="color:#666;text-align:center">Add players to the batting order first</td></tr>';
        return;
    }

    batters.forEach(name => {
        if (!game.battingStats[name]) game.battingStats[name] = {};
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = name;
        tr.appendChild(tdName);

        BATTING_STATS_FIELDS.forEach(field => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.value = game.battingStats[name][field] || '';
            input.addEventListener('change', () => {
                game.battingStats[name][field] = parseInt(input.value) || 0;
                saveData(data);
            });
            td.appendChild(input);
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
}

function renderFieldingStatsTable(game) {
    const body = document.getElementById('fielding-stats-body');
    body.innerHTML = '';

    // Show stats for all roster players who appear in fielding
    const playersInGame = new Set();
    POSITIONS.forEach(pos => {
        for (let inn = 1; inn <= game.innings; inn++) {
            const p = game.fielding[pos]?.[inn];
            if (p) playersInGame.add(p);
        }
    });
    // Also add batters
    getBatters(game).forEach(b => playersInGame.add(b));

    const players = data.roster.filter(n => playersInGame.has(n));
    if (!players.length) {
        body.innerHTML = '<tr><td colspan="4" style="color:#666;text-align:center">Set up batting order or fielding first</td></tr>';
        return;
    }

    players.forEach(name => {
        if (!game.fieldingStats[name]) game.fieldingStats[name] = {};
        const tr = document.createElement('tr');
        const tdName = document.createElement('td');
        tdName.textContent = name;
        tr.appendChild(tdName);

        FIELDING_STATS_FIELDS.forEach(field => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.value = game.fieldingStats[name][field] || '';
            input.addEventListener('change', () => {
                game.fieldingStats[name][field] = parseInt(input.value) || 0;
                saveData(data);
            });
            td.appendChild(input);
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
}

function renderPitchingStats(game) {
    const body = document.getElementById('pitching-stats-body');
    body.innerHTML = '';

    game.pitchingStats.forEach((entry, idx) => {
        const tr = document.createElement('tr');

        // Player select
        const tdName = document.createElement('td');
        const sel = document.createElement('select');
        sel.classList.add('player-select');
        sel.innerHTML = '<option value="">--</option>';
        data.roster.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (entry.player === name) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
            entry.player = sel.value || '';
            saveData(data);
        });
        tdName.appendChild(sel);
        tr.appendChild(tdName);

        PITCHING_STATS_FIELDS.forEach(field => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.step = field === 'IP' ? '0.1' : '1';
            input.value = entry[field] || '';
            input.addEventListener('change', () => {
                entry[field] = parseFloat(input.value) || 0;
                saveData(data);
            });
            td.appendChild(input);
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
}

document.getElementById('add-pitcher-row').addEventListener('click', () => {
    const game = getGame();
    if (!game) return;
    game.pitchingStats.push({ player: '' });
    saveData(data);
    renderPitchingStats(game);
});

// --- Season Tracker ---
const seasonTracker = document.getElementById('season-tracker');

// Independent game filters — each tab has its own state
const tabFilters = {};  // key -> Set of game IDs
let activeTabFilter = 'batting'; // which filter getFilteredGames() uses

function allGameIds() { return new Set(data.games.map(g => g.id)); }

function initFilter() {
    const all = allGameIds();
    tabFilters['batting'] = new Set(all);
    // Season tabs
    ['innings', 'batting-totals', 'fielding', 'pitching', 'lineup', 'optimal', 'compare'].forEach(k => {
        tabFilters[k] = new Set(all);
    });
}
initFilter();

function getFilteredGames() {
    const ids = tabFilters[activeTabFilter] || allGameIds();
    return data.games.filter(g => ids.has(g.id)).sort((a, b) => a.date.localeCompare(b.date));
}

function getBattingFilteredGames() {
    const ids = tabFilters['batting'] || allGameIds();
    return data.games.filter(g => ids.has(g.id)).sort((a, b) => a.date.localeCompare(b.date));
}

// Render a filter into a .tab-game-filter element
function renderTabFilter(filterEl, filterKey, onChangeCallback) {
    const list = filterEl.querySelector('.tab-filter-list');
    if (!list) return;
    list.innerHTML = '';
    if (!tabFilters[filterKey]) tabFilters[filterKey] = allGameIds();

    data.games.sort((a, b) => a.date.localeCompare(b.date));
    data.games.forEach(g => {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = tabFilters[filterKey].has(g.id);
        cb.addEventListener('change', () => {
            if (cb.checked) tabFilters[filterKey].add(g.id);
            else tabFilters[filterKey].delete(g.id);
            onChangeCallback();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(` ${formatDate(g.date)} vs ${g.opponent}`));
        list.appendChild(label);
    });

    // Wire All/None buttons
    const allBtn = filterEl.querySelector('.tab-filter-all');
    const noneBtn = filterEl.querySelector('.tab-filter-none');
    if (allBtn) {
        allBtn.onclick = () => { tabFilters[filterKey] = allGameIds(); renderTabFilter(filterEl, filterKey, onChangeCallback); onChangeCallback(); };
    }
    if (noneBtn) {
        noneBtn.onclick = () => { tabFilters[filterKey].clear(); renderTabFilter(filterEl, filterKey, onChangeCallback); onChangeCallback(); };
    }
}

// Batting order tab filter
function renderBattingFilter() {
    const el = document.getElementById('batting-game-filter');
    if (!el) return;
    renderTabFilter(el, 'batting', () => {
        if (activeGameId) { const g = getGame(); if (g) { activeTabFilter = 'batting'; renderBatting(g); } }
    });
}

// Render all season tab filters
function renderAllSeasonFilters() {
    const mapping = {
        'innings': { tabId: 'season-innings-tab', render: renderSeasonInnings },
        'batting-totals': { tabId: 'season-batting-tab', render: renderSeasonBatting },
        'fielding': { tabId: 'season-fielding-tab', render: renderSeasonFielding },
        'pitching': { tabId: 'season-pitching-tab', render: renderSeasonPitching },
        'lineup': { tabId: 'season-lineup-tab', render: renderSeasonLineup },
        'optimal': { tabId: 'season-optimal-tab', render: renderOptimalLineup },
        'compare': { tabId: 'season-compare-tab', render: renderSeasonCompare },
    };
    Object.entries(mapping).forEach(([key, { tabId, render }]) => {
        const tab = document.getElementById(tabId);
        if (!tab) return;
        const filterEl = tab.querySelector('.tab-game-filter');
        if (!filterEl) return;
        renderTabFilter(filterEl, key, () => {
            activeTabFilter = key;
            render();
        });
    });
}

function renderAllFilters() {
    renderBattingFilter();
    renderAllSeasonFilters();
}

function renderGameFilter() { renderAllSeasonFilters(); }

document.getElementById('season-tracker-btn').addEventListener('click', () => {
    seasonTracker.classList.toggle('hidden');
    if (!seasonTracker.classList.contains('hidden')) {
        // Reset all season tab filters to all games
        ['innings', 'batting-totals', 'fielding', 'pitching', 'lineup', 'optimal', 'compare'].forEach(k => {
            tabFilters[k] = allGameIds();
        });
        renderAllSeasonFilters();
        renderSeasonTracker();
    }
});

document.getElementById('close-season-tracker').addEventListener('click', () => {
    seasonTracker.classList.add('hidden');
});

function renderSeasonTracker() {
    activeTabFilter = 'innings'; renderSeasonInnings();
    activeTabFilter = 'batting-totals'; renderSeasonBatting();
    activeTabFilter = 'fielding'; renderSeasonFielding();
    activeTabFilter = 'pitching'; renderSeasonPitching();
    activeTabFilter = 'lineup'; renderSeasonLineup();
    activeTabFilter = 'compare'; renderSeasonCompare();
    activeTabFilter = 'optimal'; renderOptimalLineup();
}

function renderSeasonInnings() {
    const body = document.getElementById('season-innings-body');
    body.innerHTML = '';

    // For each player, count innings at each position across all games
    const posMap = {}; // name -> { Pitcher: n, Catcher: n, ... Bench: n, total: n }
    data.roster.forEach(name => {
        posMap[name] = {};
        POSITIONS.forEach(p => posMap[name][p] = 0);
        posMap[name]['Bench'] = 0;
        posMap[name]['total'] = 0;
    });

    getFilteredGames().forEach(game => {
        if (!game.fielding) return;
        for (let inn = 1; inn <= game.innings; inn++) {
            POSITIONS.forEach(pos => {
                const p = game.fielding[pos]?.[inn];
                if (p && posMap[p]) {
                    posMap[p][pos]++;
                    posMap[p].total++;
                }
            });
            for (let b = 0; b < BENCH_SLOTS; b++) {
                const p = game.fielding[`Bench ${b + 1}`]?.[inn];
                if (p && posMap[p]) {
                    posMap[p]['Bench']++;
                    posMap[p].total++;
                }
            }
        }
    });

    data.roster.forEach(name => {
        const m = posMap[name];
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${name}</td>` +
            POSITIONS.map(p => `<td>${m[p] || ''}</td>`).join('') +
            `<td>${m['Bench'] || ''}</td>` +
            `<td><strong>${m.total || ''}</strong></td>`;
        body.appendChild(tr);
    });

    // Totals row
    const totals = {};
    POSITIONS.forEach(p => totals[p] = 0);
    totals['Bench'] = 0;
    totals['total'] = 0;
    data.roster.forEach(name => {
        const m = posMap[name];
        POSITIONS.forEach(p => totals[p] += m[p]);
        totals['Bench'] += m['Bench'];
        totals['total'] += m.total;
    });
    const trTot = document.createElement('tr');
    trTot.classList.add('season-total-row');
    trTot.innerHTML = `<td>TOTAL</td>` +
        POSITIONS.map(p => `<td>${totals[p]}</td>`).join('') +
        `<td>${totals['Bench']}</td><td>${totals['total']}</td>`;
    body.appendChild(trTot);
    makeSeasonTableSortable('season-innings-table');
    sortSeasonTable('season-innings-table');
}

// Generic season table sort state: { tableId: { col, dir } }
const seasonSortState = {};

function makeSeasonTableSortable(tableId) {
    if (!seasonSortState[tableId]) seasonSortState[tableId] = { col: -1, dir: 0 };
    const table = document.getElementById(tableId);
    if (!table) return;

    const ths = table.querySelectorAll('thead th');
    ths.forEach((th, i) => {
        th.classList.remove('sort-asc', 'sort-desc');
        th.style.cursor = i > 0 ? 'pointer' : '';

        const state = seasonSortState[tableId];
        if (i === state.col) {
            th.classList.add(state.dir === 1 ? 'sort-desc' : state.dir === 2 ? 'sort-asc' : '');
        }

        if (!th._sortBound) {
            th._sortBound = true;
            th.addEventListener('click', () => {
                if (i === 0) return;
                const st = seasonSortState[tableId];
                if (st.col === i) {
                    st.dir = (st.dir + 1) % 3;
                } else {
                    st.col = i;
                    st.dir = 1;
                }
                sortSeasonTable(tableId);
            });
        }
    });
}

function sortSeasonTable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const state = seasonSortState[tableId];
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr:not(.season-total-row):not(.lineup-spot-header)'));

    if (state.col > 0 && state.dir > 0) {
        rows.sort((a, b) => {
            const va = parseFloat(a.children[state.col]?.textContent) || 0;
            const vb = parseFloat(b.children[state.col]?.textContent) || 0;
            return state.dir === 1 ? vb - va : va - vb;
        });
    }

    // Re-append sorted rows (total rows stay at bottom)
    const totalRows = Array.from(tbody.querySelectorAll('.season-total-row'));
    const spotHeaders = Array.from(tbody.querySelectorAll('.lineup-spot-header'));

    // Only re-sort if no spot headers (lineup performance has its own grouping)
    if (spotHeaders.length === 0) {
        rows.forEach(r => tbody.appendChild(r));
        totalRows.forEach(r => tbody.appendChild(r));
    }

    // Highlight best/worst
    if (state.col > 0 && state.dir > 0 && rows.length >= 2) {
        // Clear old highlights
        tbody.querySelectorAll('.highlight-best, .highlight-worst').forEach(el => {
            el.classList.remove('highlight-best', 'highlight-worst');
        });

        const vals = rows.map(r => parseFloat(r.children[state.col]?.textContent) || 0);
        const positiveVals = vals.filter(v => v > 0);
        if (positiveVals.length > 0) {
            const max = Math.max(...positiveVals);
            const min = Math.min(...positiveVals);
            rows.forEach((r, i) => {
                const td = r.children[state.col];
                if (vals[i] === max && max > 0) td.classList.add('highlight-best');
                if (vals[i] === min && min > 0 && max !== min) td.classList.add('highlight-worst');
            });
        }
    }

    makeSeasonTableSortable(tableId);
}

function buildSeasonBattingRows() {
    const rows = [];
    data.roster.forEach(name => {
        const totals = {};
        BATTING_STATS_FIELDS.forEach(f => totals[f] = 0);
        let gamesPlayed = 0;

        getFilteredGames().forEach(game => {
            if (!game.battingStats?.[name]) return;
            const s = game.battingStats[name];
            const hasStats = BATTING_STATS_FIELDS.some(f => s[f]);
            if (hasStats) gamesPlayed += s['_GP'] || 1; // Use actual GP from season imports
            BATTING_STATS_FIELDS.forEach(f => totals[f] += (s[f] || 0));
        });

        const ab = totals['AB'] || 0;
        const h = totals['H'] || 0;
        const bb = totals['BB'] || 0;
        const hbp = totals['HBP'] || 0;
        const sac = totals['SAC'] || 0;
        const doubles = totals['2B'] || 0;
        const triples = totals['3B'] || 0;
        const hr = totals['HR'] || 0;
        const singles = h - doubles - triples - hr;
        const tb = singles + (doubles * 2) + (triples * 3) + (hr * 4);
        const pa = ab + bb + hbp + sac;
        const avg = ab > 0 ? (h / ab).toFixed(3) : '.000';
        const obp = pa > 0 ? ((h + bb + hbp) / pa).toFixed(3) : '.000';
        const slg = ab > 0 ? (tb / ab).toFixed(3) : '.000';
        const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

        rows.push({
            name,
            vals: [name, gamesPlayed, pa, ab, avg, obp, ops, slg, h, singles, doubles, triples, hr, totals['RBI']||0, totals['R']||0, bb, totals['K']||0, hbp, totals['ROE']||0, totals['SB']||0]
        });
    });
    return rows;
}

function renderSeasonBatting() {
    const body = document.getElementById('season-batting-body');
    const table = document.getElementById('season-batting-table');
    body.innerHTML = '';

    let rows = buildSeasonBattingRows();

    // Render rows
    rows.forEach(row => {
        const tr = document.createElement('tr');
        row.vals.forEach((v, i) => {
            const td = document.createElement('td');
            td.textContent = (i === 0) ? v : (v || '');
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });

    // Totals row
    if (rows.length > 0) {
        // Sum columns: G(1), PA(2), AB(3), H(8), 1B(9), 2B(10), 3B(11), HR(12), RBI(13), R(14), BB(15), SO(16), HBP(17), ROE(18), SB(19)
        // Averages: AVG(4), OBP(5), OPS(6), SLG(7)
        const sumCols = [1,2,3,8,9,10,11,12,13,14,15,16,17,18,19];
        const totVals = new Array(20).fill(0);
        rows.forEach(r => {
            sumCols.forEach(ci => { totVals[ci] += (parseFloat(r.vals[ci]) || 0); });
        });
        // Recalculate averages from totals
        const tAb = totVals[3], tH = totVals[8], tBb = totVals[15], tHbp = totVals[17], tSac = 0;
        const tPa = totVals[2];
        const t2b = totVals[10], t3b = totVals[11], tHr = totVals[12];
        const t1b = tH - t2b - t3b - tHr;
        const tTb = t1b + (t2b * 2) + (t3b * 3) + (tHr * 4);
        const tAvg = tAb > 0 ? (tH / tAb).toFixed(3) : '.000';
        const tObp = tPa > 0 ? ((tH + tBb + tHbp) / tPa).toFixed(3) : '.000';
        const tSlg = tAb > 0 ? (tTb / tAb).toFixed(3) : '.000';
        const tOps = (parseFloat(tObp) + parseFloat(tSlg)).toFixed(3);

        const totTr = document.createElement('tr');
        totTr.classList.add('season-total-row');
        const totData = ['TOTAL', totVals[1], totVals[2], totVals[3], tAvg, tObp, tOps, tSlg,
            totVals[8], totVals[9], totVals[10], totVals[11], totVals[12], totVals[13], totVals[14],
            totVals[15], totVals[16], totVals[17], totVals[18], totVals[19]];
        totData.forEach((v, i) => {
            const td = document.createElement('td');
            td.textContent = (i === 0) ? v : (v || '');
            totTr.appendChild(td);
        });
        body.appendChild(totTr);
    }

    makeSeasonTableSortable('season-batting-table');
    sortSeasonTable('season-batting-table');
}

function renderSeasonFielding() {
    const body = document.getElementById('season-fielding-body');
    body.innerHTML = '';

    const rows = [];
    data.roster.forEach(name => {
        const totals = {};
        FIELDING_STATS_FIELDS.forEach(f => totals[f] = 0);
        let gamesPlayed = 0;

        getFilteredGames().forEach(game => {
            if (!game.fieldingStats?.[name]) return;
            const s = game.fieldingStats[name];
            const hasStats = FIELDING_STATS_FIELDS.some(f => s[f]);
            if (hasStats) gamesPlayed++;
            FIELDING_STATS_FIELDS.forEach(f => totals[f] += (s[f] || 0));
        });

        const po = totals['PO'] || 0;
        const a = totals['A'] || 0;
        const e = totals['E'] || 0;
        const tc = po + a + e;
        const fldPct = tc > 0 ? ((po + a) / tc).toFixed(3) : '.000';

        rows.push({ name, gamesPlayed, totals, fldPct, fldNum: parseFloat(fldPct) });
    });

    rows.sort((a, b) => b.fldNum - a.fldNum || b.gamesPlayed - a.gamesPlayed);

    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.name}</td><td>${r.gamesPlayed || ''}</td>` +
            FIELDING_STATS_FIELDS.map(f => `<td>${r.totals[f] || ''}</td>`).join('') +
            `<td>${r.fldPct}</td>`;
        body.appendChild(tr);
    });
    makeSeasonTableSortable('season-fielding-table');
    sortSeasonTable('season-fielding-table');
}

function renderSeasonPitching() {
    const body = document.getElementById('season-pitching-body');
    body.innerHTML = '';

    // Collect all pitchers
    const pitcherTotals = {};

    getFilteredGames().forEach(game => {
        if (!game.pitchingStats) return;
        game.pitchingStats.forEach(entry => {
            if (!entry.player) return;
            if (!pitcherTotals[entry.player]) {
                pitcherTotals[entry.player] = { games: 0 };
                PITCHING_STATS_FIELDS.forEach(f => pitcherTotals[entry.player][f] = 0);
            }
            const t = pitcherTotals[entry.player];
            t.games++;
            PITCHING_STATS_FIELDS.forEach(f => t[f] += (parseFloat(entry[f]) || 0));
        });
    });

    // Convert IP to proper innings (handle .1 .2 thirds)
    function normalizeIP(rawIP) {
        // IP stored as decimal where .1 = 1/3, .2 = 2/3
        const full = Math.floor(rawIP);
        const frac = Math.round((rawIP - full) * 10);
        return full + frac / 3;
    }

    data.roster.forEach(name => {
        const t = pitcherTotals[name];
        if (!t) return;

        const ip = t['IP'] || 0;
        const er = t['ER'] || 0;
        const normalizedIP = normalizeIP(ip);
        const era = normalizedIP > 0 ? ((er * 7) / normalizedIP).toFixed(2) : '0.00';

        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${name}</td><td>${t.games}</td>` +
            PITCHING_STATS_FIELDS.map(f => `<td>${f === 'IP' && t[f] ? t[f].toFixed(1) : (t[f] || '')}</td>`).join('') +
            `<td>${era}</td>`;
        body.appendChild(tr);
    });
    makeSeasonTableSortable('season-pitching-table');
    sortSeasonTable('season-pitching-table');
}

// --- Season Lineup Performance ---
let activeSpotFilter = 'all';
let activePlayerFilter = 'all';

function buildLineupData() {
    const bySpot = {};

    getFilteredGames().forEach(game => {
        // Skip imported season aggregates — batting order isn't real
        if (game.id.startsWith('season_')) return;
        if (!game.batting || !game.batting.length) return;
        game.batting.forEach((entry, idx) => {
            const name = entry.player;
            if (!name) return;
            const spot = idx + 1;
            const s = game.battingStats?.[name];
            if (!s) return;

            const gab = s['AB'] || 0;
            const gbb = s['BB'] || 0;
            const ghbp = s['HBP'] || 0;
            const gsac = s['SAC'] || 0;
            if (gab + gbb + ghbp + gsac === 0) return;

            if (!bySpot[name]) bySpot[name] = {};
            if (!bySpot[name][spot]) {
                bySpot[name][spot] = { ab:0, h:0, bb:0, hbp:0, sac:0, rbi:0, r:0, k:0, sb:0, roe:0, '2b':0, '3b':0, hr:0, g:0 };
            }

            const t = bySpot[name][spot];
            t.ab += gab;
            t.h += s['H'] || 0;
            t.bb += gbb;
            t.hbp += ghbp;
            t.sac += gsac;
            t.rbi += s['RBI'] || 0;
            t.r += s['R'] || 0;
            t.k += s['K'] || 0;
            t.sb += s['SB'] || 0;
            t.roe += s['ROE'] || 0;
            t['2b'] += s['2B'] || 0;
            t['3b'] += s['3B'] || 0;
            t.hr += s['HR'] || 0;
            t.g++;
        });
    });

    return bySpot;
}

function renderSeasonLineup() {
    const body = document.getElementById('season-lineup-body');
    const spotFilterDiv = document.getElementById('lineup-spot-filter');
    const playerFilterDiv = document.getElementById('lineup-player-filter');
    body.innerHTML = '';

    const bySpot = buildLineupData();

    // Find all spots and players
    const allSpots = new Set();
    const allPlayers = new Set();
    Object.entries(bySpot).forEach(([name, spots]) => {
        allPlayers.add(name);
        Object.keys(spots).forEach(s => allSpots.add(parseInt(s)));
    });
    const sortedSpots = [...allSpots].sort((a, b) => a - b);
    const sortedPlayers = data.roster.filter(n => allPlayers.has(n));

    // Render spot filter buttons
    spotFilterDiv.innerHTML = '<span>Filter Spot:</span>';
    const allSpotBtn = document.createElement('button');
    allSpotBtn.classList.add('spot-filter-btn');
    if (activeSpotFilter === 'all') allSpotBtn.classList.add('active');
    allSpotBtn.textContent = 'All';
    allSpotBtn.addEventListener('click', () => { activeSpotFilter = 'all'; renderSeasonLineup(); });
    spotFilterDiv.appendChild(allSpotBtn);

    sortedSpots.forEach(spot => {
        const btn = document.createElement('button');
        btn.classList.add('spot-filter-btn');
        if (activeSpotFilter === spot) btn.classList.add('active');
        btn.textContent = `#${spot}`;
        btn.addEventListener('click', () => { activeSpotFilter = spot; renderSeasonLineup(); });
        spotFilterDiv.appendChild(btn);
    });

    // Render player filter buttons
    playerFilterDiv.innerHTML = '<span>Filter Player:</span>';
    const allPlayerBtn = document.createElement('button');
    allPlayerBtn.classList.add('player-filter-btn');
    if (activePlayerFilter === 'all') allPlayerBtn.classList.add('active');
    allPlayerBtn.textContent = 'All';
    allPlayerBtn.addEventListener('click', () => { activePlayerFilter = 'all'; renderSeasonLineup(); });
    playerFilterDiv.appendChild(allPlayerBtn);

    sortedPlayers.forEach(name => {
        const btn = document.createElement('button');
        btn.classList.add('player-filter-btn');
        if (activePlayerFilter === name) btn.classList.add('active');
        btn.textContent = name;
        btn.addEventListener('click', () => { activePlayerFilter = name; renderSeasonLineup(); });
        playerFilterDiv.appendChild(btn);
    });

    // Filter spots to display
    const displaySpots = activeSpotFilter === 'all' ? sortedSpots : [activeSpotFilter];

    displaySpots.forEach(spot => {
        const players = [];
        Object.entries(bySpot).forEach(([name, spots]) => {
            if (!spots[spot]) return;
            if (activePlayerFilter !== 'all' && name !== activePlayerFilter) return;
            const t = spots[spot];
            const pa = t.ab + t.bb + t.hbp + t.sac;
            const singles = t.h - t['2b'] - t['3b'] - t.hr;
            const tb = singles + (t['2b'] * 2) + (t['3b'] * 3) + (t.hr * 4);
            const avg = t.ab > 0 ? (t.h / t.ab).toFixed(3) : '.000';
            const obp = pa > 0 ? ((t.h + t.bb + t.hbp) / pa).toFixed(3) : '.000';
            const slg = t.ab > 0 ? (tb / t.ab).toFixed(3) : '.000';
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

            players.push({
                name, spot, g: t.g, pa, ab: t.ab, avg, obp, ops, slg,
                h: t.h, s1b: singles, s2b: t['2b'], s3b: t['3b'], hr: t.hr,
                rbi: t.rbi, r: t.r, bb: t.bb, so: t.k, hbp: t.hbp, roe: t.roe, sb: t.sb
            });
        });

        players.sort((a, b) => parseFloat(b.avg) - parseFloat(a.avg) || b.g - a.g);
        if (!players.length) return;

        // Spot header row (only if there are players to show)
        const headerTr = document.createElement('tr');
        headerTr.classList.add('lineup-spot-header');
        headerTr.innerHTML = `<td colspan="21">#${spot} in Lineup</td>`;
        body.appendChild(headerTr);

        players.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML =
                `<td>${p.name}</td>` +
                `<td>${p.spot}</td>` +
                `<td>${p.g}</td>` +
                `<td>${p.pa || ''}</td>` +
                `<td>${p.ab || ''}</td>` +
                `<td>${p.avg}</td>` +
                `<td>${p.obp}</td>` +
                `<td>${p.ops}</td>` +
                `<td>${p.slg}</td>` +
                `<td>${p.h || ''}</td>` +
                `<td>${p.s1b || ''}</td>` +
                `<td>${p.s2b || ''}</td>` +
                `<td>${p.s3b || ''}</td>` +
                `<td>${p.hr || ''}</td>` +
                `<td>${p.rbi || ''}</td>` +
                `<td>${p.r || ''}</td>` +
                `<td>${p.bb || ''}</td>` +
                `<td>${p.so || ''}</td>` +
                `<td>${p.hbp || ''}</td>` +
                `<td>${p.roe || ''}</td>` +
                `<td>${p.sb || ''}</td>`;
            body.appendChild(tr);
        });
    });
    makeSeasonTableSortable('season-lineup-table');
    sortSeasonTable('season-lineup-table');
}

// --- Optimal Lineup Generator ---
// Modern sabermetrics model (2025):
// - wOBA with 2025 linear weights
// - ISO (Isolated Power)
// - Contact rate (K avoidance)
// - Speed/SB component
// - Run-limit aware "Groups of Three" staggering for 10U youth
// - Modern position hierarchy: #2 = best hitter, #1 = high OBP, #4 = best power
// - Year weighting: 2026 at 70%, 2025 at 30%

// 2025 wOBA linear weights (from FanGraphs Guts)
const WOBA_WEIGHTS = { BB: 0.692, HBP: 0.732, '1B': 0.885, '2B': 1.258, '3B': 1.593, HR: 2.053 };

// Coach-ranked speed ratings (1.0 = fastest, descending)
// Used to supplement SB stats since fast players may lack SB opportunities
const SPEED_RATINGS = {
    'Jackson': 1.00,
    'Kru':     1.00,
    'Joseph':  0.80,
    'Harrison': 0.80,
    'CH':      0.80,
    'Henry':   0.70,
};

function computePlayerScores() {
    const scores = [];
    // Dynamic Marcel-style weighting per player:
    // w26 = gp_2026 / (gp_2026 + K), where K is the regression constant
    // K=5 means after 5 games in 2026, it's weighted 50/50
    // After 10 games: 67% 2026 / 33% 2025
    // After 15 games: 75% 2026 / 25% 2025
    // After 20 games: 80% 2026 / 20% 2025
    // If only one year has data, that year gets 100%
    const REGRESSION_K = 5;

    function accumGames(games, name) {
        let ab = 0, h = 0, bb = 0, hbp = 0, sac = 0, sf = 0, sb = 0, k = 0, gp = 0;
        let singles = 0, doubles = 0, triples = 0, hr = 0, r = 0, rbi = 0;
        games.forEach(game => {
            const s = game.battingStats?.[name];
            if (!s) return;
            const gab = s['AB'] || 0;
            const gbb = s['BB'] || 0;
            const ghbp = s['HBP'] || 0;
            const gsac = s['SAC'] || 0;
            if (gab + gbb + ghbp + gsac === 0) return;

            // Use actual GP from imported season CSVs (_GP field)
            const rawGP = s['_GP'] || 1;
            gp += rawGP;

            ab += gab; h += s['H'] || 0; bb += gbb; hbp += ghbp; sac += gsac;
            sb += s['SB'] || 0; k += s['K'] || 0;
            doubles += s['2B'] || 0; triples += s['3B'] || 0; hr += s['HR'] || 0;
            r += s['R'] || 0; rbi += s['RBI'] || 0;
        });
        singles = h - doubles - triples - hr;
        const pa = ab + bb + hbp + sac;
        const tb = singles + (doubles * 2) + (triples * 3) + (hr * 4);

        // wOBA = (wBB*BB + wHBP*HBP + w1B*1B + w2B*2B + w3B*3B + wHR*HR) / PA
        const woba = pa > 0 ? (
            WOBA_WEIGHTS.BB * bb +
            WOBA_WEIGHTS.HBP * hbp +
            WOBA_WEIGHTS['1B'] * singles +
            WOBA_WEIGHTS['2B'] * doubles +
            WOBA_WEIGHTS['3B'] * triples +
            WOBA_WEIGHTS.HR * hr
        ) / pa : 0;

        // ISO = SLG - AVG = extra-base power isolated from contact
        const avg = ab > 0 ? h / ab : 0;
        const slg = ab > 0 ? tb / ab : 0;
        const iso = slg - avg;

        return {
            gp, ab, pa, h, bb, hbp, k, singles, doubles, triples, hr, sb, r, rbi,
            obp: pa > 0 ? (h + bb + hbp) / pa : 0,
            slg, avg, iso: Math.max(iso, 0),
            woba,
            contactPct: ab > 0 ? (ab - k) / ab : 0,
            bbRate: pa > 0 ? bb / pa : 0,
            kRate: ab > 0 ? k / ab : 0,
            bbG: gp > 0 ? bb / gp : 0,
            kG: gp > 0 ? k / gp : 0,
            sbG: gp > 0 ? sb / gp : 0,
            rG: gp > 0 ? r / gp : 0,
        };
    }

    const filtered = getFilteredGames();
    const games25 = filtered.filter(g => g.date && g.date.startsWith('2025'));
    const games26 = filtered.filter(g => g.date && g.date.startsWith('2026'));

    data.roster.forEach(name => {
        const s25 = accumGames(games25, name);
        const s26 = accumGames(games26, name);
        const totalGP = s25.gp + s26.gp;

        if (totalGP === 0) {
            scores.push({ name, gp: 0, woba: 0, obp: 0, slg: 0, iso: 0, ops: 0, avg: 0,
                bbG: 0, kG: 0, sbG: 0, rG: 0, contactPct: 0, bbRate: 0, kRate: 0,
                wobaScore: 0, contactScore: 0, speedScore: 0, isoScore: 0, totalScore: 0, w25: 0, w26: 0 });
            return;
        }

        // Dynamic per-player weighting based on games played
        // For projected 2025 data, cap the GP used in weighting so it doesn't dominate
        let w25 = 0, w26 = 0;
        if (s25.gp > 0 && s26.gp > 0) {
            // Check if 2025 data is projected (has _projected flag in any 2025 game)
            const has2025Projected = games25.some(g => g.battingStats?.[name]?._projected);
            const weightGP25 = has2025Projected ? Math.min(s25.gp, 3) : s25.gp;
            // Marcel formula: current year weight increases with more games
            w26 = s26.gp / (s26.gp + REGRESSION_K);
            // But floor w26 at 60% if 2025 is projected (it's derived from 2026 anyway)
            if (has2025Projected) w26 = Math.max(w26, 0.60);
            w25 = 1.0 - w26;
        } else if (s26.gp > 0) {
            w26 = 1.0;
        } else {
            w25 = 1.0;
        }

        // Blend all rate stats dynamically
        const blend = (f) => (s25[f] * w25) + (s26[f] * w26);
        const woba = blend('woba');
        const obp = blend('obp');
        const slg = blend('slg');
        const iso = blend('iso');
        const avg = blend('avg');
        const contactPct = blend('contactPct');
        const bbRate = blend('bbRate');
        const kRate = blend('kRate');
        const bbG = blend('bbG');
        const kG = blend('kG');
        const sbG = blend('sbG');
        const rG = blend('rG');
        const ops = obp + slg;

        // Modern composite scoring for 10U youth:
        // wOBA 35% — best single offensive metric, captures all outcomes weighted by run value
        // Contact 25% — K avoidance critical at youth level (walks are common, Ks waste PA)
        // Speed 20% — SB has outsized impact in youth (weak arms, stolen bases easy)
        // ISO 20% — isolated power, extra-base ability separate from contact
        const wobaScore = woba;                          // 0 to ~0.500
        const contactScore = contactPct;                  // 0 to 1.0
        // Speed: blend SB stats (40%) with coach speed rating (60%)
        // Coach rating captures true speed even without SB opportunities
        const sbScore = Math.min(sbG / 2, 1);
        const coachSpeed = SPEED_RATINGS[name] || 0.35; // default for unranked players
        const speedScore = (sbScore * 0.40) + (coachSpeed * 0.60);
        const isoScore = Math.min(iso / 0.300, 1);       // 0 to 1.0 (.300+ ISO = max)

        const totalScore = (wobaScore * 0.35) + (contactScore * 0.25) + (speedScore * 0.20) + (isoScore * 0.20);

        scores.push({
            name, gp: totalGP, woba, obp, slg, iso, ops, avg,
            bbG, kG, sbG, rG, contactPct, bbRate, kRate,
            wobaScore, contactScore, speedScore, isoScore, totalScore,
            w25: Math.round(w25 * 100), w26: Math.round(w26 * 100)
        });
    });

    return scores;
}

// --- Markov Chain Run Expectancy Simulator ---
// Simulates innings to calculate expected runs for a given batting order
// Uses each player's actual outcome probabilities (BB%, 1B%, 2B%, 3B%, HR%, out%)
// Models base-out states and runner advancement

function getPlayerProbs(p) {
    // Convert rates to per-PA outcome probabilities
    const pa = (p.obp > 0 || p.avg > 0) ? 1 : 0; // has data?
    if (!pa) return { out: 1, bb: 0, s1b: 0, s2b: 0, s3b: 0, hr: 0 };

    const bb = p.bbRate || 0;
    const hbp = 0.02; // approximate HBP rate
    // Distribute hits using ISO to estimate extra-base frequency
    const hitRate = p.avg * (1 - bb - hbp); // hits per non-walk PA
    const isoRatio = p.iso > 0 ? Math.min(p.iso / p.slg, 0.6) : 0;
    const xbhRate = hitRate * isoRatio;
    const s1bRate = hitRate - xbhRate;
    // Split XBH: approximate from ISO profile
    const hrRate = Math.min(p.iso * 0.15, hitRate * 0.3);
    const s3bRate = Math.min(p.iso * 0.05, hitRate * 0.1);
    const s2bRate = Math.max(xbhRate - hrRate - s3bRate, 0);

    const totalOnBase = bb + hbp + s1bRate + s2bRate + s3bRate + hrRate;
    const outRate = Math.max(1 - totalOnBase, 0.2);

    return { out: outRate, bb: bb + hbp, s1b: s1bRate, s2b: s2bRate, s3b: s3bRate, hr: hrRate };
}

// Seeded PRNG for deterministic simulation (Mulberry32)
function createRNG(seed) {
    let s = seed | 0;
    return function() {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

let simRNG = createRNG(42);

function simulateInning(batters, startIdx) {
    let outs = 0, runs = 0;
    let bases = [0, 0, 0];
    let bIdx = startIdx;
    while (outs < 3) {
        const p = batters[bIdx % batters.length];
        const probs = getPlayerProbs(p);
        const rand = simRNG();

        let cumulative = 0;
        let outcome = 'out';
        const outcomes = ['bb', 's1b', 's2b', 's3b', 'hr', 'out'];
        const probValues = [probs.bb, probs.s1b, probs.s2b, probs.s3b, probs.hr, probs.out];

        for (let i = 0; i < outcomes.length; i++) {
            cumulative += probValues[i];
            if (rand < cumulative) { outcome = outcomes[i]; break; }
        }

        // Apply speed bonus: fast runners advance extra base 30% of time on singles/doubles
        const speedBonus = (SPEED_RATINGS[p.name] || 0.35) > 0.7 ? 0.30 : 0.10;

        if (outcome === 'out') {
            outs++;
            // Runner on 3B scores on out with <2 outs (sac fly)
            if (outs < 3 && bases[2] && simRNG() < 0.35) {
                runs++; bases[2] = 0;
            }
        } else if (outcome === 'bb') {
            // Walk: advance forced runners
            if (bases[0] && bases[1] && bases[2]) { runs++; }
            if (bases[0] && bases[1]) { bases[2] = 1; }
            if (bases[0]) { bases[1] = 1; }
            bases[0] = 1;
        } else if (outcome === 's1b') {
            // Single: runners advance 1-2 bases
            if (bases[2]) { runs++; bases[2] = 0; }
            if (bases[1]) { runs += simRNG() < (0.55 + speedBonus) ? 1 : 0; if (runs === 0) bases[2] = 1; bases[1] = 0; }
            if (bases[0]) { bases[1] = 1; if (simRNG() < speedBonus) { bases[2] = bases[1]; bases[1] = 0; } bases[0] = 0; }
            // Batter to 1B
            if (bases[1]) { /* already occupied, batter still goes to 1B */ }
            bases[0] = 1;
        } else if (outcome === 's2b') {
            // Double: runners advance 2 bases
            if (bases[2]) { runs++; bases[2] = 0; }
            if (bases[1]) { runs++; bases[1] = 0; }
            if (bases[0]) { runs += simRNG() < (0.45 + speedBonus) ? 1 : 0; if (!runs) bases[2] = 1; bases[0] = 0; }
            bases[1] = 1;
        } else if (outcome === 's3b') {
            // Triple: all runners score
            runs += bases[0] + bases[1] + bases[2];
            bases = [0, 0, 1];
        } else if (outcome === 'hr') {
            // HR: all runners + batter score
            runs += bases[0] + bases[1] + bases[2] + 1;
            bases = [0, 0, 0];
        }

        bIdx++;
    }

    return { runs, nextBatter: bIdx % batters.length };
}

function simulateGame(batters, innings = 5, simCount = 3000) {
    // Reset seed so same inputs always produce same output
    simRNG = createRNG(42);
    let totalRuns = 0;
    for (let sim = 0; sim < simCount; sim++) {
        let gameRuns = 0;
        let bIdx = 0;
        for (let inn = 0; inn < innings; inn++) {
            const result = simulateInning(batters, bIdx);
            gameRuns += result.runs;
            bIdx = result.nextBatter;
        }
        totalRuns += gameRuns;
    }
    return totalRuns / simCount; // expected runs per game
}

function generateOptimalLineup(scores) {
    const active = [...scores].filter(p => p.gp > 0);
    const inactive = scores.filter(p => p.gp === 0);
    if (active.length === 0) return [];

    // === STEP 1: Build heuristic lineup using modern sabermetrics ===
    const byWoba = [...active].sort((a, b) => b.woba - a.woba);
    const byISO = [...active].sort((a, b) => b.iso - a.iso);
    const byTotal = [...active].sort((a, b) => b.totalScore - a.totalScore);

    const assigned = new Set();
    const lineup = new Array(active.length).fill(null);

    // #2 = Best overall hitter (highest wOBA)
    const spot2 = byWoba[0];
    lineup[1] = { ...spot2, role: '#2 Best hitter (wOBA)' };
    assigned.add(spot2.name);

    // #1 = Highest OBP + speed + contact among top candidates
    const leadoffCandidates = byTotal.filter(p => !assigned.has(p.name)).slice(0, 4);
    leadoffCandidates.sort((a, b) => {
        const aLead = (a.obp * 0.50) + (a.speedScore * 0.30) + (a.contactPct * 0.20);
        const bLead = (b.obp * 0.50) + (b.speedScore * 0.30) + (b.contactPct * 0.20);
        return bLead - aLead;
    });
    const spot1 = leadoffCandidates[0];
    lineup[0] = { ...spot1, role: '#1 Leadoff (OBP + speed)' };
    assigned.add(spot1.name);

    // #4 = Highest ISO (power) among remaining
    const cleanupCandidates = byISO.filter(p => !assigned.has(p.name));
    const spot4 = cleanupCandidates[0];
    lineup[3] = { ...spot4, role: '#4 Cleanup (ISO power)' };
    assigned.add(spot4.name);

    // #3 = Next best wOBA among remaining (high-value, bats with runners on)
    const spot3Candidates = [...active].filter(p => !assigned.has(p.name)).sort((a, b) => b.woba - a.woba);
    const spot3 = spot3Candidates[0];
    lineup[2] = { ...spot3, role: '#3 High wOBA (runners on)' };
    assigned.add(spot3.name);

    // #5 = Secondary power + run production
    const spot5Candidates = byTotal.filter(p => !assigned.has(p.name));
    spot5Candidates.sort((a, b) => {
        const aVal = (a.woba * 0.5) + (a.iso * 0.3) + (a.speedScore * 0.2);
        const bVal = (b.woba * 0.5) + (b.iso * 0.3) + (b.speedScore * 0.2);
        return bVal - aVal;
    });
    const spot5 = spot5Candidates[0];
    lineup[4] = { ...spot5, role: '#5 Secondary power' };
    assigned.add(spot5.name);

    // === STEP 2: Spots 6-12 — Run-limit staggered Groups of Three ===
    const remaining = byTotal.filter(p => !assigned.has(p.name));
    const groups = [];
    for (let i = 0; i < remaining.length; i += 3) groups.push(remaining.slice(i, i + 3));

    const groupLabels = ['GROUP B — Middle Order', 'GROUP C — Lower Order', 'GROUP D — Development'];
    let spotIdx = 5;

    groups.forEach((group, gi) => {
        if (group.length === 1) {
            lineup[spotIdx] = { ...group[0], role: 'Utility hitter', group: gi + 1, groupName: groupLabels[gi] || 'Development' };
            spotIdx++;
        } else if (group.length === 2) {
            const sorted = [...group].sort((a, b) => b.obp - a.obp);
            lineup[spotIdx] = { ...sorted[0], role: 'Table-setter', group: gi + 1, groupName: groupLabels[gi] };
            lineup[spotIdx + 1] = { ...sorted[1], role: 'Run producer', group: gi + 1, groupName: groupLabels[gi] };
            spotIdx += 2;
        } else {
            const obpSort = [...group].sort((a, b) =>
                ((b.obp * 0.6) + (b.speedScore * 0.4)) - ((a.obp * 0.6) + (a.speedScore * 0.4)));
            const setter = obpSort[0];
            const rest = group.filter(p => p.name !== setter.name);
            const isoSort = [...rest].sort((a, b) => b.iso - a.iso);
            lineup[spotIdx] = { ...setter, role: 'Table-setter (OBP)', group: gi + 1, groupName: groupLabels[gi] };
            lineup[spotIdx + 1] = { ...isoSort[1] || isoSort[0], role: 'Contact hitter', group: gi + 1, groupName: groupLabels[gi] };
            lineup[spotIdx + 2] = { ...isoSort[0], role: 'Run producer (power)', group: gi + 1, groupName: groupLabels[gi] };
            spotIdx += 3;
        }
    });

    for (let i = 0; i < 5 && i < lineup.length; i++) {
        if (lineup[i]) { lineup[i].group = 0; lineup[i].groupName = 'GROUP A — Top of Order'; }
    }

    // === STEP 3: Finalize lineup — label groups, calculate expected runs ===
    const finalLineup = lineup.filter(p => p !== null);

    // Label groups
    finalLineup.forEach((p, i) => {
        if (i < 5) { p.group = 0; p.groupName = 'GROUP A — Top of Order'; }
        else if (i < 8) { p.group = 1; p.groupName = 'GROUP B — Middle Order'; }
        else if (i < 11) { p.group = 2; p.groupName = 'GROUP C — Lower Order'; }
        else { p.group = 3; p.groupName = 'GROUP D — Development'; }
    });

    // Run simulation for expected runs (display only, no swapping)
    finalLineup._expectedRuns = simulateGame(finalLineup, 5, 3000);

    // Add inactive
    inactive.forEach(p => {
        finalLineup.push({ ...p, role: 'No stats', group: 99, groupName: 'NO DATA' });
    });

    return finalLineup;
}

function renderOptimalLineup() {
    const body = document.getElementById('optimal-lineup-body');
    body.innerHTML = '';

    const scores = computePlayerScores();
    const lineup = generateOptimalLineup(scores);

    if (!lineup.length) {
        body.innerHTML = '<tr><td colspan="13" style="color:#666;text-align:center">Need game stats to generate lineup</td></tr>';
        return;
    }

    let lastGroup = -1;
    let spotNum = 0;
    lineup.forEach((p) => {
        if (p.group !== lastGroup) {
            lastGroup = p.group;
            const headerTr = document.createElement('tr');
            headerTr.classList.add('group-header');
            headerTr.innerHTML = `<td colspan="13">${p.groupName}</td>`;
            body.appendChild(headerTr);
        }

        spotNum++;
        const tr = document.createElement('tr');
        const color = getPlayerColor(p.name);
        const textColor = color ? getTextColorForBg(color) : '';

        tr.innerHTML =
            `<td>${spotNum}</td>` +
            `<td style="background:${color};color:${textColor}">${p.name}</td>` +
            `<td>${p.role}</td>` +
            `<td>${p.obp > 0 ? p.obp.toFixed(3) : '—'}</td>` +
            `<td>${p.slg > 0 ? p.slg.toFixed(3) : '—'}</td>` +
            `<td>${p.ops > 0 ? p.ops.toFixed(3) : '—'}</td>` +
            `<td>${p.avg > 0 ? p.avg.toFixed(3) : '—'}</td>` +
            `<td>${p.gp > 0 ? p.bbG.toFixed(1) : '—'}</td>` +
            `<td>${p.gp > 0 ? p.kG.toFixed(1) : '—'}</td>` +
            `<td>${p.gp > 0 ? p.sbG.toFixed(1) : '—'}</td>` +
            `<td>${p.gp > 0 ? p.rG.toFixed(1) : '—'}</td>` +
            `<td title="(wOBA×.35)+(Contact×.25)+(Speed×.20)+(ISO×.20)">${p.totalScore > 0 ? p.totalScore.toFixed(3) : '—'}</td>` +
            `<td style="font-size:0.7rem;color:#888">${p.gp > 0 ? p.w25 + '/' + p.w26 : '—'}</td>`;
        body.appendChild(tr);
    });

    // Show expected runs
    if (lineup._expectedRuns) {
        const runsTr = document.createElement('tr');
        runsTr.classList.add('group-header');
        runsTr.innerHTML = `<td colspan="13" style="text-align:center;color:#2ecc71;font-size:0.9rem;">` +
            `Monte Carlo Simulation: <strong>${lineup._expectedRuns.toFixed(2)} expected runs/game</strong> (5 innings, no run limit, 3000 simulations)</td>`;
        body.appendChild(runsTr);
    }

    // Debug: log player scores to console for verification
    console.table(scores.filter(p => p.gp > 0).sort((a,b) => b.totalScore - a.totalScore).map(p => ({
        Name: p.name, GP: p.gp, wOBA: p.woba.toFixed(3), OBP: p.obp.toFixed(3),
        SLG: p.slg.toFixed(3), ISO: p.iso.toFixed(3), Contact: p.contactPct.toFixed(3),
        Speed: p.speedScore.toFixed(3), Score: p.totalScore.toFixed(3),
        W25: p.w25 + '%', W26: p.w26 + '%'
    })));

    window._optimalLineup = lineup;
}

document.getElementById('apply-optimal-btn').addEventListener('click', () => {
    const game = getGame();
    if (!game) { alert('Select a game first.'); return; }
    if (!window._optimalLineup || !window._optimalLineup.length) { alert('No optimal lineup generated.'); return; }
    if (!confirm('Replace the current game\'s batting order with the optimal lineup?')) return;

    game.batting = window._optimalLineup
        .filter(p => p.gp > 0)
        .map(p => ({ player: p.name }));
    saveData(data);
    renderLineup();
});

// --- Year Comparison ---
function renderSeasonCompare() {
    const container = document.getElementById('compare-tables');
    container.innerHTML = '';

    // Group games by year: imported seasons use date year, regular games use date year
    const yearGames = {};
    data.games.forEach(game => {
        const year = game.date ? game.date.substring(0, 4) : 'Unknown';
        if (!yearGames[year]) yearGames[year] = [];
        yearGames[year].push(game);
    });

    const years = Object.keys(yearGames).sort();

    if (years.length < 1) {
        container.innerHTML = '<p style="color:#666;">No games to compare.</p>';
        return;
    }

    // Build stats for each year
    years.forEach(year => {
        const games = yearGames[year];

        // Year header
        const header = document.createElement('h3');
        header.classList.add('compare-year-header');
        header.textContent = `${year} Season`;
        container.appendChild(header);

        // Compute batting stats per player for this year
        const playerStats = {};
        data.roster.forEach(name => {
            const t = { ab: 0, h: 0, bb: 0, hbp: 0, sac: 0, sb: 0, r: 0, rbi: 0, k: 0, roe: 0, '2b': 0, '3b': 0, hr: 0, gp: 0 };
            games.forEach(game => {
                const s = game.battingStats?.[name];
                if (!s) return;
                const gab = s['AB'] || 0;
                const gbb = s['BB'] || 0;
                const ghbp = s['HBP'] || 0;
                const gsac = s['SAC'] || 0;
                if (gab + gbb + ghbp + gsac > 0) t.gp++;
                t.ab += gab;
                t.h += s['H'] || 0;
                t.bb += gbb;
                t.hbp += ghbp;
                t.sac += gsac;
                t.sb += s['SB'] || 0;
                t.r += s['R'] || 0;
                t.rbi += s['RBI'] || 0;
                t.k += s['K'] || 0;
                t.roe += s['ROE'] || 0;
                t['2b'] += s['2B'] || 0;
                t['3b'] += s['3B'] || 0;
                t.hr += s['HR'] || 0;
            });
            if (t.gp > 0) playerStats[name] = t;
        });

        // Build table
        const wrap = document.createElement('div');
        wrap.classList.add('stats-table-wrap');
        const table = document.createElement('table');
        table.innerHTML = `<thead><tr>
            <th>Player</th><th>G</th><th>PA</th><th>AB</th>
            <th>AVG</th><th>OBP</th><th>OPS</th><th>SLG</th>
            <th>H</th><th>1B</th><th>2B</th><th>3B</th><th>HR</th>
            <th>RBI</th><th>R</th><th>BB</th><th>SO</th><th>HBP</th><th>ROE</th><th>SB</th>
        </tr></thead>`;

        const tbody = document.createElement('tbody');

        // Sort by AVG descending
        const sortedPlayers = Object.entries(playerStats).sort((a, b) => {
            const avgA = a[1].ab > 0 ? a[1].h / a[1].ab : 0;
            const avgB = b[1].ab > 0 ? b[1].h / b[1].ab : 0;
            return avgB - avgA;
        });

        sortedPlayers.forEach(([name, t]) => {
            const pa = t.ab + t.bb + t.hbp + t.sac;
            const singles = t.h - t['2b'] - t['3b'] - t.hr;
            const tb = singles + (t['2b'] * 2) + (t['3b'] * 3) + (t.hr * 4);
            const avg = t.ab > 0 ? (t.h / t.ab).toFixed(3) : '.000';
            const obp = pa > 0 ? ((t.h + t.bb + t.hbp) / pa).toFixed(3) : '.000';
            const slg = t.ab > 0 ? (tb / t.ab).toFixed(3) : '.000';
            const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);

            const tr = document.createElement('tr');
            tr.innerHTML =
                `<td>${name}</td>` +
                `<td>${t.gp}</td>` +
                `<td>${pa || ''}</td>` +
                `<td>${t.ab || ''}</td>` +
                `<td>${avg}</td>` +
                `<td>${obp}</td>` +
                `<td>${ops}</td>` +
                `<td>${slg}</td>` +
                `<td>${t.h || ''}</td>` +
                `<td>${singles > 0 ? singles : ''}</td>` +
                `<td>${t['2b'] || ''}</td>` +
                `<td>${t['3b'] || ''}</td>` +
                `<td>${t.hr || ''}</td>` +
                `<td>${t.rbi || ''}</td>` +
                `<td>${t.r || ''}</td>` +
                `<td>${t.bb || ''}</td>` +
                `<td>${t.k || ''}</td>` +
                `<td>${t.hbp || ''}</td>` +
                `<td>${t.roe || ''}</td>` +
                `<td>${t.sb || ''}</td>`;
            tbody.appendChild(tr);
        });

        const tableId = `compare-year-${year}`;
        table.id = tableId;
        table.appendChild(tbody);
        wrap.appendChild(table);
        container.appendChild(wrap);
        makeSeasonTableSortable(tableId);
    });

    // If two years exist, show a delta summary
    if (years.length >= 2) {
        const header = document.createElement('h3');
        header.classList.add('compare-year-header');
        header.textContent = `${years[years.length - 1]} vs ${years[years.length - 2]} Changes`;
        container.appendChild(header);

        const oldYear = years[years.length - 2];
        const newYear = years[years.length - 1];
        const oldGames = yearGames[oldYear];
        const newGames = yearGames[newYear];

        function calcYearAvg(games, name) {
            let ab = 0, h = 0, bb = 0, hbp = 0, sac = 0, rbi = 0;
            games.forEach(g => {
                const s = g.battingStats?.[name];
                if (!s) return;
                ab += s['AB'] || 0;
                h += s['H'] || 0;
                bb += s['BB'] || 0;
                hbp += s['HBP'] || 0;
                sac += s['SAC'] || 0;
                rbi += s['RBI'] || 0;
            });
            const pa = ab + bb + hbp + sac;
            return {
                avg: ab > 0 ? (h / ab) : 0,
                obp: pa > 0 ? ((h + bb + hbp) / pa) : 0,
                rbi
            };
        }

        const wrap = document.createElement('div');
        wrap.classList.add('stats-table-wrap');
        const table = document.createElement('table');
        table.innerHTML = `<thead><tr>
            <th>Player</th>
            <th>${oldYear} AVG</th><th>${newYear} AVG</th><th>+/-</th>
            <th>${oldYear} OBP</th><th>${newYear} OBP</th><th>+/-</th>
            <th>${oldYear} RBI</th><th>${newYear} RBI</th><th>+/-</th>
        </tr></thead>`;

        const tbody = document.createElement('tbody');
        data.roster.forEach(name => {
            const o = calcYearAvg(oldGames, name);
            const n = calcYearAvg(newGames, name);
            if (o.avg === 0 && n.avg === 0) return;

            const avgDiff = n.avg - o.avg;
            const obpDiff = n.obp - o.obp;
            const rbiDiff = n.rbi - o.rbi;

            function diffClass(d) { return d > 0 ? 'compare-improved' : d < 0 ? 'compare-declined' : ''; }
            function diffStr(d, dec) {
                if (dec) return (d > 0 ? '+' : '') + d.toFixed(3);
                return (d > 0 ? '+' : '') + d;
            }

            const tr = document.createElement('tr');
            tr.innerHTML =
                `<td>${name}</td>` +
                `<td>${o.avg > 0 ? o.avg.toFixed(3) : '—'}</td>` +
                `<td>${n.avg > 0 ? n.avg.toFixed(3) : '—'}</td>` +
                `<td class="${diffClass(avgDiff)}">${(o.avg > 0 || n.avg > 0) ? diffStr(avgDiff, true) : ''}</td>` +
                `<td>${o.obp > 0 ? o.obp.toFixed(3) : '—'}</td>` +
                `<td>${n.obp > 0 ? n.obp.toFixed(3) : '—'}</td>` +
                `<td class="${diffClass(obpDiff)}">${(o.obp > 0 || n.obp > 0) ? diffStr(obpDiff, true) : ''}</td>` +
                `<td>${o.rbi || '—'}</td>` +
                `<td>${n.rbi || '—'}</td>` +
                `<td class="${diffClass(rbiDiff)}">${(o.rbi > 0 || n.rbi > 0) ? diffStr(rbiDiff, false) : ''}</td>`;
            tbody.appendChild(tr);
        });

        table.id = 'compare-delta';
        table.appendChild(tbody);
        wrap.appendChild(table);
        container.appendChild(wrap);
        makeSeasonTableSortable('compare-delta');
    }
}

// --- Copy Game ---
const copyGameBtn = document.getElementById('copy-game-btn');
const copyGameDropdown = document.getElementById('copy-game-dropdown');
const copyGameList = document.getElementById('copy-game-list');

copyGameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyGameDropdown.classList.toggle('hidden');
    if (!copyGameDropdown.classList.contains('hidden')) {
        renderCopyGameList();
    }
});

document.addEventListener('click', () => {
    copyGameDropdown.classList.add('hidden');
});

copyGameDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
});

function renderCopyGameList() {
    copyGameList.innerHTML = '';
    const otherGames = data.games.filter(g => g.id !== activeGameId);

    if (!otherGames.length) {
        const li = document.createElement('li');
        li.classList.add('copy-empty');
        li.textContent = 'No other games';
        copyGameList.appendChild(li);
        return;
    }

    otherGames.forEach(g => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="copy-date">${formatDate(g.date)}</span><span class="copy-opp">vs ${g.opponent}</span>`;
        li.addEventListener('click', () => {
            copyFromGame(g.id);
            copyGameDropdown.classList.add('hidden');
        });
        copyGameList.appendChild(li);
    });
}

function copyFromGame(sourceId) {
    const source = data.games.find(g => g.id === sourceId);
    const target = getGame();
    if (!source || !target) return;

    if (!confirm(`Copy batting order and fielding from ${formatDate(source.date)} vs ${source.opponent}?`)) return;

    // Deep copy batting order
    target.batting = JSON.parse(JSON.stringify(source.batting || []));

    // Deep copy fielding (only copy innings that exist in target)
    target.fielding = {};
    const allPositions = [...POSITIONS, ...Array.from({ length: BENCH_SLOTS }, (_, i) => `Bench ${i + 1}`)];
    allPositions.forEach(pos => {
        target.fielding[pos] = {};
        if (source.fielding?.[pos]) {
            for (let inn = 1; inn <= target.innings; inn++) {
                if (source.fielding[pos][inn]) {
                    target.fielding[pos][inn] = source.fielding[pos][inn];
                }
            }
        }
    });

    saveData(data);
    renderLineup();
}

// --- CSV Upload ---
function parseCSVLine(line) {
    // Handle quoted CSV fields properly
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

function isGameChangerCSV(lines) {
    if (lines.length < 3) return false;
    const row1 = parseCSVLine(lines[0]);
    // GameChanger season CSV has section headers in row 1: "", "", "", "Batting", ...
    return row1.some(v => v === 'Batting') && row1.some(v => v === 'Pitching');
}

function parseGameChangerCSV(text) {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 3) return null;

    const sectionRow = parseCSVLine(lines[0]);
    const headerRow = parseCSVLine(lines[1]);

    // Find section boundaries
    let battingStart = -1, pitchingStart = -1, fieldingStart = -1;
    sectionRow.forEach((v, i) => {
        if (v === 'Batting' && battingStart < 0) battingStart = i;
        if (v === 'Pitching' && pitchingStart < 0) pitchingStart = i;
        if (v === 'Fielding' && fieldingStart < 0) fieldingStart = i;
    });

    // Build column index maps for each section (handle duplicate names)
    function colIndex(name, startFrom, endBefore) {
        for (let i = (startFrom || 0); i < (endBefore || headerRow.length); i++) {
            if (headerRow[i] === name) return i;
        }
        return -1;
    }

    // Key column indices
    const iJersey = colIndex('Number');
    const iLast = colIndex('Last');
    const iFirst = colIndex('First');

    // Batting columns (between battingStart and pitchingStart)
    const bEnd = pitchingStart > 0 ? pitchingStart : headerRow.length;
    const ib = {
        AB: colIndex('AB', battingStart, bEnd),
        R: colIndex('R', battingStart, bEnd),
        H: colIndex('H', battingStart, bEnd),
        '1B': colIndex('1B', battingStart, bEnd),
        '2B': colIndex('2B', battingStart, bEnd),
        '3B': colIndex('3B', battingStart, bEnd),
        HR: colIndex('HR', battingStart, bEnd),
        RBI: colIndex('RBI', battingStart, bEnd),
        BB: colIndex('BB', battingStart, bEnd),
        SO: colIndex('SO', battingStart, bEnd),
        HBP: colIndex('HBP', battingStart, bEnd),
        SAC: colIndex('SAC', battingStart, bEnd),
        SB: colIndex('SB', battingStart, bEnd),
        ROE: colIndex('ROE', battingStart, bEnd),
        GP: colIndex('GP', battingStart, bEnd),
    };

    // Pitching columns (between pitchingStart and fieldingStart)
    const pEnd = fieldingStart > 0 ? fieldingStart : headerRow.length;
    const ip = {
        IP: colIndex('IP', pitchingStart, pEnd),
        H: colIndex('H', pitchingStart, pEnd),
        R: colIndex('R', pitchingStart, pEnd),
        ER: colIndex('ER', pitchingStart, pEnd),
        BB: colIndex('BB', pitchingStart, pEnd),
        SO: colIndex('SO', pitchingStart, pEnd),
        HBP: colIndex('HBP', pitchingStart, pEnd),
        '#P': colIndex('#P', pitchingStart, pEnd),
    };

    // Fielding columns
    const fi = {
        PO: colIndex('PO', fieldingStart),
        A: colIndex('A', fieldingStart),
        E: colIndex('E', fieldingStart),
    };

    const players = [];

    for (let r = 2; r < lines.length; r++) {
        const vals = parseCSVLine(lines[r]);
        const last = vals[iLast] || '';
        const first = vals[iFirst] || '';
        if (!last || last === 'Totals' || last === 'Glossary') continue;

        const jersey = vals[iJersey] || '';
        const fullName = first ? `${first} ${last}` : last;

        function num(idx) {
            if (idx < 0) return 0;
            const v = vals[idx];
            if (!v || v === '-' || v === 'N/A') return 0;
            return parseFloat(v) || 0;
        }

        players.push({
            name: fullName,
            last: last,
            first: first,
            jersey: jersey,
            batting: {
                AB: num(ib.AB), R: num(ib.R), H: num(ib.H),
                '2B': num(ib['2B']), '3B': num(ib['3B']), HR: num(ib.HR),
                RBI: num(ib.RBI), BB: num(ib.BB), K: num(ib.SO),
                HBP: num(ib.HBP), SAC: num(ib.SAC), SB: num(ib.SB), ROE: num(ib.ROE), _GP: num(ib.GP),
            },
            pitching: {
                IP: num(ip.IP), H: num(ip.H), R: num(ip.R), ER: num(ip.ER),
                BB: num(ip.BB), K: num(ip.SO), HB: num(ip.HBP), PC: num(ip['#P']),
            },
            fielding: {
                PO: num(fi.PO), A: num(fi.A), E: num(fi.E),
            },
        });
    }

    return players;
}

function parseSimpleCSV(text) {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return null;

    const headers = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        if (vals.length >= 2) {
            const row = {};
            headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
            rows.push(row);
        }
    }
    return { headers, rows };
}

function showUploadStatus(container, message, isError) {
    const old = container.querySelector('.upload-status');
    if (old) old.remove();
    const span = document.createElement('span');
    span.classList.add('upload-status', isError ? 'error' : 'success');
    span.textContent = message;
    container.appendChild(span);
    setTimeout(() => span.remove(), 5000);
}

function fuzzyMatchPlayer(name, roster) {
    if (!name) return null;
    const clean = name.replace(/\.\.\./g, '').replace(/\u2026/g, '').trim().toLowerCase();
    if (!clean) return null;

    // Exact match
    const exact = roster.find(r => r.toLowerCase() === clean);
    if (exact) return exact;

    // Score-based matching: find the best match, prefer longest roster name match
    let bestMatch = null;
    let bestScore = 0;

    const parts = clean.split(/\s+/);
    const lastName = parts[parts.length - 1];
    const firstName = parts[0];

    for (const r of roster) {
        const rl = r.toLowerCase();
        let score = 0;

        // PDF name ends with roster name (e.g. "C Dering" → "Dering")
        if (clean.endsWith(rl)) score = Math.max(score, 10 + rl.length);

        // Exact word match within the name
        if (parts.includes(rl)) score = Math.max(score, 10 + rl.length);

        // Roster name matches last word exactly
        if (rl === lastName) score = Math.max(score, 10 + rl.length);

        // Roster name matches first word exactly
        if (rl === firstName && parts.length > 1) score = Math.max(score, 8 + rl.length);

        // Last word starts with roster name (truncated) - needs 3+ chars
        if (lastName.startsWith(rl) && rl.length >= 3) score = Math.max(score, 5 + rl.length);

        // Roster name starts with last word (truncated lookup)
        if (rl.startsWith(lastName) && lastName.length >= 3) score = Math.max(score, 5 + lastName.length);

        if (score > bestScore) {
            bestScore = score;
            bestMatch = r;
        }
    }

    return bestMatch;
}

// --- GameChanger PDF Parser ---
async function extractPDFItems(file) {
    if (!window.pdfjsLib) {
        throw new Error('PDF.js not loaded. Requires internet connection.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allItems = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        content.items.forEach(item => {
            if (!item.str.trim()) return;
            allItems.push({
                text: item.str.trim(),
                x: item.transform[4],
                y: viewport.height - item.transform[5], // flip y so top=0
                w: item.width
            });
        });
    }
    return allItems;
}

function groupIntoLines(items, yTolerance = 4) {
    // Sort by y then x
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    let currentLine = [];
    let currentY = -999;

    items.forEach(item => {
        if (Math.abs(item.y - currentY) > yTolerance) {
            if (currentLine.length) lines.push(currentLine);
            currentLine = [item];
            currentY = item.y;
        } else {
            currentLine.push(item);
        }
    });
    if (currentLine.length) lines.push(currentLine);

    // Sort items within each line by x
    lines.forEach(line => line.sort((a, b) => a.x - b.x));
    return lines;
}

function parseGameChangerPDF(items) {
    const lines = groupIntoLines(items);
    if (!lines.length) return null;

    // Find page x midpoint
    const allX = items.map(i => i.x + i.w);
    const pageWidth = Math.max(...allX);
    const midX = pageWidth / 2;

    // Split each line into left and right halves
    function lineToText(line, side) {
        const filtered = side === 'left'
            ? line.filter(i => i.x < midX - 10)
            : line.filter(i => i.x >= midX - 10);
        return filtered.map(i => i.text).join(' ');
    }

    // Find key sections
    let battingStartIdx = -1;
    let pitchingStartIdx = -1;

    lines.forEach((line, idx) => {
        const fullText = line.map(i => i.text).join(' ');
        if (/^BATTING/i.test(fullText) && battingStartIdx === -1) battingStartIdx = idx;
        if (/^PITCHING/i.test(fullText) && pitchingStartIdx === -1) pitchingStartIdx = idx;
    });

    // Parse title line for team names
    const titleText = lines[0].map(i => i.text).join(' ');
    const teamMatch = titleText.match(/^(.+?)\s+\d+\s*-\s*\d+\s+(.+)$/);
    let team1Name = 'Team 1', team2Name = 'Team 2';
    if (teamMatch) {
        team1Name = teamMatch[1].trim();
        team2Name = teamMatch[2].trim();
    }

    // Parse batting section
    const battingLines = battingStartIdx >= 0
        ? lines.slice(battingStartIdx + 1, pitchingStartIdx >= 0 ? pitchingStartIdx : lines.length)
        : [];

    // PDF batting columns: AB R H RBI BB SO
    const BATTING_COLS = ['AB', 'R', 'H', 'RBI', 'BB', 'SO'];
    const PITCHING_COLS = ['IP', 'H', 'R', 'ER', 'BB', 'SO', 'HR'];

    function parsePlayerLine(text, cols) {
        if (!text || /^totals/i.test(text.trim())) return null;
        if (/^(3B|HR|TB|HBP|SB|CS|LOB|P-S|WP|BF|W:|E:)/i.test(text.trim())) return null;
        // Skip lines that are just numbers (score rows)
        if (/^\d+(\s+\d+)*$/.test(text.trim())) return null;

        // Clean ellipsis variants
        let cleaned = text.replace(/\u2026/g, '...').replace(/\.{2,}/g, '...');

        // Match: Name #Number (Pos) Num Num Num...
        let match = cleaned.match(/^(.+?)\s*#(\d+)\s*(?:\([^)]*\))?\s+([\d.]+(?:\s+[\d.]+)*)$/);

        // Fallback: Name ... #Number (Pos) Num Num Num...
        if (!match) {
            match = cleaned.match(/^(.+?)\s*\.+\s*#(\d+)\s*(?:\([^)]*\))?\s+([\d.]+(?:\s+[\d.]+)*)$/);
        }

        // Fallback: Name #Number Num Num (no position)
        if (!match) {
            match = cleaned.match(/^(.+?)\s*#(\d+)\s+([\d.]+(?:\s+[\d.]+)*)$/);
        }

        if (!match) return null;

        const rawName = match[1].replace(/\.\.\./g, '').replace(/\u2026/g, '').trim();
        const jersey = match[2];
        const nums = match[3].split(/\s+/).map(Number);
        if (nums.length < Math.max(cols.length - 2, 2)) return null;

        const stats = {};
        cols.forEach((col, idx) => {
            stats[col] = nums[idx] || 0;
        });

        return { name: rawName, jersey, stats };
    }

    function parseSideStats(sideLines, cols) {
        const players = [];
        let teamName = '';

        for (const lineText of sideLines) {
            if (!lineText.trim()) continue;

            // Detect team header (contains column names like "AB R H")
            if (/\bAB\b.*\bR\b.*\bH\b/i.test(lineText) || /\bIP\b.*\bH\b.*\bR\b/i.test(lineText)) {
                // Extract team name (everything before the stat columns)
                const headerMatch = lineText.match(/^(.+?)\s+(AB|IP)\b/i);
                if (headerMatch) teamName = headerMatch[1].trim();
                continue;
            }

            const parsed = parsePlayerLine(lineText, cols);
            if (parsed) players.push(parsed);
        }

        return { teamName, players };
    }

    // Build left/right text for batting
    const leftBattingLines = battingLines.map(l => lineToText(l, 'left')).filter(t => t.trim());
    const rightBattingLines = battingLines.map(l => lineToText(l, 'right')).filter(t => t.trim());

    const team1Batting = parseSideStats(leftBattingLines, BATTING_COLS);
    const team2Batting = parseSideStats(rightBattingLines, BATTING_COLS);

    if (team1Batting.teamName) team1Name = team1Batting.teamName;
    if (team2Batting.teamName) team2Name = team2Batting.teamName;

    // Parse pitching section
    const pitchingLines = pitchingStartIdx >= 0
        ? lines.slice(pitchingStartIdx + 1)
        : [];

    const leftPitchingLines = pitchingLines.map(l => lineToText(l, 'left')).filter(t => t.trim());
    const rightPitchingLines = pitchingLines.map(l => lineToText(l, 'right')).filter(t => t.trim());

    const team1Pitching = parseSideStats(leftPitchingLines, PITCHING_COLS);
    const team2Pitching = parseSideStats(rightPitchingLines, PITCHING_COLS);

    // Parse extra stats notes (3B, HR, HBP, SB, E from the text blocks below tables)
    const allText = lines.map(l => l.map(i => i.text).join(' ')).join('\n');

    function parseExtraNotes(fullText) {
        const extras = { triples: {}, hr: {}, hbp: {}, sb: {}, errors: {}, pitchCounts: {} };

        // 3B: Player, Player2
        const tripleMatch = fullText.match(/3B:\s*([^,\n]+(?:,\s*[^,\n]+)*)/g);
        if (tripleMatch) {
            tripleMatch.forEach(m => {
                const names = m.replace(/3B:\s*/, '').split(',').map(n => n.trim());
                names.forEach(n => { if (n) extras.triples[n] = (extras.triples[n] || 0) + 1; });
            });
        }

        // HR: Player, Player2
        const hrMatch = fullText.match(/HR:\s*([^,\n]+(?:,\s*[^,\n]+)*)/g);
        if (hrMatch) {
            hrMatch.forEach(m => {
                const names = m.replace(/HR:\s*/, '').split(',').map(n => n.trim());
                names.forEach(n => { if (n) extras.hr[n] = (extras.hr[n] || 0) + 1; });
            });
        }

        // HBP: Player, Player2
        const hbpMatch = fullText.match(/HBP:\s*([^,\n]+(?:,\s*[^,\n]+)*)/g);
        if (hbpMatch) {
            hbpMatch.forEach(m => {
                const names = m.replace(/HBP:\s*/, '').split(',').map(n => n.trim());
                names.forEach(n => { if (n) extras.hbp[n] = (extras.hbp[n] || 0) + 1; });
            });
        }

        // SB: Player 2, Player2 (may have count after name)
        const sbMatch = fullText.match(/SB:\s*([^,\n]+(?:,\s*[^,\n]+)*)/g);
        if (sbMatch) {
            sbMatch.forEach(m => {
                const entries = m.replace(/SB:\s*/, '').split(',').map(n => n.trim());
                entries.forEach(entry => {
                    const countMatch = entry.match(/^(.+?)\s+(\d+)$/);
                    if (countMatch) {
                        extras.sb[countMatch[1].trim()] = parseInt(countMatch[2]);
                    } else if (entry) {
                        extras.sb[entry] = (extras.sb[entry] || 0) + 1;
                    }
                });
            });
        }

        // E: Player 2, Player2
        const eMatch = fullText.match(/E:\s*([^,\n]+(?:,\s*[^,\n]+)*)/g);
        if (eMatch) {
            eMatch.forEach(m => {
                const entries = m.replace(/E:\s*/, '').split(',').map(n => n.trim());
                entries.forEach(entry => {
                    const countMatch = entry.match(/^(.+?)\s+(\d+)$/);
                    if (countMatch) {
                        extras.errors[countMatch[1].trim()] = parseInt(countMatch[2]);
                    } else if (entry) {
                        extras.errors[entry] = (extras.errors[entry] || 0) + 1;
                    }
                });
            });
        }

        // P-S: Player 20-9, Player2 32-17 (total pitches is first number)
        const psMatch = fullText.match(/P-S:\s*([^,\n]+(?:,\s*[^,\n]+)*)/g);
        if (psMatch) {
            psMatch.forEach(m => {
                const entries = m.replace(/P-S:\s*/, '').split(',').map(n => n.trim());
                entries.forEach(entry => {
                    const pcMatch = entry.match(/^(.+?)\s+(\d+)-\d+$/);
                    if (pcMatch) {
                        extras.pitchCounts[pcMatch[1].trim()] = parseInt(pcMatch[2]);
                    }
                });
            });
        }

        return extras;
    }

    const extraNotes = parseExtraNotes(allText);

    return {
        teams: [
            { name: team1Name, batting: team1Batting.players, pitching: team1Pitching.players },
            { name: team2Name, batting: team2Batting.players, pitching: team2Pitching.players }
        ],
        extras: extraNotes
    };
}

// --- Import Modal with Name Mapping ---

// Persistent name map: jersey# → roster name
if (!data.nameMap) data.nameMap = {};
const DEFAULT_MAP = {
    '1': 'Randall', '3': 'Jack', '8': 'Kru', '13': 'Dering',
    '14': 'Joseph', '15': 'Brody', '21': 'Ollie', '22': 'Jackson',
    '26': 'Myles', '30': 'CH', '44': 'Henry'
};
Object.entries(DEFAULT_MAP).forEach(([jersey, name]) => {
    data.nameMap[jersey] = name;
});
saveData(data);

function resolvePlayerName(pdfName, jersey) {
    // 1. Check saved nameMap by jersey number
    if (jersey && data.nameMap[jersey]) {
        const mapped = data.nameMap[jersey];
        if (data.roster.includes(mapped)) return mapped;
    }
    // 2. Fuzzy match against roster
    return fuzzyMatchPlayer(pdfName, data.roster);
}

function showImportModal(parsed) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('import-modal-overlay');
        const teamSelect = document.getElementById('import-team-select');
        const mappingBody = document.getElementById('import-mapping-body');
        const confirmBtn = document.getElementById('import-confirm-btn');
        const cancelBtn = document.getElementById('import-cancel-btn');

        // Auto-detect best team
        let bestIdx = 0, bestCount = 0;
        parsed.teams.forEach((team, idx) => {
            const count = team.batting.filter(p => resolvePlayerName(p.name, p.jersey)).length;
            if (count > bestCount) { bestCount = count; bestIdx = idx; }
        });

        // Fill team dropdown
        teamSelect.innerHTML = '';
        parsed.teams.forEach((team, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = team.name;
            if (idx === bestIdx) opt.selected = true;
            teamSelect.appendChild(opt);
        });

        function renderMappingTable() {
            const teamIdx = parseInt(teamSelect.value);
            const team = parsed.teams[teamIdx];
            // Combine batting + pitching players (unique by jersey)
            const allPlayers = [];
            const seen = new Set();
            [...team.batting, ...team.pitching].forEach(p => {
                const key = p.jersey || p.name;
                if (!seen.has(key)) { seen.add(key); allPlayers.push(p); }
            });

            mappingBody.innerHTML = '';
            allPlayers.forEach(p => {
                const tr = document.createElement('tr');
                const guessed = resolvePlayerName(p.name, p.jersey);

                tr.innerHTML = `
                    <td class="pdf-name">${p.name}</td>
                    <td class="pdf-jersey">${p.jersey || ''}</td>
                    <td>&rarr;</td>
                    <td></td>
                `;

                const tdSelect = tr.children[3];
                const sel = document.createElement('select');
                sel.classList.add('mapping-select');
                sel.dataset.jersey = p.jersey || '';
                sel.dataset.pdfName = p.name;

                // Options: roster players + "Add as new"
                sel.innerHTML = '<option value="__new__">+ Add as new player</option>';
                data.roster.forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r;
                    opt.textContent = r;
                    if (guessed === r) { opt.selected = true; }
                    sel.appendChild(opt);
                });

                if (guessed) sel.classList.add('auto-matched');

                sel.addEventListener('change', () => {
                    sel.classList.toggle('auto-matched', sel.value !== '__new__');
                });

                tdSelect.appendChild(sel);
                mappingBody.appendChild(tr);
            });
        }

        teamSelect.addEventListener('change', renderMappingTable);
        renderMappingTable();

        confirmBtn.onclick = () => {
            overlay.classList.add('hidden');
            const teamIdx = parseInt(teamSelect.value);

            // Collect mappings from the selects
            const mappings = {}; // pdfName → rosterName
            const newPlayers = [];
            mappingBody.querySelectorAll('.mapping-select').forEach(sel => {
                const pdfName = sel.dataset.pdfName;
                const jersey = sel.dataset.jersey;

                if (sel.value === '__new__') {
                    // Add PDF name to roster
                    if (pdfName && !data.roster.includes(pdfName)) {
                        data.roster.push(pdfName);
                        newPlayers.push(pdfName);
                    }
                    mappings[pdfName] = pdfName;
                    if (jersey) data.nameMap[jersey] = pdfName;
                } else {
                    mappings[pdfName] = sel.value;
                    if (jersey) data.nameMap[jersey] = sel.value;
                }
            });

            saveData(data);
            if (newPlayers.length) renderRoster();

            resolve({ teamIdx, mappings });
        };

        cancelBtn.onclick = () => {
            overlay.classList.add('hidden');
            resolve(null);
        };

        overlay.classList.remove('hidden');
    });
}

function applyGameChangerStats(parsed, teamIdx, mappings, game) {
    const team = parsed.teams[teamIdx];
    if (!team) return { batters: 0, pitchers: 0 };

    function resolve(pdfName, jersey) {
        // Jersey map first, then modal mappings, then fuzzy
        if (jersey && data.nameMap[jersey] && data.roster.includes(data.nameMap[jersey])) {
            return data.nameMap[jersey];
        }
        return mappings[pdfName] || resolvePlayerName(pdfName, jersey);
    }

    let batterCount = 0, pitcherCount = 0;

    // Clear existing stats so latest upload fully overrides
    game.battingStats = {};
    game.fieldingStats = {};
    game.pitchingStats = [];

    // Auto-fill batting order from PDF order
    game.batting = [];
    team.batting.forEach(p => {
        const name = resolve(p.name, p.jersey);
        if (!name) return;
        game.batting.push({ player: name });

        // Apply batting stats
        if (!game.battingStats[name]) game.battingStats[name] = {};
        const s = game.battingStats[name];
        s['AB'] = p.stats['AB'] || 0;
        s['R'] = p.stats['R'] || 0;
        s['H'] = p.stats['H'] || 0;
        s['RBI'] = p.stats['RBI'] || 0;
        s['BB'] = p.stats['BB'] || 0;
        s['K'] = p.stats['SO'] || 0;
        batterCount++;
    });

    // Apply extra batting notes (3B, HR, HBP, SB)
    const extras = parsed.extras;
    function applyExtraStat(noteMap, statField) {
        Object.entries(noteMap).forEach(([noteName, val]) => {
            // Try mapping first, then fuzzy
            let name = null;
            for (const [pdfN, rosterN] of Object.entries(mappings)) {
                if (noteName.toLowerCase().includes(pdfN.toLowerCase()) ||
                    pdfN.toLowerCase().includes(noteName.toLowerCase())) {
                    name = rosterN;
                    break;
                }
            }
            if (!name) name = resolvePlayerName(noteName, null);
            if (!name) return;
            if (!game.battingStats[name]) game.battingStats[name] = {};
            game.battingStats[name][statField] = val;
        });
    }
    applyExtraStat(extras.triples, '3B');
    applyExtraStat(extras.hr, 'HR');
    applyExtraStat(extras.hbp, 'HBP');
    applyExtraStat(extras.sb, 'SB');

    // Apply fielding errors
    Object.entries(extras.errors).forEach(([noteName, val]) => {
        let name = null;
        for (const [pdfN, rosterN] of Object.entries(mappings)) {
            if (noteName.toLowerCase().includes(pdfN.toLowerCase()) ||
                pdfN.toLowerCase().includes(noteName.toLowerCase())) {
                name = rosterN;
                break;
            }
        }
        if (!name) name = resolvePlayerName(noteName, null);
        if (!name) return;
        if (!game.fieldingStats[name]) game.fieldingStats[name] = {};
        game.fieldingStats[name]['E'] = val;
    });

    // Apply pitching stats
    game.pitchingStats = [];
    team.pitching.forEach(p => {
        const name = resolve(p.name, p.jersey);
        if (!name) return;
        const entry = { player: name };
        entry['IP'] = p.stats['IP'] || 0;
        entry['H'] = p.stats['H'] || 0;
        entry['R'] = p.stats['R'] || 0;
        entry['ER'] = p.stats['ER'] || 0;
        entry['BB'] = p.stats['BB'] || 0;
        entry['K'] = p.stats['SO'] || 0;
        entry['HB'] = 0;
        game.pitchingStats.push(entry);
        pitcherCount++;
    });

    // Apply pitch counts from P-S notes
    Object.entries(extras.pitchCounts).forEach(([noteName, pc]) => {
        let name = null;
        for (const [pdfN, rosterN] of Object.entries(mappings)) {
            if (noteName.toLowerCase().includes(pdfN.toLowerCase()) ||
                pdfN.toLowerCase().includes(noteName.toLowerCase())) {
                name = rosterN;
                break;
            }
        }
        if (!name) name = resolvePlayerName(noteName, null);
        if (!name) return;
        const entry = game.pitchingStats.find(e => e.player === name);
        if (entry) entry['PC'] = pc;
    });

    // Apply HBP to pitchers from notes
    Object.entries(extras.hbp).forEach(([noteName, val]) => {
        let name = null;
        for (const [pdfN, rosterN] of Object.entries(mappings)) {
            if (noteName.toLowerCase().includes(pdfN.toLowerCase()) ||
                pdfN.toLowerCase().includes(noteName.toLowerCase())) {
                name = rosterN;
                break;
            }
        }
        if (!name) name = resolvePlayerName(noteName, null);
        if (!name) return;
        const entry = game.pitchingStats.find(e => e.player === name);
        if (entry) entry['HB'] = val;
    });

    return { batters: batterCount, pitchers: pitcherCount };
}

// Clear all stats for current game
document.getElementById('clear-game-stats-btn').addEventListener('click', () => {
    const game = getGame();
    if (!game) return;
    if (!confirm('Clear all batting, pitching, and fielding stats for this game?')) return;
    game.battingStats = {};
    game.fieldingStats = {};
    game.pitchingStats = [];
    saveData(data);
    renderGameStats(game);
    showUploadStatus(document.getElementById('pdf-upload-bar'), 'All stats cleared.', false);
});

// Wire up Game PDF upload
document.getElementById('upload-game-pdf').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    this.value = '';

    const game = getGame();
    if (!game) { alert('Select a game first.'); return; }

    const bar = document.getElementById('pdf-upload-bar');

    try {
        showUploadStatus(bar, 'Parsing PDF...', false);

        const items = await extractPDFItems(file);
        const parsed = parseGameChangerPDF(items);

        if (!parsed || !parsed.teams.length) {
            showUploadStatus(bar, 'Could not parse PDF. Unrecognized format.', true);
            return;
        }

        // Show import modal with name mapping
        const result = await showImportModal(parsed);

        if (!result) {
            showUploadStatus(bar, 'Import cancelled.', true);
            return;
        }

        const counts = applyGameChangerStats(parsed, result.teamIdx, result.mappings, game);
        saveData(data);
        projectMissing2025Stats(); // update projected 2025 stats
        renderLineup(); // re-render everything including batting order

        showUploadStatus(bar,
            `Imported: ${counts.batters} batters, ${counts.pitchers} pitchers. Batting order set.`,
            false);
    } catch (err) {
        console.error(err);
        showUploadStatus(bar, 'PDF error: ' + err.message, true);
    }
});

// Wire up per-tab CSV uploads
function handleCSVUpload(file, type) {
    const game = getGame();
    if (!game) return;
    const bar = document.querySelector(`#${type}-stats-tab .upload-bar`) || document.getElementById('pdf-upload-bar');

    if (file.name?.endsWith('.pdf')) {
        const pdfInput = document.getElementById('upload-game-pdf');
        const dt = new DataTransfer();
        dt.items.add(file);
        pdfInput.files = dt.files;
        pdfInput.dispatchEvent(new Event('change'));
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.trim().split('\n');

        // Detect GameChanger season CSV
        if (isGameChangerCSV(lines)) {
            const players = parseGameChangerCSV(text);
            if (!players || !players.length) {
                showUploadStatus(bar, 'Could not parse GameChanger CSV.', true);
                return;
            }

            // Clear existing stats so latest upload fully overrides
            game.battingStats = {};
            game.fieldingStats = {};
            game.pitchingStats = [];
            game.batting = [];

            let matched = 0;
            players.forEach(p => {
                // Try matching by: full name, last name, first name, jersey
                // Jersey map first, then name matching
                let name = (p.jersey && data.nameMap[p.jersey] && data.roster.includes(data.nameMap[p.jersey]) ? data.nameMap[p.jersey] : null)
                    || fuzzyMatchPlayer(p.last, data.roster)
                    || fuzzyMatchPlayer(p.first, data.roster)
                    || fuzzyMatchPlayer(p.name, data.roster);

                if (!name) return;

                // Batting
                if (!game.battingStats[name]) game.battingStats[name] = {};
                Object.entries(p.batting).forEach(([k, v]) => {
                    if (v) game.battingStats[name][k] = v;
                });

                // Fielding
                if (p.fielding.PO || p.fielding.A || p.fielding.E) {
                    if (!game.fieldingStats[name]) game.fieldingStats[name] = {};
                    Object.entries(p.fielding).forEach(([k, v]) => {
                        if (v) game.fieldingStats[name][k] = v;
                    });
                }

                // Pitching (only if they have IP)
                if (p.pitching.IP > 0) {
                    let entry = game.pitchingStats.find(e => e.player === name);
                    if (!entry) {
                        entry = { player: name };
                        game.pitchingStats.push(entry);
                    }
                    Object.entries(p.pitching).forEach(([k, v]) => {
                        if (v) entry[k] = v;
                    });
                }

                // Auto-fill batting order if empty
                if (!game.batting.find(b => b.player === name)) {
                    game.batting.push({ player: name });
                }

                matched++;
            });

            saveData(data);
            renderLineup();
            showUploadStatus(bar,
                `GameChanger CSV imported: ${matched} player${matched !== 1 ? 's' : ''} (batting, pitching, fielding).`,
                false);
            return;
        }

        // Simple CSV format
        const parsed = parseSimpleCSV(text);
        if (!parsed || !parsed.rows.length) {
            showUploadStatus(bar, 'Could not parse CSV. Check format.', true);
            return;
        }

        let matched = 0;
        const fields = type === 'batting' ? BATTING_STATS_FIELDS
            : type === 'fielding' ? FIELDING_STATS_FIELDS
            : PITCHING_STATS_FIELDS;

        parsed.rows.forEach(row => {
            const name = fuzzyMatchPlayer(row['Player'] || row['Name'] || row['player'] || row['name'], data.roster);
            if (!name) return;

            if (type === 'pitching') {
                let entry = game.pitchingStats.find(p => p.player === name);
                if (!entry) { entry = { player: name }; game.pitchingStats.push(entry); }
                fields.forEach(f => { const v = parseFloat(row[f] || row[f.toLowerCase()]) || 0; if (v) entry[f] = v; });
            } else {
                const store = type === 'batting' ? game.battingStats : game.fieldingStats;
                if (!store[name]) store[name] = {};
                fields.forEach(f => { const v = parseInt(row[f] || row[f.toLowerCase()]) || 0; if (v) store[name][f] = v; });
            }
            matched++;
        });

        saveData(data);
        renderGameStats(game);
        showUploadStatus(bar, `Loaded stats for ${matched} player${matched !== 1 ? 's' : ''}.`, false);
    };
    reader.readAsText(file);
}

document.getElementById('upload-batting-csv').addEventListener('change', function() {
    if (this.files[0]) handleCSVUpload(this.files[0], 'batting');
    this.value = '';
});

document.getElementById('upload-fielding-csv').addEventListener('change', function() {
    if (this.files[0]) handleCSVUpload(this.files[0], 'fielding');
    this.value = '';
});

document.getElementById('upload-pitching-csv').addEventListener('change', function() {
    if (this.files[0]) handleCSVUpload(this.files[0], 'pitching');
    this.value = '';
});

// Download CSV templates
document.querySelectorAll('.download-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        let headers, filename;
        if (type === 'batting') {
            headers = ['Player', ...BATTING_STATS_FIELDS];
            filename = 'batting_stats_template.csv';
        } else if (type === 'fielding') {
            headers = ['Player', ...FIELDING_STATS_FIELDS];
            filename = 'fielding_stats_template.csv';
        } else {
            headers = ['Player', ...PITCHING_STATS_FIELDS];
            filename = 'pitching_stats_template.csv';
        }

        const game = getGame();
        let players = data.roster;
        if (type === 'batting' && game) {
            const batters = getBatters(game);
            if (batters.length) players = batters;
        }

        let csv = headers.join(',') + '\n';
        players.forEach(name => {
            csv += name + ',' + headers.slice(1).map(() => '').join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    });
});

// --- Print ---
document.getElementById('print-btn').addEventListener('click', () => {
    if (!activeGameId) {
        alert('Select a game first.');
        return;
    }
    document.body.classList.remove('print-season');
    window.print();
});

document.getElementById('print-season-btn').addEventListener('click', () => {
    document.body.classList.add('print-season');
    window.print();
    setTimeout(() => document.body.classList.remove('print-season'), 1000);
});

// --- Download as PDF ---
async function captureElementToPDF(element, filename, landscape) {
    if (!window.html2canvas || !window.jspdf) {
        alert('PDF libraries not loaded. Check your internet connection.');
        return;
    }

    // Temporarily style for capture
    const origBg = element.style.background;
    const origColor = element.style.color;
    element.style.background = '#fff';
    element.style.color = '#000';

    const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
    });

    element.style.background = origBg;
    element.style.color = origColor;

    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;

    // Calculate PDF dimensions
    const orientation = landscape ? 'landscape' : 'portrait';
    const pdf = new jsPDF(orientation, 'mm', 'letter');
    const pageW = pdf.internal.pageSize.getWidth() - 20; // 10mm margins
    const pageH = pdf.internal.pageSize.getHeight() - 20;
    const imgW = canvas.width;
    const imgH = canvas.height;
    const ratio = Math.min(pageW / imgW, pageH / imgH);
    const w = imgW * ratio;
    const h = imgH * ratio;

    // If content is taller than one page, split across pages
    const pxPerPage = pageH / ratio;
    let srcY = 0;

    while (srcY < imgH) {
        if (srcY > 0) pdf.addPage();

        const sliceH = Math.min(pxPerPage, imgH - srcY);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = imgW;
        sliceCanvas.height = sliceH;
        const ctx = sliceCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, srcY, imgW, sliceH, 0, 0, imgW, sliceH);

        const sliceImg = sliceCanvas.toDataURL('image/png');
        const sliceRenderH = sliceH * ratio;
        pdf.addImage(sliceImg, 'PNG', 10, 10, w, sliceRenderH);

        srcY += pxPerPage;
    }

    pdf.save(filename);
}



// --- Import Season CSV ---
document.getElementById('upload-season-csv').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    this.value = '';

    const statusEl = document.getElementById('season-csv-status');
    const label = document.getElementById('import-season-label').value.trim() || 'Imported Season';

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.trim().split('\n');

        if (!isGameChangerCSV(lines)) {
            statusEl.textContent = 'Not a GameChanger CSV format.';
            statusEl.style.color = '#e74c3c';
            return;
        }

        const players = parseGameChangerCSV(text);
        if (!players || !players.length) {
            statusEl.textContent = 'Could not parse CSV.';
            statusEl.style.color = '#e74c3c';
            return;
        }

        // Reuse existing season entry if re-uploading, otherwise create new
        const seasonDate = label.includes('2025') ? '2025-12-31' : '2026-12-31';
        let game = data.games.find(g => g.id && g.id.startsWith('season_') && g.date === seasonDate);
        if (game) {
            // Clear stats but keep the entry
            game.batting = [];
            game.battingStats = {};
            game.fieldingStats = {};
            game.pitchingStats = [];
            game.opponent = label;
        } else {
            game = {
                id: 'season_' + Date.now().toString(),
                date: seasonDate,
                opponent: label,
                innings: 0,
                fielding: {},
                batting: [],
                battingStats: {},
                fieldingStats: {},
                pitchingStats: []
            };
            data.games.push(game);
        }

        let matched = 0;
        players.forEach(p => {
            // Match by jersey, last name, first name, full name
            let name = (p.jersey && data.nameMap[p.jersey] && data.roster.includes(data.nameMap[p.jersey]) ? data.nameMap[p.jersey] : null)
                || fuzzyMatchPlayer(p.last, data.roster)
                || fuzzyMatchPlayer(p.first, data.roster)
                || fuzzyMatchPlayer(p.name, data.roster);

            // If no match, add to roster
            if (!name) {
                // Use first name if available, otherwise last name
                name = p.first || p.last || p.name;
                if (name && !data.roster.includes(name)) {
                    data.roster.push(name);
                }
            }

            if (!name) return;

            // Save jersey mapping
            if (p.jersey && name) {
                data.nameMap[p.jersey] = name;
            }

            // Batting order
            game.batting.push({ player: name });

            // Batting stats
            game.battingStats[name] = {};
            Object.entries(p.batting).forEach(([k, v]) => {
                if (v) game.battingStats[name][k] = v;
            });

            // Fielding stats
            if (p.fielding.PO || p.fielding.A || p.fielding.E) {
                game.fieldingStats[name] = {};
                Object.entries(p.fielding).forEach(([k, v]) => {
                    if (v) game.fieldingStats[name][k] = v;
                });
            }

            // Pitching stats (only if they pitched)
            if (p.pitching.IP > 0 || p.pitching.K > 0) {
                const entry = { player: name };
                Object.entries(p.pitching).forEach(([k, v]) => {
                    if (v) entry[k] = v;
                });
                game.pitchingStats.push(entry);
            }

            matched++;
        });

        saveData(data);

        // Re-run Joseph's projection so it gets added back to the 2025 entry
        projectMissing2025Stats();

        renderRoster();
        renderGames();
        selectGame(game.id);
        initFilter();

        statusEl.textContent = `Imported ${matched} players as "${label}"`;
        statusEl.style.color = '#2ecc71';
        setTimeout(() => { statusEl.textContent = ''; }, 5000);
    };
    reader.readAsText(file);
});

// --- Project missing 2025 stats from 2026 data ---
// Players whose 2025 stats should be projected from 2026 data
const PROJECT_FROM_2026 = ['Joseph'];

function projectMissing2025Stats() {
    const season25 = data.games.find(g => g.id && g.id.startsWith('season_') && g.date && g.date.startsWith('2025'));
    if (!season25) return;
    if (!season25.battingStats) season25.battingStats = {};

    const games26 = data.games.filter(g => g.date && g.date.startsWith('2026') && !g.id.startsWith('season_'));

    // ONLY project for explicitly listed players — skip if already projected
    PROJECT_FROM_2026.forEach(name => {
        if (!data.roster.includes(name)) return;
        if (season25.battingStats?.[name]?._projected) return; // already done

        // Accumulate 2026 stats
        let ab = 0, h = 0, bb = 0, hbp = 0, sac = 0, sb = 0, k = 0, gp = 0;
        let doubles = 0, triples = 0, hr = 0, r = 0, rbi = 0, roe = 0;

        games26.forEach(game => {
            const s = game.battingStats?.[name];
            if (!s) return;
            const gab = s['AB'] || 0;
            const gbb = s['BB'] || 0;
            if (gab + gbb === 0) return;
            gp++;
            ab += gab; h += s['H'] || 0; bb += gbb;
            hbp += s['HBP'] || 0; sac += s['SAC'] || 0;
            sb += s['SB'] || 0; k += s['K'] || 0;
            doubles += s['2B'] || 0; triples += s['3B'] || 0;
            hr += s['HR'] || 0; r += s['R'] || 0;
            rbi += s['RBI'] || 0; roe += s['ROE'] || 0;
        });

        if (gp === 0) return;

        // Project to 48-game 2025 at 95% of 2026 production
        const scale = 48 / gp;
        const perfFactor = 0.95;
        season25.battingStats[name] = {
            AB: Math.round(ab * scale),
            H: Math.round(h * scale * perfFactor),
            '2B': Math.round(doubles * scale * perfFactor),
            '3B': Math.round(triples * scale * perfFactor),
            HR: Math.round(hr * scale * perfFactor),
            RBI: Math.round(rbi * scale * perfFactor),
            R: Math.round(r * scale * perfFactor),
            BB: Math.round(bb * scale * perfFactor),
            K: Math.round(k * scale * (2 - perfFactor)),
            HBP: Math.round(hbp * scale),
            SAC: Math.round(sac * scale),
            SB: Math.round(sb * scale * perfFactor),
            ROE: Math.round(roe * scale),
            _GP: 48,
            _projected: true,
        };

        if (!season25.batting) season25.batting = [];
        if (!season25.batting.find(b => b.player === name)) {
            season25.batting.push({ player: name });
        }
    });

    saveData(data);
}

// Only run projection if Joseph doesn't already have 2025 stats
(function initJosephProjection() {
    const season25 = data.games.find(g => g.id && g.id.startsWith('season_') && g.date && g.date.startsWith('2025'));
    if (!season25) return;
    if (season25.battingStats?.['Joseph']?._projected) return; // already projected, don't touch
    projectMissing2025Stats();
})();

// --- Init ---
if (data.roster.length === 0) {
    data.roster = ['Joseph', 'Jack', 'Ollie', 'CH', 'Jackson', 'Myles', 'Harrison', 'Randall', 'Henry', 'Kru', 'Brody', 'Dering'];
    saveData(data);
}

// --- Data Export/Import ---
document.getElementById('export-data-btn').addEventListener('click', () => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `baseball_lineup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const status = document.getElementById('sync-status');
    status.textContent = 'Data exported!';
    status.style.color = '#2ecc71';
    setTimeout(() => status.textContent = '', 3000);
});

document.getElementById('import-data-file').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    this.value = '';
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!imported.roster || !imported.games) {
                throw new Error('Invalid data format');
            }
            // Merge or replace
            if (confirm('Replace ALL current data with imported data? (OK = Replace, Cancel = Keep current)')) {
                data.roster = imported.roster;
                data.games = imported.games;
                data.nameMap = imported.nameMap || {};
                saveData(data);
                location.reload();
            }
        } catch (err) {
            const status = document.getElementById('sync-status');
            status.textContent = 'Import failed: ' + err.message;
            status.style.color = '#e74c3c';
        }
    };
    reader.readAsText(file);
});

// --- Mobile toggle ---
const mobileSidebarToggle = document.getElementById('mobile-sidebar-toggle');
const mobileMoreBtn = document.getElementById('mobile-more-btn');

function checkMobile() {
    const isMobile = window.innerWidth <= 900;
    mobileSidebarToggle.style.display = isMobile ? 'block' : 'none';
    if (mobileMoreBtn) mobileMoreBtn.style.display = 'none'; // hidden by default, shown when expanded
    if (!isMobile) {
        document.getElementById('game-list').classList.remove('expanded');
    }
}

mobileSidebarToggle.addEventListener('click', () => {
    const sidebar = document.getElementById('game-list');
    sidebar.classList.toggle('expanded');
    mobileSidebarToggle.textContent = sidebar.classList.contains('expanded')
        ? 'Close ▲' : 'Games & Settings ▼';
    if (mobileMoreBtn) mobileMoreBtn.style.display = sidebar.classList.contains('expanded') ? 'block' : 'none';
});

if (mobileMoreBtn) {
    mobileMoreBtn.addEventListener('click', () => {
        const sidebar = document.getElementById('game-list');
        const isShowingMore = mobileMoreBtn.textContent.includes('More');
        // Toggle the extra sections visibility via a class
        if (isShowingMore) {
            document.querySelectorAll('#roster-section, #import-season-section, #data-sync-section').forEach(el => el.style.display = 'block');
            mobileMoreBtn.textContent = 'Less Options ▲';
        } else {
            document.querySelectorAll('#roster-section, #import-season-section, #data-sync-section').forEach(el => el.style.display = 'none');
            mobileMoreBtn.textContent = 'More Options ▼';
        }
    });
}

window.addEventListener('resize', checkMobile);
checkMobile();

renderRoster();
renderGames();
