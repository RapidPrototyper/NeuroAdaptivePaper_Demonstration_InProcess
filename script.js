// ============================================================================
// NEUROADAPTIVE CURSOR EXPERIMENT - Main JavaScript
// Based on "Neuroadaptive technology enables implicit cursor control 
// based on medial prefrontal cortex activity" (Zander et al., 2016)
// ============================================================================

// ============================================================================
// SECTION 1: GLOBAL VARIABLES AND CONFIGURATION
// ============================================================================

// ----------------------------
// Game State Management
// ----------------------------
let gameState = 'intro';               // Current game state ('intro', 'playing')
let gridSize = 4;                       // Grid dimensions (N x N)
let currentPos = { x: 1, y: 1 };        // Current robot position (1-based coordinates)
let targetPos = { x: 4, y: 4 };         // Target position (1-based coordinates)
let moveCount = 0;                      // Moves in current trial
let phase = 'calibration';              // Current experiment phase
let totalJumps = 0;                     // Total jumps across all phases
let targetsReached = 0;                 // Number of targets reached
let breakCount = 0;                     // Break counter
let jumpCounter = 0;                    // Global jump counter for LSL markers
let hudVisible = false;                 // HUD visibility state
let gridNumbersVisible = false;         // Grid coordinate numbers visibility

// ----------------------------
// Gray Square State Tracking
// ----------------------------
let graySquareState = 'intro';          // Tracks current gray square visual state

// ----------------------------
// Configurable Parameters
// ----------------------------
let calibrationJumps = 300;             // Number of jumps in calibration phase
let bciTargets = 5;                     // Number of targets in BCI phase
let maxMovesPerTarget = 50;             // Maximum moves per target before reset
let selectedCondition = 'full';          // Selected experiment condition

// ----------------------------
// Phase Configuration Structure
// ----------------------------
// UPDATED: Full experiment = calibration + BCI only (no manual phase)
const experimentStructure = [
    { 
        phase: 'calibration', 
        type: 'calibration', 
        targets: null, 
        jumps: calibrationJumps,
        description: 'Calibration Phase',
        color: '#3182ce'
    },
    { 
        phase: 'bci', 
        type: 'bci', 
        targets: bciTargets,
        jumps: null,
        description: 'BCI Phase',
        color: '#9f7aea'
    },
    { 
        phase: 'manual', 
        type: 'manual', 
        targets: bciTargets, 
        jumps: null,
        description: 'Manual Phase',
        color: '#63b3ed'
    }
];

let currentPhaseIndex = 0;               // Index of current phase in structure
let filteredExperimentStructure = [];    // Filtered structure based on selected condition

// ----------------------------
// User Model (Machine Learning)
// ----------------------------
let userModel = {};                     // Directional probabilities for ML

// ----------------------------
// Three.js Variables
// ----------------------------
let scene, camera, renderer;           // Three.js core objects
let cursor, targetMarker;              // Robot and target references
let animating = false;                 // Movement animation flag
let gridCells = [];                    // 3D grid cell objects
let gridLabels = [];                   // Grid label objects

// ----------------------------
// Direction Vectors (8-direction movement)
// ----------------------------
const directions = {
    'N':  { x: 0,  y: 1,  angle: 90 },      // North
    'NE': { x: 1,  y: 1,  angle: 45 },      // Northeast
    'E':  { x: 1,  y: 0,  angle: 0 },       // East
    'SE': { x: 1,  y: -1, angle: -45 },     // Southeast
    'S':  { x: 0,  y: -1, angle: -90 },     // South
    'SW': { x: -1, y: -1, angle: -135 },    // Southwest
    'W':  { x: -1, y: 0,  angle: 180 },     // West
    'NW': { x: -1, y: 1,  angle: 135 }      // Northwest
};

// ----------------------------
// Current Move Tracking
// ----------------------------
let currentMove = null;                 // Current move data
let waitingForResponse = false;         // Manual phase response flag

// ----------------------------
// Event Marker System (EEG Sync)
// ----------------------------
let eventMarkers = [];                  // EEG synchronization markers

// ----------------------------
// GLTF Loader for Robot Model
// ----------------------------
let robotModel = null;                  // Loaded 3D robot model
let gltfLoader = null;                  // GLTF loader instance
let mixer = null;                       // Animation mixer
let clock = new THREE.Clock();          // Three.js clock for animations
// Add these after existing global variables
let isWaiting = false;                    // Flag for wait period between movements
let waitTimer = null;                     // Timer for wait period
const WAIT_DURATION = 3000;                // Wait time before next movement (ms)
const MOVE_ANIMATION_DURATION = 500;      // Robot movement animation duration (ms)
// ============================================================================
// SECTION 2: GRAY SQUARE STATUS INDICATOR
// ============================================================================

/**
 * Updates gray square color based on experiment state
 * @param {string} state - Current state ('intro', 'calibration', 'bci', 'manual', 'break')
 */
function updateGraySquare(state) {
    const graySquare = document.getElementById('gray-square');
    if (!graySquare) return;
    
    // Remove all state classes
    graySquare.classList.remove('intro', 'calibration', 'bci', 'manual', 'break');
    
    // Add new state class
    graySquare.classList.add(state);
    
    // Store current state
    graySquareState = state;
    
    // Apply border only for intro state
    if (state === 'intro') {
        graySquare.style.border = '2px solid #404040';
    } else {
        graySquare.style.border = 'none';
    }
    
    console.log(`Gray square updated to: ${state} ${state === 'intro' ? '(with border)' : '(no border)'}`);
}

/**
 * Flashes gray square white when robot moves
 */
function flashGraySquareWhite() {
    const graySquare = document.getElementById('gray-square');
    if (!graySquare) return;
    
    // First remove any border
    graySquare.style.border = 'none';
    
    // Add flash animation
    graySquare.classList.add('flash-white');
    
    // Remove after animation completes
    setTimeout(() => {
        graySquare.classList.remove('flash-white');
        
        // Restore to current state color
        graySquare.classList.remove('intro', 'calibration', 'bci', 'manual', 'break');
        graySquare.classList.add(graySquareState);
        
        // Ensure border stays removed after flash (except for intro)
        if (graySquareState !== 'intro') {
            graySquare.style.border = 'none';
        }
    }, 200); // Flash for 200ms
}

/**
 * Ensures gray square is always visible
 */
function ensureGraySquareVisible() {
    const graySquare = document.getElementById('gray-square');
    if (graySquare) {
        graySquare.classList.remove('hidden');
    }
}

// ============================================================================
// SECTION 3: LSL BRIDGE CONFIGURATION
// ============================================================================

// ----------------------------
// LSL WebSocket Connection
// ----------------------------
let lslWebSocket = null;                // WebSocket connection to LSL bridge
let isLSLConnected = false;             // Connection status flag
let wsReconnectAttempts = 0;            // Reconnection attempt counter
const MAX_RECONNECT_ATTEMPTS = 5;       // Maximum reconnection attempts

/**
 * Initializes WebSocket connection to LSL bridge
 */
