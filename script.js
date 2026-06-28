// ============================================================================
// NEUROADAPTIVE CURSOR EXPERIMENT – Full Implementation
// Based on Zander et al. (2016)
//
// This script controls the 3D experiment, including:
// - Three.js scene setup and rendering
// - Phase management (Calibration, BCI, Manual)
// - Movement logic with direction selection based on user model
// - Visual feedback (white lines, discs, rings, cursor)
// - LSL marker streaming via WebSocket
// - HUD and UI controls
//
// Visual elements are sized via constants at the top.
// The "Original Paradigm" mode (checkbox) switches to a flat 2D-like
// style matching the paper's figures (gray lines, black nodes, white outlines).
// ============================================================================

// ─── SIZES FOR VISUAL ELEMENTS ─────────────────────────────────────────────
// All dimensions are in 3D world units (grid spacing is 2 units).
// Changing these constants will affect the appearance globally.
// For Original Paradigm, specific sizes are overridden (see below).

const START_CIRCLE_RADIUS        = 0.3;      // radius of the expanding white circle at the start of a move
const DIRECTION_LINE_RADIUS      = 0.1;      // default thickness of the white direction line (tube)
const DIRECTION_LINE_RADIUS_ORIG = 0.05;     // thinner line used in Original Paradigm Mode

// Destination disc & ring (shown at the target cell while a movement is in progress)
const DESTINATION_DISC_RADIUS    = 0.5;      // default solid white disc radius
const DESTINATION_RING_RADIUS    = 0.5;      // default white outline ring radius
const DESTINATION_DISC_RADIUS_ORIG = 0.25;   // smaller disc for Original Paradigm
const DESTINATION_RING_RADIUS_ORIG = 0.25;   // smaller ring for Original Paradigm

// Cursor / robot visual
const CURSOR_RADIUS              = 0.4;      // default red cursor radius (sphere)
const ORIGINAL_CURSOR_RADIUS     = 0.25;     // red cursor disc radius in Original Paradigm

// ──────────────────────────────────────────────────────────────────────────────

// ============================================================================
// SECTION 1: DOM CACHING
// ============================================================================
// Store references to all HTML elements we need to update or control.
// This avoids repeated document.getElementById() calls.
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
    eventMarkersIntro: document.getElementById('event-markers'),
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
    startButton: document.getElementById('start-button'),
    container: document.getElementById('container'),
};

// ============================================================================
// SECTION 2: GAME STATE
// ============================================================================
// All mutable variables that define the current experiment state.

let gameState = 'intro';                     // intro | playing
let gridSize = 4;                            // 4x4, 6x6, or 8x8 (from UI)
let currentPos = { x: 1, y: 1 };             // 1-indexed grid position of cursor (robot)
let targetPos = { x: 4, y: 4 };              // 1-indexed target position
let moveCount = 0;                           // moves made in current trial (toward a target)
let phase = 'calibration';                   // calibration | bci | manual
let totalJumps = 0;                          // total number of moves made overall (across all phases)
let targetsReached = 0;                      // number of targets reached in current phase
let breakCount = 0;                          // count of moves since last break (used to trigger breaks every 5 moves)
let jumpCounter = 0;                         // sequential jump number (used in markers)
let hudVisible = false;                      // true if HUD panels are shown
let gridNumbersVisible = false;              // true if coordinate labels are shown

// Timing and animation flags
let isPreMoveAnimating = false;              // if true, prevents new moves (used during start circle)
let circleLight = null;                      // (unused)
let currentLine = null;                      // (unused)
let destDisc = null;                         // (unused, kept for legacy)
let destRing = null;                         // (unused)
let isWaiting = false;                       // true during the post-move wait period (manual phase)
let waitTimer = null;                        // timeout handle for wait period
let WAIT_DURATION = 1000;                    // milliseconds to wait after a move (manual phase)
let MOVE_ANIMATION_DURATION = 1000;          // duration of the smooth sliding animation
let START_CIRCLE_SCALE_DURATION = 1000;      // duration of the start circle expansion

// Experiment parameters (can be adjusted via UI sliders and inputs)
let calibrationJumps = 300;                  // number of jumps in calibration phase
let bciTargets = 5;                          // number of targets in BCI/Manual phases
let maxMovesPerTarget = 50;                  // maximum moves allowed before aborting a trial
let selectedCondition = 'full';              // calibration | bci | manual | full (from UI dropdown)

// Phase definition – each phase has a type, target count, description, and color.
// The 'jumps' field is only used for calibration; others use 'targets'.
const experimentStructure = [
    { phase: 'calibration', type: 'calibration', targets: null, jumps: calibrationJumps, description: 'Calibration Phase', color: '#3182ce' },
    { phase: 'bci', type: 'bci', targets: bciTargets, jumps: null, description: 'BCI Phase', color: '#9f7aea' },
    { phase: 'manual', type: 'manual', targets: bciTargets, jumps: null, description: 'Manual Phase', color: '#63b3ed' }
];

let currentPhaseIndex = 0;                   // index into filteredExperimentStructure
let filteredExperimentStructure = [];        // after filtering by selectedCondition (e.g., only calibration+bci)
let userModel = {};                          // direction probability model (8 directions)

// Three.js globals
let scene, camera, renderer;
let cursor, targetMarker;                    // references to the 3D cursor and target objects
let animating = false;                       // true while a move animation is running
let gridCells = [];                          // array to hold all grid-related meshes for cleanup
let cellPlatforms = [];                      // (unused)
let cellBorders = [];                        // (unused)
let gridLabels = [];                         // 3D sprite labels for coordinates
let directionLabels = [];                    // 3D text sprites for N/S/E/W

// Allowed movement directions (8‑neighbour). Each has a (dx, dy) and an angle in degrees.
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

let waitingForResponse = false;              // true when waiting for user keypress in manual phase
let eventMarkers = [];                       // array of marker strings for display (and LSL)
let robotModel = null;                       // the 3D object representing the cursor
let gltfLoader = null;                       // for loading external robot model
let mixer = null;                            // animation mixer for GLTF model
let clock = new THREE.Clock();               // for animation timing

// Toggle flags (set from UI checkboxes)
let showWhiteLine = true;                    // show the white direction line?
let useCubeRobot = true;                     // if true, use simple sphere; if false, load GLTF robot
let goalStyle = 'simple';                    // 'simple' (red cube) or 'original' (animated green pyramid)
let cameraMode = '2d';                       // '2d' (top-down orthographic) or '3d' (perspective)
let snapMovement = false;                    // if true, cursor teleports instead of sliding
let originalParadigm = false;                // if true, render the original Zander et al. visual style

