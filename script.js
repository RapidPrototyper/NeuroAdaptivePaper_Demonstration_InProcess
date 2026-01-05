// =============================================
// GLOBAL VARIABLES AND CONFIGURATION
// =============================================

// Game state management
let gameState = 'intro';
let gridSize = 4;
let currentPos = { x: 1, y: 1 }; // 1-based coordinates
let targetPos = { x: 4, y: 4 }; // 1-based coordinates
let moveCount = 0;
let phase = 'calibration';
let totalJumps = 0;
let targetsReached = 0;
let breakCount = 0;
let jumpCounter = 0;
let hudVisible = false; // HUD visibility state
let gridNumbersVisible = false; // Grid numbers visibility state

// Gray square state tracking
let graySquareState = 'intro'; // Track current gray square state

// Configurable parameters
let calibrationJumps = 300;
let bciTargets = 5; // New parameter for BCI targets
let maxMovesPerTarget = 50;
let selectedCondition = 'full';

// Phase configuration structure - UPDATED: full experiment = calibration + BCI only
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
        targets: bciTargets, // Uses bciTargets parameter
        jumps: null,
        description: 'BCI Phase',
        color: '#9f7aea'
    },
    { 
        phase: 'manual', 
        type: 'manual', 
        targets: 5, 
        jumps: null,
        description: 'Manual Phase',
        color: '#63b3ed'
    }
];

let currentPhaseIndex = 0;
let filteredExperimentStructure = [];

// User model: directional probabilities for machine learning
let userModel = {};

// Three.js variables
let scene, camera, renderer;
let cursor, targetMarker;
let animating = false;
let gridCells = []; // Store grid cell objects for 3D effect
let gridLabels = []; // Store grid label objects

// Direction vectors for 8-direction movement
const directions = {
    'N': { x: 0, y: 1, angle: 90 },
    'NE': { x: 1, y: 1, angle: 45 },
    'E': { x: 1, y: 0, angle: 0 },
    'SE': { x: 1, y: -1, angle: -45 },
    'S': { x: 0, y: -1, angle: -90 },
    'SW': { x: -1, y: -1, angle: -135 },
    'W': { x: -1, y: 0, angle: 180 },
    'NW': { x: -1, y: 1, angle: 135 }
};

// Current move tracking
let currentMove = null;
let waitingForResponse = false;

// Event marker system for EEG synchronization
let eventMarkers = [];

// GLTF Loader for robot model
let robotModel = null;
let gltfLoader = null;
let mixer = null;
let clock = new THREE.Clock();

// =============================================
// GRAY SQUARE STATUS INDICATOR
// =============================================

/**
 * Update gray square color based on experiment state
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
    
    console.log(`Gray square updated to: ${state}`);
}

/**
 * Flash white when robot moves
 */
function flashGraySquareWhite() {
    const graySquare = document.getElementById('gray-square');
    if (!graySquare) return;
    
    // Add flash animation
    graySquare.classList.add('flash-white');
    
    // Remove after animation completes
    setTimeout(() => {
        graySquare.classList.remove('flash-white');
        
        // Restore to current state color
        graySquare.classList.remove('intro', 'calibration', 'bci', 'manual', 'break');
        graySquare.classList.add(graySquareState);
    }, 200); // Flash for 200ms
}

/**
 * Ensure gray square is always visible
 */
function ensureGraySquareVisible() {
    const graySquare = document.getElementById('gray-square');
    if (graySquare) {
        graySquare.classList.remove('hidden');
    }
}

// =============================================
// LSL BRIDGE CONFIGURATION
// =============================================

let lslWebSocket = null;
let isLSLConnected = false;
let wsReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Initialize WebSocket connection to LSL bridge
 */
