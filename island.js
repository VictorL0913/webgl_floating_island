// WebGL Floating Island Scene
// Main JavaScript file - FIXED COLLISION RESPONSE

// Global variables
let canvas, gl;
let shaderProgram, shadowProgram;
let islandCubes = [], buildingVAOs = [], treeTrunks = [], treeTops = [], bushVAOs = [], carParts = [];
let shadowFBO, depthTexture;
let camera = {
    position: [0, 12, 18],
    target: [0, 0, 0],
    up: [0, 1, 0],
    rotation: 0,
    height: 12,
    distance: 18
};
let spotlight = {
    position: [0, 20, 8],
    direction: [0, -1, 0],
    target: [0, 0, 0],
    angle: 0,
    cutoff: Math.PI / 6,
    outerCutoff: Math.PI / 5,
    constant: 1.0,
    linear: 0.05,
    quadratic: 0.012
};
let keys = {};
let shadowMapSize = 1024;

// Car properties
let car = {
    position: [7.5, 0.55, 0],
    direction: Math.PI,
    speed: 0,
    maxSpeed: 0.15,
    acceleration: 0.005,
    friction: 0.98,
    turningSpeed: 0.05,
    width: 1.5,
    length: 2.0,
    height: 0.8
};

// Object tracking
let sceneObjects = [];
let collisionObjects = [];
let debugMode = false; // Set to true to see collision circles

// Vertex shader for main rendering
const vertexShaderSource = `#version 300 es
    precision highp float;
    
    in vec3 aPosition;
    in vec3 aNormal;
    in vec3 aColor;
    
    uniform mat4 uModelMatrix;
    uniform mat4 uViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uLightSpaceMatrix;
    uniform vec3 uLightPosition;
    uniform vec3 uLightDirection;
    uniform vec3 uViewPosition;
    
    out vec3 vNormal;
    out vec3 vColor;
    out vec3 vFragPos;
    out vec4 vShadowCoord;
    out vec3 vLightDir;
    out vec3 vViewDir;
    out float vLightDistance;
    
    void main() {
        vec4 worldPosition = uModelMatrix * vec4(aPosition, 1.0);
        vFragPos = worldPosition.xyz;
        vNormal = normalize(mat3(uModelMatrix) * aNormal);
        vColor = aColor;
        vShadowCoord = uLightSpaceMatrix * worldPosition;
        
        vLightDir = normalize(uLightPosition - worldPosition.xyz);
        vViewDir = normalize(uViewPosition - worldPosition.xyz);
        vLightDistance = length(uLightPosition - worldPosition.xyz);
        
        gl_Position = uProjectionMatrix * uViewMatrix * worldPosition;
    }
`;