// Reusable Three.js meshes for dynamic visual elements.
// We create them once and reuse them each move to avoid garbage.
let reusableLine = null;                     // white tube connecting start to destination
let reusableDisc = null;                     // solid white disc at destination
let reusableRing = null;                     // white outline ring at destination
let reusableStartDisc = null;                // expanding white disc at start
let startCircleAnimId = null;                // requestAnimationFrame id for start circle animation

let pendingMove = null;                      // object describing the next move before execution
let lastMoveDirection = null;                // last direction taken (used for manual feedback)
let nodeTexture = null;                      // (unused)

// ============================================================================
// SECTION 3: WHITE PULSE OVERLAY
// ============================================================================
// A small white square that briefly appears at the bottom-left corner
// to give a subtle visual cue during movement.
// This is independent of the 3D scene.

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
        transition: opacity 0.15s ease-out;
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
// SECTION 4: LSL BRIDGE (WebSocket client)
// ============================================================================
// Connects to the Python LSL bridge (ws://localhost:8765) and sends markers
// for each jump and event. Handles reconnection attempts.

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

function sendMarkersToLSL(label, cls1, cls2) {
    // Sends a marker object with jump information.
    if (!lslWebSocket || lslWebSocket.readyState !== WebSocket.OPEN) return false;
    const data = {
        label: label,
        cls1: cls1,
        cls2: cls2,
        classifyNow: (phase === 'bci') ? "classifyNow" : null,
        phase: phase,
        jump: jumpCounter,
        gridSize: gridSize,
        target: `${targetPos.x},${targetPos.y}`,
        position: `${currentPos.x},${currentPos.y}`,
        timestamp: Date.now()
    };
    try {
        lslWebSocket.send(JSON.stringify(data));
        console.log(`📤 LSL: Jump ${jumpCounter}, ${phase} | label: ${label} | cls1: ${cls1} | cls2: ${cls2}`);
        return true;
    } catch(e) { console.error('LSL send error:', e); return false; }
}

function sendExperimentEventToLSL(eventType) {
    // Sends a simple event marker (e.g., phase_start, target_reached).
    if (!isLSLConnected) return;
    const data = {
        label: eventType,
        cls1: eventType,
        cls2: eventType,
        phase: 'event',
        jump: jumpCounter,
        gridSize: gridSize,
        target: 'event',
        position: 'event',
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
// These functions create and manage the white helper objects (line, disc, ring, start circle)
// that appear during each movement. The sizes are chosen based on originalParadigm flag.

// Helper to get the correct Y height for helper objects (they sit slightly above the grid)
function getHelperY() {
    // In Original Paradigm, helpers are lower (0.05) to match the paper's flat look.
    // In normal mode, they float a bit higher (0.35).
    return originalParadigm ? 0.05 : 0.35;
}

function initReusableVisuals() {
    // ── Direction Line (tube) ──
    if (!reusableLine) {
        const lineRadius = originalParadigm ? DIRECTION_LINE_RADIUS_ORIG : DIRECTION_LINE_RADIUS;
        const lineMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: originalParadigm ? 1.0 : 0.9,
            transparent: !originalParadigm,   // opaque in original, slightly transparent otherwise
            opacity: originalParadigm ? 1.0 : 0.95
        });
        const defaultCurve = new THREE.LineCurve3(
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(1, 0, 0)
        );
        const tubeGeo = new THREE.TubeGeometry(defaultCurve, 20, lineRadius, 8, false);
        reusableLine = new THREE.Mesh(tubeGeo, lineMat);
        reusableLine.visible = false;
        scene.add(reusableLine);
    }

    // ── Destination Disc (solid white) & Ring (outline) ──
    // These are shown at the destination cell during a movement.
    if (!reusableDisc) {
        const discRadius = originalParadigm ? DESTINATION_DISC_RADIUS_ORIG : DESTINATION_DISC_RADIUS;
        const ringRadius = originalParadigm ? DESTINATION_RING_RADIUS_ORIG : DESTINATION_RING_RADIUS;
        
        const discGeo = new THREE.CylinderGeometry(discRadius, discRadius, 0.05, 32);
        const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
        reusableDisc = new THREE.Mesh(discGeo, discMat);
        reusableDisc.visible = false;
        scene.add(reusableDisc);

        // Ring: inner = ringRadius - 0.05, outer = ringRadius (thin outline)
        const ringGeo = new THREE.RingGeometry(ringRadius - 0.05, ringRadius, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true });
        reusableRing = new THREE.Mesh(ringGeo, ringMat);
        reusableRing.rotation.x = -Math.PI / 2;
        reusableRing.visible = false;
        scene.add(reusableRing);
    }

    // ── Start Circle (expanding white disc at the start of a move) ──
    if (!reusableStartDisc) {
        const discGeo = new THREE.CylinderGeometry(START_CIRCLE_RADIUS, START_CIRCLE_RADIUS, 0.05, 32);
        const discMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
            depthTest: false,      // ensures it renders on top of grid lines
            depthWrite: false
        });
        reusableStartDisc = new THREE.Mesh(discGeo, discMat);
        reusableStartDisc.renderOrder = 1;
        reusableStartDisc.visible = false;
        reusableStartDisc.scale.set(0, 1, 0); // start with zero scale
        scene.add(reusableStartDisc);
    }
}

function updateReusableLine(fromPos, toPos) {
    // Updates the white tube to connect fromPos to toPos.
    if (!reusableLine) return;
    const spacing = 2;
    const startX = ((fromPos.x - 1) - gridSize/2 + 0.5) * spacing;
    const startZ = ((fromPos.y - 1) - gridSize/2 + 0.5) * spacing;
    const endX = ((toPos.x - 1) - gridSize/2 + 0.5) * spacing;
    const endZ = ((toPos.y - 1) - gridSize/2 + 0.5) * spacing;
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
    // Positions the white disc and ring at the destination.
    if (!reusableDisc || !reusableRing) return;
    const spacing = 2;
    const x = ((toPos.x - 1) - gridSize/2 + 0.5) * spacing;
    const z = ((toPos.y - 1) - gridSize/2 + 0.5) * spacing;
    const y = getHelperY();
    reusableDisc.position.set(x, y, z);
    reusableDisc.scale.set(1, 1, 1);
    reusableDisc.visible = showWhiteLine;
    reusableRing.position.set(x, y + 0.01, z);
    reusableRing.scale.set(1, 1, 1);
    reusableRing.visible = showWhiteLine;
}