function initializeLSLBridge() {
    const wsUrl = 'ws://localhost:8765';
    
    console.log('🔌 Connecting to LSL Bridge at:', wsUrl);
    
    lslWebSocket = new WebSocket(wsUrl);
    
    // WebSocket event handlers
    lslWebSocket.onopen = () => {
        console.log('✅ Connected to LSL Bridge');
        isLSLConnected = true;
        wsReconnectAttempts = 0;
        
        // Update status indicator (only if HUD is visible)
        if (hudVisible) {
            updateLSLStatus(true);
        }
        
        // Visual feedback
        showFeedback('LSL Bridge Connected');
        setTimeout(() => hideFeedback(), 2000);
    };
    
    lslWebSocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.status === 'received') {
                console.log('📬 LSL Bridge acknowledged receipt');
            }
        } catch (e) {
            console.log('Received from LSL Bridge:', event.data);
        }
    };
    
    lslWebSocket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        isLSLConnected = false;
        if (hudVisible) {
            updateLSLStatus(false);
        }
    };
    
    lslWebSocket.onclose = () => {
        console.log('⚠️ WebSocket connection closed');
        isLSLConnected = false;
        if (hudVisible) {
            updateLSLStatus(false);
        }
        
        // Attempt reconnection
        if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            wsReconnectAttempts++;
            console.log(`↻ Reconnecting in 3 seconds... (Attempt ${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(() => initializeLSLBridge(), 3000);
        } else {
            console.error('❌ Max reconnection attempts reached. LSL Bridge disconnected.');
            showFeedback('LSL Bridge disconnected. Check Python server.');
            setTimeout(() => hideFeedback(), 3000);
        }
    };
}

/**
 * Updates LSL connection status in UI
 * @param {boolean} connected - Connection status
 */
function updateLSLStatus(connected) {
    const statusEl = document.getElementById('lsl-status');
    const statusText = document.getElementById('lsl-status-text-value');
    
    if (statusEl && statusText) {
        if (connected) {
            statusEl.classList.add('connected');
            statusText.textContent = 'Connected';
            statusText.style.color = '#10b981';
        } else {
            statusEl.classList.remove('connected');
            statusText.textContent = 'Disconnected';
            statusText.style.color = '#ef4444';
        }
        
        // Only show if HUD is visible AND we're in the experiment
        if (!hudVisible || gameState !== 'playing') {
            statusEl.classList.add('hidden');
        } else {
            statusEl.classList.remove('hidden');
        }
    }
}

/**
 * Sends markers to LSL bridge in the correct format - UPDATED FOR ALL PHASES
 * @param {string} label - Detailed marker string
 * @param {string} cls1 - Direction classification
 * @param {string} cls2 - Quality classification
 * @returns {boolean} Success status
 */
function sendMarkersToLSL(label, cls1, cls2) {
    if (!lslWebSocket || lslWebSocket.readyState !== WebSocket.OPEN) {
        console.warn('LSL Bridge not connected');
        return false;
    }
    
    // REMOVED: Phase restriction - now sends in all phases
    
    const data = {
        label: label,            // "4x4;g41;j084:33>34;ang001;cls1:away;cls2:very bad;phase:calibration"
        cls1: cls1,              // "away"
        cls2: cls2,              // "very bad"
        classifyNow: (phase === 'bci') ? "classifyNow" : null,  // Only send classifyNow for BCI phase
        phase: phase,
        jump: jumpCounter,
        gridSize: gridSize,
        target: `${targetPos.x},${targetPos.y}`,
        position: `${currentPos.x},${currentPos.y}`,
        timestamp: Date.now()
    };
    
    try {
        lslWebSocket.send(JSON.stringify(data));
        console.log(`📤 LSL (single stream): Jump ${jumpCounter}, Phase: ${phase}`);
        console.log(`   label: ${label}`);
        console.log(`   cls1: ${cls1}`);
        console.log(`   cls2: ${cls2}`);
        if (phase === 'bci') {
            console.log(`   classifyNow: classifyNow`);
        }
        return true;
    } catch (error) {
        console.error('Error sending to LSL Bridge:', error);
        return false;
    }
}

/**
 * Sends experiment event to LSL bridge
 * @param {string} eventType - Type of event
 */
function sendExperimentEventToLSL(eventType) {
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
        } catch (error) {
            console.error('Error sending event to LSL:', error);
        }
    }
}

// ============================================================================
// SECTION 4: INITIALIZATION FUNCTIONS
// ============================================================================

/**
 * Initializes user model with equal probabilities for all directions
 * @returns {Object} Initialized user model
 */
function initUserModel() {
    const model = {};
    const dirKeys = Object.keys(directions);
    dirKeys.forEach(dir => {
        model[dir] = 1 / dirKeys.length;
    });
    
    // Initialize visualization
    setTimeout(() => updateModelDisplay(), 100);
    
    return model;
}

/**
 * Initializes Three.js scene for 3D visualization
 */
function initThreeJS() {
    const canvasContainer = document.getElementById('canvas-container');
    
    if (!canvasContainer) {
        console.error('Canvas container not found!');
        return;
    }
    
    try {
        // ----------------------------
        // Scene Setup
        // ----------------------------
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        
        // ----------------------------
        // Camera Setup
        // ----------------------------
        camera = new THREE.PerspectiveCamera(
            60,
            canvasContainer.clientWidth / canvasContainer.clientHeight,
            0.1,
            1000
        );
        // Position camera to look down from top with better 3D angle
        camera.position.set(0, 11, -14);
        camera.lookAt(0, 0, 0);

        // ----------------------------
        // Renderer Setup
        // ----------------------------
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        canvasContainer.appendChild(renderer.domElement);
        
        // ----------------------------
        // Lighting Setup
        // ----------------------------
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);
        
        // Main directional light with shadows
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -20;
        directionalLight.shadow.camera.right = 20;
        directionalLight.shadow.camera.top = 20;
        directionalLight.shadow.camera.bottom = -20;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 50;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        scene.add(directionalLight);
        
        // Add fill light from opposite side
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-10, 10, -10);
        scene.add(fillLight);
        
        // Add point light for robot highlighting
        const pointLight = new THREE.PointLight(0xff4444, 0.5, 10);
        pointLight.position.set(0, 3, 0);
        scene.add(pointLight);
        
        // ----------------------------
        // Create 3D Elements
        // ----------------------------
        create3DGridVisualization();  // Grid visualization
        initRobotLoader();             // Load robot model
        createTargetMarker();          // Create target marker
        
        // ----------------------------
        // Start Animation Loop
        // ----------------------------
        animateScene();
        
        // Handle window resize
        window.addEventListener('resize', handleResize);
        
        console.log('Three.js initialized successfully');
        
    } catch (error) {
        console.error('Error initializing Three.js:', error);
        showFeedback('Error initializing 3D graphics. Please refresh the page.');
    }
    
    // Initialize user model
    userModel = initUserModel();
    updateModelDisplay();
    
    // Start first movement after delay (once robot is loaded)
    setTimeout(() => {
        if (robotModel) {
            moveCursor();
        }
    }, 1000);
}

/**
 * Initializes GLTF loader and loads robot model
 */
function initRobotLoader() {
    // Check if THREE.GLTFLoader exists
    if (typeof THREE.GLTFLoader === 'undefined') {
        // Dynamically load GLTFLoader if not available
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
        script.onload = function() {
            gltfLoader = new THREE.GLTFLoader();
            loadRobotModel();
        };
        document.head.appendChild(script);
    } else {
        gltfLoader = new THREE.GLTFLoader();
        loadRobotModel();
    }
}

/**
 * Loads robot 3D model
 */
function loadRobotModel() {
    if (!gltfLoader) return;
    
    // Simple robot model URL (using a free 3D model from Three.js examples)
    const robotModelURL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
    
    gltfLoader.load(
        robotModelURL,
        function(gltf) {
            console.log('Robot model loaded successfully');
            robotModel = gltf.scene;
            
            // Scale and position the robot
            robotModel.scale.set(0.3, 0.3, 0.3);
            
            // Convert 1-based coordinates to Three.js coordinates
            const spacing = 2;
            robotModel.position.set(
                ((currentPos.x - 1) - gridSize/2 + 0.5) * spacing,
                0.3, // Height adjustment
                ((currentPos.y - 1) - gridSize/2 + 0.5) * spacing
            );
            
            // Rotate robot to face forward
            robotModel.rotation.y = Math.PI;
            
            // Enable shadows
            robotModel.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
                    // Make the robot more visible
                    if (child.material) {
                        child.material.emissive = new THREE.Color(0x333333);
                        child.material.emissiveIntensity = 0.2;
                    }
                }
            });
            
            // Add robot to scene
            scene.add(robotModel);
            cursor = robotModel; // Set cursor reference to robot model
            
            // Set up animation mixer if animations exist
            if (gltf.animations && gltf.animations.length) {
                mixer = new THREE.AnimationMixer(robotModel);
                const action = mixer.clipAction(gltf.animations[0]);
                action.play();
            }
            
            // Add robot's own point light
            const robotLight = new THREE.PointLight(0xff4444, 0.3, 3);
            robotLight.position.set(0, 1.5, 0);
            robotModel.add(robotLight);
            
            // Add a subtle glow effect
            const robotGlow = new THREE.PointLight(0xff0000, 0.2, 2);
            robotGlow.position.set(0, 1, 0);
            robotModel.add(robotGlow);
            
            // Start movement if game is ready
            if (gameState === 'playing') {
                setTimeout(() => moveCursor(), 500);
            }
        },
        function(xhr) {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        function(error) {
            console.error('Error loading robot model:', error);
            // Fallback: create a simple robot model
            createFallbackRobotModel();
        }
    );
}

/**
 * Creates a simple robot model as fallback
 */
function createFallbackRobotModel() {
    console.log('Creating fallback robot model');
    
    // Create a group for the robot
    robotModel = new THREE.Group();
    
    // Robot body (cube)
    const bodyGeometry = new THREE.BoxGeometry(0.6, 0.8, 0.4);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xff4444,
        metalness: 0.3,
        roughness: 0.2
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.4;
    body.castShadow = true;
    robotModel.add(body);
    
    // Robot head (sphere)
    const headGeometry = new THREE.SphereGeometry(0.25, 16, 16);
    const headMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffffff,
        metalness: 0.4,
        roughness: 0.1
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.1;
    head.castShadow = true;
    robotModel.add(head);
    
    // Eyes
    const eyeGeometry = new THREE.SphereGeometry(0.05, 8, 8);
    const eyeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 0.5
    });
    
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(0.1, 1.15, 0.2);
    robotModel.add(leftEye);
    
    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(-0.1, 1.15, 0.2);
    robotModel.add(rightEye);
    
    // Arms
    const armGeometry = new THREE.BoxGeometry(0.1, 0.6, 0.1);
    const armMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xff4444,
        metalness: 0.3,
        roughness: 0.2
    });
    
    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(0.4, 0.7, 0);
    leftArm.castShadow = true;
    robotModel.add(leftArm);
    
    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(-0.4, 0.7, 0);
    rightArm.castShadow = true;
    robotModel.add(rightArm);
    
    // Legs
    const legGeometry = new THREE.BoxGeometry(0.15, 0.4, 0.15);
    const legMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x333333,
        metalness: 0.5,
        roughness: 0.5
    });
    
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(0.2, 0, 0);
    leftLeg.castShadow = true;
    robotModel.add(leftLeg);
    
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(-0.2, 0, 0);
    rightLeg.castShadow = true;
    robotModel.add(rightLeg);
    
    // Position the robot
    const spacing = 2;
    robotModel.position.set(
        ((currentPos.x - 1) - gridSize/2 + 0.5) * spacing,
        0.0,
        ((currentPos.y - 1) - gridSize/2 + 0.5) * spacing
    );
    
    // Rotate robot to face forward
    robotModel.rotation.y = Math.PI;
    
    // Add robot to scene
    scene.add(robotModel);
    cursor = robotModel;
    
    // Add robot light
    const robotLight = new THREE.PointLight(0xff4444, 0.5, 3);
    robotLight.position.set(0, 1.0, 0);
    robotModel.add(robotLight);
}

/**
 * Creates 3D grid visualization with depth and elevation
 */
function create3DGridVisualization() {
    const spacing = 2;
    const cellHeight = 0.2;
    const borderHeight = 0.3;
    
    // Clear any existing grid cells and labels
    gridCells.forEach(cell => scene.remove(cell));
    gridCells = [];
    gridLabels.forEach(label => scene.remove(label));
    gridLabels = [];
    
    // Create individual 3D grid cells
    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            // Create elevated cell platform
            const cellGeometry = new THREE.BoxGeometry(
                spacing * 0.9, 
                cellHeight, 
                spacing * 0.9
            );
            
            // Alternate colors for checkerboard pattern
            const isDark = (x + y) % 2 === 0;
            const cellColor = isDark ? 0x2a2a2a : 0x333333;
            
            const cellMaterial = new THREE.MeshStandardMaterial({ 
                color: cellColor,
                metalness: 0.1,
                roughness: 0.8
            });
            
            const cell = new THREE.Mesh(cellGeometry, cellMaterial);
            cell.position.set(
                (x - gridSize/2 + 0.5) * spacing,
                cellHeight / 2,
                (y - gridSize/2 + 0.5) * spacing
            );
            cell.receiveShadow = true;
            scene.add(cell);
            gridCells.push(cell);
            
            // Create cell border/walls for 3D effect
            createCellBorder(x, y, spacing, borderHeight);
        }
    }
    
    // Create ground plane beneath grid
    const groundGeometry = new THREE.PlaneGeometry(
        gridSize * spacing * 1.5, 
        gridSize * spacing * 1.5
    );
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x1a1a2e,
        metalness: 0.5,
        roughness: 0.8
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);
    
    // Create grid lines on top of cells
    create3DGridLines(spacing, cellHeight);
    
    // Add coordinate labels for better orientation
    createCoordinateLabels(spacing);
    
    // Add grid coordinate numbers
    createGridCoordinateNumbers(spacing);
}

/**
 * Creates cell borders for 3D effect
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} spacing - Cell spacing
 * @param {number} borderHeight - Border height
 */
function createCellBorder(x, y, spacing, borderHeight) {
    const borderGeometry = new THREE.BoxGeometry(
        spacing * 0.95, 
        borderHeight, 
        spacing * 0.95
    );
    const borderMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x555555,
        metalness: 0.3,
        roughness: 0.7
    });
    
    const border = new THREE.Mesh(borderGeometry, borderMaterial);
    border.position.set(
        (x - gridSize/2 + 0.5) * spacing,
        borderHeight / 2,
        (y - gridSize/2 + 0.5) * spacing
    );
    border.receiveShadow = true;
    border.castShadow = true;
    scene.add(border);
    gridCells.push(border);
}

/**
 * Creates 3D grid lines with depth
 * @param {number} spacing - Cell spacing
 * @param {number} cellHeight - Cell height
 */
function create3DGridLines(spacing, cellHeight) {
    const lineHeight = 0.05;
    
    // Horizontal lines (North/South lines)
    for (let i = 0; i <= gridSize; i++) {
        const lineGeometry = new THREE.BoxGeometry(
            gridSize * spacing + 0.1, 
            lineHeight, 
            0.1
        );
        const lineMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x666666,
            emissive: 0x222222,
            emissiveIntensity: 0.2
        });
        const line = new THREE.Mesh(lineGeometry, lineMaterial);
        line.position.set(
            0,
            cellHeight + lineHeight/2,
            i * spacing - gridSize * spacing / 2
        );
        line.castShadow = true;
        scene.add(line);
        gridCells.push(line);
    }
    
    // Vertical lines (East/West lines)
    for (let i = 0; i <= gridSize; i++) {
        const lineGeometry = new THREE.BoxGeometry(
            0.1, 
            lineHeight, 
            gridSize * spacing + 0.1
        );
        const lineMaterial = new THREE.MeshStandardMaterial({ 
            color: 0x666666,
            emissive: 0x222222,
            emissiveIntensity: 0.2
        });
        const line = new THREE.Mesh(lineGeometry, lineMaterial);
        line.position.set(
            i * spacing - gridSize * spacing / 2,
            cellHeight + lineHeight/2,
            0
        );
        line.castShadow = true;
        scene.add(line);
        gridCells.push(line);
    }
}

/**
 * Creates coordinate labels for better orientation
 * @param {number} spacing - Cell spacing
 */
function createCoordinateLabels(spacing) {
    const labelOffset = 1.3;
    
    // Create directional indicators
    createDirectionIndicator('N', 0, gridSize * spacing / 2 + labelOffset, spacing);
    createDirectionIndicator('S', 0, -gridSize * spacing / 2 - labelOffset, spacing);
    createDirectionIndicator('W', gridSize * spacing / 2 + labelOffset, 0, spacing);
    createDirectionIndicator('E', -gridSize * spacing / 2 - labelOffset, 0, spacing);
}

/**
 * Creates direction indicator arrow
 * @param {string} direction - Direction ('N', 'S', 'E', 'W')
 * @param {number} x - X position
 * @param {number} z - Z position
 * @param {number} spacing - Cell spacing
 */
function createDirectionIndicator(direction, x, z, spacing) {
    // Create arrow shape
    const arrowGeometry = new THREE.ConeGeometry(0.4, 0.9, 7);
    const arrowMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x63b3ed,
        emissive: 0x3182ce,
        emissiveIntensity: 0.3
    });
    const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
    
    // Position and rotate based on direction
    arrow.position.set(x, 0, z);
    
    switch(direction) {
        case 'N': arrow.rotation.y = 0; break;
        case 'S': arrow.rotation.y = Math.PI; break;
        case 'E': arrow.rotation.y = -Math.PI / 2; break;
        case 'W': arrow.rotation.y = Math.PI / 2; break;
    }
    
    arrow.castShadow = true;
    scene.add(arrow);
    gridCells.push(arrow);
    
    // Add text label
    createTextLabel(direction, x, 1.0, z, 0.8);
}

/**
 * Creates text label for direction
 * @param {string} text - Label text
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} z - Z position
 * @param {number} size - Label size
 */
function createTextLabel(text, x, y, z, size) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 256;
    
    context.fillStyle = '#ede663ff';
    context.font = 'bold 180px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 128);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    scene.add(sprite);
    gridCells.push(sprite);
}

/**
 * Creates grid coordinate numbers (X and Y axes labels)
 * @param {number} spacing - Cell spacing
 */
function createGridCoordinateNumbers(spacing) {
    const labelOffset = 0.2;
    const labelHeight = 0.5;
    
    // Create X-axis labels (columns) - 1-based numbering
    for (let x = 0; x < gridSize; x++) {
        const xPos = (x - gridSize/2 + 0.5) * spacing;
        const zPos = -gridSize * spacing / 2 - labelOffset;
        
        // Create column number (1-based)
        const columnNumber = x + 1;
        createCoordinateNumber(columnNumber.toString(), xPos, labelHeight, zPos, 0.4);
        
        // Also create labels on the opposite side
        const zPosTop = gridSize * spacing / 2 + labelOffset;
        createCoordinateNumber(columnNumber.toString(), xPos, labelHeight, zPosTop, 0.4);
    }
    
    // Create Y-axis labels (rows) - 1-based numbering
    for (let y = 0; y < gridSize; y++) {
        const xPos = -gridSize * spacing / 2 - labelOffset;
        const zPos = (y - gridSize/2 + 0.5) * spacing;
        
        // Create row number (1-based)
        const rowNumber = y + 1;
        createCoordinateNumber(rowNumber.toString(), xPos, labelHeight, zPos, 0.4);
        
        // Also create labels on the opposite side
        const xPosRight = gridSize * spacing / 2 + labelOffset;
        createCoordinateNumber(rowNumber.toString(), xPosRight, labelHeight, zPos, 0.4);
    }
    
    // Create corner labels with coordinates
    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            // Only label every cell for smaller grids, or every other for larger
            if (gridSize <= 6 || (x % 2 === 0 && y % 2 === 0)) {
                const xPos = (x - gridSize/2 + 0.5) * spacing;
                const zPos = (y - gridSize/2 + 0.5) * spacing;
                
                // Create coordinate label (x,y) - 1-based
                const coordLabel = `${x+1},${y+1}`;
                createCellCoordinateLabel(coordLabel, xPos, 0.3, zPos, 0.3);
            }
        }
    }
}

/**
 * Creates coordinate number sprite
 * @param {string} text - Number text
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} z - Z position
 * @param {number} size - Sprite size
 */
function createCoordinateNumber(text, x, y, z, size) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 128;
    
    // Clear with transparent background
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw number with glow effect
    context.shadowColor = '#63b3ed';
    context.shadowBlur = 10;
    context.fillStyle = '#ffffff';
    context.font = 'bold 80px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 64, 64);
    context.shadowBlur = 0;
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    scene.add(sprite);
    gridLabels.push(sprite);
}

/**
 * Creates cell coordinate label
 * @param {string} text - Coordinate text
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} z - Z position
 * @param {number} size - Label size
 */
function createCellCoordinateLabel(text, x, y, z, size) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 64;
    
    // Clear with transparent background
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw coordinate with subtle effect
    context.fillStyle = 'rgba(99, 179, 237, 0.7)';
    context.font = 'bold 30px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 64, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true,
        opacity: 0.6
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size/2, 1);
    scene.add(sprite);
    gridLabels.push(sprite);
}

/**
 * Toggles grid numbers visibility
 */
function toggleGridNumbers() {
    gridNumbersVisible = !gridNumbersVisible;
    
    // Show/hide all grid labels
    gridLabels.forEach(label => {
        label.visible = gridNumbersVisible;
    });
    
    // Show feedback
    const feedbackMessage = gridNumbersVisible ? 'Grid numbers shown' : 'Grid numbers hidden';
    const feedbackPanel = document.getElementById('feedback-panel');
    feedbackPanel.textContent = feedbackMessage;
    feedbackPanel.classList.add('hidden');
    
    setTimeout(() => {
        feedbackPanel.classList.remove('hidden');
    }, 100);
}

/**
 * Creates target marker (replaces createCursorAndTarget since cursor is now robot)
 */
function createTargetMarker() {
    const spacing = 2;
    
    // Create target marker (animated crystal/pyramid)
    const targetGeometry = new THREE.ConeGeometry(0.6, 1.2, 4);
    const targetMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x44ff44,
        emissive: 0x00ff00,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.9,
        metalness: 0.4,
        roughness: 0.1
    });
    targetMarker = new THREE.Mesh(targetGeometry, targetMaterial);
    // Convert 1-based coordinates
    targetMarker.position.set(
        ((targetPos.x - 1) - gridSize/2 + 0.5) * spacing,
        0.6,
        ((targetPos.y - 1) - gridSize/2 + 0.5) * spacing
    );
    targetMarker.rotation.x = Math.PI;
    targetMarker.castShadow = true;
    targetMarker.receiveShadow = true;
    scene.add(targetMarker);
    
    // Add target glow/aura
    const targetAuraGeometry = new THREE.RingGeometry(0.8, 1.0, 32);
    const targetAuraMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.3
    });
    const targetAura = new THREE.Mesh(targetAuraGeometry, targetAuraMaterial);
    targetAura.position.copy(targetMarker.position);
    targetAura.position.y = 0.1;
    targetAura.rotation.x = -Math.PI / 2;
    scene.add(targetAura);
    gridCells.push(targetAura);
    
    // Create pedestal for target
    const pedestalGeometry = new THREE.CylinderGeometry(0.3, 0.4, 0.4, 8);
    const pedestalMaterial = new THREE.MeshStandardMaterial({
        color: 0x888888,
        metalness: 0.5,
        roughness: 0.5
    });
    const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial);
    pedestal.position.copy(targetMarker.position);
    pedestal.position.y = 0.2;
    pedestal.castShadow = true;
    scene.add(pedestal);
    gridCells.push(pedestal);
}

/**
 * Animation loop for Three.js scene
 */
function animateScene() {
    function animate() {
        requestAnimationFrame(animate);
        
        // Update animation mixer if it exists
        if (mixer) {
            const delta = clock.getDelta();
            mixer.update(delta);
        }
        
        // Animate robot movement and rotation
        if (robotModel) {
            // Subtle bobbing animation
            robotModel.position.y = 0.8 + Math.sin(Date.now() * 0.003) * 0.05;
            
            // Subtle rotation for idle animation
            robotModel.rotation.y += 0.001;
        }
        
        // Animate target rotation and pulsing
        if (targetMarker) {
            targetMarker.rotation.y += 0.01;
            const pulseScale = 1 + Math.sin(Date.now() * 0.002) * 0.1;
            targetMarker.scale.set(pulseScale, pulseScale, pulseScale);
            
            // Animate target aura
            const targetAura = gridCells.find(obj => obj.geometry && obj.geometry.type === 'RingGeometry');
            if (targetAura) {
                targetAura.rotation.y += 0.005;
                const auraScale = 0.9 + Math.sin(Date.now() * 0.0015) * 0.1;
                targetAura.scale.set(auraScale, auraScale, auraScale);
            }
        }
        
        // Add subtle animation to grid cells
        gridCells.forEach((cell, index) => {
            if (cell.material && cell.material.emissive) {
                // Pulse emissive intensity
                const pulse = 0.1 + Math.sin(Date.now() * 0.001 + index * 0.1) * 0.05;
                cell.material.emissiveIntensity = pulse;
            }
        });
        
        // Add subtle pulsing animation to grid labels (only if visible)
        if (gridNumbersVisible) {
            gridLabels.forEach((label, index) => {
                if (label.material) {
                    const pulse = 0.6 + Math.sin(Date.now() * 0.001 + index * 0.05) * 0.2;
                    label.material.opacity = pulse;
                }
            });
        }
        
        renderer.render(scene, camera);
    }
    animate();
}

/**
 * Handles window resize for Three.js
 */
function handleResize() {
    const canvasContainer = document.getElementById('canvas-container');
    camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
}

// ============================================================================
// SECTION 5: EVENT MARKER SYSTEM
// ============================================================================

/**
 * Sends event marker for EEG synchronization
 * @param {string} marker - Marker text
 * @returns {string} Full marker string with timestamp
 */
function sendEventMarker(marker) {
    const timestamp = new Date().toISOString();
    const fullMarker = `[${timestamp}] ${marker}`;
    eventMarkers.push(fullMarker);
    
    // Update display in the visible panel
    const markerDisplay = document.getElementById('event-markers-display');
    if (markerDisplay) {
        const displayMarkers = eventMarkers.slice(-50);
        markerDisplay.value = displayMarkers.join('\n');
        markerDisplay.scrollTop = markerDisplay.scrollHeight;
    }
    
    // Update intro screen textarea
    const markerTextarea = document.getElementById('event-markers');
    if (markerTextarea) {
        markerTextarea.value = eventMarkers.join('\n') + '\n';
        markerTextarea.scrollTop = markerTextarea.scrollHeight;
    }
    
    console.log('EVENT MARKER:', fullMarker);
    
    return fullMarker;
}

/**
 * Calculates angle between jump direction and goal direction
 * @param {Object} fromPos - Starting position
 * @param {Object} toPos - Ending position
 * @returns {number} Angle in degrees
 */
function calculateAngleToGoal(fromPos, toPos) {
    const jumpDir = {
        x: toPos.x - fromPos.x,
        y: toPos.y - fromPos.y
    };
    
    const goalDir = {
        x: targetPos.x - fromPos.x,
        y: targetPos.y - fromPos.y
    };
    
    const dotProduct = jumpDir.x * goalDir.x + jumpDir.y * goalDir.y;
    const jumpMagnitude = Math.sqrt(jumpDir.x * jumpDir.x + jumpDir.y * jumpDir.y);
    const goalMagnitude = Math.sqrt(goalDir.x * goalDir.x + goalDir.y * goalDir.y);
    
    if (jumpMagnitude === 0 || goalMagnitude === 0) return 0;
    
    const cosAngle = dotProduct / (jumpMagnitude * goalMagnitude);
    const clampedCos = Math.max(-1, Math.min(1, cosAngle));
    const angleDeg = Math.acos(clampedCos) * (180 / Math.PI);
    
    return Math.round(angleDeg);
}

/**
 * Classifies angle into movement categories - BOTH CLASSIFICATIONS
 * @param {number} angle - Angle in degrees
 * @returns {Object} Classification object with cls1 and cls2
 */
function classifyAngle(angle) {
    // Classification 1: toward/away/sideways
    let cls1;
    if (angle < 45) {
        cls1 = 'toward';
    } else if (angle > 100) {
        cls1 = 'away';
    } else {
        cls1 = 'sideways';
    }
    
    // Classification 2: very good/neutral/very bad
    let cls2;
    if (angle < 1) {
        cls2 = 'very good';
    } else if (angle > 135) {
        cls2 = 'very bad';
    } else {
        cls2 = 'neutral';
    }
    
    return { cls1, cls2 };
}

/**
 * Creates jump marker with classification data - UPDATED FORMAT with phase info
 * @param {Object} fromPos - Starting position
 * @param {Object} toPos - Ending position
 * @param {string} direction - Movement direction
 * @param {Object} classification - Classification object
 * @returns {string} Formatted marker string
 */
function createJumpMarker(fromPos, toPos, direction, classification) {
    const angle = calculateAngleToGoal(fromPos, toPos);
    
    // Updated format: 4x4;g41;j084:33>34;ang001;cls1:away;cls2:very bad;phase:calibration
    const marker = `${gridSize}x${gridSize};g${targetPos.x}${targetPos.y};j${String(jumpCounter).padStart(3, '0')}:${fromPos.x}${fromPos.y}>${toPos.x}${toPos.y};ang${String(angle).padStart(3, '0')};cls1:${classification.cls1};cls2:${classification.cls2};phase:${phase}`;
    
    return marker;
}

// ============================================================================
// SECTION 6: PHASE MANAGEMENT
// ============================================================================

/**
 * Filters experiment structure based on selected condition
 * @returns {Array} Filtered experiment structure
 */
function filterExperimentStructure() {
    switch(selectedCondition) {
        case 'calibration':
            return experimentStructure.filter(phase => phase.type === 'calibration');
        case 'bci':
            return experimentStructure.filter(phase => phase.type === 'bci');
        case 'manual':
            return experimentStructure.filter(phase => phase.type === 'manual');
        case 'full':
        default:
            // UPDATED: Full experiment = calibration + BCI only (no manual)
            return experimentStructure.filter(phase => phase.type === 'calibration' || phase.type === 'bci');
    }
}

/**
 * Gets current phase configuration
 * @returns {Object} Current phase configuration
 */
function getCurrentPhaseConfig() {
    return filteredExperimentStructure[currentPhaseIndex];
}

/**
 * Checks if current phase is complete
 * @returns {boolean} True if phase is complete
 */
function isPhaseComplete() {
    const config = getCurrentPhaseConfig();
    
    if (config.type === 'calibration') {
        return totalJumps >= config.jumps;
    } else {
        return targetsReached >= config.targets;
    }
}

/**
 * Shows phase transition screen
 */
function showPhaseTransition() {
    const currentConfig = getCurrentPhaseConfig();
    const nextPhaseIndex = currentPhaseIndex + 1;
    
    let message = `Current phase (${currentConfig.description}) completed successfully.`;
    
    if (nextPhaseIndex < filteredExperimentStructure.length) {
        const nextConfig = filteredExperimentStructure[nextPhaseIndex];
        message += ` Ready to start ${nextConfig.description}.`;
    } else {
        message += " Experiment complete!";
    }
    
    const transitionScreen = document.getElementById('phase-transition-screen');
    const messageElement = document.getElementById('transition-message');
    
    messageElement.textContent = message;
    transitionScreen.classList.remove('hidden');
    
    // Update gray square to black during phase transition
    updateGraySquare('intro');
    
    // Still allow manual spacebar press
    function handleTransitionKeyPress(e) {
        if (e.code === 'Space') {
            transitionScreen.classList.add('hidden');
            window.removeEventListener('keydown', handleTransitionKeyPress);
            proceedToNextPhase();
        }
    }
    
    window.addEventListener('keydown', handleTransitionKeyPress);
}

/**
 * Proceeds to next phase after transition
 */
function proceedToNextPhase() {
    // Clean up any existing countdown timer
    const transitionScreen = document.getElementById('phase-transition-screen');
    if (transitionScreen && transitionScreen.dataset.countdownInterval) {
        clearInterval(parseInt(transitionScreen.dataset.countdownInterval));
        delete transitionScreen.dataset.countdownInterval;
    }
    
    // HIDE ANY VISIBLE FEEDBACK FIRST (CRITICAL FIX)
    hideFeedback();
    
    const currentConfig = getCurrentPhaseConfig();
    sendEventMarker(`phase_end:${currentConfig.phase}`);
    sendExperimentEventToLSL(`phase_end_${currentConfig.phase}`);
    
    currentPhaseIndex++;
    targetsReached = 0;
    moveCount = 0;
    breakCount = 0;
    
    // Reset user model for each new phase
    userModel = initUserModel();
    
    if (currentPhaseIndex >= filteredExperimentStructure.length) {
        // Experiment complete - show return to start screen message
        sendEventMarker('experiment_end');
        sendExperimentEventToLSL('experiment_end');
        
        // Show final completion message with auto-return
        showFinalCompletion();
        return;
    }
    
    const config = getCurrentPhaseConfig();
    phase = config.phase;
    
    // Update gray square for new phase
    updateGraySquare(config.phase);
    
    sendEventMarker(`phase_start:${config.phase}`);
    sendExperimentEventToLSL(`phase_start_${config.phase}`);
    
    // 🚨 FIXED: Only show model panel if HUD is visible
    if (hudVisible) {
        document.getElementById('model-panel').classList.remove('hidden');
    } else {
        document.getElementById('model-panel').classList.add('hidden');
    }
    
    updateStats();
    updateControlsPanel();
    
    // Show BCI phase starting message briefly
    showFeedback(`Starting ${config.description}...`);
    setTimeout(() => hideFeedback(), 2000);
    
    resetGrid();
}

/**
 * Shows final completion message and returns to start screen
 */
function showFinalCompletion() {
    // First hide any existing feedback
    hideFeedback();
    
    // Create final completion overlay
    const completionOverlay = document.createElement('div');
    completionOverlay.id = 'completion-overlay';
    completionOverlay.className = 'phase-transition-screen';
    completionOverlay.style.zIndex = '200';
    
    completionOverlay.innerHTML = `
        <div class="transition-content">
            <h2>🎉 Experiment Complete! 🎉</h2>
            <p style="font-size: 1.2rem; margin: 1.5rem 0;">
                <strong>Amazing work!</strong> You've helped advance neuroadaptive technology!
            </p>
            
            <div style="margin: 2rem 0; padding: 1.5rem; background: rgba(99, 179, 237, 0.1); border-radius: 8px; border: 1px solid rgba(99, 179, 237, 0.3);">
                <p style="color: #63b3ed; font-size: 1.1rem;">
                    <strong>Fun Fact:</strong> 
                    Your brain signals could one day control devices without you even thinking about it!
                </p>
                <p style="margin-top: 1rem; color: #ccc; font-size: 0.95rem;">
                    Based on the research: "Neuroadaptive technology enables implicit cursor control 
                    based on medial prefrontal cortex activity" (Zander et al., 2016)
                </p>
            </div>
            
            <div style="margin: 1.5rem 0; padding: 1rem; background: rgba(255, 255, 255, 0.05); border-radius: 8px;">
                <p style="color: #90cdf4; font-size: 0.95rem;">
                    <strong>🤖 The robot learned from your brain patterns!</strong><br>
                    Each movement helped train the BCI algorithm to understand your intentions.
                </p>
            </div>
            
            <div class="spacebar-instruction" style="margin-top: 2rem; padding: 1rem; background: #3182ce;">
                Press <kbd style="background: #2c5aa0; padding: 0.3rem 0.8rem;">SPACEBAR</kbd> to return to the main page
            </div>
            
            <p style="margin-top: 1rem; font-size: 0.85rem; color: #ccc;">
                Or wait for the countdown: <span id="countdown-timer">30</span> seconds
            </p>
        </div>
    `;
    
    document.getElementById('container').appendChild(completionOverlay);
    
    // Countdown timer
    let countdown = 30;
    const countdownEl = document.getElementById('countdown-timer');
    let countdownInterval;
    
    // Update countdown every second
    function updateCountdown() {
        countdown--;
        if (countdownEl) {
            countdownEl.textContent = countdown;
        }
        
        // Change color when getting low
        if (countdown <= 10) {
            countdownEl.style.color = '#ff6b6b';
            countdownEl.style.fontWeight = 'bold';
        } else if (countdown <= 20) {
            countdownEl.style.color = '#f6ad55';
        }
    }
    
    countdownInterval = setInterval(updateCountdown, 1000);
    
    // Add spacebar listener for completion screen
    function handleCompletionKeyPress(e) {
        if (e.code === 'Space') {
            clearInterval(countdownInterval);
            
            // Add a quick fade out effect
            completionOverlay.style.opacity = '0';
            completionOverlay.style.transition = 'opacity 0.5s ease';
            
            setTimeout(() => {
                if (completionOverlay.parentNode) {
                    completionOverlay.parentNode.removeChild(completionOverlay);
                }
                window.removeEventListener('keydown', handleCompletionKeyPress);
                
                // Return to start screen
                returnToStartScreen();
            }, 500);
        }
    }
    
    window.addEventListener('keydown', handleCompletionKeyPress);
    
    // Auto-return after countdown reaches 0
    setTimeout(() => {
        if (document.getElementById('completion-overlay')) {
            clearInterval(countdownInterval);
            
            // Show "Returning..." message briefly
            if (countdownEl) {
                countdownEl.textContent = 'Returning...';
                countdownEl.style.color = '#63b3ed';
            }
            
            setTimeout(() => {
                if (completionOverlay.parentNode) {
                    completionOverlay.parentNode.removeChild(completionOverlay);
                }
                window.removeEventListener('keydown', handleCompletionKeyPress);
                
                // Return to start screen
                returnToStartScreen();
            }, 1500);
        }
    }, 30000); // 30 seconds
}

/**
 * Returns to start screen after experiment completion
 */
function returnToStartScreen() {
    // Hide all experiment panels
    hideHUD();
    toggleGridNumbers();

    // Show intro screen
    document.getElementById('intro-screen').classList.remove('hidden');

    // Update gray square to black for intro
    updateGraySquare('intro');

    // Reset game state
    gameState = 'intro';
    currentPhaseIndex = 0;
    targetsReached = 0;
    totalJumps = 0;
    moveCount = 0;
    breakCount = 0;
    jumpCounter = 0;
    hudVisible = false;
    gridNumbersVisible = false; // Reset grid numbers to visible
    
    // Close LSL WebSocket connection
    if (lslWebSocket) {
        lslWebSocket.close();
        lslWebSocket = null;
    }
    isLSLConnected = false;
    
    // Clear Three.js scene if it exists
    if (renderer && scene) {
        const canvasContainer = document.getElementById('canvas-container');
        if (canvasContainer.contains(renderer.domElement)) {
            canvasContainer.removeChild(renderer.domElement);
        }
        // Clean up Three.js resources
        scene = null;
        camera = null;
        renderer = null;
        robotModel = null;
        cursor = null;
        targetMarker = null;
        gridCells = [];
        gridLabels = [];
        mixer = null;
        gltfLoader = null;
    }
    
    // Reset user model
    userModel = initUserModel();
    
    console.log('Returned to start screen');
}

/**
 * Moves to next phase with transition
 */
function nextPhase() {
    hideFeedback();
    showPhaseTransition();
}

// ============================================================================
// SECTION 7: MOVEMENT AND DIRECTION LOGIC
// ============================================================================

/**
 * Selects direction based on current phase and probabilities
 * @returns {string} Selected direction key
 */
function selectDirection() {
    const dirKeys = Object.keys(directions);
    const config = getCurrentPhaseConfig();
    
    if (config.type === 'calibration') {
        // Pure random selection during calibration
        return dirKeys[Math.floor(Math.random() * dirKeys.length)];
    } else if (config.type === 'bci' || config.type === 'manual') {
        // Weighted random selection based on current model
        return selectWeightedDirection();
    }
    
    return dirKeys[Math.floor(Math.random() * dirKeys.length)];
}

/**
 * Weighted random selection based on user model probabilities
 * @returns {string} Selected direction key
 */
function selectWeightedDirection() {
    const dirKeys = Object.keys(directions);
    const rand = Math.random();
    let cumulative = 0;
    
    for (let dir of dirKeys) {
        cumulative += userModel[dir] || (1 / dirKeys.length);
        if (rand <= cumulative) {
            return dir;
        }
    }
    
    return dirKeys[0];
}

/**
 * Moves cursor to new position - UPDATED for 1-based coordinates
 */
 function moveCursor() {
    // Don't start new movement if animating, waiting, or robot not loaded
    if (animating || waitingForResponse || !robotModel || isWaiting) return;
    
    // Flash gray square white when robot starts moving
    flashGraySquareWhite();
    
    // Check if calibration is complete before moving
    const config = getCurrentPhaseConfig();
    if (config.type === 'calibration' && totalJumps >= config.jumps) {
        nextPhase();
        return;
    }
    
    const direction = selectDirection();
    const dir = directions[direction];
    const newX = currentPos.x + dir.x;
    const newY = currentPos.y + dir.y;
    
    // Check bounds - 1-based coordinates (1 to gridSize)
    if (newX < 1 || newX > gridSize || newY < 1 || newY > gridSize) {
        return moveCursor(); // Try another direction
    }
    
    const newPos = { x: newX, y: newY };
    
    // Calculate classification before sending markers
    const angle = calculateAngleToGoal(currentPos, newPos);
    const classification = classifyAngle(angle);
    
    // Increment jump counter and send jump markers
    jumpCounter++;
    
    // Create the detailed marker string with both classifications and phase info
    const jumpMarker = createJumpMarker(currentPos, newPos, direction, classification);
    
    // Get individual classifications
    const cls1Marker = classification.cls1;
    const cls2Marker = classification.cls2;
    
    // Send to LSL Bridge
    sendMarkersToLSL(jumpMarker, cls1Marker, cls2Marker);
    
    // Also send to event marker system
    sendEventMarker(jumpMarker);
    sendEventMarker(cls1Marker);
    sendEventMarker(cls2Marker);
    
    // Send additional classifyNow marker ONLY for BCI phases
    if (phase === 'bci') {
        sendEventMarker('classifyNow');
    }
    
    // Animate movement with 3D effects
    animating = true;
    animateRobotMove(currentPos, newPos, direction, () => {
        currentPos = newPos;
        moveCount++;
        totalJumps++;
        animating = false;
        
        // Check if calibration is complete
        const config = getCurrentPhaseConfig();
        if (config.type === 'calibration' && totalJumps >= config.jumps) {
            showFeedback(`Calibration complete! ${totalJumps} jumps recorded.`);
            setTimeout(() => {
                hideFeedback();
                setTimeout(() => {
                    nextPhase();
                }, 500);
            }, 1500);
            return;
        }
        
        updateStats();
        
        // Check if reached target
        if (newPos.x === targetPos.x && newPos.y === targetPos.y) {
            handleTargetReached();
            return;
        }
        
        // Check if maximum moves reached
        if (moveCount >= maxMovesPerTarget) {
            handleMaxMovesReached();
            return;
        }
        
        // START WAIT PERIOD BEFORE NEXT MOVEMENT
        startWaitPeriod();
    });
}

function startWaitPeriod() {
    if (waitTimer) {
        clearTimeout(waitTimer);
    }
    
    isWaiting = true;
    
    // Send wait start marker
    sendEventMarker('wait_start');
    
    // Start wait timer
    waitTimer = setTimeout(() => {
        endWaitPeriod();
    }, WAIT_DURATION);
}

function endWaitPeriod() {
    if (waitTimer) {
        clearTimeout(waitTimer);
        waitTimer = null;
    }
    
    isWaiting = false;
    
    // Send wait end marker
    sendEventMarker('wait_end');
    
    const config = getCurrentPhaseConfig();
    
    // In manual phase, wait for user response
    if (config.type === 'manual') {
        waitingForResponse = true;
        showFeedback('Was this movement ACCEPTABLE? Press V (yes) or B (no)');
        currentMove = { direction, fromPos: currentPos, toPos: newPos };
    } else {
        // Continue automatically in other phases
        setTimeout(() => moveCursor(), 50);
    }
}

/**
 * Handles when target is reached
 */
function handleTargetReached() {
    const config = getCurrentPhaseConfig();
    targetsReached++;
    
    // Send target reached marker
    sendEventMarker(`target_reached:${targetsReached}`);
    if (config.type === 'bci') {
        sendExperimentEventToLSL(`target_reached_${targetsReached}`);
    }
    
    // Add visual celebration effect
    createCelebrationEffect();
    
    showFeedback(`Target reached! (${targetsReached}/${config.targets})`);
    if (config.type === 'bci' && targetsReached % 5 === 0) {
        showBreakScreen();
        return;
    }
    // Check if we need a break
    if (config.type !== 'calibration') {
        breakCount++;
        if (breakCount % 5 === 0) {
            showBreakScreen();
            return;
        }
    }
    
    setTimeout(() => {
        if (isPhaseComplete()) {
            nextPhase();
        } else {
            // Always start fresh trial with reset user model
            resetGrid();
        }
    }, 1500);
}

/**
 * Creates celebration effect when target is reached
 */
function createCelebrationEffect() {
    const spacing = 2;
    const targetX = ((targetPos.x - 1) - gridSize/2 + 0.5) * spacing;
    const targetZ = ((targetPos.y - 1) - gridSize/2 + 0.5) * spacing;
    
    // Create particle explosion
    for (let i = 0; i < 20; i++) {
        const particleGeometry = new THREE.SphereGeometry(0.1, 8, 8);
        const particleMaterial = new THREE.MeshBasicMaterial({
            color: Math.random() > 0.5 ? 0x44ff44 : 0xffff00,
            transparent: true,
            opacity: 0.8
        });
        const particle = new THREE.Mesh(particleGeometry, particleMaterial);
        
        particle.position.set(targetX, 1, targetZ);
        particle.userData = {
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                Math.random() * 2 + 1,
                (Math.random() - 0.5) * 2
            ),
            life: 1.0
        };
        
        scene.add(particle);
        gridCells.push(particle);
        
        // Animate and remove particle
        setTimeout(() => {
            scene.remove(particle);
            const index = gridCells.indexOf(particle);
            if (index > -1) {
                gridCells.splice(index, 1);
            }
        }, 1000);
    }
}

/**
 * Handles when maximum moves are reached without finding target
 */
function handleMaxMovesReached() {
    const config = getCurrentPhaseConfig();
    
    // Count as completed target for BCI phase when aborted
    if (config.type === 'bci') {
        targetsReached++;
        sendEventMarker(`target_aborted:${targetsReached}`);
        sendExperimentEventToLSL(`target_aborted_${targetsReached}`);
        showFeedback(`Target aborted (too long). Progress: ${targetsReached}/${config.targets}`);
    } else {
        sendEventMarker('max_moves_reached');
        showFeedback('Maximum moves reached. Resetting...');
    }
    
    setTimeout(() => {
        if (isPhaseComplete()) {
            nextPhase();
        } else {
            // Always start fresh trial
            resetGrid();
        }
    }, 1500);
}

/**
 * Animates robot movement with walking animation - UPDATED for proper 3D movement
 * @param {Object} from - Starting position
 * @param {Object} to - Ending position
 * @param {string} direction - Movement direction
 * @param {Function} onComplete - Callback when animation completes
 */
function animateRobotMove(from, to, direction, onComplete) {
    if (!robotModel) return;
    
    const spacing = 2;
    const startX = ((from.x - 1) - gridSize/2 + 0.5) * spacing;
    const startZ = ((from.y - 1) - gridSize/2 + 0.5) * spacing;
    const endX = ((to.x - 1) - gridSize/2 + 0.5) * spacing;
    const endZ = ((to.y - 1) - gridSize/2 + 0.5) * spacing;
    
    const duration = MOVE_ANIMATION_DURATION;  // CHANGED: use constant
    const startTime = Date.now();
    
    const targetRotationY = getRotationFromDirection(direction);
    
    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        
        robotModel.position.x = startX + (endX - startX) * eased;
        robotModel.position.z = startZ + (endZ - startZ) * eased;
        
        const walkHeight = 0.8 + Math.sin(progress * Math.PI * 2) * 0.1;
        robotModel.position.y = walkHeight;
        
        const rotationProgress = Math.min(progress * 2, 1);
        robotModel.rotation.y += (targetRotationY - robotModel.rotation.y) * rotationProgress * 0.1;
        
        animateRobotWalking(progress);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            robotModel.position.y = 0.8;
            onComplete();
        }
    }
    
    animate();
}

/**
 * Gets rotation angle from direction
 * @param {string} direction - Movement direction
 * @returns {number} Rotation angle in radians
 */
function getRotationFromDirection(direction) {
    switch(direction) {
        case 'N': return 0;
        case 'NE': return Math.PI * 0.25;
        case 'E': return Math.PI * 0.5;
        case 'SE': return Math.PI * 0.75;
        case 'S': return Math.PI;
        case 'SW': return -Math.PI * 0.75;
        case 'W': return -Math.PI * 0.5;
        case 'NW': return -Math.PI * 0.25;
        default: return 0;
    }
}

/**
 * Animates robot walking motion
 * @param {number} progress - Animation progress (0-1)
 */
function animateRobotWalking(progress) {
    if (!robotModel) return;
    
    // Simple walking animation by moving arms and legs
    const walkCycle = Math.sin(progress * Math.PI * 4);
    
    // Traverse robot model and animate parts
    robotModel.traverse(function(child) {
        if (child.name && child.name.includes('arm') || child.name && child.name.includes('Arm')) {
            child.rotation.z = walkCycle * 0.2;
        }
        if (child.name && child.name.includes('leg') || child.name && child.name.includes('Leg')) {
            child.rotation.z = walkCycle * 0.1;
        }
    });
}

// ============================================================================
// SECTION 8: USER MODEL AND MACHINE LEARNING
// ============================================================================

/**
 * Updates user model based on manual feedback
 * @param {string} direction - Movement direction
 * @param {boolean} isAcceptable - Whether movement was acceptable
 */
function updateUserModel(direction, isAcceptable) {
    const config = getCurrentPhaseConfig();
    
    // Only update model in manual phase
    if (config.type !== 'manual') return;
    
    const learningRate = 0.25;
    
    if (isAcceptable) {
        // Increase probability for this direction
        userModel[direction] = Math.min(0.8, (userModel[direction] || 0) + learningRate);
        
        // Slightly decrease probabilities for opposite directions
        const oppositeDir = getOppositeDirection(direction);
        if (oppositeDir) {
            userModel[oppositeDir] = Math.max(0.02, (userModel[oppositeDir] || 0) - learningRate/2);
        }
    } else {
        // Decrease probability for this direction
        userModel[direction] = Math.max(0.02, (userModel[direction] || 0) - learningRate);
        
        // Slightly increase probabilities for perpendicular directions (exploration)
        const perpendicularDirs = getPerpendicularDirections(direction);
        perpendicularDirs.forEach(dir => {
            userModel[dir] = Math.min(0.8, (userModel[dir] || 0) + learningRate/3);
        });
    }
    
    // Normalize probabilities
    normalizeProbabilities();
    
    updateModelDisplay();
}

/**
 * Gets opposite direction
 * @param {string} dir - Direction
 * @returns {string} Opposite direction
 */
function getOppositeDirection(dir) {
    const opposites = {
        'N': 'S', 'S': 'N',
        'E': 'W', 'W': 'E', 
        'NE': 'SW', 'SW': 'NE',
        'NW': 'SE', 'SE': 'NW'
    };
    return opposites[dir];
}

/**
 * Gets perpendicular directions
 * @param {string} dir - Direction
 * @returns {Array} Perpendicular directions
 */
function getPerpendicularDirections(dir) {
    const perpendiculars = {
        'N': ['E', 'W'],
        'S': ['E', 'W'], 
        'E': ['N', 'S'],
        'W': ['N', 'S'],
        'NE': ['NW', 'SE'],
        'NW': ['NE', 'SW'],
        'SE': ['NE', 'SW'],
        'SW': ['NW', 'SE']
    };
    return perpendiculars[dir] || [];
}

/**
 * Normalizes probabilities to sum to 1
 */
function normalizeProbabilities() {
    const sum = Object.values(userModel).reduce((a, b) => a + b, 0);
    Object.keys(userModel).forEach(key => {
        userModel[key] /= sum;
    });
}

// ============================================================================
// SECTION 9: HUD TOGGLE FUNCTIONS - CORRECTED
// ============================================================================

/**
 * Toggles HUD visibility
 */
function toggleHUD() {
    hudVisible = !hudVisible;
    
    if (hudVisible) {
        showHUD();
        // Show grid numbers when HUD is visible
        showGridNumbers();
    } else {
        hideHUD();
        // Hide grid numbers when HUD is hidden
        hideGridNumbers();
    }
    
    // Gray square should always remain visible
    ensureGraySquareVisible();

    // Show feedback briefly
    const feedbackMessage = hudVisible ? 'HUD enabled' : 'HUD disabled';
    const feedbackPanel = document.getElementById('feedback-panel');
    feedbackPanel.textContent = feedbackMessage;
    feedbackPanel.classList.remove('hidden');
    
    setTimeout(() => {
        feedbackPanel.classList.add('hidden');
    }, 1500);
}

/**
 * Shows grid numbers
 */
function showGridNumbers() {
    gridNumbersVisible = true;
    
    // Show all grid labels
    gridLabels.forEach(label => {
        label.visible = true;
    });
    
    console.log('Grid numbers shown');
}

/**
 * Hides grid numbers
 */
function hideGridNumbers() {
    gridNumbersVisible = false;
    
    // Hide all grid labels
    gridLabels.forEach(label => {
        label.visible = false;
    });
    
    console.log('Grid numbers hidden');
}

/**
 * Toggles grid numbers visibility (for separate control if needed)
 */
function toggleGridNumbers() {
    gridNumbersVisible = !gridNumbersVisible;
    
    // Show/hide all grid labels
    gridLabels.forEach(label => {
        label.visible = gridNumbersVisible;
    });
    
    // Show feedback
    const feedbackMessage = gridNumbersVisible ? 'Grid numbers shown' : 'Grid numbers hidden';
    const feedbackPanel = document.getElementById('feedback-panel');
    feedbackPanel.textContent = feedbackMessage;
    feedbackPanel.classList.add('hidden');
    
    setTimeout(() => {
        feedbackPanel.classList.remove('hidden');
    }, 100);
}

/**
 * Shows HUD panels
 */
function showHUD() {
    // Show all HUD panels
    const hudPanels = [
        'stats-panel',
        'phase-indicator',
        'progress-display',
        'controls-panel',
        'model-panel',
        'event-markers-panel',
        'author-badge'
    ];
    
    hudPanels.forEach(panelId => {
        const panel = document.getElementById(panelId);
        if (panel) {
            panel.classList.remove('hidden');
        }
    });
    
    // Update LSL status visibility
    updateLSLStatus(isLSLConnected);
    
    console.log('HUD shown');
}

/**
 * Hides HUD panels
 */
function hideHUD() {
    // Hide all HUD panels
    const hudPanels = [
        'stats-panel',
        'phase-indicator',
        'progress-display',
        'feedback-panel',
        'controls-panel',
        'model-panel',
        'event-markers-panel',
        'author-badge'
    ];
    
    hudPanels.forEach(panelId => {
        const panel = document.getElementById(panelId);
        if (panel) {
            panel.classList.add('hidden');
        }
    });
    
    // Hide grid numbers when HUD is hidden
    hideGridNumbers();
    
    // Keep the gray square visible
    ensureGraySquareVisible();
    
    console.log('HUD hidden');
}

// ============================================================================
// SECTION 10: VISUALIZATION AND UI UPDATES
// ============================================================================

/**
 * Creates bar chart visualization of direction probabilities
 */
function createBarChartVisualization() {
    const canvas = document.getElementById('probability-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Chart configuration
    const margin = { top: 30, right: 20, bottom: 40, left: 40 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const barWidth = chartWidth / 8;
    const maxBarHeight = chartHeight * 0.7;
    
    // Draw chart background with gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    gradient.addColorStop(0, 'rgba(45, 55, 72, 0.8)');
    gradient.addColorStop(1, 'rgba(26, 32, 44, 0.8)');
    ctx.fillStyle = gradient;
    ctx.fillRect(margin.left, margin.top, chartWidth, chartHeight);
    
    // Draw 3D chart border
    ctx.strokeStyle = '#63b3ed';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin.left, margin.top, chartWidth, chartHeight);
    
    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
        const y = margin.top + (i * chartHeight / 5);
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + chartWidth, y);
        ctx.stroke();
        
        // Y-axis labels
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '10px Arial';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${(100 - i * 20)}%`, margin.left - 5, y);
    }
    
    // Draw bars for each direction with 3D effect
    const directionsList = Object.entries(directions).sort((a, b) => {
        // Sort by angle for consistent order
        return a[1].angle - b[1].angle;
    });
    
    directionsList.forEach(([dir, data], index) => {
        const probability = userModel[dir] || 0;
        const barHeight = probability * maxBarHeight;
        const x = margin.left + (index * barWidth) + (barWidth * 0.1);
        const y = margin.top + chartHeight - barHeight;
        const barActualWidth = barWidth * 0.8;
        
        // Draw bar with gradient
        const barGradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        barGradient.addColorStop(0, 'rgba(99, 179, 237, 0.9)');
        barGradient.addColorStop(1, 'rgba(49, 130, 206, 0.7)');
        ctx.fillStyle = barGradient;
        ctx.fillRect(x, y, barActualWidth, barHeight);
        
        // Draw 3D bar sides
        ctx.fillStyle = 'rgba(49, 130, 206, 0.5)';
        ctx.fillRect(x + barActualWidth, y, 3, barHeight);
        ctx.fillRect(x, y + barHeight, barActualWidth, 3);
        
        // Draw bar border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, barActualWidth, barHeight);
        
        // Draw direction label
        ctx.fillStyle = probability > 0.1 ? '#63b3ed' : 'rgba(99, 179, 237, 0.7)';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(dir, x + barActualWidth / 2, margin.top + chartHeight + 5);
        
        // Draw probability value on top of bar
        if (probability > 0.05) {
            ctx.fillStyle = 'white';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(
                `${Math.round(probability * 100)}%`, 
                x + barActualWidth / 2, 
                y - 5
            );
        }
        
        // Highlight the bar if it has high probability
        if (probability > 0.15) {
            ctx.strokeStyle = '#63b3ed';
            ctx.lineWidth = 2;
            ctx.strokeRect(x - 1, y - 1, barActualWidth + 2, barHeight + 2);
            
            // Add glow effect
            ctx.shadowColor = '#63b3ed';
            ctx.shadowBlur = 10;
            ctx.strokeRect(x - 2, y - 2, barActualWidth + 4, barHeight + 4);
            ctx.shadowBlur = 0;
        }
    });
    
    // Draw chart title
    ctx.fillStyle = '#63b3ed';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Direction Preferences', width / 2, 10);
    
    // Draw Y-axis label
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Probability', 0, 0);
    ctx.restore();
}