// Fragment shader for main rendering
const fragmentShaderSource = `#version 300 es
    precision highp float;
    
    in vec3 vNormal;
    in vec3 vColor;
    in vec3 vFragPos;
    in vec4 vShadowCoord;
    in vec3 vLightDir;
    in vec3 vViewDir;
    in float vLightDistance;
    
    uniform vec3 uLightColor;
    uniform vec3 uLightDirection;
    uniform vec3 uAmbientColor;
    uniform sampler2D uShadowMap;
    uniform float uLightCutoff;
    uniform float uLightOuterCutoff;
    uniform float uLightConstant;
    uniform float uLightLinear;
    uniform float uLightQuadratic;
    
    out vec4 fragColor;
    
    float calculateShadow(vec4 shadowCoord) {
        vec3 projCoords = shadowCoord.xyz / shadowCoord.w;
        projCoords = projCoords * 0.5 + 0.5;
        
        if(projCoords.z > 1.0) return 0.0;
        
        float closestDepth = texture(uShadowMap, projCoords.xy).r;
        float currentDepth = projCoords.z;
        
        float bias = max(0.005 * (1.0 - dot(normalize(vNormal), normalize(uLightDirection))), 0.001);
        float shadow = currentDepth - bias > closestDepth ? 1.0 : 0.0;
        
        return shadow;
    }
    
    void main() {
        vec3 ambient = uAmbientColor * vColor * 1.5;
        
        float theta = dot(vLightDir, normalize(-uLightDirection));
        float epsilon = uLightCutoff - uLightOuterCutoff;
        float intensity = clamp((theta - uLightOuterCutoff) / epsilon, 0.0, 1.0);
        
        float diff = max(dot(vNormal, vLightDir), 0.0);
        vec3 diffuse = diff * uLightColor * vColor * 2.5;
        
        vec3 reflectDir = reflect(-vLightDir, vNormal);
        float spec = pow(max(dot(vViewDir, reflectDir), 0.0), 32.0);
        vec3 specular = spec * uLightColor * 0.8;
        
        float attenuation = 1.0 / (uLightConstant + uLightLinear * vLightDistance + 
                                 uLightQuadratic * (vLightDistance * vLightDistance));
        
        float shadow = calculateShadow(vShadowCoord);
        
        vec3 result = ambient + (1.0 - shadow * 0.5) * intensity * attenuation * (diffuse + specular);
        
        fragColor = vec4(result, 1.0);
    }
`;

// Vertex shader for shadow mapping
const shadowVertexShaderSource = `#version 300 es
    precision highp float;
    
    in vec3 aPosition;
    
    uniform mat4 uModelMatrix;
    uniform mat4 uLightSpaceMatrix;
    
    void main() {
        gl_Position = uLightSpaceMatrix * uModelMatrix * vec4(aPosition, 1.0);
    }
`;

// Fragment shader for shadow mapping
const shadowFragmentShaderSource = `#version 300 es
    precision highp float;
    
    void main() {
        // Depth is automatically written
    }
`;

// Initialize WebGL context
function initWebGL() {
    canvas = document.getElementById('webgl');
    
    if (!canvas) {
        console.error('Canvas element not found!');
        return false;
    }
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    gl = canvas.getContext('webgl2');
    
    if (!gl) {
        alert('WebGL 2 is not available in your browser.');
        return false;
    }
    
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    
    return true;
}

// Create and compile shader
function createShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    
    return shader;
}

// Create shader program
function createProgram(vertexSource, fragmentSource) {
    const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);
    
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        return null;
    }
    
    return program;
}

// Create shadow framebuffer with depth texture
function createShadowFramebuffer() {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    
    depthTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, 
                  shadowMapSize, shadowMapSize, 0, 
                  gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, 
                           gl.TEXTURE_2D, depthTexture, 0);
    
    gl.drawBuffers([]);
    gl.readBuffer(gl.NONE);
    
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer is incomplete:', status);
        return null;
    }
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}