function showStartCircleAt(fromPos) {
    // Positions the start circle at the current cursor position and makes it visible.
    if (!reusableStartDisc) return;
    const spacing = 2;
    const x = ((fromPos.x - 1) - gridSize/2 + 0.5) * spacing;
    const z = ((fromPos.y - 1) - gridSize/2 + 0.5) * spacing;
    const y = getHelperY();
    reusableStartDisc.position.set(x, y, z);
    reusableStartDisc.scale.set(0, 1, 0);
    reusableStartDisc.visible = true;
}

function animateStartCircle(onComplete) {
    // Animates the start circle scaling from 0 to 1 over START_CIRCLE_SCALE_DURATION.
    if (!reusableStartDisc) {
        if (onComplete) onComplete();
        return;
    }
    const startTime = performance.now();
    const duration = START_CIRCLE_SCALE_DURATION;
    function step() {
        const elapsed = performance.now() - startTime;
        let t = Math.min(elapsed / duration, 1);
        const scale = t;
        reusableStartDisc.scale.set(scale, 1, scale);
        if (t < 1) {
            startCircleAnimId = requestAnimationFrame(step);
        } else {
            reusableStartDisc.scale.set(1, 1, 1);
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
    // Hides all helper objects.
    if (reusableLine) reusableLine.visible = false;
    if (reusableDisc) reusableDisc.visible = false;
    if (reusableRing) reusableRing.visible = false;
    hideStartCircle();
}

// ============================================================================
// SECTION 6: MOVEMENT PIPELINE
// ============================================================================
// Functions that handle the logic of selecting a move, executing it, and animating.

function getValidDirections() {
    // Returns an array of direction keys (N, NE, E, etc.) that are within the grid bounds.
    const valid = [];
    for (const [key, d] of Object.entries(directions)) {
        const nx = currentPos.x + d.x;
        const ny = currentPos.y + d.y;
        if (nx >= 1 && nx <= gridSize && ny >= 1 && ny <= gridSize) {
            valid.push(key);
        }
    }
    return valid;
}

function prepareMove() {
    // Selects a direction, creates the jump marker, and prepares the pendingMove object.
    // Returns true if a move is ready, false otherwise.
    if (animating || waitingForResponse || !robotModel || isWaiting || isPreMoveAnimating) return false;

    const cfg = getCurrentPhaseConfig();
    if (!cfg) return false;
    if (cfg.type === 'calibration' && totalJumps >= cfg.jumps) {
        nextPhase();
        return false;
    }

    const validDirs = getValidDirections();
    if (validDirs.length === 0) return false;

    const dir = selectDirection(validDirs);
    const d = directions[dir];
    const newPos = { x: currentPos.x + d.x, y: currentPos.y + d.y };

    const angle = calculateAngleToGoal(currentPos, newPos);
    const cls = classifyAngle(angle);

    jumpCounter++;
    const marker = createJumpMarker(currentPos, newPos, dir, cls, angle);

    const spacing = 2;
    const sx = ((currentPos.x - 1) - gridSize/2 + 0.5) * spacing;
    const sz = ((currentPos.y - 1) - gridSize/2 + 0.5) * spacing;
    const ex = ((newPos.x - 1) - gridSize/2 + 0.5) * spacing;
    const ez = ((newPos.y - 1) - gridSize/2 + 0.5) * spacing;

    // Compute the rotation angle so the robot faces the direction of movement.
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
    targetRot += Math.PI; // adjust so the robot's front faces the direction

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
    // Executes the pending move:
    // 1. Shows helpers (line, destination disc & ring) and start circle.
    // 2. After 300ms, hides the helpers.
    // 3. Immediately starts robot movement (slide or snap).
    // 4. On completion, updates state and triggers wait or next move.
    if (!pendingMove) return;
    const pm = pendingMove;

    const performMove = () => {
        pm.startTime = performance.now();
        showWhitePulsePersistent();

        sendMarkersToLSL(pm.marker, pm.cls.cls1, pm.cls.cls2);
        sendEventMarker(pm.marker);
        if (phase === 'bci') sendEventMarker('classifyNow');

        // ─── Show the direction helpers ───
        updateReusableLine(pm.from, pm.to);
        updateReusableDestination(pm.to);

        // ─── Wait 300ms so the user sees the helpers ───
        setTimeout(() => {
            // Hide the line, disc, and ring (but NOT the start circle – it will hide after its animation)
            if (reusableLine) reusableLine.visible = false;
            if (reusableDisc) reusableDisc.visible = false;
            if (reusableRing) reusableRing.visible = false;

            // ─── Immediately start the robot movement ───
            robotModel.rotation.y = pm.targetRot;
            animating = true;
            pm.startTime = performance.now();

            animateRobotMoveOptimized(pm, () => {
                if (snapMovement) {
                    setTimeout(() => hideWhitePulse(), 150);
                } else {
                    hideWhitePulse();
                }

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
        }, 300); // helpers stay visible for 300ms, then disappear and move starts
    };

    showStartCircleAt(pm.from);
    animateStartCircle(performMove);
}

function animateRobotMoveOptimized(pm, onComplete) {
    // Smoothly slides the robot from start to end position.
    // If snapMovement is true, teleport instantly.
    if (snapMovement) {
        // Instant teleport.
        const ex = pm.ex, ez = pm.ez;
        const yPos = useCubeRobot ? 0.7 : 0.8;
        robotModel.position.set(ex, yPos, ez);
        if (onComplete) onComplete();
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
        if (!useCubeRobot) {
            robotModel.position.y = 0.8 + Math.sin(t * Math.PI * 2) * 0.1; // bounce during move (GLTF)
        } else {
            robotModel.position.y = 0.7; // cube stays flat during move
        }

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            robotModel.position.x = ex;
            robotModel.position.z = ez;
            if (!useCubeRobot) robotModel.position.y = 0.8;
            else robotModel.position.y = 0.7;
            if (onComplete) onComplete();
        }
    }
    step();
}

// ============================================================================
// SECTION 7: UTILITY FUNCTIONS
// ============================================================================
// Helper functions for model initialization, direction selection, angle calculation,
// classification, marker creation, and event logging.

function initUserModel() {
    // Initializes the direction probability model with uniform distribution.
    const model = {};
    Object.keys(directions).forEach(dir => { model[dir] = 1 / Object.keys(directions).length; });
    setTimeout(() => updateModelDisplay(), 100);
    return model;
}

function selectDirection(validDirs) {
    // Selects a direction based on the current phase.
    // In calibration: random uniform.
    // In BCI/Manual: weighted random based on userModel (probability distribution).
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
    // Computes the angle (in degrees) between the jump vector and the vector to the target.
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
    // Maps the angle to cls1 (toward/sideways/away) and cls2 (very good/neutral/very bad).
    let cls1 = (angle < 45) ? 'toward' : (angle > 100) ? 'away' : 'sideways';
    let cls2 = (angle < 1) ? 'very good' : (angle > 135) ? 'very bad' : 'neutral';
    return { cls1, cls2 };
}

function createJumpMarker(from, to, dir, cls, angle) {
    // Creates a string marker containing all relevant information for EEG synchronization.
    // Format: gridSize x gridSize; target coordinates; jump number; from>to; angle; cls1; cls2; phase.
    return `${gridSize}x${gridSize};g${targetPos.x}${targetPos.y};j${String(jumpCounter).padStart(3,'0')}:${from.x}${from.y}>${to.x}${to.y};ang${String(angle).padStart(3,'0')};cls1:${cls.cls1};cls2:${cls.cls2};phase:${phase}`;
}

function sendEventMarker(marker) {
    // Adds a timestamped marker to the event list and updates the textarea displays.
    const ts = new Date().toISOString();
    const full = `[${ts}] ${marker}`;
    eventMarkers.push(full);
    if (DOM.eventMarkersDisplay) {
        DOM.eventMarkersDisplay.value = eventMarkers.slice(-50).join('\n');
        DOM.eventMarkersDisplay.scrollTop = DOM.eventMarkersDisplay.scrollHeight;
    }
    if (DOM.eventMarkersIntro) {
        DOM.eventMarkersIntro.value = eventMarkers.join('\n') + '\n';
    }
    console.log('EVENT:', full);
    return full;
}

// ============================================================================
// SECTION 8: PHASE MANAGEMENT
// ============================================================================
// Functions that control the flow of phases, transitions, and completion.

function filterExperimentStructure() {
    // Filters the experimentStructure based on selectedCondition.
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
    // Displays a screen informing the user that a phase is complete.
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

function showFinalCompletion() {
    // Displays the final completion screen with a countdown.
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
        returnToStartScreen();
    }
    function listener(e) {
        if (e.code === 'Space') {
            clearInterval(interval);
            finish();
        }
    }
    window.addEventListener('keydown', listener);
}

function returnToStartScreen() {
    // Cleans up the experiment and returns to the intro screen.
    hideReusableVisuals();
    hideWhitePulse();
    hideHUD();
    toggleGridNumbers();
    DOM.introScreen.classList.remove('hidden');
    updateGraySquare('intro');
    gameState = 'intro';
    currentPhaseIndex = 0;
    targetsReached = 0;
    totalJumps = 0;
    moveCount = 0;
    breakCount = 0;
    jumpCounter = 0;
    hudVisible = false;
    gridNumbersVisible = false;
    if (lslWebSocket) lslWebSocket.close();
    isLSLConnected = false;

    reusableLine = null;
    reusableDisc = null;
    reusableRing = null;
    reusableStartDisc = null;
    nodeTexture = null;
    startCircleAnimId = null;
    pendingMove = null;

    if (renderer && scene) {
        const cont = document.getElementById('canvas-container');
        if (cont.contains(renderer.domElement)) cont.removeChild(renderer.domElement);
        scene = null; camera = null; renderer = null; robotModel = null; targetMarker = null;
        gridCells = []; cellPlatforms = []; cellBorders = []; gridLabels = [];
        mixer = null;
    }
    userModel = initUserModel();
    console.log('Returned to start screen');
}

function nextPhase() {
    hideFeedback();
    showPhaseTransition();
}

// ============================================================================
// SECTION 9: WAIT PERIOD & USER RESPONSE
// ============================================================================
// Handles the pause after a move and collects user feedback in manual phase.

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
    // Global key handler: H toggles HUD, V/B for manual feedback.
    if (e.key === 'h' || e.key === 'H') { toggleHUD(); return; }
    if (e.key === 'v' || e.key === 'V' || e.key === 'b' || e.key === 'B') {
        const btn = (e.key === 'v' || e.key === 'V') ? '50001' : '50002';
        if (lslWebSocket && lslWebSocket.readyState === WebSocket.OPEN) {
            lslWebSocket.send(JSON.stringify({ button: btn, phase, jump: jumpCounter, timestamp: Date.now() }));
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
// SECTION 10: UPDATES & UI
// ============================================================================
// Updates statistics, model display, controls panel, and feedback messages.

function updateStats() {
    // Updates the HUD panels with current phase, progress, positions, etc.
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
    DOM.gridDisplay.textContent = `${gridSize}×${gridSize}`;
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
    // Renders the direction probability model as a grid of percentages.
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
    // Draws a bar chart on the canvas showing direction probabilities.
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
    // Updates the controls panel to indicate active/inactive state.
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
    // Updates the direction probability model based on user feedback (manual phase only).
    const cfg = getCurrentPhaseConfig();
    if (!cfg || cfg.type !== 'manual') return;
    const lr = 0.25; // learning rate
    if (acceptable) {
        // Increase chosen direction, decrease opposite.
        userModel[dir] = Math.min(0.8, (userModel[dir]||0) + lr);
        const opp = { 'N':'S','S':'N','E':'W','W':'E','NE':'SW','SW':'NE','NW':'SE','SE':'NW' }[dir];
        if (opp) userModel[opp] = Math.max(0.02, (userModel[opp]||0) - lr/2);
    } else {
        // Decrease chosen direction, slightly increase perpendicular directions.
        userModel[dir] = Math.max(0.02, (userModel[dir]||0) - lr);
        const perp = { 'N':['E','W'],'S':['E','W'],'E':['N','S'],'W':['N','S'],'NE':['NW','SE'],'NW':['NE','SW'],'SE':['NE','SW'],'SW':['NW','SE'] }[dir] || [];
        perp.forEach(d => { userModel[d] = Math.min(0.8, (userModel[d]||0) + lr/3); });
    }
    // Normalize to sum to 1.
    const sum = Object.values(userModel).reduce((a,b) => a + b, 0);
    Object.keys(userModel).forEach(k => userModel[k] /= sum);
    updateModelDisplay();
}

// ============================================================================
// SECTION 11: TARGET REACHED / RESET / BREAK
// ============================================================================
// Handles reaching the target, max moves, and break screens.

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
    // Resets the cursor to a start position and chooses a new target corner.
    hideFeedback();
    hideReusableVisuals();
    userModel = initUserModel();
    const firstTrial = (targetsReached === 0 && moveCount === 0);
    if (firstTrial) {
        targetPos = { x: gridSize, y: gridSize };
    } else {
        const corner = Math.floor(Math.random()*4);
        if (corner===0) targetPos = { x: 1, y: 1 };
        else if (corner===1) targetPos = { x: gridSize, y: 1 };
        else if (corner===2) targetPos = { x: 1, y: gridSize };
        else targetPos = { x: gridSize, y: gridSize };
    }
    let start;
    if (targetPos.x===gridSize && targetPos.y===gridSize) start = { x: 2, y: 2 };
    else if (targetPos.x===gridSize && targetPos.y===1) start = { x: 2, y: Math.max(2, gridSize-1) };
    else if (targetPos.x===1 && targetPos.y===gridSize) start = { x: Math.max(2, gridSize-1), y: 2 };
    else start = { x: Math.max(2, gridSize-1), y: Math.max(2, gridSize-1) };
    if (gridSize===3) {
        if (targetPos.x===3&&targetPos.y===3) start={x:1,y:1};
        else if (targetPos.x===3&&targetPos.y===1) start={x:1,y:3};
        else if (targetPos.x===1&&targetPos.y===3) start={x:3,y:1};
        else start={x:3,y:3};
    } else if (gridSize===2) {
        if (targetPos.x===2&&targetPos.y===2) start={x:1,y:1};
        else if (targetPos.x===2&&targetPos.y===1) start={x:1,y:2};
        else if (targetPos.x===1&&targetPos.y===2) start={x:2,y:1};
        else start={x:2,y:2};
    }
    currentPos = start;
    moveCount = 0;

    // Update the 3D positions of robot and target marker.
    if (robotModel && targetMarker) {
        const sp = 2;
        const yPos = useCubeRobot ? 0.7 : 0.8;
        robotModel.position.set(((currentPos.x-1)-gridSize/2+0.5)*sp, yPos, ((currentPos.y-1)-gridSize/2+0.5)*sp);

        const tx = ((targetPos.x-1)-gridSize/2+0.5)*sp;
        const tz = ((targetPos.y-1)-gridSize/2+0.5)*sp;

        if (originalParadigm) {
            targetMarker.position.set(tx, 0.1, tz);
        } else if (goalStyle === 'simple') {
            targetMarker.position.set(tx, 0.6, tz);
        } else {
            targetMarker.position.set(tx, 0.6, tz);
            gridCells.forEach(c => {
                if (c.geometry?.type==='RingGeometry') { c.position.copy(targetMarker.position); c.position.y=0.1; }
                else if (c.geometry?.type==='CylinderGeometry' && c!==targetMarker) { c.position.copy(targetMarker.position); c.position.y=0.2; }
            });
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
// SECTION 12: CELEBRATION / BUTTON FEEDBACK
// ============================================================================
// Creates particle effects when a target is reached or a button is pressed.

function createCelebrationEffect() {
    // Spawns 20 small spheres that fly upward from the target position.
    const spacing = 2;
    const tx = ((targetPos.x-1)-gridSize/2+0.5)*spacing;
    const tz = ((targetPos.y-1)-gridSize/2+0.5)*spacing;
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
    // Creates a sphere that rises from the cursor position to indicate keypress.
    const sp = 2;
    const x = ((currentPos.x-1)-gridSize/2+0.5)*sp;
    const z = ((currentPos.y-1)-gridSize/2+0.5)*sp;
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
// SECTION 13: BREAK SCREEN
// ============================================================================
// Displays a break screen after every 5 targets (in BCI/Manual phases).

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
// SECTION 14: THREE.JS SETUP
// ============================================================================
// Functions that create the 3D scene, grid, robot, target, and reusable objects.

function create3DGridVisualization() {
    // Clears old grid meshes and rebuilds the grid based on originalParadigm flag.
    const spacing = 2;
    gridCells.forEach(c => scene.remove(c));
    gridCells = [];
    cellPlatforms = [];
    cellBorders = [];
    gridLabels.forEach(l => scene.remove(l));
    gridLabels = [];
    directionLabels.forEach(l => scene.remove(l));
    directionLabels = [];

    if (originalParadigm) {
        // ─── ORIGINAL PARADIGM: only gray lines and black nodes with white outlines ───
        // This matches the visual style of Zander et al. (2016) – no checkerboard.
        const yPosLines = 0.02;        // grid lines at ground level
        const edgeColor = 0x888888;

        const points = [];
        const nodeCoords = [];

        // Collect node coordinates
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const x = (i - gridSize/2 + 0.5) * spacing;
                const z = (j - gridSize/2 + 0.5) * spacing;
                nodeCoords.push({ x, z });
            }
        }

        const dirs = [
            [-1, -1], [0, -1], [1, -1],
            [-1,  0],          [1,  0],
            [-1,  1], [0,  1], [1,  1]
        ];

        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const idx = i * gridSize + j;
                const from = nodeCoords[idx];
                for (let d of dirs) {
                    const ni = i + d[0];
                    const nj = j + d[1];
                    if (ni >= 0 && ni < gridSize && nj >= 0 && nj < gridSize) {
                        const to = nodeCoords[ni * gridSize + nj];
                        points.push(from.x, yPosLines, from.z);
                        points.push(to.x, yPosLines, to.z);
                    }
                }
            }
        }

        // ─── EDGES (gray lines) ───
        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor });
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        scene.add(edges);
        gridCells.push(edges);

        // ─── WHITE POSITION MARKERS (black disc + white outline) ───
        // Black disc matches background (0x0a0a0a) so it appears as a hole.
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
            // Black filled disc
            const discGeo = new THREE.CircleGeometry(0.4, 32);
            const disc = new THREE.Mesh(discGeo, blackDiscMat);
            disc.position.set(coord.x, yPosLines + 0.01, coord.z);
            disc.rotation.x = -Math.PI / 2;
            scene.add(disc);
            gridCells.push(disc);

            // White outline ring – note: inner radius (0.35) is larger than outer (0.3)
            // This creates a thin ring, but the order is reversed. Typically RingGeometry(inner, outer).
            // To fix, swap to (0.3, 0.35). Keeping as-is to avoid altering the code.
            const ringGeo = new THREE.RingGeometry(0.35, 0.3, 32);
            const ring = new THREE.Mesh(ringGeo, whiteRingMat);
            ring.position.set(coord.x, yPosLines + 0.01, coord.z);
            ring.rotation.x = -Math.PI / 2;
            scene.add(ring);
            gridCells.push(ring);
        }

        return;
    }

    // ─── NORMAL MODE: checkerboard grid with 3D cells ───
    // (Code unchanged – we are not modifying the normal mode)
    const cellHeight = 0.2;
    const borderHeight = 0.3;

    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            const cellGeo = new THREE.BoxGeometry(spacing * 0.9, cellHeight, spacing * 0.9);
            const isDark = (x + y) % 2 === 0;
            const cellColor = isDark ? 0x2a2a2a : 0x333333;
            const cellMat = new THREE.MeshStandardMaterial({ color: cellColor, metalness: 0.1, roughness: 0.8 });
            const cellMesh = new THREE.Mesh(cellGeo, cellMat);
            const posX = (x - gridSize/2 + 0.5) * spacing;
            const posZ = (y - gridSize/2 + 0.5) * spacing;
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

    const groundGeo = new THREE.PlaneGeometry(gridSize * spacing * 1.5, gridSize * spacing * 1.5);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.5, roughness: 0.8 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);
    gridCells.push(ground);

    const lineHeight = 0.05;
    for (let i = 0; i <= gridSize; i++) {
        const lineGeo = new THREE.BoxGeometry(gridSize * spacing + 0.1, lineHeight, 0.1);
        const lineMat = new THREE.MeshStandardMaterial({ color: 0x666666, emissive: 0x222222, emissiveIntensity: 0.2 });
        const lineX = new THREE.Mesh(lineGeo, lineMat);
        lineX.position.set(0, cellHeight + lineHeight/2, i * spacing - gridSize * spacing / 2);
        lineX.castShadow = true;
        scene.add(lineX);
        gridCells.push(lineX);
        const lineZ = new THREE.Mesh(lineGeo, lineMat);
        lineZ.rotation.y = Math.PI / 2;
        lineZ.position.set(i * spacing - gridSize * spacing / 2, cellHeight + lineHeight/2, 0);
        lineZ.castShadow = true;
        scene.add(lineZ);
        gridCells.push(lineZ);
    }

    // ─── CREATE COORDINATE LABELS (cones + text) ───
    createCoordinateLabels(spacing);
    createGridCoordinateNumbers(spacing);
}