/**
 * Updates the model display with numerical values and bar chart
 */
function updateModelDisplay() {
    const modelGrid = document.getElementById('model-grid');
    if (!modelGrid) return;
    
    modelGrid.innerHTML = '';
    
    // Sort directions by probability for the grid display
    const sortedDirections = Object.entries(userModel)
        .sort((a, b) => b[1] - a[1]);
    
    sortedDirections.forEach(([dir, prob]) => {
        const item = document.createElement('div');
        item.className = 'model-item';
        
        // Add 3D effect to high probability items
        if (prob > 0.15) {
            item.style.background = 'linear-gradient(145deg, rgba(99, 179, 237, 0.3), rgba(49, 130, 206, 0.2))';
            item.style.border = '1px solid #63b3ed';
            item.style.boxShadow = '2px 2px 5px rgba(0, 0, 0, 0.3)';
        } else {
            item.style.background = 'rgba(255, 255, 255, 0.05)';
        }
        
        const dirEl = document.createElement('div');
        dirEl.className = 'direction';
        dirEl.textContent = dir;
        dirEl.style.color = prob > 0.1 ? '#63b3ed' : '#90cdf4';
        
        const probEl = document.createElement('div');
        probEl.className = 'probability';
        probEl.textContent = `${(prob * 100).toFixed(0)}%`;
        probEl.style.fontSize = prob > 0.15 ? '0.8rem' : '0.7rem';
        probEl.style.fontWeight = prob > 0.15 ? 'bold' : 'normal';
        
        item.appendChild(dirEl);
        item.appendChild(probEl);
        modelGrid.appendChild(item);
    });
    
    // Update bar chart visualization
    createBarChartVisualization();
}