// Create a proper cube with correct normals
function createCube(position, size, color) {
    const [x, y, z] = position;
    const [w, h, d] = size;
    
    const allVertices = [];
    const allNormals = [];
    const allColors = [];
    const allIndices = [];
    let index = 0;
    
    // Front face
    allVertices.push(x-w, y, z+d, x+w, y, z+d, x+w, y+h, z+d, x-w, y+h, z+d);
    for (let i = 0; i < 4; i++) {
        allNormals.push(0, 0, 1);
        allColors.push(...color);
    }
    allIndices.push(index, index+1, index+2, index, index+2, index+3);
    index += 4;
    
    // Back face
    allVertices.push(x+w, y, z-d, x-w, y, z-d, x-w, y+h, z-d, x+w, y+h, z-d);
    for (let i = 0; i < 4; i++) {
        allNormals.push(0, 0, -1);
        allColors.push(...color);
    }
    allIndices.push(index, index+1, index+2, index, index+2, index+3);
    index += 4;
    
    // Top face
    allVertices.push(x-w, y+h, z+d, x+w, y+h, z+d, x+w, y+h, z-d, x-w, y+h, z-d);
    for (let i = 0; i < 4; i++) {
        allNormals.push(0, 1, 0);
        allColors.push(...color);
    }
    allIndices.push(index, index+1, index+2, index, index+2, index+3);
    index += 4;
    
    // Bottom face
    allVertices.push(x-w, y, z-d, x+w, y, z-d, x+w, y, z+d, x-w, y, z+d);
    for (let i = 0; i < 4; i++) {
        allNormals.push(0, -1, 0);
        allColors.push(...color);
    }
    allIndices.push(index, index+1, index+2, index, index+2, index+3);
    index += 4;
    
    // Right face
    allVertices.push(x+w, y, z+d, x+w, y, z-d, x+w, y+h, z-d, x+w, y+h, z+d);
    for (let i = 0; i < 4; i++) {
        allNormals.push(1, 0, 0);
        allColors.push(...color);
    }
    allIndices.push(index, index+1, index+2, index, index+2, index+3);
    index += 4;
    
    // Left face
    allVertices.push(x-w, y, z-d, x-w, y, z+d, x-w, y+h, z+d, x-w, y+h, z-d);
    for (let i = 0; i < 4; i++) {
        allNormals.push(-1, 0, 0);
        allColors.push(...color);
    }
    allIndices.push(index, index+1, index+2, index, index+2, index+3);
    
    return createVAO(allVertices, allNormals, allColors, allIndices);
}

// Create pyramid island from stacked cubes
function createIsland() {
    const islandCubes = [];
    const brownColor = [0.65, 0.50, 0.39];
    const sandstoneColor = [0.76, 0.70, 0.50];
    
    const layers = 8;
    const baseSize = 12;
    const layerHeight = 0.4;
    
    for (let layer = 0; layer < layers; layer++) {
        const currentSize = baseSize * (1 - (layer / layers) * 0.5);
        const yPos = -layer * layerHeight;
        
        const cube = createCube([0, yPos, 0], [currentSize, layerHeight, currentSize], brownColor);
        islandCubes.push(cube);
    }
    
    // Top surface
    const topSize = 10.0;
    const topCube = createCube([0, 0.2, 0], [topSize, 0.4, topSize], sandstoneColor);
    islandCubes.push(topCube);
    
    return islandCubes;
}

// Create building with collision data
function createBuilding(position, size, color) {
    const adjustedPos = [position[0], -0.4 + (size[1]/2), position[2]];
    
    const buildingVAO = createCube(adjustedPos, size, color);
    
    // Add to scene objects for rendering
    sceneObjects.push({
        vao: buildingVAO.vao,
        count: buildingVAO.count,
        modelMatrix: mat4.create()
    });
    
    // Add to collision objects with precise circle collision
    const radius = Math.max(size[0], size[2]) * 0.8;
    collisionObjects.push({
        type: 'building',
        position: [position[0], 0, position[2]],
        size: size,
        radius: radius,
        color: color
    });
    
    return buildingVAO;
}

// Create tree trunk with collision data
function createTreeTrunk(position) {
    const [x, z] = position;
    const trunkHeight = 2.0;
    const adjustedPos = [x, -0.4 + (trunkHeight/2), z];
    
    const trunkVAO = createCube(adjustedPos, [0.3, trunkHeight, 0.3], [0.4, 0.25, 0.1]);
    
    sceneObjects.push({
        vao: trunkVAO.vao,
        count: trunkVAO.count,
        modelMatrix: mat4.create()
    });
    
    // Add tree trunk to collision objects
    collisionObjects.push({
        type: 'tree',
        position: [x, 0, z],
        radius: 0.5,
        color: [0.4, 0.25, 0.1]
    });
    
    return trunkVAO;
}

