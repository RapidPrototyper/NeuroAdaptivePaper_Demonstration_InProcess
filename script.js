// ============================================================================
// NEUROADAPTIVE CURSOR EXPERIMENT – Full Implementation
// Based on Zander et al. (2016)
// ============================================================================

// ─── SIZES FOR VISUAL ELEMENTS ─────────────────────────────────────────────
const START_CIRCLE_RADIUS        = 0.25;
const DIRECTION_LINE_RADIUS      = 0.05;
const DIRECTION_LINE_RADIUS_ORIG = 0.05;

const DESTINATION_DISC_RADIUS    = 0.35;
const DESTINATION_RING_RADIUS    = 0.35;
const DESTINATION_DISC_RADIUS_ORIG = 0.25;
const DESTINATION_RING_RADIUS_ORIG = 0.25;

const CURSOR_RADIUS              = 0.35;
const ORIGINAL_CURSOR_RADIUS     = 0.25;

const OVERLAY_NODE_RADIUS        = 0.45;
const OVERLAY_LINE_OPACITY       = 1.0;
const OVERLAY_LINE_COLOR         = 0xffffff;
const OVERLAY_NODE_OUTLINE_COLOR = 0xffffff;
const OVERLAY_NODE_FILL_COLOR    = 0x000000;

const CURSOR_2D_Y = 0.40;
const GOAL_2D_Y   = 0.45;

// ============================================================================
// SECTION 1: DOM CACHING
// ============================================================================
const DOM = {
    graySquare: document.getElementById('gray-square'),
    whitePulseOverlay: null,
    feedbackPanel: document.getElementById('feedback-panel'),
    statsPanel: document.getElementById('stats-panel'),
    phaseIndicator: document.getElementById('phase-indicator'),
    progressDisplay: document.getElementById('progress-display'),
    controlsPanel: document.getElementById('controls-panel'),
    controlsStatus: document.getElementById('controls-status'),
    modelPanel: document.getElementById('model-panel'),
    modelGrid: document.getElementById('model-grid'),
    probabilityCanvas: document.getElementById('probability-canvas'),
    eventMarkersDisplay: document.getElementById('event-markers-display'),
    phaseDisplay: document.getElementById('phase-display'),
    targetsDisplay: document.getElementById('targets-display'),
    jumpsDisplay: document.getElementById('jumps-display'),
    movesDisplay: document.getElementById('moves-display'),
    gridDisplay: document.getElementById('grid-display'),
    positionDisplay: document.getElementById('position-display'),
    targetDisplay: document.getElementById('target-display'),
    lslStatus: document.getElementById('lsl-status'),
    lslStatusText: document.getElementById('lsl-status-text-value'),
    authorBadge: document.getElementById('author-badge'),
    introScreen: document.getElementById('intro-screen'),
    startButton: document.getElementById('main-action-button'), // renamed
    container: document.getElementById('container'),
    profileNameInput: document.getElementById('profile-name-input'),
    profileDropdown: document.getElementById('profile-dropdown'),
    saveProfileBtn: document.getElementById('save-profile-btn'),
    loadProfileBtn: document.getElementById('load-profile-btn'),
    deleteProfileBtn: document.getElementById('delete-profile-btn'),
    resetDefaultsBtn: document.getElementById('reset-defaults-btn'),
    profileStatus: document.getElementById('profile-status'),
    sequenceProfileSelect: document.getElementById('sequence-profile-select'),
    sequenceList: document.getElementById('sequence-list'),
    sequenceStatus: document.getElementById('sequence-status'),
    seqAddBtn: document.getElementById('seq-add-btn'),
    seqClearBtn: document.getElementById('seq-clear-btn'),
    sequenceProgress: document.getElementById('sequence-progress'),
};

// ============================================================================
// SECTION 2: GAME STATE
// ============================================================================

let gameState = 'intro';
let gridWidth = 4;
let gridHeight = 4;
let currentPos = { x: 1, y: 1 };
let targetPos = { x: 4, y: 4 };
let moveCount = 0;
let phase = 'calibration';
let totalJumps = 0;
let targetsReached = 0;
let breakCount = 0;
let jumpCounter = 0;
let hudVisible = false;
let gridNumbersVisible = false;

let isPreMoveAnimating = false;
let circleLight = null;
let currentLine = null;
let destDisc = null;
let destRing = null;
let isWaiting = false;
let waitTimer = null;
let WAIT_DURATION = 1000;
let MOVE_ANIMATION_DURATION = 1000;
let START_CIRCLE_SCALE_DURATION = 1000;

let calibrationJumps = 300;
let bciTargets = 5;
let maxMovesPerTarget = 50;
let selectedCondition = 'full';

const experimentStructure = [
    { phase: 'calibration', type: 'calibration', targets: null, jumps: calibrationJumps, description: 'Calibration Phase', color: '#3182ce' },
    { phase: 'bci', type: 'bci', targets: bciTargets, jumps: null, description: 'BCI Phase', color: '#9f7aea' },
    { phase: 'manual', type: 'manual', targets: bciTargets, jumps: null, description: 'Manual Phase', color: '#63b3ed' }
];

let currentPhaseIndex = 0;
let filteredExperimentStructure = [];
let userModel = {};

let scene, camera, renderer;
let cursor, targetMarker;
let animating = false;
let gridCells = [];
let cellPlatforms = [];
let cellBorders = [];
let gridLabels = [];
let directionLabels = [];
let overlayGroup = null;

const directions = {
    'N':  { x: 0,  y: -1, angle: 0 },
    'NE': { x: 1,  y: -1, angle: 45 },
    'E':  { x: 1,  y: 0,  angle: 90 },
    'SE': { x: 1,  y: 1,  angle: 135 },
    'S':  { x: 0,  y: 1,  angle: 180 },
    'SW': { x: -1, y: 1,  angle: -135 },
    'W':  { x: -1, y: 0,  angle: -90 },
    'NW': { x: -1, y: -1, angle: -45 }
};

// ============================================================================
// HELPER: Get a random start position at Chebyshev distance exactly 2 from target
// ============================================================================
function getStartPosition(target, width, height) {
    const candidates = [];
    for (let row = 1; row <= height; row++) {
        for (let col = 1; col <= width; col++) {
            if (row === target.y && col === target.x) continue;
            const dx = Math.abs(col - target.x);
            const dy = Math.abs(row - target.y);
            const dist = Math.max(dx, dy);
            if (dist === 2) {
                candidates.push({ x: col, y: row });
            }
        }
    }
    if (candidates.length === 0) {
        const corners = [
            { x: 1, y: 1 },
            { x: width, y: 1 },
            { x: 1, y: height },
            { x: width, y: height }
        ];
        let best = corners[0];
        let bestDist = -1;
        for (const c of corners) {
            const d = Math.abs(c.x - target.x) + Math.abs(c.y - target.y);
            if (d > bestDist) {
                bestDist = d;
                best = c;
            }
        }
        return best;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
}

let waitingForResponse = false;
let eventMarkers = [];
let robotModel = null;
let gltfLoader = null;
let mixer = null;
let clock = new THREE.Clock();
let animationFrameId = null;

// Visual toggles
let showWhiteLine = true;
let snapMovement = false;
let originalParadigm = false;
let showButtonFeedback = false;
let showStartCircle = true;

let gridStyle = 'node';
let showGridLines = true;
let cursorStyle = '2d';
let goalDesign = '2d';
let showDirectionLabels = true;
let cameraMode = '2d';

// Marker configuration
let markerPushing = true;
let sendLabel = true;
let sendCls1 = true;
let sendCls2 = true;
let sendButton = true;
let sendPredict = false;
let predictValue = '';

let reusableLine = null;
let reusableDisc = null;
let reusableRing = null;
let reusableStartDisc = null;
let startCircleAnimId = null;

let pendingMove = null;
let lastMoveDirection = null;
let nodeTexture = null;

// ============================================================================
// SECTION 2.5: PROFILE MANAGEMENT
// ============================================================================

const PROFILE_STORAGE_KEY = 'neurocursor_profiles';

function clampTiming(value) {
    return Math.max(100, Math.round(value * 1000));
}

function getGridStyleFromUI() {
    const node = document.getElementById('toggle-node-grid')?.checked || false;
    const box = document.getElementById('toggle-box-grid')?.checked || false;
    if (node && box) return 'both';
    if (node) return 'node';
    if (box) return 'box';
    return 'none';
}

function getDefaultSettings() {
    return {
        'toggle-original-paradigm': false,
        'toggle-snap-movement': true,
        'toggle-white-line': true,
        'toggle-button-feedback': false,
        'toggle-start-circle': true,
        'toggle-node-grid': true,
        'toggle-box-grid': false,
        'toggle-grid-lines': true,
        'cursor-style': '2d',
        'goal-design': '2d',
        'toggle-direction-labels': true,
        'camera-mode': '2d',
        'wait-duration': 1000,
        'move-animation-duration': 1000,
        'start-circle-duration': 1000,
        'grid-width': 4,
        'grid-height': 4,
        'condition': 'full',
        'calibration-jumps': 300,
        'bci-targets': 5,
        'toggle-marker-pushing': true,
        'toggle-send-label': true,
        'toggle-send-cls1': true,
        'toggle-send-cls2': true,
        'toggle-send-button': true,
        'toggle-send-predict': false,
        'predict-marker-value': ''
    };
}

function getGridDimensionsFromUI() {
    const widthInput = document.getElementById('grid-width-input');
    const heightInput = document.getElementById('grid-height-input');
    let w = parseInt(widthInput?.value) || 4;
    let h = parseInt(heightInput?.value) || 4;
    w = Math.max(1, Math.min(20, w));
    h = Math.max(1, Math.min(20, h));
    return { width: w, height: h };
}

function captureCurrentSettings() {
    const dims = getGridDimensionsFromUI();
    return {
        'toggle-original-paradigm': document.getElementById('toggle-original-paradigm')?.checked || false,
        'toggle-snap-movement': document.getElementById('toggle-snap-movement').checked,
        'toggle-white-line': document.getElementById('toggle-white-line').checked,
        'toggle-button-feedback': document.getElementById('toggle-button-feedback').checked,
        'toggle-start-circle': document.getElementById('toggle-start-circle').checked,
        'toggle-node-grid': document.getElementById('toggle-node-grid').checked,
        'toggle-box-grid': document.getElementById('toggle-box-grid').checked,
        'grid-style': getGridStyleFromUI(),
        'toggle-grid-lines': document.getElementById('toggle-grid-lines').checked,
        'cursor-style': document.querySelector('input[name="cursor-style"]:checked')?.value || '2d',
        'goal-design': document.querySelector('input[name="goal-design"]:checked')?.value || '2d',
        'toggle-direction-labels': document.getElementById('toggle-direction-labels').checked,
        'camera-mode': document.querySelector('input[name="camera-mode"]:checked')?.value || '2d',
        'wait-duration': clampTiming(parseFloat(document.getElementById('wait-duration').value) || 0.1),
        'move-animation-duration': clampTiming(parseFloat(document.getElementById('move-animation-duration').value) || 0.1),
        'start-circle-duration': clampTiming(parseFloat(document.getElementById('start-circle-duration').value) || 0.1),
        'grid-width': dims.width,
        'grid-height': dims.height,
        'condition': document.getElementById('condition').value || 'full',
        'calibration-jumps': parseInt(document.getElementById('calibration-jumps').value) || 300,
        'bci-targets': parseInt(document.getElementById('bci-targets').value) || 5,
        'toggle-marker-pushing': document.getElementById('toggle-marker-pushing').checked,
        'toggle-send-label': document.getElementById('toggle-send-label').checked,
        'toggle-send-cls1': document.getElementById('toggle-send-cls1').checked,
        'toggle-send-cls2': document.getElementById('toggle-send-cls2').checked,
        'toggle-send-button': document.getElementById('toggle-send-button').checked,
        'toggle-send-predict': document.getElementById('toggle-send-predict').checked,
        'predict-marker-value': document.getElementById('predict-marker-value').value
    };
}

function applySettingsToUI(settings) {
    if (!settings) return;
    const checkboxIds = [
        'toggle-original-paradigm', 'toggle-snap-movement', 'toggle-white-line',
        'toggle-button-feedback', 'toggle-grid-lines', 'toggle-direction-labels',
        'toggle-start-circle', 'toggle-node-grid', 'toggle-box-grid',
        'toggle-marker-pushing', 'toggle-send-label', 'toggle-send-cls1',
        'toggle-send-cls2', 'toggle-send-button', 'toggle-send-predict'
    ];
    checkboxIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && settings.hasOwnProperty(id)) el.checked = settings[id];
    });
    if (settings.hasOwnProperty('predict-marker-value')) {
        const el = document.getElementById('predict-marker-value');
        if (el) el.value = settings['predict-marker-value'];
    }
    if (settings.hasOwnProperty('toggle-original-paradigm')) {
        originalParadigm = settings['toggle-original-paradigm'];
    }
    ['cursor-style', 'goal-design', 'camera-mode'].forEach(name => {
        const val = settings[name];
        if (val) {
            const radio = document.querySelector(`input[name="${name}"][value="${val}"]`);
            if (radio) radio.checked = true;
        }
    });
    if (settings['wait-duration']) {
        const el = document.getElementById('wait-duration');
        if (el) el.value = Math.max(0.1, settings['wait-duration'] / 1000).toFixed(1);
    }
    if (settings['move-animation-duration']) {
        const el = document.getElementById('move-animation-duration');
        if (el) el.value = Math.max(0.1, settings['move-animation-duration'] / 1000).toFixed(1);
    }
    if (settings['start-circle-duration']) {
        const el = document.getElementById('start-circle-duration');
        if (el) el.value = Math.max(0.1, settings['start-circle-duration'] / 1000).toFixed(1);
    }
    const w = settings['grid-width'] || 4;
    const h = settings['grid-height'] || 4;
    const widthInput = document.getElementById('grid-width-input');
    const heightInput = document.getElementById('grid-height-input');
    if (widthInput) widthInput.value = Math.max(1, Math.min(20, w));
    if (heightInput) heightInput.value = Math.max(1, Math.min(20, h));

    const simpleMap = {
        'condition': 'condition',
        'calibration-jumps': 'calibration-jumps',
        'bci-targets': 'bci-targets'
    };
    Object.entries(simpleMap).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el && settings.hasOwnProperty(key)) el.value = settings[key];
    });
    updateTimingDisplay();
    restartPreviewAnimation();
    renderPreview(false);
    updateMarkerToggles();
}

function getProfiles() {
    try {
        const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to parse profiles:', e);
        return {};
    }
}

function saveProfilesToStorage(profiles) {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

function populateProfileDropdown() {
    const dropdown = DOM.profileDropdown;
    if (!dropdown) return;
    const profiles = getProfiles();
    const names = Object.keys(profiles);
    dropdown.innerHTML = '';
    if (names.length === 0) {
        dropdown.innerHTML = '<option value="">-- No profiles saved --</option>';
        return;
    }
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        dropdown.appendChild(opt);
    });
    const last = localStorage.getItem('neurocursor_last_profile');
    if (last && names.includes(last)) dropdown.value = last;
}

function setProfileStatus(msg, isError = false) {
    if (DOM.profileStatus) {
        DOM.profileStatus.textContent = msg;
        DOM.profileStatus.style.color = isError ? '#f87171' : '#a0aec0';
        setTimeout(() => {
            if (DOM.profileStatus.textContent === msg) {
                DOM.profileStatus.textContent = '';
            }
        }, 4000);
    }
}

function ensureBuiltinProfile() {
    const profiles = getProfiles();
    if (profiles['Original Paradigm']) return;
    const settings = {
        'toggle-original-paradigm': true,
        'toggle-snap-movement': true,
        'toggle-white-line': true,
        'toggle-button-feedback': false,
        'toggle-start-circle': true,
        'toggle-node-grid': true,
        'toggle-box-grid': false,
        'toggle-grid-lines': true,
        'cursor-style': '2d',
        'goal-design': '2d',
        'toggle-direction-labels': true,
        'camera-mode': '2d',
        'wait-duration': 1000,
        'move-animation-duration': 1000,
        'start-circle-duration': 1000,
        'grid-width': 4,
        'grid-height': 4,
        'condition': 'full',
        'calibration-jumps': 300,
        'bci-targets': 5,
        'toggle-marker-pushing': true,
        'toggle-send-label': true,
        'toggle-send-cls1': true,
        'toggle-send-cls2': true,
        'toggle-send-button': true,
        'toggle-send-predict': false,
        'predict-marker-value': ''
    };
    profiles['Original Paradigm'] = settings;
    saveProfilesToStorage(profiles);
    console.log('✅ Built-in "Original Paradigm" profile created.');
}

function saveProfile() {
    const nameInput = DOM.profileNameInput;
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
        setProfileStatus('⚠️ Please enter a profile name.', true);
        return;
    }
    const profiles = getProfiles();
    if (profiles[name]) {
        if (!confirm(`Profile "${name}" already exists. Overwrite?`)) {
            setProfileStatus('Save cancelled.', false);
            return;
        }
    }
    const settings = captureCurrentSettings();
    profiles[name] = settings;
    saveProfilesToStorage(profiles);
    localStorage.setItem('neurocursor_last_profile', name);
    populateProfileDropdown();
    populateSequenceDropdown();
    setProfileStatus(`✅ Profile "${name}" saved successfully!`);
}