/**
 * Updates controls panel based on current phase
 */
function updateControlsPanel() {
    const controlsPanel = document.getElementById('controls-panel');
    const controlsStatus = document.getElementById('controls-status');
    const config = getCurrentPhaseConfig();
    
    if (config.type === 'manual') {
        controlsStatus.textContent = 'ACTIVE - Press Keys Now';
        controlsStatus.style.color = '#63b3ed';
        controlsStatus.style.textShadow = '0 0 5px rgba(99, 179, 237, 0.5)';
        controlsPanel.classList.add('controls-active');
        controlsPanel.classList.remove('controls-inactive');
        
        // Add pulsing animation to active controls
        controlsPanel.style.animation = 'pulse-border 2s ease-in-out infinite';
    } else {
        controlsStatus.textContent = 'INACTIVE - Observation Only';
        controlsStatus.style.color = '#ccc';
        controlsStatus.style.textShadow = 'none';
        controlsPanel.classList.add('controls-inactive');
        controlsPanel.classList.remove('controls-active');
        controlsPanel.style.animation = 'none';
    }
}

/**
 * Updates statistics display - UPDATED for 1-based coordinates
 */
function updateStats() {
    const config = getCurrentPhaseConfig();
    
    // Update phase indicator with 3D effect
    const phaseIndicator = document.getElementById('phase-indicator');
    phaseIndicator.textContent = config.description;
    phaseIndicator.className = `phase-indicator phase-${config.type}`;
    phaseIndicator.style.borderColor = config.color;
    phaseIndicator.style.background = `linear-gradient(145deg, rgba(0, 0, 0, 0.9), rgba(20, 20, 20, 0.8))`;
    phaseIndicator.style.boxShadow = `0 4px 15px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)`;
    
    // Update main stats - 1-based coordinates
    document.getElementById('phase-display').textContent = config.description;
    
    if (config.type === 'calibration') {
        document.getElementById('targets-display').textContent = 'N/A';
        document.getElementById('jumps-display').textContent = `${totalJumps}/${config.jumps}`;
    } else {
        document.getElementById('targets-display').textContent = `${targetsReached}/${config.targets}`;
        document.getElementById('jumps-display').textContent = `${totalJumps}`;
    }
    
    document.getElementById('moves-display').textContent = moveCount;
    document.getElementById('grid-display').textContent = `${gridSize}×${gridSize}`;
    document.getElementById('position-display').textContent = `(${currentPos.x}, ${currentPos.y})`;
    document.getElementById('target-display').textContent = `(${targetPos.x}, ${targetPos.y})`;
    
    // Update progress panel with 3D effect
    const progressPanel = document.getElementById('progress-display');
    if (config.type === 'calibration') {
        progressPanel.innerHTML = `<strong>Calibration Progress:</strong><br>${totalJumps}/${config.jumps} jumps completed`;
    } else {
        const percent = Math.round((targetsReached / config.targets) * 100);
        progressPanel.innerHTML = `<strong>Phase Progress:</strong><br>${targetsReached}/${config.targets} targets (${percent}%)`;
    }
    
    // Add 3D styling to progress panel
    progressPanel.style.background = 'linear-gradient(145deg, rgba(0, 0, 0, 0.8), rgba(20, 20, 20, 0.7))';
    progressPanel.style.border = '1px solid rgba(99, 179, 237, 0.3)';
    progressPanel.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';
}