// Create tree top
function createTreeTop(position) {
    const [x, z] = position;
    const treeParts = [];
    const greenColor = [0.15, 0.7, 0.15];
    
    const trunkTopY = 0.4 + 2.0;
    
    for (let layer = 0; layer < 3; layer++) {
        const layerSize = 1.5 - (layer * 0.4);
        const yPos = trunkTopY + (layer * 0.8);
        const cube = createCube([x, yPos, z], [layerSize, 0.8, layerSize], greenColor);
        
        sceneObjects.push({
            vao: cube.vao,
            count: cube.count,
            modelMatrix: mat4.create()
        });
        
        treeParts.push(cube);
    }
    
    return treeParts;
}

// Create bush cluster
function createBushCluster(position) {
    const [x, z] = position;
    const bushParts = [];
    const greenColor = [0.1, 0.6, 0.1];
    
    const bushHeight = 0.6;
    const bushY = 0.4 + (bushHeight/2);
    
    const bushPositions = [
        [x, bushY, z],
        [x + 0.3, bushY, z],
        [x - 0.3, bushY, z],
        [x, bushY, z + 0.3],
        [x, bushY, z - 0.3]
    ];
    
    bushPositions.forEach((bushPos, index) => {
        const bush = createCube(bushPos, [0.3, bushHeight, 0.3], greenColor);
        
        sceneObjects.push({
            vao: bush.vao,
            count: bush.count,
            modelMatrix: mat4.create()
        });
        
        // Add central bush to collision objects
        if (index === 0) {
            collisionObjects.push({
                type: 'bush',
                position: [bushPos[0], 0, bushPos[2]],
                radius: 0.4,
                color: greenColor
            });
        }
        
        bushParts.push(bush);
    });
    
    return bushParts;
}

// Create a car with proper wheel placement
function createCar() {
    const carParts = [];
    const [x, y, z] = [0, 0, 0];
    
    const bodyColor = [0.8, 0.2, 0.2];
    const wheelColor = [0.1, 0.1, 0.1];
    
    // Wheels
    const wheelY = (0.2/2);
    const wheelPositions = [
        [x - 0.4, wheelY, z - 0.7],
        [x + 0.4, wheelY, z - 0.7],
        [x - 0.4, wheelY, z + 0.7],
        [x + 0.4, wheelY, z + 0.7]
    ];
    
    wheelPositions.forEach(wheelPos => {
        const wheelVAO = createCube(wheelPos, [0.2, 0.2, 0.2], wheelColor);
        carParts.push(wheelVAO);
    });
    
    // Main car body
    const carBodyHeight = 0.3;
    const carY = wheelY + (carBodyHeight/2) + 0.1;
    const bodyVAO = createCube([x, carY, z], [0.6, carBodyHeight, 1.0], bodyColor);
    carParts.push(bodyVAO);
    
    // Red cabin block
    const cabinHeight = 0.3;
    const cabinY = carY + (carBodyHeight/2) + (cabinHeight/2);
    const cabinVAO = createCube([x, cabinY, z + 0.15], [0.5, cabinHeight, 0.7], bodyColor);
    carParts.push(cabinVAO);
    
    return carParts;
}