function initializeLSLBridge() {
    const wsUrl = 'ws://localhost:8765';
    
    console.log('🔌 Connecting to LSL Bridge at:', wsUrl);
    
    lslWebSocket = new WebSocket(wsUrl);
    
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
 * Update LSL connection status in UI
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
 * Send classification to LSL bridge - FIXED FOR FULL EXPERIMENT
 */
function sendToLSLBridge(cls1, cls2) {
    if (!lslWebSocket || lslWebSocket.readyState !== WebSocket.OPEN) {
        console.warn('LSL Bridge not connected');
        if (hudVisible) {
            updateLSLStatus(false);
        }
        return false;
    }
    
    // Check the actual phase, not config.type
    if (phase !== 'bci') {
        // Don't send during calibration or manual phases
        return false;
    }
    
    const config = getCurrentPhaseConfig();
    
    const data = {
        cls1: cls1,
        cls2: cls2,
        phase: phase,
        jump: jumpCounter,
        gridSize: gridSize,
        target: `${targetPos.x},${targetPos.y}`,
        position: `${currentPos.x},${currentPos.y}`,
        timestamp: Date.now()
    };
    
    try {
        lslWebSocket.send(JSON.stringify(data));
        console.log(`📤 LSL: Jump ${jumpCounter}, cls1="${cls1}", cls2="${cls2}"`);
        return true;
    } catch (error) {
        console.error('Error sending to LSL Bridge:', error);
        if (hudVisible) {
            updateLSLStatus(false);
        }
        return false;
    }
}

/**
 * Send experiment event to LSL bridge
 */
function sendExperimentEventToLSL(eventType) {
    if (!isLSLConnected) return;
    
    const data = {
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

// =============================================
// INITIALIZATION FUNCTIONS
// =============================================

/**
 * Initialize user model with equal probabilities for all directions
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
 * Initialize Three.js scene for 3D visualization
 */
function initThreeJS() {
    const canvasContainer = document.getElementById('canvas-container');
    
    if (!canvasContainer) {
        console.error('Canvas container not found!');
        return;
    }
    
    try {
        // Scene setup
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);
        
        // Camera setup - FIXED: Look down from above with proper orientation
        camera = new THREE.PerspectiveCamera(
            60,
            canvasContainer.clientWidth / canvasContainer.clientHeight,
            0.1,
            1000
        );
        // Position camera to look down from top with better 3D angle
        // CHANGED: Position camera to view grid with North at top
        camera.position.set(0,11,-14);  // X=15 (was 8), Z=0 (was 15)
        camera.lookAt(0, 0, 0);

        // Renderer setup
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        canvasContainer.appendChild(renderer.domElement);
        
        // Lighting setup
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
        
        // Create 3D grid visualization
        create3DGridVisualization();
        
        // Initialize GLTF loader and load robot model
        initRobotLoader();
        
        // Create target marker (robot will be loaded separately)
        createTargetMarker();
        
        // Start animation loop
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
 * Initialize GLTF loader and load robot model
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
 * Load robot 3D model
 */
function loadRobotModel() {
    if (!gltfLoader) return;
    
    // Simple robot model URL (using a free 3D model from Three.js examples)
    // You can replace this URL with your own robot model
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
 * Create a simple robot model as fallback
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
 * Create 3D grid visualization with depth and elevation
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
            const cellColor = isDark ? 0x2a2a2a : 0x333333;  // Both dark grays
            
            const cellMaterial = new THREE.MeshStandardMaterial({ 
                color: cellColor,
                metalness: 0.1,
                roughness: 0.8
            });
            
            const cell = new THREE.Mesh(cellGeometry, cellMaterial);
            cell.position.set(
                (x - gridSize/2 + 0.5) * spacing,
                cellHeight / 2,  // Half height to sit on ground
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
 * Create cell borders for 3D effect
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
 * Create 3D grid lines with depth
 */
function create3DGridLines(spacing, cellHeight) {
    // Create grid lines with 3D depth
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
 * Create coordinate labels for better orientation
 */
function createCoordinateLabels(spacing) {
    const labelOffset = 1.3;
    
    // Create North indicator
    createDirectionIndicator('N', 0, gridSize * spacing / 2 + labelOffset, spacing);
    // Create South indicator
    createDirectionIndicator('S', 0, -gridSize * spacing / 2 - labelOffset, spacing);
    // Create East indicator
    createDirectionIndicator('E', gridSize * spacing / 2 + labelOffset, 0, spacing);
    // Create West indicator
    createDirectionIndicator('W', -gridSize * spacing / 2 - labelOffset, 0, spacing);
}

/**
 * Create direction indicator arrow
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
        case 'N':
            arrow.rotation.y = 0;
            break;
        case 'S':
            arrow.rotation.y = Math.PI;
            break;
        case 'E':
            arrow.rotation.y = -Math.PI / 2;
            break;
        case 'W':
            arrow.rotation.y = Math.PI / 2;
            break;
    }
    
    arrow.castShadow = true;
    scene.add(arrow);
    gridCells.push(arrow);
    
    // Add text label
    createTextLabel(direction, x, 1.0, z, 0.8);
}

/**
 * Create text label for direction
 */
function createTextLabel(text, x, y, z, size) {
    // Create simple 3D text using geometry
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
 * Create grid coordinate numbers (X and Y axes labels)
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
 * Create coordinate number sprite
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
 * Create cell coordinate label
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
 * Toggle grid numbers visibility
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
 * Create target marker (replaces createCursorAndTarget since cursor is now robot)
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
        ((targetPos.x - 1) - gridSize/2 + 0.5) * spacing,  // X: East/West
        0.6,                                                // Y: height
        ((targetPos.y - 1) - gridSize/2 + 0.5) * spacing   // Z: North/South
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
 * Handle window resize for Three.js
 */
function handleResize() {
    const canvasContainer = document.getElementById('canvas-container');
    camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
}

// =============================================
// EVENT MARKER SYSTEM
// =============================================

/**
 * Send event marker for EEG synchronization
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
 * Calculate angle between jump direction and goal direction
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
 * Classify angle into movement categories - BOTH CLASSIFICATIONS
 */
function classifyAngle(angle) {
    // Classification 1: toward/away/sideways
    let cls1;
    if (angle <= 45) {
        cls1 = 'toward';
    } else if (angle <= 135) {
        cls1 = 'sideways';
    } else {
        cls1 = 'away';
    }
    
    // Classification 2: very good/neutral/very bad
    let cls2;
    if (angle < 1) {
        cls2 = 'very good';
    } else if (angle <= 135) {
        cls2 = 'neutral';
    } else {
        cls2 = 'very bad';
    }
    
    return { cls1, cls2 };
}

/**
 * Create jump marker with classification data - UPDATED with cls1
 */
function createJumpMarker(fromPos, toPos, direction, classification) {
    const angle = calculateAngleToGoal(fromPos, toPos);
    
    // Format: 4x4;g44;j001:11>22;ang090;cls1:sideways;cls2:neutral (1-based coordinates)
    const marker = `${gridSize}x${gridSize};g${targetPos.x}${targetPos.y};j${String(jumpCounter).padStart(3, '0')}:${fromPos.x}${fromPos.y}>${toPos.x}${toPos.y};ang${String(angle).padStart(3, '0')};cls1:${classification.cls1};cls2:${classification.cls2}`;
    
    return marker;
}

// =============================================
// PHASE MANAGEMENT
// =============================================

/**
 * Filter experiment structure based on selected condition
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
 * Get current phase configuration
 */
function getCurrentPhaseConfig() {
    return filteredExperimentStructure[currentPhaseIndex];
}

/**
 * Check if current phase is complete
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
 * Show phase transition screen
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
    updateGraySquare('intro'); // Use 'intro' state which is black
    
    // Add spacebar listener for phase transition
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
 * Proceed to next phase after transition
 */
function proceedToNextPhase() {
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
        showFeedback('Experiment complete! Thank you for participating.<br><br>Press <kbd>SPACEBAR</kbd> to return to start screen');
        
        // Update gray square to intro (black)
        updateGraySquare('intro');
        
        // Add spacebar listener to return to start screen
        function handleExperimentCompleteKeyPress(e) {
            if (e.code === 'Space') {
                window.removeEventListener('keydown', handleExperimentCompleteKeyPress);
                returnToStartScreen();
            }
        }
        
        window.addEventListener('keydown', handleExperimentCompleteKeyPress);
        return;
    }
    
    const config = getCurrentPhaseConfig();
    phase = config.phase;
    
    // Update gray square for new phase
    updateGraySquare(config.phase);
    
    sendEventMarker(`phase_start:${config.phase}`);
    sendExperimentEventToLSL(`phase_start_${config.phase}`);
    
    // Show model panel
    document.getElementById('model-panel').classList.remove('hidden');
    
    updateStats();
    updateControlsPanel();
    resetGrid();
}

/**
 * Return to start screen after experiment completion
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
 * Move to next phase with transition
 */
function nextPhase() {
    showPhaseTransition();
}

// =============================================
// MOVEMENT AND DIRECTION LOGIC
// =============================================

/**
 * Select direction based on current phase and probabilities
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
 * Move cursor to new position - UPDATED for 1-based coordinates
 */
function moveCursor() {
    if (animating || waitingForResponse || !robotModel) return;
    
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
    
    // Send the detailed jump marker
    const jumpMarker = createJumpMarker(currentPos, newPos, direction, classification);
    sendEventMarker(jumpMarker);
    
    // ALSO send the simple cls1 marker
    sendEventMarker(classification.cls1);  // "toward", "sideways", or "away"
    
    // Send additional classifyNow marker for BCI phases and send to LSL
    if (phase === 'bci') {
        sendEventMarker('classifyNow');
        // Send classification to LSL Bridge
        sendToLSLBridge(classification.cls1, classification.cls2);
    }
    
    // Animate movement with 3D effects
    animating = true;
    animateRobotMove(currentPos, newPos, direction, () => {
        currentPos = newPos;
        moveCount++;
        totalJumps++;
        animating = false;
        
        // Check calibration completion
        if (config.type === 'calibration' && totalJumps >= config.jumps) {
            showFeedback(`Calibration complete! ${totalJumps} jumps recorded.`);
            setTimeout(() => nextPhase(), 1500);
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
        
        // In manual phase, wait for user response
        if (config.type === 'manual') {
            waitingForResponse = true;
            showFeedback('Was this movement ACCEPTABLE? Press V (yes) or B (no)');
            currentMove = { direction, fromPos: currentPos, toPos: newPos };
        } else {
            // Continue automatically in other phases
            setTimeout(() => moveCursor(), 400);
        }
    });
}

/**
 * Handle when target is reached
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
    
    // Check if we need a break
    if (config.type !== 'calibration') {
        breakCount++;
        if (breakCount >= 5) {
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
 * Create celebration effect when target is reached
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
 * Handle when maximum moves are reached without finding target
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
 * Animate robot movement with walking animation - UPDATED for proper 3D movement
 */
function animateRobotMove(from, to, direction, onComplete) {
    if (!robotModel) return;
    
    const spacing = 2;
    // Convert 1-based coordinates to Three.js coordinates
    const startX = ((from.x - 1) - gridSize/2 + 0.5) * spacing;
    const startZ = ((from.y - 1) - gridSize/2 + 0.5) * spacing;  // Using Z for North/South
    const endX = ((to.x - 1) - gridSize/2 + 0.5) * spacing;
    const endZ = ((to.y - 1) - gridSize/2 + 0.5) * spacing;      // Using Z for North/South
    
    const duration = 500;
    const startTime = Date.now();
    
    // Calculate rotation based on direction
    const targetRotationY = getRotationFromDirection(direction);
    
    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        
        // Update position
        robotModel.position.x = startX + (endX - startX) * eased;  // East/West
        robotModel.position.z = startZ + (endZ - startZ) * eased;  // North/South (using Z)
        
        // Animate walking motion
        const walkHeight = 0.8 + Math.sin(progress * Math.PI * 2) * 0.1;
        robotModel.position.y = walkHeight;
        
        // Smoothly rotate to face movement direction
        const rotationProgress = Math.min(progress * 2, 1);
        robotModel.rotation.y += (targetRotationY - robotModel.rotation.y) * rotationProgress * 0.1;
        
        // Add walking animation to robot parts
        animateRobotWalking(progress);
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Return to normal height
            robotModel.position.y = 0.8;
            onComplete();
        }
    }
    
    animate();
}

/**
 * Get rotation angle from direction
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
 * Animate robot walking motion
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

// =============================================
// USER MODEL AND MACHINE LEARNING
// =============================================

/**
 * Update user model based on manual feedback
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
 * Get opposite direction
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
 * Get perpendicular directions
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
 * Normalize probabilities to sum to 1
 */
function normalizeProbabilities() {
    const sum = Object.values(userModel).reduce((a, b) => a + b, 0);
    Object.keys(userModel).forEach(key => {
        userModel[key] /= sum;
    });
}

// =============================================
// HUD TOGGLE FUNCTIONS
// =============================================

/**
 * Toggle HUD visibility
 */
function toggleHUD() {
    hudVisible = !hudVisible;
    
    if (hudVisible) {
        showHUD();
    } else {
        hideHUD();
    }
    
    // Toggle grid numbers separately
    toggleGridNumbers();
    
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
 * Show HUD panels
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
 * Hide HUD panels
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
    
    // Keep the gray square visible
    ensureGraySquareVisible();
    
    console.log('HUD hidden');
}

// =============================================
// VISUALIZATION AND UI UPDATES
// =============================================

/**
 * Create bar chart visualization of direction probabilities
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
        ctx.fillRect(x + barActualWidth, y, 3, barHeight); // Right side
        ctx.fillRect(x, y + barHeight, barActualWidth, 3); // Top side
        
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
 * Update the model display with numerical values and bar chart
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
 * Update controls panel based on current phase
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
 * Update statistics display - UPDATED for 1-based coordinates
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
    document.getElementById('position-display').textContent = `(${currentPos.x}, ${currentPos.y})`; // 1-based
    document.getElementById('target-display').textContent = `(${targetPos.x}, ${targetPos.y})`; // 1-based
    
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

// =============================================
// USER INTERFACE FUNCTIONS
// =============================================

/**
 * Show feedback message with HTML support
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
 * Hide feedback message
 */
function hideFeedback() {
    document.getElementById('feedback-panel').classList.add('hidden');
}

/**
 * Show break screen
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
 * Reset grid with new positions - UPDATED: Initial goal based on grid size
 */
function resetGrid() {
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
    // For 4x4: if goal is (4,4), start is (2,2)
    // For 6x6: if goal is (6,6), start is (2,2)
    // For 8x8: if goal is (8,8), start is (2,2)
    
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
            (start.x - 1 - gridSize/2 + 0.5) * spacing, // X: East/West
            0.3,                                        // Y: height
            (start.y - 1 - gridSize/2 + 0.5) * spacing  // Z: North/South
        );
        
        // Reset robot rotation to face forward
        robotModel.rotation.y = Math.PI;
        
        // Update target position
        targetMarker.position.set(
            (target.x - 1 - gridSize/2 + 0.5) * spacing, // X: East/West
            0.6,                                         // Y: height
            (target.y - 1 - gridSize/2 + 0.5) * spacing  // Z: North/South
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

// =============================================
// INPUT HANDLING
// =============================================

/**
 * Handle keyboard input
 */
function handleKeyPress(e) {
    const config = getCurrentPhaseConfig();
    
    if (e.key === 'h' || e.key === 'H') {
        // Toggle HUD visibility with H key
        toggleHUD();
        return;
    }
    
    if (config.type === 'manual' && waitingForResponse) {
        if (e.key === 'v' || e.key === 'V') {
            sendEventMarker('button:v');
            
            // Add visual feedback for V key
            createButtonFeedbackEffect(true);
            handleUserResponse(true);
        } else if (e.key === 'b' || e.key === 'B') {
            sendEventMarker('button:b');
            
            // Add visual feedback for B key
            createButtonFeedbackEffect(false);
            handleUserResponse(false);
        }
    }
}

/**
 * Create visual feedback for button presses
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
 * Handle user response in manual phase
 */
function handleUserResponse(isAcceptable) {
    waitingForResponse = false;
    hideFeedback();
    
    if (currentMove) {
        updateUserModel(currentMove.direction, isAcceptable);
    }
    
    setTimeout(() => moveCursor(), 300);
}

// =============================================
// EXPERIMENT CONTROL
// =============================================

/**
 * Start the experiment
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
        
        // Filter experiment structure
        filteredExperimentStructure = filterExperimentStructure();
        
        // Update phase parameters
        if (filteredExperimentStructure[0] && filteredExperimentStructure[0].type === 'calibration') {
            filteredExperimentStructure[0].jumps = calibrationJumps;
        }
        if (filteredExperimentStructure[1] && filteredExperimentStructure[1].type === 'bci') {
            filteredExperimentStructure[1].targets = bciTargets;
        }
        
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
        showHUD();  // This will also show LSL status if connected
        
        // Grid numbers hidden by default
        gridNumbersVisible = false;
        
        console.log(`Starting experiment with ${gridSize}x${gridSize} grid`);
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

// =============================================
// INITIALIZATION
// =============================================

/**
 * Initialize the application when DOM is loaded
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