function loadProfile() {
    const dropdown = DOM.profileDropdown;
    if (!dropdown) return;
    const name = dropdown.value;
    if (!name) {
        setProfileStatus('⚠️ Please select a profile to load.', true);
        return;
    }
    const profiles = getProfiles();
    const settings = profiles[name];
    if (!settings) {
        setProfileStatus(`❌ Profile "${name}" not found.`, true);
        populateProfileDropdown();
        return;
    }
    applySettingsToUI(settings);
    localStorage.setItem('neurocursor_last_profile', name);
    setProfileStatus(`📂 Profile "${name}" loaded.`);
}

function deleteProfile() {
    const dropdown = DOM.profileDropdown;
    if (!dropdown) return;
    const name = dropdown.value;
    if (!name) {
        setProfileStatus('⚠️ Please select a profile to delete.', true);
        return;
    }
    if (name === 'Original Paradigm') {
        setProfileStatus('⚠️ Cannot delete the built‑in "Original Paradigm" profile.', true);
        return;
    }
    if (!confirm(`Are you sure you want to delete profile "${name}"?`)) {
        setProfileStatus('Deletion cancelled.', false);
        return;
    }
    const profiles = getProfiles();
    delete profiles[name];
    saveProfilesToStorage(profiles);
    const last = localStorage.getItem('neurocursor_last_profile');
    if (last === name) localStorage.removeItem('neurocursor_last_profile');
    populateProfileDropdown();
    populateSequenceDropdown();
    setProfileStatus(`🗑️ Profile "${name}" deleted.`);
}

function resetToDefaults() {
    if (!confirm('Reset all settings to factory defaults?')) return;
    const defaults = getDefaultSettings();
    applySettingsToUI(defaults);
    if (DOM.profileNameInput) DOM.profileNameInput.value = '';
    setProfileStatus('↺ Reset to factory defaults.');
}

function exportProfiles() {
    const profiles = getProfiles();
    const names = Object.keys(profiles);
    if (names.length === 0) {
        setProfileStatus('⚠️ No profiles to export.', true);
        return;
    }
    const json = JSON.stringify(profiles, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neurocursor_profiles_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setProfileStatus(`✅ Exported ${names.length} profile(s).`);
}

function importProfiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();

    input.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) {
            document.body.removeChild(input);
            return;
        }
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const imported = JSON.parse(ev.target.result);
                if (typeof imported !== 'object' || imported === null) {
                    throw new Error('Invalid JSON: expected an object.');
                }
                const current = getProfiles();
                const importNames = Object.keys(imported);
                const overlap = importNames.filter(n => current.hasOwnProperty(n));
                let proceed = true;
                if (overlap.length > 0) {
                    proceed = confirm(`The following profiles already exist: ${overlap.join(', ')}. Overwrite them?`);
                }
                if (!proceed) {
                    setProfileStatus('Import cancelled.', false);
                    document.body.removeChild(input);
                    return;
                }
                const merged = { ...current, ...imported };
                saveProfilesToStorage(merged);
                populateProfileDropdown();
                populateSequenceDropdown();
                if (importNames.length > 0) {
                    localStorage.setItem('neurocursor_last_profile', importNames[importNames.length-1]);
                }
                setProfileStatus(`✅ Imported ${importNames.length} profile(s).`);
            } catch (err) {
                setProfileStatus(`❌ Import failed: ${err.message}`, true);
            }
            document.body.removeChild(input);
        };
        reader.onerror = function() {
            setProfileStatus('❌ Failed to read file.', true);
            document.body.removeChild(input);
        };
        reader.readAsText(file);
    });
}

// ============================================================================
// MARKER TOGGLE HELPER – Gray out individual toggles when master is OFF
// ============================================================================
function updateMarkerToggles() {
    const master = document.getElementById('toggle-marker-pushing');
    const individualToggles = [
        'toggle-send-label',
        'toggle-send-cls1',
        'toggle-send-cls2',
        'toggle-send-button',
        'toggle-send-predict'
    ];
    const isMasterOn = master ? master.checked : true;
    individualToggles.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !isMasterOn;
        }
    });
    // Handle predict text input separately
    const predictCheckbox = document.getElementById('toggle-send-predict');
    const predictInput = document.getElementById('predict-marker-value');
    if (predictInput) {
        const isPredictOn = predictCheckbox ? predictCheckbox.checked : false;
        predictInput.disabled = !isMasterOn || !isPredictOn;
    }
}

// ============================================================================
// SECTION 2.6: LIVE PREVIEW
// ============================================================================