// Check collision and push car away from objects
function handleCollisions(newX, newZ) {
    const carRadius = 1.0;
    const islandEdge = 9.0;
    let collision = false;
    
    // Check island boundaries first
    if (Math.abs(newX) > islandEdge) {
        car.speed = 0;
        // Push car away from edge
        car.position[0] = Math.sign(newX) * (islandEdge - 0.1);
        return true;
    }
    
    if (Math.abs(newZ) > islandEdge) {
        car.speed = 0;
        // Push car away from edge
        car.position[2] = Math.sign(newZ) * (islandEdge - 0.1);
        return true;
    }
    
    // Check collisions with all objects
    for (const obj of collisionObjects) {
        const dx = newX - obj.position[0];
        const dz = newZ - obj.position[2];
        const distance = Math.sqrt(dx * dx + dz * dz);
        const minDistance = carRadius + obj.radius;
        
        if (distance < minDistance) {
            collision = true;
            
            // Push car away from the object
            if (distance > 0.01) { // Avoid division by zero
                const overlap = minDistance - distance;
                const pushX = (dx / distance) * overlap * 1.5;
                const pushZ = (dz / distance) * overlap * 1.5;
                
                // Apply push force
                car.position[0] -= pushX;
                car.position[2] -= pushZ;
            } else {
                // If directly on top, push in a random direction
                car.position[0] += 0.5;
                car.position[2] += 0.5;
            }
            
            // Reduce speed when colliding
            car.speed *= 0.5;
            
            // Prevent car from getting stuck by ensuring we're at least minDistance away
            const newDx = car.position[0] - obj.position[0];
            const newDz = car.position[2] - obj.position[2];
            const newDistance = Math.sqrt(newDx * newDx + newDz * newDz);
            
            if (newDistance < minDistance) {
                const adjust = (minDistance - newDistance) / newDistance;
                car.position[0] += newDx * adjust;
                car.position[2] += newDz * adjust;
            }
        }
    }
    
    return collision;
}

// Update car position with collision response
function updateCar() {
    car.speed *= car.friction;
    
    // Arrow Up/Down for forward/backward
    if (keys['ArrowDown']) {
        car.speed = Math.min(car.speed + car.acceleration, car.maxSpeed);
    }
    if (keys['ArrowUp']) {
        car.speed = Math.max(car.speed - car.acceleration, -car.maxSpeed * 0.7);
    }
    
    // Arrow Left/Right for turning
    if (keys['ArrowRight']) {
        car.direction -= car.turningSpeed;
    }
    if (keys['ArrowLeft']) {
        car.direction += car.turningSpeed;
    }
    
    // Apply movement if we have speed
    if (Math.abs(car.speed) > 0.001) {
        const moveX = Math.sin(car.direction) * car.speed;
        const moveZ = Math.cos(car.direction) * car.speed;
        
        const newX = car.position[0] + moveX;
        const newZ = car.position[2] + moveZ;
        
        // Try to move in X direction
        let canMoveX = true;
        let canMoveZ = true;
        
        // Check X movement
        if (!handleCollisions(newX, car.position[2])) {
            car.position[0] = newX;
        } else {
            canMoveX = false;
        }
        
        // Check Z movement  
        if (!handleCollisions(car.position[0], newZ)) {
            car.position[2] = newZ;
        } else {
            canMoveZ = false;
        }
        
        // If both directions blocked, try diagonal movement
        if (!canMoveX && !canMoveZ) {
            // Try smaller steps
            const smallMoveX = Math.sin(car.direction) * car.speed * 0.3;
            const smallMoveZ = Math.cos(car.direction) * car.speed * 0.3;
            
            if (!handleCollisions(car.position[0] + smallMoveX, car.position[2])) {
                car.position[0] += smallMoveX;
            }
            if (!handleCollisions(car.position[0], car.position[2] + smallMoveZ)) {
                car.position[2] += smallMoveZ;
            }
        }
    }
}

// Create Vertex Array Object
function createVAO(vertices, normals, colors, indices) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    
    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);
    
    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(2);
    
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    
    gl.bindVertexArray(null);
    
    return {
        vao: vao,
        count: indices.length
    };
}