// ============================================================================
// SECTION 11: USER INTERFACE FUNCTIONS
// ============================================================================

/**
 * Shows feedback message with HTML support
 * @param {string} message - Feedback message
 */
function showFeedback(message) {
    const feedbackPanel = document.getElementById('feedback-panel');
    feedbackPanel.innerHTML = message; // Use innerHTML to support <br> and <kbd> tags
    feedbackPanel.classList.remove('hidden');
    
    // Add 3D effect to feedback panel
    feedbackPanel.style.background = 'linear-gradient(145deg, #3182ce, #2c5aa0)';
    feedbackPanel.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
}

/**
 * Hides feedback message
 */
function hideFeedback() {
    document.getElementById('feedback-panel').classList.add('hidden');
}

/**
 * Shows break screen
 */
function showBreakScreen() {
    sendEventMarker('break_start');
    
    // Update gray square to black for break
    updateGraySquare('break');
    
    const breakScreen = document.createElement('div');
    breakScreen.id = 'break-screen';
    breakScreen.className = 'break-screen';
    
    const config = getCurrentPhaseConfig();
    const progressPercent = (targetsReached / config.targets) * 100;
    
    breakScreen.innerHTML = `
        <div class="break-content">
            <h2>Break Time</h2>
            <p>You've completed ${targetsReached} out of ${config.targets} targets in this phase.</p>
            <p>Take a short break.</p>
            <div class="spacebar-instruction">
                Press <kbd>SPACEBAR</kbd> to continue when you're ready
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progressPercent}%"></div>
            </div>
            <p style="margin-top: 1rem; font-size: 0.9rem; color: #ccc;">
                Current Phase: ${config.description}
            </p>
        </div>
    `;
    document.getElementById('container').appendChild(breakScreen);
    
    // Add 3D styling to break screen
    const breakContent = breakScreen.querySelector('.break-content');
    breakContent.style.background = 'linear-gradient(145deg, #2d3748, #1a202c)';
    breakContent.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
    breakContent.style.border = '2px solid #3182ce';
    
    // Add spacebar listener for break screen
    function handleBreakKeyPress(e) {
        if (e.code === 'Space') {
            sendEventMarker('break_end');
            document.getElementById('container').removeChild(breakScreen);
            window.removeEventListener('keydown', handleBreakKeyPress);
            breakCount = 0;
            
            // Restore gray square to current phase color
            const config = getCurrentPhaseConfig();
            updateGraySquare(config.phase);
            
            setTimeout(() => {
                if (isPhaseComplete()) {
                    nextPhase();
                } else {
                    resetGrid();
                }
            }, 500);
        }
    }
    
    window.addEventListener('keydown', handleBreakKeyPress);
}