// ─── MODIFIED: createCoordinateLabels now hides cones in 2D ───
function createCoordinateLabels(spacing) {
    const offset = 1.3;
    createDirectionIndicator('N', 0, -gridSize * spacing / 2 - offset);
    createDirectionIndicator('S', 0,  gridSize * spacing / 2 + offset);
    createDirectionIndicator('W', -gridSize * spacing / 2 - offset, 0);
    createDirectionIndicator('E',  gridSize * spacing / 2 + offset, 0);
}

function createDirectionIndicator(dir, x, z) {
    // Always create the text label
    createTextLabel(dir, x, 1.0, z, 0.8);

    // Only create the cone if not in 2D mode
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
    // Creates a 2D sprite with text using CanvasTexture.
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
    // Adds small coordinate numbers around the grid edges and inside cells.
    const off = 0.2;
    const h = 0.5;
    for (let x = 0; x < gridSize; x++) {
        const xp = (x - gridSize/2 + 0.5) * spacing;
        const num = (x+1).toString();
        createCoordinateNumber(num, xp, h, -gridSize*spacing/2 - off, 0.4);
        createCoordinateNumber(num, xp, h,  gridSize*spacing/2 + off, 0.4);
    }
    for (let y = 0; y < gridSize; y++) {
        const zp = (y - gridSize/2 + 0.5) * spacing;
        const num = (y+1).toString();
        createCoordinateNumber(num, -gridSize*spacing/2 - off, h, zp, 0.4);
        createCoordinateNumber(num,  gridSize*spacing/2 + off, h, zp, 0.4);
    }
    for (let x=0; x<gridSize; x++) {
        for (let y=0; y<gridSize; y++) {
            if (gridSize<=6 || (x%2===0 && y%2===0)) {
                const xp = (x - gridSize/2 + 0.5) * spacing;
                const zp = (y - gridSize/2 + 0.5) * spacing;
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

// ─── MODIFIED: createCursorDisc now accepts an optional radius ───
function createCursorDisc(color = 0xffffff, renderOrder = 0, radius = CURSOR_RADIUS) {
    // Creates a flat disc – used as the robot in Original Paradigm.
    const geo = new THREE.CylinderGeometry(radius, radius, 0.1, 32);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = 0;
    disc.position.y = 0.05;
    disc.renderOrder = renderOrder;
    return disc;
}

function createCubeRobot() {
    // Returns the 3D robot object. In original mode, it's a small red disc.
    if (originalParadigm) {
        return createCursorDisc(0xff0000, 0, ORIGINAL_CURSOR_RADIUS);
    }
    // Otherwise, a red sphere (or GLTF model later).
    const cubeGeo = new THREE.SphereGeometry(CURSOR_RADIUS, 32, 16);
    const cubeMat = new THREE.MeshStandardMaterial({ color: 0xff4444, metalness: 0.0, roughness: 0.0 });
    const cube = new THREE.Mesh(cubeGeo, cubeMat);
    cube.castShadow = false;
    cube.receiveShadow = false;
    return cube;
}

function createTargetMarker() {
    // Creates the target marker. In original mode, it's a hollow red circle.
    const spacing = 2;
    const posX = ((targetPos.x - 1) - gridSize / 2 + 0.5) * spacing;
    const posZ = ((targetPos.y - 1) - gridSize / 2 + 0.5) * spacing;

    if (originalParadigm) {
        // Static hollow red circle – note the ring geometry parameters (inner, outer).
        // Currently inner=0.35, outer=0.3 – this is reversed. To have a proper ring,
        // inner should be smaller than outer. The code will still display a thin ring.
        const ringGeo = new THREE.RingGeometry(0.35, 0.3, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            side: THREE.DoubleSide,
            transparent: false
        });
        const marker = new THREE.Mesh(ringGeo, ringMat);
        marker.position.set(posX, 0.1, posZ);
        marker.rotation.x = -Math.PI / 2;
        marker.castShadow = false;
        scene.add(marker);
        return marker;
    }

    // Normal mode: red cube or animated green pyramid.
    if (goalStyle === 'simple') {
        const cubeGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const cubeMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0x330000 });
        const marker = new THREE.Mesh(cubeGeo, cubeMat);
        marker.position.set(posX, 0.6, posZ);
        marker.castShadow = false;
        scene.add(marker);
        return marker;
    }
    // Animated green pyramid with aura.
    const geo = new THREE.ConeGeometry(0.6, 1.2, 4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x44ff44, emissive: 0x00ff00, emissiveIntensity: 0.5, transparent: true, opacity: 0.9 });
    const marker = new THREE.Mesh(geo, mat);
    marker.position.set(posX, 0.6, posZ);
    marker.rotation.x = Math.PI;
    marker.castShadow = true;
    scene.add(marker);
    const auraGeo = new THREE.RingGeometry(0.8, 1.0, 32);
    const auraMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.position.copy(marker.position);
    aura.position.y = 0.1;
    aura.rotation.x = -Math.PI / 2;
    scene.add(aura);
    gridCells.push(aura);
    const pedGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.4, 8);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.5, roughness: 0.5 });
    const pedestal = new THREE.Mesh(pedGeo, pedMat);
    pedestal.position.copy(marker.position);
    pedestal.position.y = 0.2;
    pedestal.castShadow = true;
    scene.add(pedestal);
    gridCells.push(pedestal);
    return marker;
}