// Create all scene objects with fixed positions
function createSceneObjects() {
    // Clear object arrays
    sceneObjects = [];
    collisionObjects = [];
    
    // Create island
    islandCubes = createIsland();
    
    // Add island cubes to scene objects
    islandCubes.forEach(cube => {
        sceneObjects.push({
            vao: cube.vao,
            count: cube.count,
            modelMatrix: mat4.create()
        });
    });
    
    // Create buildings - fixed positions
    buildingVAOs = [];
    
    const buildingPositions = [
        {x: -4.0, z: -3.0, size: [0.8, 2.0, 0.8], color: [0.7, 0.3, 0.3]},
        {x: 4.0, z: -3.0, size: [1.0, 2.5, 1.0], color: [0.3, 0.3, 0.7]},
        {x: -3.5, z: 3.5, size: [0.9, 1.8, 0.9], color: [0.3, 0.7, 0.3]},
        {x: 3.5, z: 3.5, size: [1.1, 2.2, 1.1], color: [0.7, 0.7, 0.3]}
    ];
    
    buildingPositions.forEach(building => {
        const buildingVAO = createBuilding([building.x, 0.4, building.z], 
                                         building.size, 
                                         building.color);
        buildingVAOs.push(buildingVAO);
    });
    
    // Create bushes - fixed positions
    bushVAOs = [];
    
    const bushPositions = [
        [-2.0, -1.0], [2.0, -1.0], [-2.0, 1.0], [2.0, 1.0],
        [0, -2.5], [0, 2.5], [-4.0, 0], [4.0, 0]
    ];
    
    bushPositions.forEach(pos => {
        const bushCluster = createBushCluster([pos[0], pos[1]]);
        bushVAOs.push(...bushCluster);
    });
    
    // Create trees - fixed positions
    treeTrunks = [];
    treeTops = [];
    
    const treePositions = [
        [-6.0, 0],
        [6.0, 0],
        [0, -5.0],
        [0, 5.0]
    ];
    
    treePositions.forEach(pos => {
        // Create trunk
        const trunk = createTreeTrunk([pos[0], pos[1]]);
        treeTrunks.push(trunk);
        
        // Create top
        const topParts = createTreeTop([pos[0], pos[1]]);
        treeTops.push(...topParts);
    });
    
    // Create car
    carParts = createCar();
}