function renderPreview2D(ctx, w, h) {
    if (w < 10 || h < 10) {
        console.warn('Preview dimensions too small, skipping 2D render.');
        return;
    }
    ctx.clearRect(0, 0, w, h);

    const isOriginal = originalParadigm;
    const dims = getGridDimensionsFromUI();
    const cols = dims.width;
    const rows = dims.height;
    const gStyle = getGridStyleFromUI();
    const showLines = document.getElementById('toggle-grid-lines').checked;
    const cStyle = document.querySelector('input[name="cursor-style"]:checked')?.value || '2d';
    const gDesign = document.querySelector('input[name="goal-design"]:checked')?.value || '2d';
    const showLabels = document.getElementById('toggle-direction-labels').checked;
    const cameraModeRadio = document.querySelector('input[name="camera-mode"]:checked')?.value || '2d';
    
    const is3D = (cameraModeRadio === '3d' && !isOriginal);

    const margin = 25;
    const maxDim = Math.max(cols, rows);
    const cellSize = Math.min((w - margin * 2) / (cols + 1), (h - margin * 2) / (rows + 1));
    const offsetX = (w - cellSize * (cols + 1)) / 2;
    const offsetY = (h - cellSize * (rows + 1)) / 2;

    function getX(i) { return offsetX + (i + 1) * cellSize; }
    function getY(j) { return offsetY + (j + 1) * cellSize; }

    const cx = (getX(0) + getX(cols - 1)) / 2;
    const cy = (getY(0) + getY(rows - 1)) / 2;

    function project(x, y) {
        if (!is3D) return { x, y };
        return {
            x: x,
            y: cy + (y - cy) * 0.55 + (x - cx) * 0.12
        };
    }

    const dirs = [
        [-1, -1], [0, -1], [1, -1],
        [-1,  0],          [1,  0],
        [-1,  1], [0,  1], [1,  1]
    ];

    ctx.fillStyle = '#161616';
    ctx.fillRect(0, 0, w, h);

    // ---------- Draw Grid ----------
    if (isOriginal) {
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 1;
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const p1 = project(getX(i), getY(j));
                for (const d of dirs) {
                    const ni = i + d[0];
                    const nj = j + d[1];
                    if (ni >= 0 && ni < cols && nj >= 0 && nj < rows) {
                        if (ni > i || (ni === i && nj > j)) {
                            const p2 = project(getX(ni), getY(nj));
                            ctx.beginPath();
                            ctx.moveTo(p1.x, p1.y);
                            ctx.lineTo(p2.x, p2.y);
                            ctx.stroke();
                        }
                    }
                }
            }
        }
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const p = project(getX(i), getY(j));
                ctx.beginPath();
                ctx.arc(p.x, p.y, cellSize * 0.25, 0, Math.PI * 2);
                ctx.fillStyle = '#0a0a0a';
                ctx.fill();
                ctx.strokeStyle = '#888';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
    } else {
        const isBox = (gStyle === 'box' || gStyle === 'both');
        const isNode = (gStyle === 'node' || gStyle === 'both');

        if (isBox) {
            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const center = project(getX(i), getY(j));
                    const scale = is3D ? 0.85 : 1;
                    const size = (cellSize - 4) * scale;
                    const isDark = (i + j) % 2 === 0;
                    ctx.fillStyle = isDark ? '#2a2a2a' : '#3a3a3a';
                    ctx.fillRect(center.x - size/2, center.y - size/2, size, size);
                    ctx.strokeStyle = '#a4a4a4';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(center.x - size/2, center.y - size/2, size, size);
                }
            }
        }

        if (isNode && showLines) {
            ctx.strokeStyle = '#636262';
            ctx.lineWidth = 2.5;
            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const p1 = project(getX(i), getY(j));
                    for (const d of dirs) {
                        const ni = i + d[0];
                        const nj = j + d[1];
                        if (ni >= 0 && ni < cols && nj >= 0 && nj < rows) {
                            if (ni > i || (ni === i && nj > j)) {
                                const p2 = project(getX(ni), getY(nj));
                                ctx.beginPath();
                                ctx.moveTo(p1.x, p1.y);
                                ctx.lineTo(p2.x, p2.y);
                                ctx.stroke();
                            }
                        }
                    }
                }
            }
        }

        if (isNode) {
            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const p = project(getX(i), getY(j));
                    const r = cellSize * 0.22 * (is3D ? 0.85 : 1);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                    ctx.fillStyle = '#000';
                    ctx.fill();
                    ctx.strokeStyle = '#636262';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }

        if (showLabels) {
            ctx.fillStyle = '#ede663';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const off = cellSize * 0.6;
            const cx2 = (getX(0) + getX(cols-1)) / 2;
            const cy2 = (getY(0) + getY(rows-1)) / 2;
            
            const n = project(cx2, getY(0) - off);
            const s = project(cx2, getY(rows-1) + off);
            const wPos = project(getX(0) - off, cy2);
            const ePos = project(getX(cols-1) + off, cy2);
            
            ctx.fillText('N', n.x, n.y);
            ctx.fillText('S', s.x, s.y);
            ctx.fillText('W', wPos.x, wPos.y);
            ctx.fillText('E', ePos.x, ePos.y);
        }
    }

    // ---------- Target ----------
    const targetI = cols - 1;
    const targetJ = rows - 1;
    const tPos = project(getX(targetI), getY(targetJ));
    const tr = cellSize * 0.28 * (is3D ? 0.85 : 1);

    if (isOriginal || gDesign === '2d') {
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tPos.x, tPos.y, tr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tPos.x, tPos.y, tr * 0.7, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        const half = tr * 0.8;
        ctx.fillStyle = '#cc0000';
        ctx.shadowColor = 'rgba(255,0,0,0.3)';
        ctx.shadowBlur = 6;
        ctx.fillRect(tPos.x - half, tPos.y - half, half * 2, half * 2);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tPos.x - half, tPos.y - half, half * 2, half * 2);
    }
    ctx.shadowBlur = 0;

    // ---------- Direction line + destination markers ----------
    if (previewAnim.valid && previewAnim.showLineAndDest && document.getElementById('toggle-white-line').checked) {
        const fPos = project(getX(previewAnim.from.i), getY(previewAnim.from.j));
        const dPos = project(getX(previewAnim.to.i), getY(previewAnim.to.j));

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, cellSize * 0.06);
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(255,255,255,0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(fPos.x, fPos.y);
        ctx.lineTo(dPos.x, dPos.y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        const destR = cellSize * 0.15 * (is3D ? 0.85 : 1);
        ctx.beginPath();
        ctx.arc(dPos.x, dPos.y, destR, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dPos.x, dPos.y, destR * 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // ---------- Cursor ----------
    let cursorFI, cursorFJ;
    if (previewAnim.valid) {
        const t = previewAnim.moveProgress;
        cursorFI = previewAnim.from.i + (previewAnim.to.i - previewAnim.from.i) * t;
        cursorFJ = previewAnim.from.j + (previewAnim.to.j - previewAnim.from.j) * t;
    } else {
        cursorFI = Math.max(0, Math.floor(cols / 2) - 1);
        cursorFJ = Math.max(0, Math.floor(rows / 2) - 1);
    }
    const cPos = project(getX(cursorFI), getY(cursorFJ));
    const cursorR = cellSize * 0.2 * (is3D ? 0.85 : 1);

    ctx.shadowColor = 'rgba(255,0,0,0.5)';
    ctx.shadowBlur = 8;

    if (isOriginal || cStyle === '2d') {
        ctx.beginPath();
        ctx.arc(cPos.x, cPos.y, cursorR, 0, Math.PI * 2);
        ctx.fillStyle = '#ff0000';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    } else if (cStyle === '3d') {
        const grad = ctx.createRadialGradient(cPos.x-3, cPos.y-3, 2, cPos.x, cPos.y, cursorR);
        grad.addColorStop(0, '#ff6666');
        grad.addColorStop(1, '#990000');
        ctx.beginPath();
        ctx.arc(cPos.x, cPos.y, cursorR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 1;
        ctx.stroke();
    } else if (cStyle === 'robot') {
        ctx.shadowBlur = 0;
        ctx.font = `${cursorR * 2}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🤖', cPos.x, cPos.y);
    }

    ctx.shadowBlur = 0;

    // ---------- Ghost Circle ----------
    if (previewAnim.valid && previewAnim.phase === 'startcircle' && document.getElementById('toggle-start-circle').checked && previewAnim.startCircleScale > 0) {
        const sPos = project(getX(previewAnim.from.i), getY(previewAnim.from.j));
        const cursorRMax = cellSize * 0.3 * (is3D ? 0.85 : 1);
        const r = cursorRMax * previewAnim.startCircleScale * 0.8;
        if (r > 0.5) {
            ctx.beginPath();
            ctx.arc(sPos.x, sPos.y, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.fill();
        }
    }
}

// ---- Helper: create a 3D robot from primitives ----
function createSimpleRobot() {
    const group = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5, roughness: 0.3 });
    const matHead = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.3, roughness: 0.5 });
    const matArm = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.5, roughness: 0.3 });
    const matLeg = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5, roughness: 0.3 });
    const matEye = new THREE.MeshBasicMaterial({ color: 0x00ffff });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), matBody);
    body.position.y = 0.4;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), matHead);
    head.position.y = 0.9;
    group.add(head);

    const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const eyeL = new THREE.Mesh(eyeGeo, matEye);
    eyeL.position.set(-0.12, 0.95, 0.25);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, matEye);
    eyeR.position.set(0.12, 0.95, 0.25);
    group.add(eyeR);

    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), matArm);
    armL.position.set(-0.5, 0.6, 0);
    armL.rotation.z = 0.3;
    group.add(armL);

    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), matArm);
    armR.position.set(0.5, 0.6, 0);
    armR.rotation.z = -0.3;
    group.add(armR);

    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), matLeg);
    legL.position.set(-0.2, 0.1, 0);
    group.add(legL);

    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), matLeg);
    legR.position.set(0.2, 0.1, 0);
    group.add(legR);

    return group;
}

// ---- 3D preview using Three.js ----
let previewScene = null;
let previewCamera = null;
let previewRenderer = null;
let previewGridObjects = [];
let previewOverlayObjects = [];
let previewStaticSignature = null;

// ============================================================================
// DYNAMIC CAMERA EXTENT HELPERS (NEW)
// ============================================================================

/**
 * Computes the required half‑size (radius) of the viewport so that
 * the grid and all directional labels (N, S, E, W) are fully visible.
 * Used for the main experiment.
 */
function getGridExtent() {
    // Grid spans from (0,0) to (gridWidth-1, gridHeight-1) in world coords
    const maxGridCoord = Math.max(gridWidth - 1, gridHeight - 1);
    // Labels are placed at ±(dimension + 1.3) from centre
    const labelOffset = 1.3;
    const maxLabelCoord = Math.max(gridWidth, gridHeight) + labelOffset;
    const padding = 0.8; // extra margin for comfort
    return Math.max(1, Math.max(maxGridCoord, maxLabelCoord) + padding);
}

/**
 * Same as getGridExtent() but reads grid dimensions from the UI
 * for the live preview.
 */
function getPreviewGridExtent() {
    const dims = getGridDimensionsFromUI();
    const maxGridCoord = Math.max(dims.width - 1, dims.height - 1);
    const labelOffset = 1.3;
    const maxLabelCoord = Math.max(dims.width, dims.height) + labelOffset;
    const padding = 0.8;
    return Math.max(1, Math.max(maxGridCoord, maxLabelCoord) + padding);
}

// ============================================================================
// LIVE PREVIEW ANIMATION ENGINE
// ============================================================================
let previewAnim = {
    active: false,
    rafId: null,
    phase: 'idle',
    phaseStart: 0,
    from: { i: 0, j: 0 },
    to: { i: 0, j: 0 },
    current: null,
    moveProgress: 0,
    startCircleScale: 0,
    showLineAndDest: false,
    valid: true
};

function getPreviewDemoCells() {
    const dims = getGridDimensionsFromUI();
    const cols = dims.width, rows = dims.height;
    if (cols < 1 || rows < 1) return null;
    return { cols, rows };
}

function previewStepBegin(now) {
    const cells = getPreviewDemoCells();
    if (!cells) {
        previewAnim.valid = false;
        previewAnim.phase = 'idle';
        previewAnim.showLineAndDest = false;
        previewAnim.moveProgress = 0;
        return;
    }
    previewAnim.valid = true;

    if (!previewAnim.current) {
        const ci = Math.max(0, Math.floor(cells.cols / 2) - 1);
        const cj = Math.max(0, Math.floor(cells.rows / 2) - 1);
        previewAnim.current = { i: ci, j: cj };
    }

    const dirs = [
        { di: -1, dj: -1 }, { di: 0, dj: -1 }, { di: 1, dj: -1 },
        { di: -1, dj: 0 },                    { di: 1, dj: 0 },
        { di: -1, dj: 1 },  { di: 0, dj: 1 }, { di: 1, dj: 1 }
    ];
    const neighbours = [];
    for (const d of dirs) {
        const ni = previewAnim.current.i + d.di;
        const nj = previewAnim.current.j + d.dj;
        if (ni >= 0 && ni < cells.cols && nj >= 0 && nj < cells.rows) {
            neighbours.push({ i: ni, j: nj });
        }
    }

    if (neighbours.length === 0) {
        previewAnim.from = previewAnim.current;
        previewAnim.to = previewAnim.current;
        previewAnim.phase = 'waiting';
        previewAnim.phaseStart = now;
        previewAnim.moveProgress = 0;
        previewAnim.showLineAndDest = false;
        return;
    }

    const chosen = neighbours[Math.floor(Math.random() * neighbours.length)];
    previewAnim.from = { i: previewAnim.current.i, j: previewAnim.current.j };
    previewAnim.to = { i: chosen.i, j: chosen.j };
    previewAnim.moveProgress = 0;
    previewAnim.phaseStart = now;

    const showStart = document.getElementById('toggle-start-circle')?.checked ?? true;
    if (showStart) {
        previewAnim.phase = 'startcircle';
        previewAnim.startCircleScale = 0;
        previewAnim.showLineAndDest = false;
    } else {
        previewAnim.phase = 'moving';
        previewAnim.showLineAndDest = true;
    }
}

function previewTick(now) {
    if (!previewAnim.active) return;

    if (previewAnim.phaseStart === 0) {
        previewStepBegin(now);
    } else if (previewAnim.valid) {
        const startDurRaw = parseFloat(document.getElementById('start-circle-duration')?.value);
        const moveDurRaw = parseFloat(document.getElementById('move-animation-duration')?.value);
        const waitDurRaw = parseFloat(document.getElementById('wait-duration')?.value);
        const startDur = Math.max(100, (isNaN(startDurRaw) ? 1 : startDurRaw) * 1000);
        const moveDur = Math.max(100, (isNaN(moveDurRaw) ? 1 : moveDurRaw) * 1000);
        const waitDur = Math.max(100, (isNaN(waitDurRaw) ? 1 : waitDurRaw) * 1000);
        const snap = document.getElementById('toggle-snap-movement')?.checked ?? false;
        const showStartNow = document.getElementById('toggle-start-circle')?.checked ?? true;

        const elapsed = now - previewAnim.phaseStart;

        if (previewAnim.phase === 'startcircle') {
            if (!showStartNow) {
                previewAnim.phase = 'moving';
                previewAnim.phaseStart = now;
                previewAnim.showLineAndDest = true;
                previewAnim.startCircleScale = 0;
            } else {
                const t = Math.min(elapsed / startDur, 1);
                previewAnim.startCircleScale = t;
                if (t >= 1) {
                    previewAnim.phase = 'moving';
                    previewAnim.phaseStart = now;
                    previewAnim.showLineAndDest = true;
                    previewAnim.startCircleScale = 0;
                }
            }
        } else if (previewAnim.phase === 'moving') {
            const t = Math.min(elapsed / moveDur, 1);
            if (snap) {
                previewAnim.moveProgress = (t >= 1) ? 1 : 0;
            } else {
                previewAnim.moveProgress = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            }
            if (t >= 1) {
                previewAnim.moveProgress = 1;
                previewAnim.showLineAndDest = false;
                previewAnim.current = { i: previewAnim.to.i, j: previewAnim.to.j };
                previewAnim.phase = 'waiting';
                previewAnim.phaseStart = now;
            }
        } else if (previewAnim.phase === 'waiting') {
            if (elapsed >= waitDur) {
                previewStepBegin(now);
            }
        }
    }

    renderPreview(false);
    previewAnim.rafId = requestAnimationFrame(previewTick);
}

function startPreviewAnimation() {
    if (previewAnim.active) return;
    previewAnim.active = true;
    previewAnim.phaseStart = 0;
    previewAnim.rafId = requestAnimationFrame(previewTick);
}

function stopPreviewAnimation() {
    previewAnim.active = false;
    if (previewAnim.rafId) {
        cancelAnimationFrame(previewAnim.rafId);
        previewAnim.rafId = null;
    }
}

function restartPreviewAnimation() {
    previewAnim.current = null;
    previewAnim.phaseStart = 0;
    if (!previewAnim.active) startPreviewAnimation();
}

function initPreviewScene() {
    const container = document.querySelector('.preview-frame');
    if (!container) return;
    
    const existing3D = container.querySelector('.preview-3d-canvas');
    if (existing3D) existing3D.remove();
    
    previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    const rect = container.getBoundingClientRect();
    previewRenderer.setSize(rect.width || 300, rect.height || 300);
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    const canvas = previewRenderer.domElement;
    canvas.className = 'preview-3d-canvas';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);
    
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x000000);
    
    const isOriginal = originalParadigm;
    const aspect = rect.width / rect.height || 1;
    const halfSize = getPreviewGridExtent();  // <-- dynamic
    
    if (isOriginal) {
        // Original paradigm always uses orthographic 2D view
        previewCamera = new THREE.OrthographicCamera(
            -halfSize * aspect, halfSize * aspect,
            halfSize, -halfSize,
            0.1, 100
        );
        previewCamera.position.set(0, 20, 0);
        previewCamera.lookAt(0, 0, 0);
    } else {
        const cameraModeRadio = document.querySelector('input[name="camera-mode"]:checked')?.value || '2d';
        if (cameraModeRadio === '3d') {
            previewCamera = new THREE.PerspectiveCamera(25, aspect, 0.1, 1000);
            const fovRad = (previewCamera.fov * Math.PI) / 360;
            const dist = halfSize / Math.tan(fovRad);
            previewCamera.position.set(0, dist / Math.SQRT2, dist / Math.SQRT2);
            previewCamera.lookAt(0, 0, 0);
        } else {
            previewCamera = new THREE.OrthographicCamera(
                -halfSize * aspect, halfSize * aspect,
                halfSize, -halfSize,
                0.1, 100
            );
            previewCamera.position.set(0, 20, 0);
            previewCamera.lookAt(0, 0, 0);
        }
    }
    
    const ambient = new THREE.AmbientLight(0xffffff, isOriginal ? 0.9 : 0.4);
    previewScene.add(ambient);
    if (!isOriginal) {
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 20, 10);
        previewScene.add(dirLight);
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-10, 10, -10);
        previewScene.add(fillLight);
        const pointLight = new THREE.PointLight(0xff4444, 0.3, 10);
        pointLight.position.set(0, 3, 0);
        previewScene.add(pointLight);
    }
    
    function animatePreview() {
        requestAnimationFrame(animatePreview);
        if (previewRenderer && previewScene && previewCamera) {
            previewRenderer.render(previewScene, previewCamera);
        }
    }
    animatePreview();
    previewStaticSignature = null;
}

function rebuildPreviewGrid() {
    if (!previewScene) return;
    previewGridObjects.forEach(obj => previewScene.remove(obj));
    previewGridObjects = [];

    const isOriginal = originalParadigm;
    const dims = getGridDimensionsFromUI();
    const cols = dims.width;
    const rows = dims.height;
    const gStyle = getGridStyleFromUI();
    const showLines = document.getElementById('toggle-grid-lines').checked;
    const showLabels = document.getElementById('toggle-direction-labels').checked;

    const spacing = 2;

    if (isOriginal) {
        const edgeColor = 0x888888;
        const points = [];
        const nodeCoords = [];
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const x = (i - cols/2 + 0.5) * spacing;
                const z = (j - rows/2 + 0.5) * spacing;
                nodeCoords.push({ x, z });
            }
        }
        const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const idx = i * rows + j;
                const from = nodeCoords[idx];
                for (const d of dirs) {
                    const ni = i + d[0], nj = j + d[1];
                    if (ni >= 0 && ni < cols && nj >= 0 && nj < rows) {
                        const to = nodeCoords[ni * rows + nj];
                        points.push(from.x, 0.02, from.z);
                        points.push(to.x, 0.02, to.z);
                    }
                }
            }
        }
        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor });
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        previewScene.add(edges);
        previewGridObjects.push(edges);

        const blackMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.DoubleSide });
        const whiteMat = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide });
        for (const coord of nodeCoords) {
            const disc = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), blackMat);
            disc.position.set(coord.x, 0.03, coord.z);
            disc.rotation.x = -Math.PI/2;
            previewScene.add(disc);
            previewGridObjects.push(disc);
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.35, 16), whiteMat);
            ring.position.set(coord.x, 0.03, coord.z);
            ring.rotation.x = -Math.PI/2;
            previewScene.add(ring);
            previewGridObjects.push(ring);
        }
    } else {
        const drawBox = (gStyle === 'box' || gStyle === 'both');
        const drawNode = (gStyle === 'node' || gStyle === 'both');
        const drawNone = (gStyle === 'none');

        if (drawBox) {
            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const x = (i - cols/2 + 0.5) * spacing;
                    const z = (j - rows/2 + 0.5) * spacing;
                    const isDark = (i + j) % 2 === 0;
                    const color = isDark ? 0x2a2a2a : 0x333333;
                    const box = new THREE.Mesh(
                        new THREE.BoxGeometry(spacing*0.9, 0.2, spacing*0.9),
                        new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.8 })
                    );
                    box.position.set(x, 0.1, z);
                    previewScene.add(box);
                    previewGridObjects.push(box);

                    const border = new THREE.Mesh(
                        new THREE.BoxGeometry(spacing*0.95, 0.3, spacing*0.95),
                        new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.3, roughness: 0.7 })
                    );
                    border.position.set(x, 0.15, z);
                    previewScene.add(border);
                    previewGridObjects.push(border);
                }
            }
            const ground = new THREE.Mesh(
                new THREE.PlaneGeometry(Math.max(cols, rows)*spacing*1.5, Math.max(cols, rows)*spacing*1.5),
                new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.5, roughness: 0.8, transparent: true, opacity: 0.8 })
            );
            ground.rotation.x = -Math.PI/2;
            ground.position.y = -0.1;
            previewScene.add(ground);
            previewGridObjects.push(ground);
        }

        if (drawNode && showLines) {
            const lineMat = new THREE.LineBasicMaterial({ color: 0x1a1a2e });

            const dirs = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const x1 = (i - cols/2 + 0.5) * spacing;
                    const z1 = (j - rows/2 + 0.5) * spacing;
                    for (const d of dirs) {
                        const ni = i + d[0], nj = j + d[1];
                        if (ni >= 0 && ni < cols && nj >= 0 && nj < rows) {
                            if (ni > i || (ni === i && nj > j)) {
                                const x2 = (ni - cols/2 + 0.5) * spacing;
                                const z2 = (nj - rows/2 + 0.5) * spacing;
                                const pts = [
                                    new THREE.Vector3(x1, 0.351, z1),
                                    new THREE.Vector3(x2, 0.351, z2)
                                ];
                                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                                const line = new THREE.Line(geo, lineMat);
                                previewScene.add(line);
                                previewGridObjects.push(line);
                            }
                        }
                    }
                }
            }
        }

        if (drawNode) {
            const fillMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
            const outlineMat = new THREE.MeshBasicMaterial({ color: 0x636262, side: THREE.DoubleSide });

            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const x = (i - cols/2 + 0.5) * spacing;
                    const z = (j - rows/2 + 0.5) * spacing;
                    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.5*0.85, 16), fillMat);
                    fill.position.set(x, 0.352, z);
                    fill.rotation.x = -Math.PI/2;
                    previewScene.add(fill);
                    previewGridObjects.push(fill);
                    const outline = new THREE.Mesh(new THREE.RingGeometry(0.5*0.85, 0.45, 16), outlineMat);
                    outline.position.set(x, 0.352, z);
                    outline.rotation.x = -Math.PI/2;
                    previewScene.add(outline);
                    previewGridObjects.push(outline);
                }
            }
        }

        if (showLabels && !drawNone) {
            const labelData = [
                { text: 'N', dx: 0, dz: -rows*spacing/2 - 1.3 },
                { text: 'S', dx: 0, dz: rows*spacing/2 + 1.3 },
                { text: 'W', dx: -cols*spacing/2 - 1.3, dz: 0 },
                { text: 'E', dx: cols*spacing/2 + 1.3, dz: 0 }
            ];
            labelData.forEach(({text, dx, dz}) => {
                const canvas = document.createElement('canvas');
                canvas.width = 128; canvas.height = 128;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ede663';
                ctx.font = 'bold 80px Arial';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(text, 64, 64);
                const tex = new THREE.CanvasTexture(canvas);
                const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                const sprite = new THREE.Sprite(mat);
                sprite.position.set(dx, 0.8, dz);
                sprite.scale.set(0.8, 0.8, 1);
                previewScene.add(sprite);
                previewGridObjects.push(sprite);
            });
        }
    }
}

function updatePreviewCameraAspect() {
    const container = document.querySelector('.preview-frame');
    if (!container || !previewCamera || !previewRenderer) return;
    const rect = container.getBoundingClientRect();
    const aspect = rect.width / rect.height || 1;
    const halfSize = getPreviewGridExtent(); // <-- dynamic

    if (previewCamera.isOrthographicCamera) {
        previewCamera.left = -halfSize * aspect;
        previewCamera.right = halfSize * aspect;
        previewCamera.top = halfSize;
        previewCamera.bottom = -halfSize;
        previewCamera.updateProjectionMatrix();
    } else {
        previewCamera.aspect = aspect;
        const fovRad = (previewCamera.fov * Math.PI) / 360;
        const dist = halfSize / Math.tan(fovRad);
        previewCamera.position.set(0, dist / Math.SQRT2, dist / Math.SQRT2);
        previewCamera.lookAt(0, 0, 0);
        previewCamera.updateProjectionMatrix();
    }
    previewRenderer.setSize(rect.width, rect.height);
}

function previewCellToWorld(i, j, cols, rows, spacing = 2) {
    return {
        x: (i - cols / 2 + 0.5) * spacing,
        z: (j - rows / 2 + 0.5) * spacing
    };
}

function updatePreviewOverlay() {
    if (!previewScene) return;
    previewOverlayObjects.forEach(obj => previewScene.remove(obj));
    previewOverlayObjects = [];

    const isOriginal = originalParadigm;
    const dims = getGridDimensionsFromUI();
    const cols = dims.width;
    const rows = dims.height;
    const cStyle = document.querySelector('input[name="cursor-style"]:checked')?.value || '2d';
    const gDesign = document.querySelector('input[name="goal-design"]:checked')?.value || '2d';
    const showWhiteLineToggle = document.getElementById('toggle-white-line').checked;
    const showStartToggle = document.getElementById('toggle-start-circle').checked;
    const spacing = 2;

    let ci, cj;
    if (previewAnim.valid) {
        const t = previewAnim.moveProgress;
        ci = previewAnim.from.i + (previewAnim.to.i - previewAnim.from.i) * t;
        cj = previewAnim.from.j + (previewAnim.to.j - previewAnim.from.j) * t;
    } else {
        ci = Math.max(0, Math.floor(cols / 2) - 1);
        cj = Math.max(0, Math.floor(rows / 2) - 1);
    }
    const cWorld = previewCellToWorld(ci, cj, cols, rows, spacing);
    const cursorY = isOriginal ? 0.05 : (cStyle === '2d' ? CURSOR_2D_Y : 0.7);
    const cursorR = isOriginal ? ORIGINAL_CURSOR_RADIUS : CURSOR_RADIUS;

    if (isOriginal || cStyle === '2d') {
        const disc = new THREE.Mesh(
            new THREE.CircleGeometry(cursorR, 16),
            new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide })
        );
        disc.position.set(cWorld.x, cursorY, cWorld.z);
        disc.rotation.x = -Math.PI/2;
        disc.renderOrder = 4;
        previewScene.add(disc);
        previewOverlayObjects.push(disc);
        const center = new THREE.Mesh(
            new THREE.CircleGeometry(cursorR*0.0, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
        );
        center.position.set(cWorld.x, cursorY+0.001, cWorld.z);
        center.rotation.x = -Math.PI/2;
        center.renderOrder = 4;
        previewScene.add(center);
        previewOverlayObjects.push(center);
    } else if (cStyle === '3d') {
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(cursorR, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xff4444, metalness: 0.0, roughness: 0.0 })
        );
        sphere.position.set(cWorld.x, cursorY, cWorld.z);
        sphere.renderOrder = 4;
        previewScene.add(sphere);
        previewOverlayObjects.push(sphere);
    } else if (cStyle === 'robot') {
        const robot = createSimpleRobot();
        robot.position.set(cWorld.x, cursorY, cWorld.z);
        const scale = cursorR * 2.8;
        robot.scale.set(scale, scale, scale);
        robot.renderOrder = 4;
        previewScene.add(robot);
        previewOverlayObjects.push(robot);
    }

    // Target
    const targetI = cols - 1;
    const targetJ = rows - 1;
    const tWorld = previewCellToWorld(targetI, targetJ, cols, rows, spacing);
    const targetY = isOriginal ? 0.1 : (gDesign === '2d' ? GOAL_2D_Y : 0.6);
    const targetR = isOriginal ? 0.35 : 0.45;

    if (isOriginal || gDesign === '2d') {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(targetR*0.8, targetR, 24),
            new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide })
        );
        ring.position.set(tWorld.x, targetY, tWorld.z);
        ring.rotation.x = -Math.PI/2;
        ring.renderOrder = 3;
        previewScene.add(ring);
        previewOverlayObjects.push(ring);
        const inner = new THREE.Mesh(
            new THREE.RingGeometry(targetR*0.5, targetR*0.7, 24),
            new THREE.MeshBasicMaterial({ color: 0xff4444, side: THREE.DoubleSide })
        );
        inner.position.set(tWorld.x, targetY+0.001, tWorld.z);
        inner.rotation.x = -Math.PI/2;
        inner.renderOrder = 3;
        previewScene.add(inner);
        previewOverlayObjects.push(inner);
    } else {
        const cube = new THREE.Mesh(
            new THREE.BoxGeometry(targetR*1.2, targetR*1.2, targetR*1.2),
            new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x330000 })
        );
        cube.position.set(tWorld.x, targetY, tWorld.z);
        cube.renderOrder = 3;
        previewScene.add(cube);
        previewOverlayObjects.push(cube);
    }

    // White Direction Line + destination
    if (previewAnim.valid && previewAnim.showLineAndDest && showWhiteLineToggle) {
        const helperY = isOriginal ? 0.05 : 0.35;
        const fWorld = previewCellToWorld(previewAnim.from.i, previewAnim.from.j, cols, rows, spacing);
        const tWorld2 = previewCellToWorld(previewAnim.to.i, previewAnim.to.j, cols, rows, spacing);
        const lineRadius = isOriginal ? DIRECTION_LINE_RADIUS_ORIG : DIRECTION_LINE_RADIUS;
        const curve = new THREE.LineCurve3(
            new THREE.Vector3(fWorld.x, helperY, fWorld.z),
            new THREE.Vector3(tWorld2.x, helperY, tWorld2.z)
        );
        const lineMat = new THREE.MeshStandardMaterial({
            color: 0xffffff, emissive: 0xffffff, emissiveIntensity: isOriginal ? 1.0 : 0.9
        });
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, lineRadius, 8, false), lineMat);
        tube.renderOrder = 2;
        previewScene.add(tube);
        previewOverlayObjects.push(tube);

        const discRadius = isOriginal ? DESTINATION_DISC_RADIUS_ORIG : DESTINATION_DISC_RADIUS;
        const ringRadius = isOriginal ? DESTINATION_RING_RADIUS_ORIG : DESTINATION_RING_RADIUS;
        const destDisc = new THREE.Mesh(
            new THREE.CylinderGeometry(discRadius, discRadius, 0.05, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        destDisc.position.set(tWorld2.x, helperY, tWorld2.z);
        destDisc.renderOrder = 2;
        previewScene.add(destDisc);
        previewOverlayObjects.push(destDisc);

        const destRing = new THREE.Mesh(
            new THREE.RingGeometry(ringRadius - 0.05, ringRadius, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
        );
        destRing.position.set(tWorld2.x, helperY + 0.01, tWorld2.z);
        destRing.rotation.x = -Math.PI/2;
        destRing.renderOrder = 2;
        previewScene.add(destRing);
        previewOverlayObjects.push(destRing);
    }

    // Ghost Circle
    if (previewAnim.valid && previewAnim.phase === 'startcircle' && showStartToggle && previewAnim.startCircleScale > 0) {
        const helperY = isOriginal ? 0.05 : 0.35;
        const fWorld = previewCellToWorld(previewAnim.from.i, previewAnim.from.j, cols, rows, spacing);
        const cursorRadius2 = isOriginal ? ORIGINAL_CURSOR_RADIUS : CURSOR_RADIUS;
        const targetScale = cursorRadius2 / START_CIRCLE_RADIUS;
        const scale = previewAnim.startCircleScale * targetScale;
        const disc = new THREE.Mesh(
            new THREE.CylinderGeometry(START_CIRCLE_RADIUS, START_CIRCLE_RADIUS, 0.05, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false })
        );
        disc.position.set(fWorld.x, helperY, fWorld.z);
        disc.scale.set(scale, 1, scale);
        disc.renderOrder = 5;
        previewScene.add(disc);
        previewOverlayObjects.push(disc);
    }
}

function renderPreview3DFrame() {
    if (!previewScene) return;

    const isOriginal = originalParadigm;
    const dims = getGridDimensionsFromUI();
    const cols = dims.width;
    const rows = dims.height;
    const gStyle = getGridStyleFromUI();
    const showLines = document.getElementById('toggle-grid-lines').checked;
    const showLabels = document.getElementById('toggle-direction-labels').checked;

    const sig = [isOriginal, cols, rows, gStyle, showLines, showLabels].join('|');
    if (sig !== previewStaticSignature) {
        previewStaticSignature = sig;
        rebuildPreviewGrid();
    }

    updatePreviewCameraAspect();
    updatePreviewOverlay();
}

function renderPreview(forceOriginal = false) {
    const isOriginal = forceOriginal || originalParadigm;
    const cameraModeRadio = document.querySelector('input[name="camera-mode"]:checked')?.value || '2d';
    const use3D = (cameraModeRadio === '3d' && !isOriginal);
    
    const container = document.querySelector('.preview-frame');
    if (!container) return;
    
    const canvas2d = document.getElementById('preview-canvas');
    if (!use3D) {
        if (previewRenderer) {
            previewRenderer.domElement.style.display = 'none';
        }
        if (canvas2d) {
            canvas2d.style.display = 'block';
            const rect = container.getBoundingClientRect();
            const w = rect.width || 300;
            const h = rect.height || 300;
            canvas2d.width = w;
            canvas2d.height = h;
            canvas2d.style.width = w + 'px';
            canvas2d.style.height = h + 'px';
            const ctx = canvas2d.getContext('2d');
            renderPreview2D(ctx, w, h);
        }
    } else {
        if (canvas2d) canvas2d.style.display = 'none';
        if (!previewRenderer) {
            initPreviewScene();
        } else {
            previewRenderer.domElement.style.display = 'block';
        }
        renderPreview3DFrame();
    }
}

function updateTimingDisplay() {
    const waitVal = parseFloat(document.getElementById('wait-duration').value) || 0;
    const waitMs = document.getElementById('wait-duration-ms');
    if (waitMs) waitMs.textContent = Math.round(waitVal * 1000);

    const moveVal = parseFloat(document.getElementById('move-animation-duration').value) || 0;
    const moveMs = document.getElementById('move-animation-ms');
    if (moveMs) moveMs.textContent = Math.round(moveVal * 1000);

    const startVal = parseFloat(document.getElementById('start-circle-duration').value) || 0;
    const startMs = document.getElementById('start-circle-ms');
    if (startMs) startMs.textContent = Math.round(startVal * 1000);
}

function setupPreviewListeners() {
    const liveControls = [
        '#toggle-node-grid',
        '#toggle-box-grid',
        '#toggle-grid-lines',
        '#toggle-direction-labels',
        '#toggle-snap-movement',
        '#toggle-white-line',
        '#toggle-start-circle',
        'input[name="cursor-style"]',
        'input[name="goal-design"]',
        'input[name="camera-mode"]',
        '#wait-duration',
        '#move-animation-duration',
        '#start-circle-duration'
    ];

    const restartControls = [
        '#grid-width-input',
        '#grid-height-input'
    ];

    liveControls.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            const handler = () => {
                renderPreview(false);
                updateTimingDisplay();
            };
            el.addEventListener('input', handler);
            el.addEventListener('change', handler);
        });
    });

    restartControls.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            const handler = () => {
                restartPreviewAnimation();
                updateTimingDisplay();
            };
            el.addEventListener('input', handler);
            el.addEventListener('change', handler);
        });
    });

    window.addEventListener('resize', () => {
        renderPreview(false);
    });
}

// ============================================================================
// SECTION 3: WHITE PULSE OVERLAY
// ============================================================================

function ensureWhitePulseOverlay() {
    if (DOM.whitePulseOverlay) return;
    const overlay = document.createElement('div');
    overlay.id = 'white-pulse-overlay';
    overlay.style.cssText = `
        position: fixed;
        bottom: 0.5cm;
        left: 0.5cm;
        width: 1cm;
        height: 1cm;
        border-radius: 6px;
        z-index: 1001;
        pointer-events: none;
        background-color: white;
        opacity: 0;
        transition: opacity 0s linear;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(overlay);
    DOM.whitePulseOverlay = overlay;
}

function showWhitePulsePersistent() {
    ensureWhitePulseOverlay();
    DOM.whitePulseOverlay.style.opacity = '0.9';
}

function hideWhitePulse() {
    if (DOM.whitePulseOverlay) {
        DOM.whitePulseOverlay.style.opacity = '0';
    }
}

// ============================================================================
// SECTION 4: LSL BRIDGE
// ============================================================================

let lslWebSocket = null;
let isLSLConnected = false;
let wsReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function initializeLSLBridge() {
    const wsUrl = 'ws://localhost:8765';
    console.log('🔌 Connecting to LSL Bridge at:', wsUrl);
    lslWebSocket = new WebSocket(wsUrl);
    lslWebSocket.onopen = () => {
        console.log('✅ Connected to LSL Bridge');
        isLSLConnected = true;
        wsReconnectAttempts = 0;
        if (hudVisible) updateLSLStatus(true);
        showFeedback('LSL Bridge Connected');
        setTimeout(() => hideFeedback(), 2000);
    };
    lslWebSocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.status === 'received') console.log('📬 LSL Bridge acknowledged');
        } catch(e) { console.log('LSL message:', event.data); }
    };
    lslWebSocket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        isLSLConnected = false;
        if (hudVisible) updateLSLStatus(false);
    };
    lslWebSocket.onclose = () => {
        console.log('⚠️ WebSocket connection closed');
        isLSLConnected = false;
        if (hudVisible) updateLSLStatus(false);
        if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            wsReconnectAttempts++;
            console.log(`↻ Reconnecting in 3s... (${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(() => initializeLSLBridge(), 3000);
        } else {
            console.error('❌ Max reconnection attempts reached.');
            showFeedback('LSL Bridge disconnected. Check Python server.');
            setTimeout(() => hideFeedback(), 3000);
        }
    };
}

function updateLSLStatus(connected) {
    if (DOM.lslStatus && DOM.lslStatusText) {
        if (connected) {
            DOM.lslStatus.classList.add('connected');
            DOM.lslStatusText.textContent = 'Connected';
            DOM.lslStatusText.style.color = '#10b981';
        } else {
            DOM.lslStatus.classList.remove('connected');
            DOM.lslStatusText.textContent = 'Disconnected';
            DOM.lslStatusText.style.color = '#ef4444';
        }
        if (!hudVisible || gameState !== 'playing') DOM.lslStatus.classList.add('hidden');
        else DOM.lslStatus.classList.remove('hidden');
    }
}

function sendMarkersToLSL(label, cls1, cls2, classifyNow = null, button = null, predict = null) {
    if (!markerPushing) return false;

    if (!lslWebSocket || lslWebSocket.readyState !== WebSocket.OPEN) return false;

    const data = {
        phase: phase,
        jump: jumpCounter,
        gridSize: `${gridWidth}x${gridHeight}`,
        target: `${targetPos.x},${targetPos.y}`,
        position: `${currentPos.x},${currentPos.y}`,
        timestamp: Date.now()
    };

    if (sendLabel && label) data.label = label;
    if (sendCls1 && cls1) data.cls1 = cls1;
    if (sendCls2 && cls2) data.cls2 = cls2;
    if (sendCls1 && classifyNow) data.classifyNow = classifyNow;
    if (sendButton && button) data.button = button;
    if (sendPredict && predict) data.predict = predict;

    if (Object.keys(data).length <= 6) {
        console.warn('⚠️ No marker types enabled – nothing sent.');
        return false;
    }

    try {
        lslWebSocket.send(JSON.stringify(data));
        console.log(`📤 LSL: Jump ${jumpCounter}, ${phase} | label: ${label || 'off'} | cls1: ${cls1 || 'off'} | cls2: ${cls2 || 'off'} | button: ${button || 'off'} | predict: ${predict || 'off'}`);
        return true;
    } catch(e) {
        console.error('LSL send error:', e);
        return false;
    }
}

function sendExperimentEventToLSL(eventType) {
    if (!isLSLConnected || !markerPushing || !sendLabel) return;
    const data = {
        label: eventType,
        phase: 'event',
        jump: jumpCounter,
        gridSize: `${gridWidth}x${gridHeight}`,
        timestamp: Date.now(),
        event: eventType
    };
    if (lslWebSocket && lslWebSocket.readyState === WebSocket.OPEN) {
        try {
            lslWebSocket.send(JSON.stringify(data));
            console.log(`📤 LSL Event: ${eventType}`);
        } catch(e) { console.error('Event send error:', e); }
    }
}

// ============================================================================
// SECTION 5: REUSABLE VISUAL OBJECTS
// ============================================================================

function getHelperY() {
    return originalParadigm ? 0.05 : 0.35;
}

function initReusableVisuals() {
    if (!reusableLine) {
        const lineRadius = originalParadigm ? DIRECTION_LINE_RADIUS_ORIG : DIRECTION_LINE_RADIUS;
        const lineMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: originalParadigm ? 1.0 : 0.9,
            transparent: false,
            depthTest: true,
            depthWrite: true
        });
        const defaultCurve = new THREE.LineCurve3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(1, 0, 0)
        );
        const tubeGeo = new THREE.TubeGeometry(defaultCurve, 20, lineRadius, 8, false);
        reusableLine = new THREE.Mesh(tubeGeo, lineMat);
        reusableLine.renderOrder = 2;
        reusableLine.visible = false;
        scene.add(reusableLine);
    }

    if (!reusableDisc) {
        const discRadius = originalParadigm ? DESTINATION_DISC_RADIUS_ORIG : DESTINATION_DISC_RADIUS;
        const ringRadius = originalParadigm ? DESTINATION_RING_RADIUS_ORIG : DESTINATION_RING_RADIUS;

        const discGeo = new THREE.CylinderGeometry(discRadius, discRadius, 0.05, 32);
        const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: false });
        reusableDisc = new THREE.Mesh(discGeo, discMat);
        reusableDisc.renderOrder = 2;
        reusableDisc.visible = false;
        scene.add(reusableDisc);

        const ringGeo = new THREE.RingGeometry(ringRadius - 0.05, ringRadius, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: false });
        reusableRing = new THREE.Mesh(ringGeo, ringMat);
        reusableRing.renderOrder = 2;
        reusableRing.rotation.x = -Math.PI / 2;
        reusableRing.visible = false;
        scene.add(reusableRing);
    }

    if (!reusableStartDisc) {
        const discGeo = new THREE.CylinderGeometry(START_CIRCLE_RADIUS, START_CIRCLE_RADIUS, 0.05, 32);
        const discMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: false,
            depthTest: false,
            depthWrite: false
        });
        reusableStartDisc = new THREE.Mesh(discGeo, discMat);
        reusableStartDisc.renderOrder = 5;
        reusableStartDisc.visible = false;
        reusableStartDisc.scale.set(0, 1, 0);
        scene.add(reusableStartDisc);
    }
}

function updateReusableLine(fromPos, toPos) {
    if (!reusableLine) return;
    const spacing = 2;
    const startX = ((fromPos.x - 1) - gridWidth/2 + 0.5) * spacing;
    const startZ = ((fromPos.y - 1) - gridHeight/2 + 0.5) * spacing;
    const endX = ((toPos.x - 1) - gridWidth/2 + 0.5) * spacing;
    const endZ = ((toPos.y - 1) - gridHeight/2 + 0.5) * spacing;
    const y = getHelperY();
    const startVec = new THREE.Vector3(startX, y, startZ);
    const endVec = new THREE.Vector3(endX, y, endZ);
    const curve = new THREE.LineCurve3(startVec, endVec);
    reusableLine.geometry.dispose();
    const lineRadius = originalParadigm ? DIRECTION_LINE_RADIUS_ORIG : DIRECTION_LINE_RADIUS;
    reusableLine.geometry = new THREE.TubeGeometry(curve, 20, lineRadius, 8, false);
    reusableLine.visible = showWhiteLine;
}

function updateReusableDestination(toPos) {
    if (!reusableDisc || !reusableRing) return;
    const spacing = 2;
    const x = ((toPos.x - 1) - gridWidth/2 + 0.5) * spacing;
    const z = ((toPos.y - 1) - gridHeight/2 + 0.5) * spacing;
    const y = getHelperY();
    reusableDisc.position.set(x, y, z);
    reusableDisc.scale.set(1, 1, 1);
    reusableDisc.visible = showWhiteLine;
    reusableRing.position.set(x, y + 0.01, z);
    reusableRing.scale.set(1, 1, 1);
    reusableRing.visible = showWhiteLine;
}

function showStartCircleAt(fromPos) {
    if (!reusableStartDisc) return;
    const spacing = 2;
    const x = ((fromPos.x - 1) - gridWidth/2 + 0.5) * spacing;
    const z = ((fromPos.y - 1) - gridHeight/2 + 0.5) * spacing;
    const y = getHelperY();
    reusableStartDisc.position.set(x, y, z);
    reusableStartDisc.scale.set(0, 1, 0);
    reusableStartDisc.visible = true;
}

function animateStartCircle(onComplete) {
    if (!reusableStartDisc) {
        if (onComplete) onComplete();
        return;
    }

    let cursorRadius = originalParadigm ? ORIGINAL_CURSOR_RADIUS : CURSOR_RADIUS;
    const COVER_MULTIPLIER = 1.0;
    let targetScale = (cursorRadius * COVER_MULTIPLIER) / START_CIRCLE_RADIUS;

    const startTime = performance.now();
    const duration = START_CIRCLE_SCALE_DURATION;

    function step() {
        const elapsed = performance.now() - startTime;
        let t = Math.min(elapsed / duration, 1);
        const scale = t * targetScale;
        reusableStartDisc.scale.set(scale, 1, scale);

        if (t < 1) {
            startCircleAnimId = requestAnimationFrame(step);
        } else {
            reusableStartDisc.scale.set(targetScale, 1, targetScale);
            setTimeout(() => {
                hideStartCircle();
                if (onComplete) onComplete();
            }, 100);
        }
    }
    step();
}

function hideStartCircle() {
    if (reusableStartDisc) {
        reusableStartDisc.visible = false;
        reusableStartDisc.scale.set(0, 1, 0);
    }
    if (startCircleAnimId) {
        cancelAnimationFrame(startCircleAnimId);
        startCircleAnimId = null;
    }
}

function hideReusableVisuals() {
    if (reusableLine) reusableLine.visible = false;
    if (reusableDisc) reusableDisc.visible = false;
    if (reusableRing) reusableRing.visible = false;
    hideStartCircle();
}

// ============================================================================
// SECTION 6: MOVEMENT PIPELINE
// ============================================================================

function getValidDirections() {
    const valid = [];
    for (const [key, d] of Object.entries(directions)) {
        const nx = currentPos.x + d.x;
        const ny = currentPos.y + d.y;
        if (nx >= 1 && nx <= gridWidth && ny >= 1 && ny <= gridHeight) {
            valid.push(key);
        }
    }
    return valid;
}

function prepareMove() {
    if (animating || waitingForResponse || !robotModel || isWaiting || isPreMoveAnimating) return false;

    const cfg = getCurrentPhaseConfig();
    if (!cfg) return false;
    if (cfg.type === 'calibration' && totalJumps >= cfg.jumps) {
        nextPhase();
        return false;
    }

    const validDirs = getValidDirections();
    if (validDirs.length === 0) {
        console.warn('No valid moves available. Resetting grid.');
        resetGrid();
        return false;
    }

    const dir = selectDirection(validDirs);
    const d = directions[dir];
    const newPos = { x: currentPos.x + d.x, y: currentPos.y + d.y };

    const angle = calculateAngleToGoal(currentPos, newPos);
    const cls = classifyAngle(angle);

    jumpCounter++;
    const marker = createJumpMarker(currentPos, newPos, dir, cls, angle);

    const spacing = 2;
    const sx = ((currentPos.x - 1) - gridWidth/2 + 0.5) * spacing;
    const sz = ((currentPos.y - 1) - gridHeight/2 + 0.5) * spacing;
    const ex = ((newPos.x - 1) - gridWidth/2 + 0.5) * spacing;
    const ez = ((newPos.y - 1) - gridHeight/2 + 0.5) * spacing;

    let targetRot = (() => {
        switch(dir) {
            case 'N': return 0;
            case 'NE': return Math.PI/4;
            case 'E': return Math.PI/2;
            case 'SE': return 3*Math.PI/4;
            case 'S': return Math.PI;
            case 'SW': return -3*Math.PI/4;
            case 'W': return -Math.PI/2;
            case 'NW': return -Math.PI/4;
            default: return 0;
        }
    })();
    targetRot += Math.PI;

    lastMoveDirection = dir;

    pendingMove = {
        from: { x: currentPos.x, y: currentPos.y },
        to: { x: newPos.x, y: newPos.y },
        dir: dir,
        cls: cls,
        marker: marker,
        angle: angle,
        sx: sx, sz: sz,
        ex: ex, ez: ez,
        targetRot: targetRot,
        startRot: robotModel.rotation.y,
        startTime: 0
    };

    return true;
}

function executeMove() {
    if (!pendingMove) return;
    const pm = pendingMove;

    const performMove = () => {
        pm.startTime = performance.now();
        showWhitePulsePersistent();

        let predict = sendPredict ? predictValue : null;

        sendMarkersToLSL(pm.marker, null, null, null, null, predict);
        if (sendCls1) {
            sendMarkersToLSL(null, pm.cls.cls1, null);
            if (phase === 'bci') {
                sendMarkersToLSL(null, null, null, 'classifyNow');
            }
        }
        if (sendCls2) {
            sendMarkersToLSL(null, null, pm.cls.cls2);
        }
        sendEventMarker(pm.marker);

        updateReusableLine(pm.from, pm.to);
        updateReusableDestination(pm.to);

        robotModel.rotation.y = pm.targetRot;
        animating = true;
        pm.startTime = performance.now();

        animateRobotMoveOptimized(pm, () => {
            if (snapMovement) {
                setTimeout(() => hideWhitePulse(), 150);
            } else {
                hideWhitePulse();
            }

            if (reusableLine) reusableLine.visible = false;
            if (reusableDisc) reusableDisc.visible = false;
            if (reusableRing) reusableRing.visible = false;

            currentPos = { x: pm.to.x, y: pm.to.y };
            moveCount++;
            totalJumps++;
            animating = false;
            pendingMove = null;
            updateStats();

            if (currentPos.x === targetPos.x && currentPos.y === targetPos.y) {
                handleTargetReached();
                return;
            }
            if (moveCount >= maxMovesPerTarget) {
                handleMaxMovesReached();
                return;
            }
            startWaitPeriod();
        });
    };

    if (showStartCircle) {
        showStartCircleAt(pm.from);
        animateStartCircle(performMove);
    } else {
        performMove();
    }
}

function animateRobotMoveOptimized(pm, onComplete) {
    let yPos;
    if (originalParadigm) {
        yPos = 0.05;
    } else if (cursorStyle === '2d') {
        yPos = CURSOR_2D_Y;
    } else {
        yPos = 0.7;
    }

    if (snapMovement) {
        const ex = pm.ex, ez = pm.ez;
        setTimeout(() => {
            robotModel.position.set(ex, yPos, ez);
            if (onComplete) onComplete();
        }, MOVE_ANIMATION_DURATION);
        return;
    }

    const start = pm.startTime;
    const duration = MOVE_ANIMATION_DURATION;
    const sx = pm.sx, sz = pm.sz;
    const ex = pm.ex, ez = pm.ez;

    function step() {
        const elapsed = performance.now() - start;
        let t = Math.min(elapsed / duration, 1);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

        robotModel.position.x = sx + (ex - sx) * ease;
        robotModel.position.z = sz + (ez - sz) * ease;
        if (!originalParadigm && (cursorStyle === '3d' || cursorStyle === 'robot')) {
            robotModel.position.y = yPos + Math.sin(t * Math.PI * 2) * 0.1;
        } else {
            robotModel.position.y = yPos;
        }

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            robotModel.position.x = ex;
            robotModel.position.z = ez;
            robotModel.position.y = yPos;
            if (onComplete) onComplete();
        }
    }
    step();
}

// ============================================================================
// SECTION 7: UTILITY FUNCTIONS
// ============================================================================

function initUserModel() {
    const model = {};
    Object.keys(directions).forEach(dir => { model[dir] = 1 / Object.keys(directions).length; });
    setTimeout(() => updateModelDisplay(), 100);
    return model;
}

function selectDirection(validDirs) {
    if (!validDirs || validDirs.length === 0) validDirs = Object.keys(directions);
    const cfg = getCurrentPhaseConfig();
    if (!cfg) return validDirs[0];
    if (cfg.type === 'calibration') {
        return validDirs[Math.floor(Math.random() * validDirs.length)];
    } else {
        let total = 0;
        for (const d of validDirs) {
            total += userModel[d] || 0;
        }
        if (total === 0) return validDirs[Math.floor(Math.random() * validDirs.length)];
        let r = Math.random() * total;
        let cum = 0;
        for (const d of validDirs) {
            cum += userModel[d] || 0;
            if (r <= cum) return d;
        }
        return validDirs[validDirs.length - 1];
    }
}

function calculateAngleToGoal(from, to) {
    const jump = { x: to.x - from.x, y: to.y - from.y };
    const goal = { x: targetPos.x - from.x, y: targetPos.y - from.y };
    const dot = jump.x * goal.x + jump.y * goal.y;
    const magJ = Math.hypot(jump.x, jump.y);
    const magG = Math.hypot(goal.x, goal.y);
    if (magJ === 0 || magG === 0) return 0;
    const cos = dot / (magJ * magG);
    return Math.round(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI);
}

function classifyAngle(angle) {
    let cls1 = (angle < 45) ? 'toward' : (angle > 100) ? 'away' : 'sideways';
    let cls2 = (angle < 1) ? 'very good' : (angle > 135) ? 'very bad' : 'neutral';
    return { cls1, cls2 };
}

function createJumpMarker(from, to, dir, cls, angle) {
    return `${gridWidth}x${gridHeight};g${targetPos.x}${targetPos.y};j${String(jumpCounter).padStart(3,'0')}:${from.x}${from.y}>${to.x}${to.y};ang${String(angle).padStart(3,'0')};cls1:${cls.cls1};cls2:${cls.cls2};phase:${phase}`;
}

function sendEventMarker(marker) {
    const ts = new Date().toISOString();
    const full = `[${ts}] ${marker}`;
    eventMarkers.push(full);
    if (DOM.eventMarkersDisplay) {
        DOM.eventMarkersDisplay.value = eventMarkers.slice(-50).join('\n');
        DOM.eventMarkersDisplay.scrollTop = DOM.eventMarkersDisplay.scrollHeight;
    }
    console.log('EVENT:', full);
    return full;
}

// ============================================================================
// SECTION 8: PHASE MANAGEMENT
// ============================================================================

function filterExperimentStructure() {
    switch(selectedCondition) {
        case 'calibration': return experimentStructure.filter(p => p.type === 'calibration');
        case 'bci': return experimentStructure.filter(p => p.type === 'bci');
        case 'manual': return experimentStructure.filter(p => p.type === 'manual');
        default: return experimentStructure.filter(p => p.type === 'calibration' || p.type === 'bci');
    }
}

function getCurrentPhaseConfig() {
    if (currentPhaseIndex < filteredExperimentStructure.length)
        return filteredExperimentStructure[currentPhaseIndex];
    return null;
}

function isPhaseComplete() {
    const cfg = getCurrentPhaseConfig();
    if (!cfg) return true;
    return cfg.type === 'calibration' ? totalJumps >= cfg.jumps : targetsReached >= cfg.targets;
}

function showPhaseTransition() {
    const cfg = getCurrentPhaseConfig();
    const nextIdx = currentPhaseIndex + 1;
    let msg = `Current phase (${cfg.description}) completed successfully.`;
    if (nextIdx < filteredExperimentStructure.length) {
        msg += ` Ready to start ${filteredExperimentStructure[nextIdx].description}.`;
    } else {
        msg += " Experiment complete!";
    }
    const screen = document.createElement('div');
    screen.id = 'phase-transition-screen';
    screen.className = 'phase-transition-screen';
    screen.innerHTML = `
        <div class="transition-content">
            <h2>Phase Complete</h2>
            <p id="transition-message">${msg}</p>
            <div class="spacebar-instruction">
                Press <kbd>SPACEBAR</kbd> to start the next phase
            </div>
        </div>
    `;
    DOM.container.appendChild(screen);
    updateGraySquare('intro');
    function onSpace(e) {
        if (e.code === 'Space') {
            screen.remove();
            window.removeEventListener('keydown', onSpace);
            proceedToNextPhase();
        }
    }
    window.addEventListener('keydown', onSpace);
}

function proceedToNextPhase() {
    hideFeedback();
    const cur = getCurrentPhaseConfig();
    if (cur) {
        sendEventMarker(`phase_end:${cur.phase}`);
        sendExperimentEventToLSL(`phase_end_${cur.phase}`);
    }
    currentPhaseIndex++;
    targetsReached = 0;
    moveCount = 0;
    breakCount = 0;
    userModel = initUserModel();
    if (currentPhaseIndex >= filteredExperimentStructure.length) {
        sendEventMarker('experiment_end');
        sendExperimentEventToLSL('experiment_end');
        showFinalCompletion();
        return;
    }
    const cfg = getCurrentPhaseConfig();
    phase = cfg.phase;
    updateGraySquare(cfg.phase);
    sendEventMarker(`phase_start:${cfg.phase}`);
    sendExperimentEventToLSL(`phase_start_${cfg.phase}`);
    if (hudVisible) DOM.modelPanel.classList.remove('hidden');
    else DOM.modelPanel.classList.add('hidden');
    updateStats();
    updateControlsPanel();
    showFeedback(`Starting ${cfg.description}...`);
    setTimeout(() => hideFeedback(), 2000);
    resetGrid();
}

function nextPhase() {
    hideFeedback();
    showPhaseTransition();
}

function showFinalCompletion() {
    hideFeedback();
    const ov = document.createElement('div');
    ov.id = 'completion-overlay';
    ov.className = 'phase-transition-screen';
    ov.style.zIndex = '200';
    ov.innerHTML = `
        <div class="transition-content">
            <h2>🎉 Experiment Complete! 🎉</h2>
            <p style="font-size:1.2rem; margin:1.5rem 0;"><strong>Amazing work!</strong> You've helped advance neuroadaptive technology!</p>
            <div style="margin:2rem 0; padding:1.5rem; background:rgba(99,179,237,0.1); border-radius:8px;">
                <p style="color:#63b3ed;"><strong>Fun Fact:</strong> Your brain signals could one day control devices without you even thinking about it!</p>
            </div>
            <div class="spacebar-instruction" style="margin-top:2rem; padding:1rem; background:#3182ce;">
                Press <kbd style="background:#2c5aa0; padding:0.3rem 0.8rem;">SPACEBAR</kbd> to return to the main page
            </div>
            <p style="margin-top:1rem;">Or wait for the countdown: <span id="countdown-timer">30</span> seconds</p>
        </div>
    `;
    DOM.container.appendChild(ov);
    let count = 30;
    const cd = document.getElementById('countdown-timer');
    let interval = setInterval(() => {
        count--;
        if (cd) cd.textContent = count;
        if (count <= 10) cd.style.color = '#ff6b6b';
        if (count === 0) {
            clearInterval(interval);
            finish();
        }
    }, 1000);
    function finish() {
        if (ov.parentNode) ov.remove();
        window.removeEventListener('keydown', listener);
        if (isSequenceRunning) {
            seqIndex++;
            runNextProfile();
        } else {
            returnToStartScreen();
        }
    }
    function listener(e) {
        if (e.code === 'Space') {
            clearInterval(interval);
            finish();
        }
    }
    window.addEventListener('keydown', listener);
}

// ============================================================================
// SECTION 9: RETURN TO START SCREEN & CLEANUP
// ============================================================================

function cleanupExperiment() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    hideReusableVisuals();
    hideWhitePulse();
    hideHUD();
    toggleGridNumbers();
    if (renderer && scene) {
        const cont = document.getElementById('canvas-container');
        if (cont.contains(renderer.domElement)) cont.removeChild(renderer.domElement);
        scene = null; camera = null; renderer = null; robotModel = null; targetMarker = null;
        gridCells = []; cellPlatforms = []; cellBorders = []; gridLabels = [];
        mixer = null;
    }

    reusableLine = null;
    reusableDisc = null;
    reusableRing = null;
    reusableStartDisc = null;
    if (startCircleAnimId) {
        cancelAnimationFrame(startCircleAnimId);
        startCircleAnimId = null;
    }

    currentPos = { x: 1, y: 1 };
    targetPos = { x: gridWidth, y: gridHeight };
    moveCount = 0;
    totalJumps = 0;
    targetsReached = 0;
    jumpCounter = 0;
    breakCount = 0;
    animating = false;
    isWaiting = false;
    waitingForResponse = false;
    pendingMove = null;
    lastMoveDirection = null;
    eventMarkers = [];
    userModel = initUserModel();
    if (DOM.eventMarkersDisplay) DOM.eventMarkersDisplay.value = '';
    hideFeedback();
    updateStats();
    updateModelDisplay();
}

function returnToStartScreen() {
    cleanupExperiment();
    DOM.introScreen.classList.remove('hidden');
    updateGraySquare('intro');
    gameState = 'intro';
    hudVisible = false;
    gridNumbersVisible = false;
    if (DOM.sequenceProgress) DOM.sequenceProgress.textContent = '';
    if (DOM.sequenceStatus) DOM.sequenceStatus.textContent = '';
    isSequenceRunning = false;
    sequence = [];
    updateSequenceUI();
    console.log('Returned to start screen');

    stopPreviewAnimation();
    if (previewRenderer) {
        previewRenderer.dispose();
        previewRenderer = null;
    }
    previewScene = null;
    previewCamera = null;
    previewGridObjects = [];
    previewOverlayObjects = [];
    previewStaticSignature = null;

    previewAnim.active = false;
    previewAnim.rafId = null;
    previewAnim.current = null;
    previewAnim.phaseStart = 0;
    previewAnim.valid = true;
    previewAnim.moveProgress = 0;
    previewAnim.startCircleScale = 0;
    previewAnim.showLineAndDest = false;

    restartPreviewAnimation();
    setTimeout(() => {
        renderPreview(false);
        updateTimingDisplay();
    }, 50);
}

function resetExperimentState() {
    cleanupExperiment();
    gameState = 'intro';
    hudVisible = false;
    gridNumbersVisible = false;
}

// ============================================================================
// SECTION 9.5: SEQUENCE RUNNER
// ============================================================================

let sequence = [];
let isSequenceRunning = false;
let seqIndex = 0;

function populateSequenceDropdown() {
    const sel = DOM.sequenceProfileSelect;
    if (!sel) return;
    const profiles = getProfiles();
    const names = Object.keys(profiles);
    sel.innerHTML = '<option value="">-- Select a profile --</option>';
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
}

// Update the single main button text based on sequence length
function updateMainButtonText() {
    const btn = document.getElementById('main-action-button');
    if (!btn) return;
    if (sequence.length > 0) {
        btn.textContent = `▶ Run Sequence (${sequence.length} profiles)`;
    } else {
        btn.textContent = '▶ Start Experiment';
    }
}

function updateSequenceUI() {
    const list = DOM.sequenceList;
    if (!list) return;
    if (sequence.length === 0) {
        list.innerHTML = '<span style="color:#718096; font-size:0.8rem;">No profiles in sequence.</span>';
    } else {
        list.innerHTML = sequence.map((name, idx) => 
            `<span style="display:inline-block; background:#2d3748; padding:0.2rem 0.8rem; border-radius:12px; margin:0.2rem; font-size:0.8rem; display:inline-flex; align-items:center; gap:0.3rem;">
                ${idx+1}. ${name}
                <button class="seq-remove-btn" data-index="${idx}" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:0 0.2rem; font-size:1rem;">✕</button>
            </span>`
        ).join('');
        list.querySelectorAll('.seq-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                sequence.splice(idx, 1);
                updateSequenceUI();
                updateMainButtonText();
                if (DOM.sequenceStatus) DOM.sequenceStatus.textContent = '';
            });
        });
    }
    updateMainButtonText();
}

function runNextProfile() {
    if (seqIndex >= sequence.length) {
        isSequenceRunning = false;
        if (DOM.sequenceStatus) DOM.sequenceStatus.textContent = '✅ Sequence Complete!';
        if (DOM.sequenceProgress) DOM.sequenceProgress.textContent = '';
        showSequenceCompleteMessage();
        return;
    }
    const profileName = sequence[seqIndex];
    const profiles = getProfiles();
    const settings = profiles[profileName];
    if (!settings) {
        console.error(`Profile "${profileName}" not found. Skipping.`);
        seqIndex++;
        runNextProfile();
        return;
    }
    applySettingsToUI(settings);
    resetExperimentState();
    if (DOM.sequenceProgress) {
        DOM.sequenceProgress.textContent = `🔁 Profile ${seqIndex+1}/${sequence.length}: "${profileName}"`;
    }
    if (DOM.sequenceStatus) {
        DOM.sequenceStatus.textContent = `▶ Running: ${profileName} (${seqIndex+1}/${sequence.length})`;
    }
    gameState = 'playing';
    startExperiment();
}

function showSequenceCompleteMessage() {
    const ov = document.createElement('div');
    ov.id = 'sequence-complete-overlay';
    ov.className = 'phase-transition-screen';
    ov.style.zIndex = '200';
    ov.innerHTML = `
        <div class="transition-content">
            <h2>🎉 All Profiles in Sequence Completed! 🎉</h2>
            <p style="font-size:1.2rem; margin:1.5rem 0;">You've successfully run <strong>${sequence.length}</strong> profile(s).</p>
            <div class="spacebar-instruction" style="margin-top:2rem; padding:1rem; background:#3182ce;">
                Press <kbd style="background:#2c5aa0; padding:0.3rem 0.8rem;">SPACEBAR</kbd> to return to the main page
            </div>
        </div>
    `;
    DOM.container.appendChild(ov);
    function onSpace(e) {
        if (e.code === 'Space') {
            ov.remove();
            window.removeEventListener('keydown', onSpace);
            returnToStartScreen();
        }
    }
    window.addEventListener('keydown', onSpace);
}

// ===== SEQUENCE MANAGEMENT =====

const SEQUENCE_STORAGE_KEY = 'neurocursor_sequences';

function getSequences() {
    try {
        const raw = localStorage.getItem(SEQUENCE_STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch (e) {
        console.warn('Failed to parse sequences:', e);
        return {};
    }
}

function saveSequencesToStorage(sequences) {
    localStorage.setItem(SEQUENCE_STORAGE_KEY, JSON.stringify(sequences));
}

function populateSequenceLoadDropdown() {
    const dropdown = document.getElementById('load-sequence-dropdown');
    if (!dropdown) return;
    const sequences = getSequences();
    const names = Object.keys(sequences);
    dropdown.innerHTML = '';
    if (names.length === 0) {
        dropdown.innerHTML = '<option value="">-- No sequences saved --</option>';
        return;
    }
    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        dropdown.appendChild(opt);
    });
}

function setSeqManagementStatus(msg, isError = false) {
    const el = document.getElementById('sequence-management-status');
    if (el) {
        el.textContent = msg;
        el.style.color = isError ? '#f87171' : '#a0aec0';
        setTimeout(() => {
            if (el.textContent === msg) el.textContent = '';
        }, 4000);
    }
}

function saveCurrentSequence() {
    const nameInput = document.getElementById('seq-name-input');
    const name = nameInput.value.trim();
    if (!name) {
        setSeqManagementStatus('⚠️ Please enter a sequence name.', true);
        return;
    }
    if (sequence.length === 0) {
        setSeqManagementStatus('⚠️ Sequence is empty. Add at least one profile.', true);
        return;
    }
    const sequences = getSequences();
    if (sequences[name] && !confirm(`Sequence "${name}" already exists. Overwrite?`)) {
        setSeqManagementStatus('Save cancelled.', false);
        return;
    }
    sequences[name] = [...sequence];
    saveSequencesToStorage(sequences);
    populateSequenceLoadDropdown();
    setSeqManagementStatus(`✅ Sequence "${name}" saved with ${sequence.length} profile(s).`);
    nameInput.value = '';
}

function loadSelectedSequence() {
    const dropdown = document.getElementById('load-sequence-dropdown');
    const name = dropdown.value;
    if (!name) {
        setSeqManagementStatus('⚠️ Please select a sequence to load.', true);
        return;
    }
    const sequences = getSequences();
    const seq = sequences[name];
    if (!seq) {
        setSeqManagementStatus(`❌ Sequence "${name}" not found.`, true);
        populateSequenceLoadDropdown();
        return;
    }
    // Clear current sequence
    sequence.length = 0;
    seq.forEach(p => sequence.push(p));
    updateSequenceUI();
    updateMainButtonText();
    setSeqManagementStatus(`📂 Sequence "${name}" loaded (${seq.length} profiles).`);
    if (document.getElementById('sequence-status')) {
        document.getElementById('sequence-status').textContent = '';
    }
}

function deleteSelectedSequence() {
    const dropdown = document.getElementById('load-sequence-dropdown');
    const name = dropdown.value;
    if (!name) {
        setSeqManagementStatus('⚠️ Please select a sequence to delete.', true);
        return;
    }
    if (!confirm(`Are you sure you want to delete sequence "${name}"?`)) {
        setSeqManagementStatus('Deletion cancelled.', false);
        return;
    }
    const sequences = getSequences();
    delete sequences[name];
    saveSequencesToStorage(sequences);
    populateSequenceLoadDropdown();
    setSeqManagementStatus(`🗑️ Sequence "${name}" deleted.`);
}

function exportSequences() {
    const sequences = getSequences();
    const names = Object.keys(sequences);
    if (names.length === 0) {
        setSeqManagementStatus('⚠️ No sequences to export.', true);
        return;
    }
    const json = JSON.stringify(sequences, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neurocursor_sequences_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSeqManagementStatus(`✅ Exported ${names.length} sequence(s).`);
}

function importSequences() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();

    input.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) {
            document.body.removeChild(input);
            return;
        }
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const imported = JSON.parse(ev.target.result);
                if (typeof imported !== 'object' || imported === null) {
                    throw new Error('Invalid JSON: expected an object.');
                }
                // Validate that each value is an array of strings (profile names)
                for (const [name, list] of Object.entries(imported)) {
                    if (!Array.isArray(list) || !list.every(item => typeof item === 'string')) {
                        throw new Error(`Sequence "${name}" is not an array of strings.`);
                    }
                }
                const current = getSequences();
                const overlap = Object.keys(imported).filter(n => current.hasOwnProperty(n));
                let proceed = true;
                if (overlap.length > 0) {
                    proceed = confirm(`The following sequences already exist: ${overlap.join(', ')}. Overwrite them?`);
                }
                if (!proceed) {
                    setSeqManagementStatus('Import cancelled.', false);
                    document.body.removeChild(input);
                    return;
                }
                const merged = { ...current, ...imported };
                saveSequencesToStorage(merged);
                populateSequenceLoadDropdown();
                setSeqManagementStatus(`✅ Imported ${Object.keys(imported).length} sequence(s).`);
            } catch (err) {
                setSeqManagementStatus(`❌ Import failed: ${err.message}`, true);
            }
            document.body.removeChild(input);
        };
        reader.onerror = function() {
            setSeqManagementStatus('❌ Failed to read file.', true);
            document.body.removeChild(input);
        };
        reader.readAsText(file);
    });
}

// ============================================================================
// SECTION 10: WAIT PERIOD & USER RESPONSE
// ============================================================================

function startWaitPeriod() {
    if (waitTimer) clearTimeout(waitTimer);
    isWaiting = true;
    sendEventMarker('wait_start');
    waitTimer = setTimeout(() => endWaitPeriod(), WAIT_DURATION);
}

function endWaitPeriod() {
    if (waitTimer) clearTimeout(waitTimer);
    isWaiting = false;
    sendEventMarker('wait_end');
    const cfg = getCurrentPhaseConfig();
    if (cfg && cfg.type === 'manual') {
        waitingForResponse = true;
        showFeedback('Was this movement ACCEPTABLE? Press V (yes) or B (no)');
    } else {
        if (prepareMove()) {
            executeMove();
        }
    }
}

function handleKeyPress(e) {
    if (e.key === 'h' || e.key === 'H') { toggleHUD(); return; }
    if (e.key === 'v' || e.key === 'V' || e.key === 'b' || e.key === 'B') {
        const btn = (e.key === 'v' || e.key === 'V') ? '50001' : '50002';
        if (markerPushing && sendButton) {
            sendMarkersToLSL(null, null, null, null, btn);
        }
        if (showButtonFeedback) {
            createButtonFeedbackEffect(e.key === 'v' || e.key === 'V');
        }
        const cfg = getCurrentPhaseConfig();
        if (cfg && cfg.type === 'manual' && waitingForResponse) {
            const acceptable = (e.key === 'v' || e.key === 'V');
            sendEventMarker(`button:${acceptable?'v':'b'}`);
            waitingForResponse = false;
            hideFeedback();
            if (lastMoveDirection) {
                updateUserModel(lastMoveDirection, acceptable);
            }
            setTimeout(() => {
                if (prepareMove()) executeMove();
            }, 300);
        }
    }
}

// ============================================================================
// SECTION 11: UPDATES & UI
// ============================================================================

function updateStats() {
    const cfg = getCurrentPhaseConfig();
    if (!cfg) return;
    DOM.phaseIndicator.textContent = cfg.description;
    DOM.phaseIndicator.className = `phase-indicator phase-${cfg.type}`;
    DOM.phaseIndicator.style.borderColor = cfg.color;
    DOM.phaseDisplay.textContent = cfg.description;
    if (cfg.type === 'calibration') {
        DOM.targetsDisplay.textContent = 'N/A';
        DOM.jumpsDisplay.textContent = `${totalJumps}/${cfg.jumps}`;
    } else {
        DOM.targetsDisplay.textContent = `${targetsReached}/${cfg.targets}`;
        DOM.jumpsDisplay.textContent = `${totalJumps}`;
    }
    DOM.movesDisplay.textContent = moveCount;
    DOM.gridDisplay.textContent = `${gridWidth}×${gridHeight}`;
    DOM.positionDisplay.textContent = `(${currentPos.x}, ${currentPos.y})`;
    DOM.targetDisplay.textContent = `(${targetPos.x}, ${targetPos.y})`;
    if (cfg.type === 'calibration') {
        DOM.progressDisplay.innerHTML = `<strong>Calibration Progress:</strong><br>${totalJumps}/${cfg.jumps} jumps`;
    } else {
        const pct = cfg.targets ? Math.round((targetsReached/cfg.targets)*100) : 0;
        DOM.progressDisplay.innerHTML = `<strong>Phase Progress:</strong><br>${targetsReached}/${cfg.targets} targets (${pct}%)`;
    }
}

function updateModelDisplay() {
    if (!DOM.modelGrid) return;
    DOM.modelGrid.innerHTML = '';
    const sorted = Object.entries(userModel).sort((a,b) => b[1] - a[1]);
    sorted.forEach(([dir, prob]) => {
        const item = document.createElement('div');
        item.className = 'model-item';
        if (prob > 0.15) {
            item.style.background = 'linear-gradient(145deg, rgba(99,179,237,0.3), rgba(49,130,206,0.2))';
            item.style.border = '1px solid #63b3ed';
        }
        const dirSpan = document.createElement('div');
        dirSpan.className = 'direction';
        dirSpan.textContent = dir;
        dirSpan.style.color = prob > 0.1 ? '#63b3ed' : '#90cdf4';
        const probSpan = document.createElement('div');
        probSpan.className = 'probability';
        probSpan.textContent = `${Math.round(prob*100)}%`;
        item.appendChild(dirSpan);
        item.appendChild(probSpan);
        DOM.modelGrid.appendChild(item);
    });
    createBarChartVisualization();
}

function createBarChartVisualization() {
    const canvas = DOM.probabilityCanvas;
    if (!canvas) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const margin = { top: 30, right: 20, bottom: 40, left: 40 };
    const cw = w - margin.left - margin.right;
    const ch = h - margin.top - margin.bottom;
    const barW = cw / 8;
    const maxH = ch * 0.7;
    ctx.fillStyle = 'rgba(45,55,72,0.8)';
    ctx.fillRect(margin.left, margin.top, cw, ch);
    ctx.strokeStyle = '#63b3ed';
    ctx.strokeRect(margin.left, margin.top, cw, ch);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    for (let i = 0; i <= 5; i++) {
        const y = margin.top + i * ch / 5;
        ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + cw, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(`${100 - i * 20}%`, margin.left - 5, y);
    }
    const sorted = Object.entries(directions).sort((a,b) => a[1].angle - b[1].angle);
    sorted.forEach(([dir], idx) => {
        const prob = userModel[dir] || 0;
        const barH = prob * maxH;
        const x = margin.left + idx * barW + barW * 0.1;
        const y = margin.top + ch - barH;
        const bw = barW * 0.8;
        ctx.fillStyle = `rgba(99, 179, 237, ${0.7 + prob * 0.3})`;
        ctx.fillRect(x, y, bw, barH);
        ctx.fillStyle = 'rgba(49,130,206,0.5)';
        ctx.fillRect(x + bw, y, 3, barH);
        ctx.fillRect(x, y + barH, bw, 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.strokeRect(x, y, bw, barH);
        ctx.fillStyle = prob > 0.1 ? '#63b3ed' : '#90cdf4';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(dir, x + bw / 2, margin.top + ch + 5);
        if (prob > 0.05) {
            ctx.fillStyle = 'white';
            ctx.font = 'bold 10px Arial';
            ctx.fillText(`${Math.round(prob * 100)}%`, x + bw / 2, y - 5);
        }
    });
    ctx.fillStyle = '#63b3ed';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Direction Preferences', w / 2, 10);
}

function updateControlsPanel() {
    const cfg = getCurrentPhaseConfig();
    if (!cfg) return;
    if (cfg.type === 'manual') {
        DOM.controlsStatus.textContent = 'ACTIVE - Press Keys Now';
        DOM.controlsStatus.style.color = '#63b3ed';
        DOM.controlsPanel.classList.add('controls-active');
        DOM.controlsPanel.classList.remove('controls-inactive');
        DOM.controlsPanel.style.animation = 'pulse-border 2s ease-in-out infinite';
    } else {
        DOM.controlsStatus.textContent = 'INACTIVE - Observation Only';
        DOM.controlsStatus.style.color = '#ccc';
        DOM.controlsPanel.classList.add('controls-inactive');
        DOM.controlsPanel.classList.remove('controls-active');
        DOM.controlsPanel.style.animation = 'none';
    }
}

function showFeedback(msg) {
    DOM.feedbackPanel.innerHTML = msg;
    DOM.feedbackPanel.classList.remove('hidden');
    DOM.feedbackPanel.style.background = 'linear-gradient(145deg, #3182ce, #2c5aa0)';
}
function hideFeedback() { DOM.feedbackPanel.classList.add('hidden'); }

function updateUserModel(dir, acceptable) {
    const cfg = getCurrentPhaseConfig();
    if (!cfg || cfg.type !== 'manual') return;
    const lr = 0.25;
    if (acceptable) {
        userModel[dir] = Math.min(0.8, (userModel[dir]||0) + lr);
        const opp = { 'N':'S','S':'N','E':'W','W':'E','NE':'SW','SW':'NE','NW':'SE','SE':'NW' }[dir];
        if (opp) userModel[opp] = Math.max(0.02, (userModel[opp]||0) - lr/2);
    } else {
        userModel[dir] = Math.max(0.02, (userModel[dir]||0) - lr);
        const perp = { 'N':['E','W'],'S':['E','W'],'E':['N','S'],'W':['N','S'],'NE':['NW','SE'],'NW':['NE','SW'],'SE':['NE','SW'],'SW':['NW','SE'] }[dir] || [];
        perp.forEach(d => { userModel[d] = Math.min(0.8, (userModel[d]||0) + lr/3); });
    }
    const sum = Object.values(userModel).reduce((a,b) => a + b, 0);
    Object.keys(userModel).forEach(k => userModel[k] /= sum);
    updateModelDisplay();
}

// ============================================================================
// SECTION 12: TARGET REACHED / RESET / BREAK
// ============================================================================

function handleTargetReached() {
    const cfg = getCurrentPhaseConfig();
    if (!cfg) return;
    targetsReached++;
    sendEventMarker(`target_reached:${targetsReached}`);
    if (cfg.type === 'bci') sendExperimentEventToLSL(`target_reached_${targetsReached}`);
    createCelebrationEffect();
    showFeedback(`Target reached! (${targetsReached}/${cfg.targets})`);
    if (cfg.type === 'bci' && targetsReached % 5 === 0) { showBreakScreen(); return; }
    if (cfg.type !== 'calibration') {
        breakCount++;
        if (breakCount % 5 === 0) { showBreakScreen(); return; }
    }
    setTimeout(() => {
        if (isPhaseComplete()) nextPhase();
        else resetGrid();
    }, 1500);
}

function handleMaxMovesReached() {
    const cfg = getCurrentPhaseConfig();
    if (!cfg) return;
    if (cfg.type === 'bci') {
        targetsReached++;
        sendEventMarker(`target_aborted:${targetsReached}`);
        sendExperimentEventToLSL(`target_aborted_${targetsReached}`);
        showFeedback(`Target aborted. Progress: ${targetsReached}/${cfg.targets}`);
    } else {
        sendEventMarker('max_moves_reached');
        showFeedback('Maximum moves reached. Resetting...');
    }
    setTimeout(() => {
        if (isPhaseComplete()) nextPhase();
        else resetGrid();
    }, 1500);
}

function resetGrid() {
    hideFeedback();
    hideReusableVisuals();
    userModel = initUserModel();
    const firstTrial = (targetsReached === 0 && moveCount === 0);
    if (firstTrial) {
        targetPos = { x: gridWidth, y: gridHeight };
    } else {
        const corner = Math.floor(Math.random()*4);
        if (corner===0) targetPos = { x: 1, y: 1 };
        else if (corner===1) targetPos = { x: gridWidth, y: 1 };
        else if (corner===2) targetPos = { x: 1, y: gridHeight };
        else targetPos = { x: gridWidth, y: gridHeight };
    }
    
    let start = getStartPosition(targetPos, gridWidth, gridHeight);
    currentPos = start;
    moveCount = 0;

    if (robotModel && targetMarker) {
        const sp = 2;
        let yPos;
        if (originalParadigm) {
            yPos = 0.05;
        } else if (cursorStyle === '2d') {
            yPos = CURSOR_2D_Y;
        } else {
            yPos = 0.7;
        }
        robotModel.position.set(((currentPos.x-1)-gridWidth/2+0.5)*sp, yPos, ((currentPos.y-1)-gridHeight/2+0.5)*sp);

        const tx = ((targetPos.x-1)-gridWidth/2+0.5)*sp;
        const tz = ((targetPos.y-1)-gridHeight/2+0.5)*sp;

        if (originalParadigm) {
            targetMarker.position.set(tx, 0.1, tz);
        } else {
            if (goalDesign === '2d') {
                targetMarker.position.set(tx, GOAL_2D_Y, tz);
            } else {
                targetMarker.position.set(tx, 0.6, tz);
            }
        }
    }

    updateStats();
    updateModelDisplay();
    const cfg = getCurrentPhaseConfig();
    if (cfg && cfg.type !== 'calibration') {
        sendEventMarker(`trial_start:g${targetPos.x}${targetPos.y}:s${currentPos.x}${currentPos.y}`);
        if (cfg.type === 'bci') sendExperimentEventToLSL(`trial_start_${targetPos.x}${targetPos.y}`);
    }
    setTimeout(() => {
        if (prepareMove()) executeMove();
    }, 1000);
}

// ============================================================================
// SECTION 13: CELEBRATION / BUTTON FEEDBACK
// ============================================================================

function createCelebrationEffect() {
    const spacing = 2;
    const tx = ((targetPos.x-1)-gridWidth/2+0.5)*spacing;
    const tz = ((targetPos.y-1)-gridHeight/2+0.5)*spacing;
    for (let i=0; i<20; i++) {
        const pgeo = new THREE.SphereGeometry(0.1,8,8);
        const pmat = new THREE.MeshBasicMaterial({
            color: Math.random()>0.5 ? 0x44ff44 : 0xffff00,
            transparent: true,
            opacity: 0.8
        });
        const part = new THREE.Mesh(pgeo, pmat);
        part.position.set(tx, 1, tz);
        part.userData = {
            vel: new THREE.Vector3((Math.random()-0.5)*2, Math.random()*2+1, (Math.random()-0.5)*2),
            life: 1
        };
        scene.add(part);
        gridCells.push(part);
        setTimeout(() => {
            scene.remove(part);
            const idx = gridCells.indexOf(part);
            if (idx>-1) gridCells.splice(idx,1);
        }, 1000);
    }
}

function createButtonFeedbackEffect(isAcceptable) {
    const sp = 2;
    const x = ((currentPos.x-1)-gridWidth/2+0.5)*sp;
    const z = ((currentPos.y-1)-gridHeight/2+0.5)*sp;
    const part = new THREE.Mesh(
        new THREE.SphereGeometry(0.2,16,16),
        new THREE.MeshBasicMaterial({
            color: isAcceptable ? 0x44ff44 : 0xff4444,
            transparent: true,
            opacity: 0.8
        })
    );
    part.position.set(x, 2, z);
    scene.add(part);
    gridCells.push(part);
    const start = Date.now();
    function anim() {
        const t = Math.min((Date.now()-start)/1000, 1);
        part.position.y = 2 + t*2;
        part.material.opacity = 0.8*(1-t);
        if (t<1) requestAnimationFrame(anim);
        else {
            scene.remove(part);
            const idx = gridCells.indexOf(part);
            if (idx>-1) gridCells.splice(idx,1);
        }
    }
    anim();
}

// ============================================================================
// SECTION 14: BREAK SCREEN
// ============================================================================

function showBreakScreen() {
    sendEventMarker('break_start');
    updateGraySquare('break');
    const div = document.createElement('div');
    div.id = 'break-screen';
    div.className = 'break-screen';
    const cfg = getCurrentPhaseConfig();
    const pct = cfg && cfg.targets ? (targetsReached / cfg.targets)*100 : 0;
    div.innerHTML = `
        <div class="break-content">
            <h2>Break Time</h2>
            <p>You've completed ${targetsReached} out of ${cfg ? cfg.targets : '?'} targets in this phase.</p>
            <p>Take a short break.</p>
            <div class="spacebar-instruction">Press <kbd>SPACEBAR</kbd> to continue</div>
            <div class="progress-bar"><div class="progress-fill" style="width: ${pct}%"></div></div>
        </div>
    `;
    DOM.container.appendChild(div);
    const onSpace = (e) => {
        if (e.code === 'Space') {
            sendEventMarker('break_end');
            div.remove();
            window.removeEventListener('keydown', onSpace);
            breakCount = 0;
            const cfg2 = getCurrentPhaseConfig();
            if (cfg2) updateGraySquare(cfg2.phase);
            setTimeout(() => {
                if (isPhaseComplete()) nextPhase();
                else resetGrid();
            }, 500);
        }
    };
    window.addEventListener('keydown', onSpace);
}

// ============================================================================
// SECTION 15: THREE.JS SETUP
// ============================================================================

function clearOverlay() {
    if (overlayGroup) {
        scene.remove(overlayGroup);
        overlayGroup = null;
    }
}

function create3DGridVisualization() {
    const spacing = 2;
    gridCells.forEach(c => scene.remove(c));
    gridCells = [];
    cellPlatforms = [];
    cellBorders = [];
    gridLabels.forEach(l => scene.remove(l));
    gridLabels = [];
    directionLabels.forEach(l => scene.remove(l));
    directionLabels = [];
    clearOverlay();

    if (originalParadigm) {
        const yPosLines = 0.02;
        const edgeColor = 0x888888;

        const points = [];
        const nodeCoords = [];

        for (let i = 0; i < gridWidth; i++) {
            for (let j = 0; j < gridHeight; j++) {
                const x = (i - gridWidth/2 + 0.5) * spacing;
                const z = (j - gridHeight/2 + 0.5) * spacing;
                nodeCoords.push({ x, z });
            }
        }

        const dirs = [
            [-1, -1], [0, -1], [1, -1],
            [-1,  0],          [1,  0],
            [-1,  1], [0,  1], [1,  1]
        ];

        for (let i = 0; i < gridWidth; i++) {
            for (let j = 0; j < gridHeight; j++) {
                const idx = i * gridHeight + j;
                const from = nodeCoords[idx];
                for (const d of dirs) {
                    const ni = i + d[0];
                    const nj = j + d[1];
                    if (ni >= 0 && ni < gridWidth && nj >= 0 && nj < gridHeight) {
                        const to = nodeCoords[ni * gridHeight + nj];
                        points.push(from.x, yPosLines, from.z);
                        points.push(to.x, yPosLines, to.z);
                    }
                }
            }
        }

        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor });
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        scene.add(edges);
        gridCells.push(edges);

        const blackDiscMat = new THREE.MeshBasicMaterial({
            color: 0x0a0a0a,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const whiteRingMat = new THREE.MeshBasicMaterial({
            color: 0x888888,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        for (const coord of nodeCoords) {
            const discGeo = new THREE.CircleGeometry(0.4, 32);
            const disc = new THREE.Mesh(discGeo, blackDiscMat);
            disc.position.set(coord.x, yPosLines + 0.01, coord.z);
            disc.rotation.x = -Math.PI / 2;
            scene.add(disc);
            gridCells.push(disc);

            const ringGeo = new THREE.RingGeometry(0.35, 0.3, 32);
            const ring = new THREE.Mesh(ringGeo, whiteRingMat);
            ring.position.set(coord.x, yPosLines + 0.01, coord.z);
            ring.rotation.x = -Math.PI / 2;
            scene.add(ring);
            gridCells.push(ring);
        }

        createCoordinateLabels(spacing);
        createGridCoordinateNumbers(spacing);
        return;
    }

    // Custom mode
    const drawNone = (gridStyle === 'none');
    const drawBoxGrid = (gridStyle === 'box' || gridStyle === 'both');
    const drawNodeOverlay = (gridStyle === 'node' || gridStyle === 'both');

    if (drawBoxGrid) {
        const cellHeight = 0.2;
        const borderHeight = 0.3;
        for (let x = 0; x < gridWidth; x++) {
            for (let y = 0; y < gridHeight; y++) {
                const cellGeo = new THREE.BoxGeometry(spacing * 0.9, cellHeight, spacing * 0.9);
                const isDark = (x + y) % 2 === 0;
                const cellColor = isDark ? 0x2a2a2a : 0x333333;
                const cellMat = new THREE.MeshStandardMaterial({ color: cellColor, metalness: 0.1, roughness: 0.8 });
                const cellMesh = new THREE.Mesh(cellGeo, cellMat);
                const posX = (x - gridWidth/2 + 0.5) * spacing;
                const posZ = (y - gridHeight/2 + 0.5) * spacing;
                cellMesh.position.set(posX, cellHeight / 2, posZ);
                cellMesh.receiveShadow = true;
                scene.add(cellMesh);
                gridCells.push(cellMesh);
                cellPlatforms.push({ mesh: cellMesh, x: x+1, y: y+1 });

                const borderGeo = new THREE.BoxGeometry(spacing * 0.95, borderHeight, spacing * 0.95);
                const borderMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.3, roughness: 0.7 });
                const border = new THREE.Mesh(borderGeo, borderMat);
                border.position.set(posX, borderHeight / 2, posZ);
                border.castShadow = true;
                border.receiveShadow = true;
                scene.add(border);
                gridCells.push(border);
                cellBorders.push({ mesh: border, x: x+1, y: y+1 });
            }
        }
        const groundGeo = new THREE.PlaneGeometry(Math.max(gridWidth, gridHeight) * spacing * 1.5, Math.max(gridWidth, gridHeight) * spacing * 1.5);
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.5, roughness: 0.8 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.1;
        ground.receiveShadow = true;
        scene.add(ground);
        gridCells.push(ground);
    }

    if (drawNodeOverlay) {
        overlayGroup = new THREE.Group();
        const nodeY = 0.351;
        const lineY = 0.35;

        if (showGridLines) {
            const lineMat = new THREE.LineBasicMaterial({
                color: 0x333333,
                transparent: false,
                opacity: 1.0
            });
            const dirs = [
                [-1, -1], [0, -1], [1, -1],
                [-1,  0],          [1,  0],
                [-1,  1], [0,  1], [1,  1]
            ];
            for (let i = 0; i < gridWidth; i++) {
                for (let j = 0; j < gridHeight; j++) {
                    for (const d of dirs) {
                        const ni = i + d[0];
                        const nj = j + d[1];
                        if (ni >= 0 && ni < gridWidth && nj >= 0 && nj < gridHeight) {
                            if (ni > i || (ni === i && nj > j)) {
                                const x1 = (i - gridWidth/2 + 0.5) * spacing;
                                const z1 = (j - gridHeight/2 + 0.5) * spacing;
                                const x2 = (ni - gridWidth/2 + 0.5) * spacing;
                                const z2 = (nj - gridHeight/2 + 0.5) * spacing;
                                const pts = [
                                    new THREE.Vector3(x1, lineY, z1),
                                    new THREE.Vector3(x2, lineY, z2)
                                ];
                                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                                const line = new THREE.Line(geo, lineMat);
                                line.renderOrder = 0;
                                overlayGroup.add(line);
                            }
                        }
                    }
                }
            }
        }

        const fillMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: false,
            depthTest: false,
            depthWrite: false
        });
        const outlineMat = new THREE.MeshBasicMaterial({
            color: 0x636262,
            transparent: false,
            depthTest: false,
            depthWrite: false
        });

        const fillRadius = 0.45 * 0.85;
        const outlineInner = fillRadius;
        const outlineOuter = 0.45;

        for (let i = 0; i < gridWidth; i++) {
            for (let j = 0; j < gridHeight; j++) {
                const x = (i - gridWidth/2 + 0.5) * spacing;
                const z = (j - gridHeight/2 + 0.5) * spacing;

                const fill = new THREE.Mesh(new THREE.CircleGeometry(fillRadius, 16), fillMat);
                fill.position.set(x, nodeY, z);
                fill.rotation.x = -Math.PI / 2;
                fill.renderOrder = 1;
                overlayGroup.add(fill);

                const outline = new THREE.Mesh(new THREE.RingGeometry(outlineInner, outlineOuter, 16), outlineMat);
                outline.position.set(x, nodeY, z);
                outline.rotation.x = -Math.PI / 2;
                outline.renderOrder = 1;
                overlayGroup.add(outline);
            }
        }
        scene.add(overlayGroup);
    }

    if (!drawNone) {
        createCoordinateLabels(spacing);
        createGridCoordinateNumbers(spacing);
    }
}

function createCoordinateLabels(spacing) {
    directionLabels.forEach(l => scene.remove(l));
    directionLabels = [];

    if (!showDirectionLabels) return;

    const offset = 1.3;
    createDirectionIndicator('N', 0, -gridHeight * spacing / 2 - offset);
    createDirectionIndicator('S', 0,  gridHeight * spacing / 2 + offset);
    createDirectionIndicator('W', -gridWidth * spacing / 2 - offset, 0);
    createDirectionIndicator('E',  gridWidth * spacing / 2 + offset, 0);
}

function createDirectionIndicator(dir, x, z) {
    createTextLabel(dir, x, 1.0, z, 0.8);
    if (cameraMode !== '2d') {
        const coneGeo = new THREE.ConeGeometry(0.4, 0.9, 7);
        const coneMat = new THREE.MeshStandardMaterial({ color: 0x63b3ed, emissive: 0x3182ce, emissiveIntensity: 0.3 });
        const arrow = new THREE.Mesh(coneGeo, coneMat);
        arrow.position.set(x, 0, z);
        switch(dir) {
            case 'N': arrow.rotation.y = 0; break;
            case 'S': arrow.rotation.y = Math.PI; break;
            case 'E': arrow.rotation.y = -Math.PI/2; break;
            case 'W': arrow.rotation.y = Math.PI/2; break;
        }
        arrow.castShadow = true;
        scene.add(arrow);
        gridCells.push(arrow);
        directionLabels.push(arrow);
    }
}

function createTextLabel(text, x, y, z, size) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ede663ff';
    ctx.font = 'bold 180px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    scene.add(sprite);
    gridCells.push(sprite);
    directionLabels.push(sprite);
}

function createGridCoordinateNumbers(spacing) {
    const off = 0.2;
    const h = 0.5;
    for (let x = 0; x < gridWidth; x++) {
        const xp = (x - gridWidth/2 + 0.5) * spacing;
        const num = (x+1).toString();
        createCoordinateNumber(num, xp, h, -gridHeight*spacing/2 - off, 0.4);
        createCoordinateNumber(num, xp, h,  gridHeight*spacing/2 + off, 0.4);
    }
    for (let y = 0; y < gridHeight; y++) {
        const zp = (y - gridHeight/2 + 0.5) * spacing;
        const num = (y+1).toString();
        createCoordinateNumber(num, -gridWidth*spacing/2 - off, h, zp, 0.4);
        createCoordinateNumber(num,  gridWidth*spacing/2 + off, h, zp, 0.4);
    }
    for (let x=0; x<gridWidth; x++) {
        for (let y=0; y<gridHeight; y++) {
            if (Math.max(gridWidth, gridHeight) <= 6 || (x%2===0 && y%2===0)) {
                const xp = (x - gridWidth/2 + 0.5) * spacing;
                const zp = (y - gridHeight/2 + 0.5) * spacing;
                createCellCoordinateLabel(`${x+1},${y+1}`, xp, 0.3, zp, 0.3);
            }
        }
    }
}

function createCoordinateNumber(text, x, y, z, size) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.shadowColor = '#63b3ed';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 80px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);
    ctx.shadowBlur = 0;
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    scene.add(sprite);
    gridLabels.push(sprite);
}

function createCellCoordinateLabel(text, x, y, z, size) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(99, 179, 237, 0.7)';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.6 }));
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size/2, 1);
    scene.add(sprite);
    gridLabels.push(sprite);
}

function createCursorDisc(color = 0xff0000, renderOrder = 0, radius = CURSOR_RADIUS) {
    const geo = new THREE.CylinderGeometry(radius, radius, 0.1, 32);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = 0;
    disc.position.y = 0.05;
    disc.renderOrder = renderOrder;
    return disc;
}

function createCubeRobot() {
    if (originalParadigm) {
        return createCursorDisc(0xff0000, 0, ORIGINAL_CURSOR_RADIUS);
    }
    if (cursorStyle === '2d') {
        return createCursorDisc(0xff0000, 4, CURSOR_RADIUS);
    } else {
        const geo = new THREE.SphereGeometry(CURSOR_RADIUS, 32, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff4444, metalness: 0.0, roughness: 0.0 });
        const sphere = new THREE.Mesh(geo, mat);
        sphere.castShadow = false;
        sphere.receiveShadow = false;
        sphere.renderOrder = 4;
        return sphere;
    }
}

function createTargetMarker() {
    const spacing = 2;
    const posX = ((targetPos.x - 1) - gridWidth / 2 + 0.5) * spacing;
    const posZ = ((targetPos.y - 1) - gridHeight / 2 + 0.5) * spacing;

    if (originalParadigm) {
        const ringGeo = new THREE.RingGeometry(0.35, 0.3, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            side: THREE.DoubleSide,
            transparent: false
        });
        const marker = new THREE.Mesh(ringGeo, ringMat);
        marker.renderOrder = 3;
        marker.position.set(posX, 0.1, posZ);
        marker.rotation.x = -Math.PI / 2;
        marker.castShadow = false;
        scene.add(marker);
        return marker;
    }

    if (goalDesign === '2d') {
        const ringGeo = new THREE.RingGeometry(0.45, 0.38, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            side: THREE.DoubleSide,
            transparent: false
        });
        const marker = new THREE.Mesh(ringGeo, ringMat);
        marker.renderOrder = 3;
        marker.position.set(posX, GOAL_2D_Y, posZ);
        marker.rotation.x = -Math.PI / 2;
        marker.castShadow = false;
        scene.add(marker);
        return marker;
    } else {
        const cubeGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const cubeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x330000 });
        const marker = new THREE.Mesh(cubeGeo, cubeMat);
        marker.renderOrder = 3;
        marker.position.set(posX, 0.6, posZ);
        marker.castShadow = false;
        scene.add(marker);
        return marker;
    }
}

function initRobotLoader() {
    if (cursorStyle === 'robot' && !originalParadigm) {
        if (typeof THREE.GLTFLoader === 'undefined') {
            console.warn('GLTFLoader not available, using fallback sphere');
            createFallbackRobotModel();
            return;
        }
        const loader = new THREE.GLTFLoader();
        const url = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
        loader.load(url, (gltf) => {
            robotModel = gltf.scene;
            robotModel.scale.set(0.3, 0.3, 0.3);
            const spacing = 2;
            const yPos = 0.7;
            robotModel.position.set(((currentPos.x - 1) - gridWidth / 2 + 0.5) * spacing, yPos, ((currentPos.y - 1) - gridHeight / 2 + 0.5) * spacing);
            robotModel.rotation.y = Math.PI;
            robotModel.traverse(child => {
                if (child.isMesh) {
                    child.renderOrder = 4;
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (child.material) child.material.emissiveIntensity = 0.2;
                }
            });
            scene.add(robotModel);
            cursor = robotModel;
            if (gltf.animations && gltf.animations.length) {
                mixer = new THREE.AnimationMixer(robotModel);
            }
            const rlight = new THREE.PointLight(0xff4444, 0.3, 3);
            rlight.position.set(0, 1.5, 0);
            robotModel.add(rlight);
            if (gameState === 'playing') setTimeout(() => { if (prepareMove()) executeMove(); }, 500);
        }, undefined, (err) => {
            console.error('Failed to load robot model:', err);
            createFallbackRobotModel();
        });
    } else {
        robotModel = createCubeRobot();
        const spacing = 2;
        let yPos;
        if (originalParadigm) {
            yPos = 0.05;
        } else if (cursorStyle === '2d') {
            yPos = CURSOR_2D_Y;
        } else {
            yPos = 0.7;
        }
        robotModel.position.set(((currentPos.x - 1) - gridWidth / 2 + 0.5) * spacing, yPos, ((currentPos.y - 1) - gridHeight / 2 + 0.5) * spacing);
        scene.add(robotModel);
        cursor = robotModel;
        if (gameState === 'playing') setTimeout(() => { if (prepareMove()) executeMove(); }, 500);
    }
}

function createFallbackRobotModel() {
    cursorStyle = '3d';
    robotModel = createCubeRobot();
    const spacing = 2;
    const yPos = 0.7;
    robotModel.position.set(((currentPos.x - 1) - gridWidth / 2 + 0.5) * spacing, yPos, ((currentPos.y - 1) - gridHeight / 2 + 0.5) * spacing);
    scene.add(robotModel);
    cursor = robotModel;
    if (gameState === 'playing') setTimeout(() => { if (prepareMove()) executeMove(); }, 500);
}

// ============================================================================
// DYNAMIC CAMERA SETUP IN THREE.JS (UPDATED)
// ============================================================================

function initThreeJS() {
    const container = document.getElementById('canvas-container');
    if (!container) {
        console.error('Canvas container not found');
        return;
    }
    scene = new THREE.Scene();
    scene.background = new THREE.Color(originalParadigm ? 0x0a0a0a : 0x000000);

    const aspect = container.clientWidth / container.clientHeight;
    const halfSize = getGridExtent();  // <-- dynamic half‑size

    if (cameraMode === '2d' || originalParadigm) {
        // Orthographic camera
        camera = new THREE.OrthographicCamera(
            -halfSize * aspect, halfSize * aspect,
            halfSize, -halfSize,
            0.1, 100
        );
        camera.position.set(0, 20, 0);
        camera.lookAt(0, 0, 0);
    } else {
        // Perspective camera – distance adjusts to fit vertically
        camera = new THREE.PerspectiveCamera(25, aspect, 0.1, 1000);
        const fovRad = (camera.fov * Math.PI) / 360; // half‑angle in radians
        const dist = halfSize / Math.tan(fovRad);
        camera.position.set(0, dist / Math.SQRT2, dist / Math.SQRT2);
        camera.lookAt(0, 0, 0);
    }

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = (cameraMode !== '2d' && !originalParadigm);
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, originalParadigm ? 0.9 : 0.4);
    scene.add(ambient);

    if (!originalParadigm) {
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        scene.add(dirLight);
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-10, 10, -10);
        scene.add(fillLight);
        const pointLight = new THREE.PointLight(0xff4444, 0.5, 10);
        pointLight.position.set(0, 3, 0);
        scene.add(pointLight);
    }

    create3DGridVisualization();
    initRobotLoader();
    targetMarker = createTargetMarker();
    initReusableVisuals();
    animateScene();

    window.addEventListener('resize', handleResize);
    setTimeout(() => handleResize(), 50);
    userModel = initUserModel();
}

// ---- updated resize handler ----
function handleResize() {
    const container = document.getElementById('canvas-container');
    if (!container || !renderer) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;
    const halfSize = getGridExtent();  // <-- dynamic

    if (camera.isOrthographicCamera) {
        camera.left = -halfSize * aspect;
        camera.right = halfSize * aspect;
        camera.top = halfSize;
        camera.bottom = -halfSize;
        camera.updateProjectionMatrix();
    } else {
        camera.aspect = aspect;
        const fovRad = (camera.fov * Math.PI) / 360;
        const dist = halfSize / Math.tan(fovRad);
        camera.position.set(0, dist / Math.SQRT2, dist / Math.SQRT2);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
    }
    renderer.setSize(width, height);
}

function animateScene() {
    function animate() {
        if (!renderer) {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            return;
        }

        if (mixer) mixer.update(clock.getDelta());

        if (robotModel && !originalParadigm) {
            if (cursorStyle === '3d' || cursorStyle === 'robot') {
                if (!animating) {
                    robotModel.position.y = 0.7 + Math.sin(Date.now() * 0.002) * 0.05;
                    robotModel.rotation.y += 0.003;
                }
            }
        }

        if (targetMarker && goalDesign !== '2d' && !originalParadigm) {
            const aura = gridCells.find(obj => obj.geometry && obj.geometry.type === 'RingGeometry');
            if (aura) {
                aura.rotation.y += 0.005;
                const as = 0.9 + Math.sin(Date.now() * 0.0015) * 0.1;
                aura.scale.set(as, as, as);
            }
        }

        renderer.render(scene, camera);
        animationFrameId = requestAnimationFrame(animate);
    }
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = requestAnimationFrame(animate);
}

// ============================================================================
// SECTION 16: HUD TOGGLES
// ============================================================================

function toggleHUD() {
    hudVisible = !hudVisible;
    if (hudVisible) { showHUD(); showGridNumbers(); } else { hideHUD(); hideGridNumbers(); }
    ensureGraySquareVisible();
    DOM.feedbackPanel.textContent = hudVisible ? 'HUD enabled' : 'HUD disabled';
    DOM.feedbackPanel.classList.remove('hidden');
    setTimeout(() => DOM.feedbackPanel.classList.add('hidden'), 1500);
}

function showHUD() {
    ['stats-panel','phase-indicator','progress-display','controls-panel','model-panel','event-markers-panel','author-badge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('hidden');
    });
    updateLSLStatus(isLSLConnected);
}

function hideHUD() {
    ['stats-panel','phase-indicator','progress-display','feedback-panel','controls-panel','model-panel','event-markers-panel','author-badge'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    hideGridNumbers();
    ensureGraySquareVisible();
}

function showGridNumbers() { gridNumbersVisible = true; gridLabels.forEach(l => l.visible = true); }
function hideGridNumbers() { gridNumbersVisible = false; gridLabels.forEach(l => l.visible = false); }
function toggleGridNumbers() { gridNumbersVisible = !gridNumbersVisible; gridLabels.forEach(l => l.visible = gridNumbersVisible); }

function ensureGraySquareVisible() {
    if (DOM.graySquare) DOM.graySquare.classList.remove('hidden');
}

function updateGraySquare(state) {
    if (!DOM.graySquare) return;
    DOM.graySquare.classList.remove('intro', 'calibration', 'bci', 'manual', 'break');
    DOM.graySquare.classList.add(state);
    if (state === 'intro') DOM.graySquare.style.border = '2px solid #404040';
    else DOM.graySquare.style.border = 'none';
    DOM.graySquare.style.backgroundColor = '#808080';
}

// ============================================================================
// SECTION 17: START EXPERIMENT
// ============================================================================

function startExperiment() {
    stopPreviewAnimation();

    const origCheckbox = document.getElementById('toggle-original-paradigm');
    originalParadigm = origCheckbox ? origCheckbox.checked : false;

    showWhiteLine = document.getElementById('toggle-white-line').checked;
    snapMovement = document.getElementById('toggle-snap-movement').checked;
    showButtonFeedback = document.getElementById('toggle-button-feedback').checked;
    showStartCircle = document.getElementById('toggle-start-circle').checked;

    gridStyle = getGridStyleFromUI();
    showGridLines = document.getElementById('toggle-grid-lines').checked;
    cursorStyle = document.querySelector('input[name="cursor-style"]:checked')?.value || '2d';
    goalDesign = document.querySelector('input[name="goal-design"]:checked')?.value || '2d';
    showDirectionLabels = document.getElementById('toggle-direction-labels').checked;

    WAIT_DURATION = clampTiming(parseFloat(document.getElementById('wait-duration').value) || 0.1);
    MOVE_ANIMATION_DURATION = clampTiming(parseFloat(document.getElementById('move-animation-duration').value) || 0.1);
    START_CIRCLE_SCALE_DURATION = clampTiming(parseFloat(document.getElementById('start-circle-duration').value) || 0.1);

    // Read marker configuration
    markerPushing = document.getElementById('toggle-marker-pushing').checked;
    sendLabel = document.getElementById('toggle-send-label').checked;
    sendCls1 = document.getElementById('toggle-send-cls1').checked;
    sendCls2 = document.getElementById('toggle-send-cls2').checked;
    sendButton = document.getElementById('toggle-send-button').checked;
    sendPredict = document.getElementById('toggle-send-predict').checked;
    predictValue = document.getElementById('predict-marker-value').value.trim();

    const cameraModeRadio = document.querySelector('input[name="camera-mode"]:checked');
    if (cameraModeRadio) cameraMode = cameraModeRadio.value;
    const dims = getGridDimensionsFromUI();
    gridWidth = dims.width;
    gridHeight = dims.height;
    
    calibrationJumps = parseInt(document.getElementById('calibration-jumps').value) || 300;
    bciTargets = parseInt(document.getElementById('bci-targets').value) || 5;
    selectedCondition = document.getElementById('condition').value;

    gameState = 'playing';
    eventMarkers = [];
    jumpCounter = 0;
    targetPos = { x: gridWidth, y: gridHeight };
    const start = getStartPosition(targetPos, gridWidth, gridHeight);
    currentPos = start;

    sendEventMarker('experiment_start');
    sendExperimentEventToLSL('experiment_start');
    initializeLSLBridge();

    experimentStructure[0].jumps = calibrationJumps;
    experimentStructure[1].targets = bciTargets;
    filteredExperimentStructure = filterExperimentStructure();
    currentPhaseIndex = 0;
    phase = filteredExperimentStructure[0].phase;
    targetsReached = 0;
    totalJumps = 0;
    moveCount = 0;
    breakCount = 0;

    updateGraySquare(phase);
    sendEventMarker(`phase_start:${phase}`);
    sendExperimentEventToLSL(`phase_start_${phase}`);
    userModel = initUserModel();

    DOM.introScreen.classList.add('hidden');
    hudVisible = true;
    showHUD();
    gridNumbersVisible = false;

    initThreeJS();
    window.addEventListener('keydown', handleKeyPress);
    updateStats();
    updateControlsPanel();
    updateModelDisplay();
}

// ============================================================================
// SECTION 18: INIT ON LOAD
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (DOM.saveProfileBtn) DOM.saveProfileBtn.addEventListener('click', saveProfile);
    if (DOM.loadProfileBtn) DOM.loadProfileBtn.addEventListener('click', loadProfile);
    if (DOM.deleteProfileBtn) DOM.deleteProfileBtn.addEventListener('click', deleteProfile);
    if (DOM.resetDefaultsBtn) DOM.resetDefaultsBtn.addEventListener('click', resetToDefaults);
    document.getElementById('export-profiles-btn').addEventListener('click', exportProfiles);
    document.getElementById('import-profiles-btn').addEventListener('click', importProfiles);

    ensureBuiltinProfile();
    populateProfileDropdown();
    populateSequenceDropdown();
    populateSequenceLoadDropdown();

    applySettingsToUI(getDefaultSettings());
    renderPreview(false);
    updateTimingDisplay();

    // Attach master switch listener for graying out individual toggles
    const masterToggle = document.getElementById('toggle-marker-pushing');
    if (masterToggle) {
        masterToggle.addEventListener('change', updateMarkerToggles);
        updateMarkerToggles();
    }

    // Listener for predict checkbox to enable/disable text input
    const predictCheckbox = document.getElementById('toggle-send-predict');
    if (predictCheckbox) {
        predictCheckbox.addEventListener('change', updateMarkerToggles);
    }

    // SINGLE MAIN BUTTON HANDLER
    document.getElementById('main-action-button').addEventListener('click', () => {
        if (sequence.length > 0) {
            // Run the sequence
            isSequenceRunning = true;
            seqIndex = 0;
            DOM.introScreen.classList.add('hidden');
            if (DOM.sequenceStatus) DOM.sequenceStatus.textContent = '';
            runNextProfile();
        } else {
            // Start single experiment
            startExperiment();
        }
    });

    DOM.seqAddBtn.addEventListener('click', () => {
        const sel = DOM.sequenceProfileSelect;
        const name = sel.value;
        if (name && !sequence.includes(name)) {
            sequence.push(name);
            updateSequenceUI();
            updateMainButtonText();
            if (DOM.sequenceStatus) DOM.sequenceStatus.textContent = '';
        }
    });
    DOM.seqClearBtn.addEventListener('click', () => {
        sequence = [];
        updateSequenceUI();
        updateMainButtonText();
        if (DOM.sequenceStatus) DOM.sequenceStatus.textContent = '';
    });

    // Sequence management buttons
    document.getElementById('save-sequence-btn').addEventListener('click', saveCurrentSequence);
    document.getElementById('load-sequence-btn').addEventListener('click', loadSelectedSequence);
    document.getElementById('delete-sequence-btn').addEventListener('click', deleteSelectedSequence);
    document.getElementById('export-sequences-btn').addEventListener('click', exportSequences);
    document.getElementById('import-sequences-btn').addEventListener('click', importSequences);

    // Initial UI updates
    userModel = initUserModel();
    updateModelDisplay();
    updateGraySquare('intro');
    ensureWhitePulseOverlay();
    hideWhitePulse();
    updateMainButtonText(); // ensure button text is correct on load

    setupPreviewListeners();
    updateTimingDisplay();
    renderPreview(true);
    startPreviewAnimation();
});