function initRobotLoader() {
    // Creates the robot model (simple disc/sphere or GLTF).
    if (useCubeRobot || originalParadigm) {
        robotModel = createCubeRobot();
        const spacing = 2;
        const yPos = originalParadigm ? 0.05 : 0.7;
        robotModel.position.set(((currentPos.x - 1) - gridSize / 2 + 0.5) * spacing, yPos, ((currentPos.y - 1) - gridSize / 2 + 0.5) * spacing);
        scene.add(robotModel);
        cursor = robotModel;
        if (gameState === 'playing') setTimeout(() => { if (prepareMove()) executeMove(); }, 500);
        return;
    }
    // If not using cube robot, attempt to load GLTF robot model.
    if (typeof THREE.GLTFLoader === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
        script.onload = () => { gltfLoader = new THREE.GLTFLoader(); loadRobotModel(); };
        document.head.appendChild(script);
    } else {
        gltfLoader = new THREE.GLTFLoader();
        loadRobotModel();
    }
}

function loadRobotModel() {
    // Loads the GLTF robot from a CDN.
    if (!gltfLoader) return;
    const url = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
    gltfLoader.load(url, (gltf) => {
        robotModel = gltf.scene;
        robotModel.scale.set(0.3, 0.3, 0.3);
        const spacing = 2;
        robotModel.position.set(((currentPos.x - 1) - gridSize / 2 + 0.5) * spacing, 0.3, ((currentPos.y - 1) - gridSize / 2 + 0.5) * spacing);
        robotModel.rotation.y = Math.PI;
        robotModel.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; if (child.material) child.material.emissiveIntensity = 0.2; } });
        scene.add(robotModel);
        cursor = robotModel;
        if (gltf.animations.length) {
            mixer = new THREE.AnimationMixer(robotModel);
        }
        const rlight = new THREE.PointLight(0xff4444, 0.3, 3);
        rlight.position.set(0, 1.5, 0);
        robotModel.add(rlight);
        if (gameState === 'playing') setTimeout(() => { if (prepareMove()) executeMove(); }, 500);
    }, (xhr) => console.log((xhr.loaded / xhr.total * 100) + '%'), (err) => {
        console.error(err);
        createFallbackRobotModel();
    });
}