/**
 * Resets grid with new positions - UPDATED: Initial goal based on grid size
 */
function resetGrid() {
    // Clear any visible feedback at trial start
    hideFeedback();
    
    // Reset user model for new trial (always fresh)
    userModel = initUserModel();
    
    // For the FIRST trial after experiment start: goal is at (gridSize, gridSize)
    // For subsequent trials: randomly choose one of four corners
    let target;
    let start;
    
    // Check if this is the first trial of a phase
    const isFirstTrial = (targetsReached === 0 && moveCount === 0);
    
    if (isFirstTrial) {
        // First trial: goal at bottom-right corner based on grid size
        target = { x: gridSize, y: gridSize };
        console.log(`First trial: Goal set to (${target.x},${target.y}) based on grid size ${gridSize}x${gridSize}`);
    } else {
        // Subsequent trials: randomly choose one of four corners
        const cornerChoice = Math.floor(Math.random() * 4);
        
        switch(cornerChoice) {
            case 0: // Goal at Top-left corner (1,1)
                target = { x: 1, y: 1 };
                break;
            case 1: // Goal at Top-right corner (gridSize,1)
                target = { x: gridSize, y: 1 };
                break;
            case 2: // Goal at Bottom-left corner (1,gridSize)
                target = { x: 1, y: gridSize };
                break;
            case 3: // Goal at Bottom-right corner (gridSize,gridSize)
            default:
                target = { x: gridSize, y: gridSize };
                break;
        }
    }
    
    // Calculate start position: one move away from opposite corner
    if (target.x === gridSize && target.y === gridSize) {
        // Goal at bottom-right: start at top-left (2,2)
        start = { x: 2, y: 2 };
    } else if (target.x === gridSize && target.y === 1) {
        // Goal at top-right: start at bottom-left (2, gridSize-1)
        start = { 
            x: 2,
            y: gridSize <= 3 ? gridSize : gridSize - 1
        };
    } else if (target.x === 1 && target.y === gridSize) {
        // Goal at bottom-left: start at top-right (gridSize-1, 2)
        start = { 
            x: gridSize <= 3 ? gridSize : gridSize - 1,
            y: 2
        };
    } else if (target.x === 1 && target.y === 1) {
        // Goal at top-left: start at bottom-right (gridSize-1, gridSize-1)
        start = { 
            x: gridSize <= 3 ? gridSize : gridSize - 1,
            y: gridSize <= 3 ? gridSize : gridSize - 1
        };
    }
    
    // Special handling for small grids
    if (gridSize === 3) {
        // For 3x3 grid, adjust positions
        if (target.x === 3 && target.y === 3) {
            start = { x: 1, y: 1 };
        } else if (target.x === 3 && target.y === 1) {
            start = { x: 1, y: 3 };
        } else if (target.x === 1 && target.y === 3) {
            start = { x: 3, y: 1 };
        } else if (target.x === 1 && target.y === 1) {
            start = { x: 3, y: 3 };
        }
    } else if (gridSize === 2) {
        // For 2x2 grid, just use opposite corners
        if (target.x === 2 && target.y === 2) {
            start = { x: 1, y: 1 };
        } else if (target.x === 2 && target.y === 1) {
            start = { x: 1, y: 2 };
        } else if (target.x === 1 && target.y === 2) {
            start = { x: 2, y: 1 };
        } else if (target.x === 1 && target.y === 1) {
            start = { x: 2, y: 2 };
        }
    }
    
    // Final validation
    target.x = Math.max(1, Math.min(gridSize, target.x));
    target.y = Math.max(1, Math.min(gridSize, target.y));
    start.x = Math.max(1, Math.min(gridSize, start.x));
    start.y = Math.max(1, Math.min(gridSize, start.y));
    
    // Ensure start is not the same as target
    if (start.x === target.x && start.y === target.y) {
        // Simple adjustment
        start.x = start.x === 1 ? gridSize : 1;
        start.y = start.y === 1 ? gridSize : 1;
    }
    
    targetPos = target;
    currentPos = start;
    moveCount = 0;
    
    console.log(`New trial: Grid ${gridSize}x${gridSize}, Goal (${targetPos.x},${targetPos.y}), Start (${currentPos.x},${currentPos.y})`);
    
    // Flash gray square white at trial start
    flashGraySquareWhite();
    
    // Update 3D positions (convert 1-based to Three.js coordinates)
    if (robotModel && targetMarker) {
        const spacing = 2;
        
        // Update robot position
        robotModel.position.set(
            (start.x - 1 - gridSize/2 + 0.5) * spacing,
            0.3,
            (start.y - 1 - gridSize/2 + 0.5) * spacing
        );
        
        // Reset robot rotation to face forward
        robotModel.rotation.y = Math.PI;
        
        // Update target position
        targetMarker.position.set(
            (target.x - 1 - gridSize/2 + 0.5) * spacing,
            0.6,
            (target.y - 1 - gridSize/2 + 0.5) * spacing
        );
        
        // Update target aura and pedestal positions
        gridCells.forEach(cell => {
            if (cell.geometry) {
                if (cell.geometry.type === 'RingGeometry') {
                    // Update target aura
                    cell.position.copy(targetMarker.position);
                    cell.position.y = 0.1;
                } else if (cell.geometry.type === 'CylinderGeometry' && cell !== targetMarker) {
                    // Update pedestal
                    cell.position.copy(targetMarker.position);
                    cell.position.y = 0.2;
                }
            }
        });
    }
    
    updateStats();
    updateModelDisplay(); // Update visualization for fresh trial
    
    // Send trial start marker
    const config = getCurrentPhaseConfig();
    if (config.type !== 'calibration') {
        sendEventMarker(`trial_start:g${targetPos.x}${targetPos.y}:s${currentPos.x}${currentPos.y}`);
        if (config.type === 'bci') {
            sendExperimentEventToLSL(`trial_start_${targetPos.x}${targetPos.y}`);
        }
    }
    
    setTimeout(() => moveCursor(), 1000);
}