// Render shadow pass
function renderShadowPass() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.viewport(0, 0, shadowMapSize, shadowMapSize);
    
    gl.clear(gl.DEPTH_BUFFER_BIT);
    
    gl.useProgram(shadowProgram);
    
    const lightProjection = mat4.create();
    mat4.perspective(lightProjection, spotlight.cutoff * 2.0, 1.0, 1.0, 50.0);
    
    const lightView = mat4.create();
    mat4.lookAt(lightView, 
                spotlight.position,
                spotlight.target,
                [0, 1, 0]);
    
    const lightSpaceMatrix = mat4.create();
    mat4.multiply(lightSpaceMatrix, lightProjection, lightView);
    
    const lightSpaceLoc = gl.getUniformLocation(shadowProgram, 'uLightSpaceMatrix');
    gl.uniformMatrix4fv(lightSpaceLoc, false, lightSpaceMatrix);
    
    const modelLoc = gl.getUniformLocation(shadowProgram, 'uModelMatrix');
    
    // Render all static scene objects
    sceneObjects.forEach(obj => {
        gl.uniformMatrix4fv(modelLoc, false, obj.modelMatrix);
        gl.bindVertexArray(obj.vao);
        gl.drawElements(gl.TRIANGLES, obj.count, gl.UNSIGNED_SHORT, 0);
    });
    
    // Render car in shadow pass
    const carModelMatrix = mat4.create();
    mat4.translate(carModelMatrix, carModelMatrix, [car.position[0], car.position[1], car.position[2]]);
    mat4.rotateY(carModelMatrix, carModelMatrix, car.direction);
    gl.uniformMatrix4fv(modelLoc, false, carModelMatrix);
    
    carParts.forEach(part => {
        gl.bindVertexArray(part.vao);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
    });
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Render main pass
function renderMainPass() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.2, 0.2, 0.25, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    
    gl.useProgram(shaderProgram);
    
    const projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, 
                     Math.PI / 4,
                     canvas.width / canvas.height,
                     0.1,
                     100.0);
    
    const viewMatrix = mat4.create();
    mat4.lookAt(viewMatrix, 
                camera.position,
                camera.target,
                camera.up);
    
    const lightProjection = mat4.create();
    mat4.perspective(lightProjection, spotlight.cutoff * 2.0, 1.0, 1.0, 50.0);
    
    const lightView = mat4.create();
    mat4.lookAt(lightView, 
                spotlight.position,
                spotlight.target,
                [0, 1, 0]);
    
    const lightSpaceMatrix = mat4.create();
    mat4.multiply(lightSpaceMatrix, lightProjection, lightView);
    
    // Set all uniforms
    const projLoc = gl.getUniformLocation(shaderProgram, 'uProjectionMatrix');
    const viewLoc = gl.getUniformLocation(shaderProgram, 'uViewMatrix');
    const lightSpaceLoc = gl.getUniformLocation(shaderProgram, 'uLightSpaceMatrix');
    const modelLoc = gl.getUniformLocation(shaderProgram, 'uModelMatrix');
    const lightPosLoc = gl.getUniformLocation(shaderProgram, 'uLightPosition');
    const lightDirLoc = gl.getUniformLocation(shaderProgram, 'uLightDirection');
    const lightColorLoc = gl.getUniformLocation(shaderProgram, 'uLightColor');
    const ambientLoc = gl.getUniformLocation(shaderProgram, 'uAmbientColor');
    const viewPosLoc = gl.getUniformLocation(shaderProgram, 'uViewPosition');
    const cutoffLoc = gl.getUniformLocation(shaderProgram, 'uLightCutoff');
    const outerCutoffLoc = gl.getUniformLocation(shaderProgram, 'uLightOuterCutoff');
    const constantLoc = gl.getUniformLocation(shaderProgram, 'uLightConstant');
    const linearLoc = gl.getUniformLocation(shaderProgram, 'uLightLinear');
    const quadraticLoc = gl.getUniformLocation(shaderProgram, 'uLightQuadratic');
    
    gl.uniformMatrix4fv(projLoc, false, projectionMatrix);
    gl.uniformMatrix4fv(viewLoc, false, viewMatrix);
    gl.uniformMatrix4fv(lightSpaceLoc, false, lightSpaceMatrix);
    gl.uniform3fv(lightPosLoc, spotlight.position);
    gl.uniform3fv(lightDirLoc, spotlight.direction);
    gl.uniform3fv(lightColorLoc, [1.5, 1.5, 1.3]);
    gl.uniform3fv(ambientLoc, [0.4, 0.4, 0.4]);
    
    // Set spotlight properties
    gl.uniform3fv(viewPosLoc, camera.position);
    gl.uniform1f(cutoffLoc, Math.cos(spotlight.cutoff));
    gl.uniform1f(outerCutoffLoc, Math.cos(spotlight.outerCutoff));
    gl.uniform1f(constantLoc, spotlight.constant);
    gl.uniform1f(linearLoc, spotlight.linear);
    gl.uniform1f(quadraticLoc, spotlight.quadratic);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    const shadowMapLoc = gl.getUniformLocation(shaderProgram, 'uShadowMap');
    gl.uniform1i(shadowMapLoc, 0);
    
    // Render all static scene objects
    sceneObjects.forEach(obj => {
        gl.uniformMatrix4fv(modelLoc, false, obj.modelMatrix);
        gl.bindVertexArray(obj.vao);
        gl.drawElements(gl.TRIANGLES, obj.count, gl.UNSIGNED_SHORT, 0);
    });
    
    gl.bindVertexArray(null);
}

// Update camera based on input
function updateCamera() {
    if (keys['KeyA']) camera.rotation -= 0.02;
    if (keys['KeyD']) camera.rotation += 0.02;
    
    if (keys['KeyW']) camera.height = Math.max(5, camera.height - 0.2);
    if (keys['KeyS']) camera.height = Math.min(25, camera.height + 0.2);
    
    if (keys['KeyQ']) camera.distance = Math.max(8, camera.distance - 0.3);
    if (keys['KeyE']) camera.distance = Math.min(30, camera.distance + 0.3);
    
    const camX = Math.sin(camera.rotation) * camera.distance;
    const camZ = Math.cos(camera.rotation) * camera.distance;
    
    camera.position[0] = camX;
    camera.position[1] = camera.height;
    camera.position[2] = camZ;
    
    camera.target = [0, 0, 0];
}