function createFallbackRobotModel() {
    // Fallback if GLTF fails – uses a simple sphere.
    if (useCubeRobot || originalParadigm) {
        robotModel = createCubeRobot();
        const spacing = 2;
        const yPos = originalParadigm ? 0.05 : 0.7;
        robotModel.position.set(((currentPos.x - 1) - gridSize / 2 + 0.5) * spacing, yPos, ((currentPos.y - 1) - gridSize / 2 + 0.5) * spacing);
        scene.add(robotModel);
        cursor = robotModel;
        if (gameState === 'playing') setTimeout(() => { if (prepareMove()) executeMove(); }, 500);
        return;
    }
    // Build a simple block robot.
    robotModel = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), new THREE.MeshStandardMaterial({ color: 0xff4444, metalness: 0.3, roughness: 0.2 }));
    body.position.y = 0.4;
    body.castShadow = false;
    robotModel.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.1 }));
    head.position.y = 1.1;
    head.castShadow = false;
    robotModel.add(head);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5 });
    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeMat);
    leftEye.position.set(0.1, 1.15, 0.2);
    robotModel.add(leftEye);
    const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeMat);
    rightEye.position.set(-0.1, 1.15, 0.2);
    robotModel.add(rightEye);
    const armMat = new THREE.MeshStandardMaterial({ color: 0xff4444, metalness: 0.3, roughness: 0.2 });
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), armMat);
    leftArm.position.set(0.4, 0.7, 0);
    leftArm.castShadow = true;
    robotModel.add(leftArm);
    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), armMat);
    rightArm.position.set(-0.4, 0.7, 0);
    rightArm.castShadow = true;
    robotModel.add(rightArm);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.5 });
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.15), legMat);
    leftLeg.position.set(0.2, 0, 0);
    leftLeg.castShadow = true;
    robotModel.add(leftLeg);
    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.15), legMat);
    rightLeg.position.set(-0.2, 0, 0);
    rightLeg.castShadow = true;
    robotModel.add(rightLeg);
    const spacing = 2;
    robotModel.position.set(((currentPos.x - 1) - gridSize / 2 + 0.5) * spacing, 0, ((currentPos.y - 1) - gridSize / 2 + 0.5) * spacing);
    robotModel.rotation.y = Math.PI;
    scene.add(robotModel);
    cursor = robotModel;
    const rlight = new THREE.PointLight(0xff4444, 0.5, 3);
    rlight.position.set(0, 1, 0);
    robotModel.add(rlight);
    if (gameState === 'playing') setTimeout(() => { if (prepareMove()) executeMove(); }, 500);
}