// ============================================================================
// SECTION 12: INPUT HANDLING
// ============================================================================

/**
 * Handles keyboard input
 * @param {KeyboardEvent} e - Keyboard event
 */
// Update handleKeyPress function to send button markers for V and B at ANY time
function handleKeyPress(e) {
    if (e.key === 'h' || e.key === 'H') {
        toggleHUD();
        return;
    }
    
    // NEW: Send button presses immediately on keydown (not just in manual phase)
    if (e.key === 'v' || e.key === 'V' || e.key === 'b' || e.key === 'B') {
        const buttonValue = (e.key === 'v' || e.key === 'V') ? '50001' : '50002';
        
        // Send button marker immediately
        if (lslWebSocket && lslWebSocket.readyState === WebSocket.OPEN) {
            const buttonData = {
                button: buttonValue,
                phase: phase,
                jump: jumpCounter,
                timestamp: Date.now()
            };
            
            try {
                lslWebSocket.send(JSON.stringify(buttonData));
                console.log(`📤 Button press: ${buttonValue}`);
                
                // Visual feedback
                createButtonFeedbackEffect(e.key === 'v' || e.key === 'V');
            } catch (error) {
                console.error('Error sending button press:', error);
            }
        }
        
        // If in manual phase and waiting for response, handle as before
        const config = getCurrentPhaseConfig();
        if (config.type === 'manual' && waitingForResponse) {
            if (e.key === 'v' || e.key === 'V') {
                sendEventMarker('button:v');
                handleUserResponse(true);
            } else if (e.key === 'b' || e.key === 'B') {
                sendEventMarker('button:b');
                handleUserResponse(false);
            }
        }
    }
}