// Update spotlight based on scroll
function updateSpotlight(scrollDelta) {
    spotlight.angle += scrollDelta * 0.01;
    
    const targetDistance = 10;
    spotlight.target[0] = Math.sin(spotlight.angle) * targetDistance * 0.5;
    spotlight.target[1] = 0;
    spotlight.target[2] = Math.cos(spotlight.angle) * targetDistance * 0.5;
    
    const height = 20;
    const radius = 10;
    spotlight.position[0] = Math.sin(spotlight.angle) * radius;
    spotlight.position[1] = height;
    spotlight.position[2] = Math.cos(spotlight.angle) * radius;
    
    spotlight.direction[0] = spotlight.target[0] - spotlight.position[0];
    spotlight.direction[1] = spotlight.target[1] - spotlight.position[1];
    spotlight.direction[2] = spotlight.target[2] - spotlight.position[2];
    
    const length = Math.sqrt(
        spotlight.direction[0]*spotlight.direction[0] +
        spotlight.direction[1]*spotlight.direction[1] +
        spotlight.direction[2]*spotlight.direction[2]
    );
    if (length > 0) {
        spotlight.direction[0] /= length;
        spotlight.direction[1] /= length;
        spotlight.direction[2] /= length;
    }
}

// Render car
function renderCar() {
    gl.useProgram(shaderProgram);
    
    const carModelMatrix = mat4.create();
    mat4.translate(carModelMatrix, carModelMatrix, [car.position[0], car.position[1], car.position[2]]);
    mat4.rotateY(carModelMatrix, carModelMatrix, car.direction);
    
    const modelLoc = gl.getUniformLocation(shaderProgram, 'uModelMatrix');
    gl.uniformMatrix4fv(modelLoc, false, carModelMatrix);
    
    carParts.forEach(part => {
        gl.bindVertexArray(part.vao);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
    });
    
    gl.bindVertexArray(null);
}

// Main render loop
function render() {
    updateCamera();
    updateCar();
    
    renderShadowPass();
    renderMainPass();
    renderCar();
    
    requestAnimationFrame(render);
}

// Event listeners
function setupEventListeners() {
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            e.preventDefault();
        }
        
        // Toggle debug mode with 'B' key
        if (e.code === 'KeyB') {
            debugMode = !debugMode;
            console.log('Debug mode:', debugMode ? 'ON' : 'OFF');
        }
    });
    
    window.addEventListener('keyup', (e) => {
        keys[e.code] = false;
    });
    
    window.addEventListener('wheel', (e) => {
        e.preventDefault();
        updateSpotlight(e.deltaY);
    }, { passive: false });
    
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    });
    
    // Add focus event to ensure key detection works
    canvas.addEventListener('click', () => {
        canvas.focus();
    });
    
    // Focus the canvas on load
    window.addEventListener('load', () => {
        canvas.focus();
    });
}

// Initialize the application
function init() {
    if (!initWebGL()) {
        return;
    }
    
    shaderProgram = createProgram(vertexShaderSource, fragmentShaderSource);
    shadowProgram = createProgram(shadowVertexShaderSource, shadowFragmentShaderSource);
    
    if (!shaderProgram || !shadowProgram) {
        console.error('Failed to create shader programs');
        return;
    }
    
    shadowFBO = createShadowFramebuffer();
    if (!shadowFBO) {
        console.error('Failed to create shadow framebuffer');
        return;
    }
    
    createSceneObjects();
    setupEventListeners();
    
    // Set focus to canvas
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';
    canvas.focus();
    
    render();
}

window.addEventListener('load', init);