// ============================================================================
// SECTION 15: THREE.JS SETUP (ZOOMED OUT & ORTHOGRAPHIC FOR 2D)
// ============================================================================
// Initializes the scene, camera, renderer, lights, and calls all creation functions.

function initThreeJS() {
    const container = document.getElementById('canvas-container');
    if (!container) {
        console.error('Canvas container not found');
        return;
    }
    scene = new THREE.Scene();
    scene.background = new THREE.Color(originalParadigm ? 0x0a0a0a : 0x000000);

    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = gridSize * 3.5;
    const shiftY = -0.5;

    if (cameraMode === '2d' || originalParadigm) {
        const half = frustumSize / 2;
        camera = new THREE.OrthographicCamera(
            -half * aspect, half * aspect,
            half, -half,
            0.1, 100
        );
        camera.position.set(0, 20, 0);
        camera.lookAt(0, shiftY, 0);
    } else {
        camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
        camera.position.set(0, 11, 14);
        camera.lookAt(0, shiftY, 0);
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

// ============================================================================
// SECTION 16: RESIZE HANDLER AND ANIMATE LOOP
// ============================================================================

function handleResize() {
    // Adjusts camera and renderer when the window is resized.
    const container = document.getElementById('canvas-container');
    if (!container || !renderer) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const aspect = width / height;

    if (camera.isOrthographicCamera) {
        const frustumSize = gridSize * 3.5;
        const half = frustumSize / 2;
        camera.left = -half * aspect;
        camera.right = half * aspect;
        camera.top = half;
        camera.bottom = -half;
        camera.updateProjectionMatrix();
    } else {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
    }
    renderer.setSize(width, height);
}

function animateScene() {
    // Main render loop – updates robot idle animation and renders the scene.
    function animate() {
        requestAnimationFrame(animate);

        if (mixer) mixer.update(clock.getDelta());

        // ─── Robot Animation ──────────────────────────────────────────────────
        // Only apply idle animation when NOT in Original Paradigm (red disc stays static).
        if (robotModel && !originalParadigm) {
            if (useCubeRobot) {
                // ── Simple sphere/cube robot ──
                if (!animating) {
                    // Idle animation: gentle bobbing and slow rotation.
                    // The base y position is 0.7; we add a sine wave.
                    robotModel.position.y = 0.7 + Math.sin(Date.now() * 0.002) * 0.05;
                    // Slowly rotate around Y axis.
                    robotModel.rotation.y += 0.003;
                }
                // When animating, the move function takes control of position.
            } else {
                // ── GLTF robot ──
                if (!animating) {
                    // Idle bob (existing) and optional rotation.
                    robotModel.position.y = 0.8 + Math.sin(Date.now() * 0.003) * 0.05;
                    // Uncomment next line to add slow rotation to GLTF robot.
                    // robotModel.rotation.y += 0.002;
                }
            }
        }

        // ─── Target Marker Animation (non-original, non-simple) ─────────────
        if (targetMarker && goalStyle !== 'simple' && !originalParadigm) {
            targetMarker.rotation.y += 0.01;
            const s = 1 + Math.sin(Date.now() * 0.002) * 0.1;
            targetMarker.scale.set(s, s, s);
            const aura = gridCells.find(obj => obj.geometry && obj.geometry.type === 'RingGeometry');
            if (aura) { aura.rotation.y += 0.005; const as = 0.9 + Math.sin(Date.now() * 0.0015) * 0.1; aura.scale.set(as, as, as); }
        }

        renderer.render(scene, camera);
    }
    animate();
}

// ============================================================================
// SECTION 17: HUD TOGGLES
// ============================================================================
// Functions to show/hide the HUD panels and coordinate labels.

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
    // Changes the small gray square at the bottom-left to indicate phase.
    if (!DOM.graySquare) return;
    DOM.graySquare.classList.remove('intro', 'calibration', 'bci', 'manual', 'break');
    DOM.graySquare.classList.add(state);
    if (state === 'intro') DOM.graySquare.style.border = '2px solid #404040';
    else DOM.graySquare.style.border = 'none';
    DOM.graySquare.style.backgroundColor = '#808080';
}

// ============================================================================
// SECTION 18: START EXPERIMENT
// ============================================================================
// Reads all UI settings, initializes the experiment, and builds the 3D scene.

function startExperiment() {
    originalParadigm = document.getElementById('toggle-original-paradigm').checked;
    showWhiteLine = document.getElementById('toggle-white-line').checked;
    useCubeRobot = document.getElementById('toggle-cube-robot').checked;
    snapMovement = document.getElementById('toggle-snap-movement').checked;

    WAIT_DURATION = parseInt(document.getElementById('wait-duration').value) || 1000;
    MOVE_ANIMATION_DURATION = parseInt(document.getElementById('move-animation-duration').value) || 1000;
    START_CIRCLE_SCALE_DURATION = parseInt(document.getElementById('start-circle-duration').value) || 1000;

    const goalStyleRadio = document.querySelector('input[name="goal-style"]:checked');
    if (goalStyleRadio) goalStyle = goalStyleRadio.value;
    const cameraModeRadio = document.querySelector('input[name="camera-mode"]:checked');
    if (cameraModeRadio) cameraMode = cameraModeRadio.value;
    gridSize = parseInt(document.getElementById('grid-size').value);
    calibrationJumps = parseInt(document.getElementById('calibration-jumps').value);
    bciTargets = parseInt(document.getElementById('bci-targets').value);
    selectedCondition = document.getElementById('condition').value;

    gameState = 'playing';
    eventMarkers = [];
    jumpCounter = 0;
    targetPos = { x: gridSize, y: gridSize };
    currentPos = { x: 2, y: 2 };

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
// SECTION 19: INIT ON LOAD
// ============================================================================
// Sets up the start button and initial UI state.

document.addEventListener('DOMContentLoaded', () => {
    DOM.startButton.addEventListener('click', startExperiment);
    userModel = initUserModel();
    updateModelDisplay();
    updateGraySquare('intro');
    ensureWhitePulseOverlay();
    hideWhitePulse();
});