/**
 * Creates visual feedback for button presses
 * @param {boolean} isAcceptable - Whether movement was acceptable
 */
function createButtonFeedbackEffect(isAcceptable) {
    const spacing = 2;
    const cursorX = ((currentPos.x - 1) - gridSize/2 + 0.5) * spacing;
    const cursorZ = ((currentPos.y - 1) - gridSize/2 + 0.5) * spacing;
    
    // Create feedback particle
    const particleGeometry = new THREE.SphereGeometry(0.2, 16, 16);
    const particleMaterial = new THREE.MeshBasicMaterial({
        color: isAcceptable ? 0x44ff44 : 0xff4444,
        transparent: true,
        opacity: 0.8
    });
    const particle = new THREE.Mesh(particleGeometry, particleMaterial);
    
    particle.position.set(cursorX, 2, cursorZ);
    scene.add(particle);
    gridCells.push(particle);
    
    // Animate particle upward
    const startTime = Date.now();
    const duration = 1000;
    
    function animateParticle() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        particle.position.y = 2 + progress * 2;
        particle.material.opacity = 0.8 * (1 - progress);
        
        if (progress < 1) {
            requestAnimationFrame(animateParticle);
        } else {
            scene.remove(particle);
            const index = gridCells.indexOf(particle);
            if (index > -1) {
                gridCells.splice(index, 1);
            }
        }
    }
    
    animateParticle();
}

/**
 * Handles user response in manual phase
 * @param {boolean} isAcceptable - Whether movement was acceptable
 */
function handleUserResponse(isAcceptable) {
    waitingForResponse = false;
    hideFeedback();
    
    if (currentMove) {
        updateUserModel(currentMove.direction, isAcceptable);
    }
    
    setTimeout(() => moveCursor(), 300);
}

// ============================================================================
// SECTION 13: EXPERIMENT CONTROL
// ============================================================================

/**
 * Starts the experiment
 */
function startExperiment() {
    console.log('Start experiment clicked');
    
    try {
        // Get configuration from UI
        gridSize = parseInt(document.getElementById('grid-size').value);
        calibrationJumps = parseInt(document.getElementById('calibration-jumps').value);
        bciTargets = parseInt(document.getElementById('bci-targets').value);
        selectedCondition = document.getElementById('condition').value;
        gameState = 'playing';
        
        // Reset event markers
        eventMarkers = [];
        jumpCounter = 0;
        
        // Set initial positions
        targetPos = { x: gridSize, y: gridSize };
        currentPos = { x: 2, y: 2 };
        
        // Send experiment start marker
        sendEventMarker('experiment_start');
        sendExperimentEventToLSL('experiment_start');
        
        // Initialize LSL Bridge
        initializeLSLBridge();
        
        // Update the experiment structure with user values BEFORE filtering
        experimentStructure[0].jumps = calibrationJumps;
        experimentStructure[1].targets = bciTargets;
        
        // Filter experiment structure
        filteredExperimentStructure = filterExperimentStructure();
        
        currentPhaseIndex = 0;
        phase = filteredExperimentStructure[0].phase;
        targetsReached = 0;
        totalJumps = 0;
        moveCount = 0;
        breakCount = 0;
        
        // Update gray square for starting phase
        updateGraySquare(phase);
        
        // Send phase start marker
        sendEventMarker(`phase_start:${phase}`);
        sendExperimentEventToLSL(`phase_start_${phase}`);
        
        // Initialize user model
        userModel = initUserModel();
        
        // Hide intro screen
        document.getElementById('intro-screen').classList.add('hidden');
        
        // Start with HUD VISIBLE by default
        hudVisible = true;
        showHUD();
        
        // Grid numbers hidden by default
        gridNumbersVisible = false;
        
        console.log(`Starting experiment with ${gridSize}x${gridSize} grid`);
        console.log(`BCI Targets: ${bciTargets}`);
        console.log('UI panels updated, initializing Three.js...');
        
        // Initialize Three.js
        initThreeJS();
        
        // Add keyboard listener
        window.addEventListener('keydown', handleKeyPress);
        
        // Update UI
        updateStats();
        updateControlsPanel();
        
        // Initialize visualization
        updateModelDisplay();
        
        console.log('Experiment started successfully');
        
    } catch (error) {
        console.error('Error starting experiment:', error);
        showFeedback('Error starting experiment. Please check console for details.');
    }
}

// ============================================================================
// SECTION 14: INITIALIZATION
// ============================================================================

/**
 * Initializes the application when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, setting up event listeners...');
    
    const startButton = document.getElementById('start-button');
    if (startButton) {
        startButton.addEventListener('click', startExperiment);
        console.log('Start button event listener added');
    } else {
        console.error('Start button not found!');
    }
    
    // Initialize user model
    userModel = initUserModel();
    updateModelDisplay();

    // Initialize gray square to black (intro state)
    updateGraySquare('intro');
    
    console.log('Application initialized');
});

// ============================================================================
// END OF SCRIPT
// ============================================================================