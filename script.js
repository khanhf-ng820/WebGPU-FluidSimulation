async function loadShader(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to load shader: ${url}`);
    }

    return await response.text();
}





// =========================================================
// WebGPU Boilerplate Setup
// =========================================================

if (!navigator.gpu) {
    throw new Error("WebGPU not supported.");
}

const canvas = document.getElementById("gpuCanvas");

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();

const context = canvas.getContext("webgpu");

const format = navigator.gpu.getPreferredCanvasFormat();

context.configure({
    device,
    format,
    alphaMode: "opaque",
});

// =========================================================
// Pixel Grid Settings (For Fragment Shaders)
// =========================================================

const GRID_WIDTH = 128;
const GRID_HEIGHT = 128;

// Create a uniform buffer that describes the grid texture
const uniformGridArray = new Float32Array([GRID_WIDTH, GRID_HEIGHT]);
const uniformGridBuffer = device.createBuffer({
    label: "Grid Uniforms",
    size: uniformGridArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformGridBuffer, 0, uniformGridArray);

const GAUSS_SEIDEL = 20;
const MAX_DENSITY = 1.0;

const diffRate = 0.00001;
const dt = 1.0;

const uniformDiffRateArray = new Float32Array( [diffRate] );
const uniformDiffRateBuffer = device.createBuffer({
    label: "Diffusion Rate Uniform",
    size: uniformDiffRateArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformDiffRateBuffer, 0, uniformDiffRateArray);

const uniformDtArray = new Float32Array( [dt] );
const uniformDtBuffer = device.createBuffer({
    label: "Time Interval dt Uniform",
    size: uniformDtArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(uniformDtBuffer, 0, uniformDtArray);

// =========================================================
// Grid Texture
// =========================================================

// RGBA per pixel
// Uint8Array = 0-255 color values
const pixels = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);

// Example initialization
for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {

        const i = (y * GRID_WIDTH + x) * 4;

        // Example pattern
        pixels[i + 0] = x / GRID_WIDTH  * 255;  // R
        pixels[i + 1] = y / GRID_HEIGHT * 255;  // G
        pixels[i + 2] = 255;                    // B
        pixels[i + 3] = 255;                    // A
    }
}

// =========================================================
// Cell State Grid Settings (For Simulation)
// =========================================================

// Instructions for setBounds
const SetBoundsType = Object.freeze({
    SCALAR: 0,
    VECTOR_X: 1,
    VECTOR_Y: 2,
});

// const densityFieldArray = new Uint32Array(GRID_WIDTH * GRID_HEIGHT);
const densityFieldArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
const velocityFieldXArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
const velocityFieldYArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
const diffuseTempFieldArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
const tempFieldArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
const setBoundsTypeScalar  = new Uint32Array( [SetBoundsType.SCALAR] );
const setBoundsTypeVectorX = new Uint32Array( [SetBoundsType.VECTOR_X] );
const setBoundsTypeVectorY = new Uint32Array( [SetBoundsType.VECTOR_Y] );

// Create two Storage Buffers to hold the density field
const densityFieldStorage = [
    device.createBuffer({
        label: "Density Field A",
        size: densityFieldArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
        label: "Density Field B",
        size: densityFieldArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
];

const velocityFieldXStorage = [
    device.createBuffer({
        label: "Velocity Field X A",
        size: velocityFieldXArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
        label: "Velocity Field X B",
        size: velocityFieldXArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
];

const velocityFieldYStorage = [
    device.createBuffer({
        label: "Velocity Field Y A",
        size: velocityFieldYArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
        label: "Velocity Field Y B",
        size: velocityFieldYArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
];

const diffuseTempFieldStorage = [
    device.createBuffer({
        label: "Diffuse Temp Field A",
        size: diffuseTempFieldArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
        label: "Diffuse Temp Field B",
        size: diffuseTempFieldArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
];

const tempFieldStorage = [
    device.createBuffer({
        label: "General Temp Field A",
        size: tempFieldArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
        label: "General Temp Field B",
        size: tempFieldArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
];

const setBoundsTypeScalarStorage = device.createBuffer({
    label: "Single setBounds Scalar Instruction",
    size: setBoundsTypeScalar.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const setBoundsTypeVectorXStorage = device.createBuffer({
    label: "Single setBounds Vector X Instruction",
    size: setBoundsTypeVectorX.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const setBoundsTypeVectorYStorage = device.createBuffer({
    label: "Single setBounds Vector Y Instruction",
    size: setBoundsTypeVectorY.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});



// Initialization : Density field
for (let i = 0; i < densityFieldArray.length; i++) {
    densityFieldArray[i] = Math.random() > 0.6 ? 1 : 0;
}
// Write to Storage Buffer
device.queue.writeBuffer(densityFieldStorage[0], 0, densityFieldArray);
// Write to Storage Buffer
device.queue.writeBuffer(densityFieldStorage[1], 0, densityFieldArray);

// Initialization : Velocity field X
for (let i = 0; i < velocityFieldXArray.length; i++) {
    velocityFieldXArray[i] = (i > velocityFieldXArray.length/2 ? 1 : -1) * 3;
}
// Write to Storage Buffer
device.queue.writeBuffer(velocityFieldXStorage[0], 0, velocityFieldXArray);
device.queue.writeBuffer(velocityFieldXStorage[1], 0, velocityFieldXArray);
// Initialization : Velocity field Y
for (let i = 0; i < velocityFieldYArray.length; i++) {
    velocityFieldYArray[i] = (i > velocityFieldYArray.length/2 ? 1 : -1) * 3;
}
// Write to Storage Buffer
device.queue.writeBuffer(velocityFieldYStorage[0], 0, velocityFieldYArray);
device.queue.writeBuffer(velocityFieldYStorage[1], 0, velocityFieldYArray);

// Initialization : Diffuse temp field
// Write to Storage Buffer
device.queue.writeBuffer(diffuseTempFieldStorage[0], 0, diffuseTempFieldArray);
// Write to Storage Buffer
device.queue.writeBuffer(diffuseTempFieldStorage[1], 0, diffuseTempFieldArray);

// Initialization : Temp field
// Write to Storage Buffer
device.queue.writeBuffer(tempFieldStorage[0], 0, tempFieldArray);
// Write to Storage Buffer
device.queue.writeBuffer(tempFieldStorage[1], 0, tempFieldArray);

// Initialization : setBounds instruction
// Write to Storage Buffer
device.queue.writeBuffer(setBoundsTypeScalarStorage, 0, setBoundsTypeScalar);
device.queue.writeBuffer(setBoundsTypeVectorXStorage, 0, setBoundsTypeVectorX);
device.queue.writeBuffer(setBoundsTypeVectorYStorage, 0, setBoundsTypeVectorY);


// =========================================================
// GPU Texture
// =========================================================

const texture = device.createTexture({
    size: [GRID_WIDTH, GRID_HEIGHT],
    format: "rgba8unorm",
    usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
});

// Upload CPU pixel data to GPU texture
function uploadTexture() {

    device.queue.writeTexture(
        { texture },

        pixels,

        {
            bytesPerRow: GRID_WIDTH * 4,
        },

        {
            width: GRID_WIDTH,
            height: GRID_HEIGHT,
        }
    );
}

uploadTexture();

// =========================================================
// Shader Modules
// =========================================================

const WORKGROUP_SIZE = 8; // WORKGROUP_SIZE is also in Compute Shader code

const densityVertShaderModuleCode = await loadShader("./density_shader_vert.wgsl");
const densityFragShaderModuleCode = await loadShader("./density_shader_frag.wgsl");
const velocityVertShaderModuleCode = await loadShader("./velocity_shader_vert.wgsl");
const velocityFragShaderModuleCode = await loadShader("./velocity_shader_frag.wgsl");
const simShaderModuleCode = (await loadShader("./density_shader_comp.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const fieldCopyShaderModuleCode = (await loadShader("./fieldcopy.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const setBoundsShaderModuleCode = (await loadShader("./setbounds.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const diffuseGS_ShaderModuleCode = (await loadShader("./diffuse_gs_step.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);

const densityVertShaderModule = device.createShaderModule({
    label: "Density Grid Vertex shader",
    code: densityVertShaderModuleCode
});
const densityFragShaderModule = device.createShaderModule({
    label: "Density Grid Fragment shader",
    code: densityFragShaderModuleCode
});
const velocityVertShaderModule = device.createShaderModule({
    label: "Velocity Grid Vertex shader",
    code: velocityVertShaderModuleCode
});
const velocityFragShaderModule = device.createShaderModule({
    label: "Velocity Grid Fragment shader",
    code: velocityFragShaderModuleCode
});
const simShaderModule = device.createShaderModule({
    label: "Game of Life simulation shader",
    code: simShaderModuleCode
});

const fieldCopyShaderModule = device.createShaderModule({
    label: "Copy Field shader",
    code: fieldCopyShaderModuleCode
});
const setBoundsShaderModule = device.createShaderModule({
    label: "Set Bounds shader",
    code: setBoundsShaderModuleCode
});
const diffuseGS_ShaderModule = device.createShaderModule({
    label: "Diffusion Gauss-Seidel Relaxation Step shader",
    code: diffuseGS_ShaderModuleCode
});

// =========================================================
// Texture Sampler
// =========================================================

const sampler = device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
});

// =========================================================
// Bind Group Layout
// =========================================================

// Create the bind group layout and pipeline layout.
const bindGroupLayout = device.createBindGroupLayout({
    label: "Bind Group Layout",
    entries: [
    {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: {} // Grid uniform buffer
    },
    {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" }
    },
    {
        binding: 2,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        sampler: {}
    },
    {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {}
    },
    {
        binding: 4,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {}
    },
    {
        binding: 5,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" } // Field input buffer
    },
    {
        binding: 6,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" }           // Field output buffer
    },
    {
        binding: 7,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: { type: "read-only-storage" } // Field input buffer
    },
    ]
});

// =========================================================
// Pipeline Layout
// =========================================================

const pipelineLayout = device.createPipelineLayout({
    label: "Cell Pipeline Layout",
    bindGroupLayouts: [ bindGroupLayout ],
});

const densityPipeline = device.createRenderPipeline({
    label: "Density Grid Vertex and Fragment Pipeline",
    layout: pipelineLayout,

    vertex: {
        module: densityVertShaderModule,
        entryPoint: "vsMain",
    },

    fragment: {
        module: densityFragShaderModule,
        entryPoint: "fsMain",

        targets: [
            {
                format,
            }
        ]
    },

    primitive: {
        topology: "triangle-list",
    },
});

const velocityPipeline = device.createRenderPipeline({
    label: "Velocity Grid Vertex and Fragment Pipeline",
    layout: pipelineLayout,

    vertex: {
        module: velocityVertShaderModule,
        entryPoint: "vsMain",
    },

    fragment: {
        module: velocityFragShaderModule,
        entryPoint: "fsMain",

        targets: [
            {
                format,
            }
        ]
    },

    primitive: {
        topology: "line-list",
    },
});

// =========================================================
// Compute Shader Pipeline
// =========================================================
// Create a compute pipeline that updates the cell state.

const simulationPipeline = device.createComputePipeline({
    label: "Simulation pipeline",
    layout: pipelineLayout,
    compute: {
        module: simShaderModule,
        entryPoint: "csMain",
    }
});

const fieldCopyPipeline = device.createComputePipeline({
    label: "Field Copy pipeline",
    layout: pipelineLayout,
    compute: {
        module: fieldCopyShaderModule,
        entryPoint: "csMain",
    }
});

const setBoundsPipeline = device.createComputePipeline({
    label: "Set Bounds pipeline",
    layout: pipelineLayout,
    compute: {
        module: setBoundsShaderModule,
        entryPoint: "csMain",
    }
});

const diffuseGS_Pipeline = device.createComputePipeline({
    label: "Diffusion Gauss-Seidel Relaxation Step pipeline",
    layout: pipelineLayout,
    compute: {
        module: diffuseGS_ShaderModule,
        entryPoint: "csMain",
    }
});


// =========================================================
// Bind Groups for Rendering
// =========================================================

const uniformBindings = [
    {
        binding: 0,
        resource: { buffer: uniformGridBuffer },
    },
    {
        binding: 1,
        resource: texture.createView(),
    },
    {
        binding: 2,
        resource: sampler,
    },
    {
        binding: 3,
        resource: { buffer: uniformDtBuffer },
    },
    {
        binding: 4,
        resource: { buffer: uniformDiffRateBuffer },
    },
];

const densityRenderBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Cell Density renderer Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: densityFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: densityFieldStorage[1 - i] },
        },
        {
            binding: 7,
            resource: { buffer: velocityFieldXStorage[1 - i] },
        },
    ]
}));

const velocityRenderBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Cell Velocity renderer Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: densityFieldStorage[1 - i] }, // Does not matter
        },
        {
            binding: 7,
            resource: { buffer: velocityFieldYStorage[i] },
        },
    ]
}));

// =========================================================
// Bind Groups for Diffusion
// =========================================================

///// Density
const diffuseGSDensity_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Diffusion Gauss-Seidel Relaxation Step for Density Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: densityFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[i] },
        },
    ]
}));

const setBoundsDensityBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Set Bounds Density Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: setBoundsTypeScalarStorage },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[i] }, // Does not matter
        },
    ]
}));

const fieldCopy_Temp_DiffuseTemp_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy TempField to DiffuseTempField Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: diffuseTempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[1 - i] }, // Does not matter
        },
    ]
}));

const fieldCopy_DiffuseTemp_Density_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy DiffuseTempField to Density Field Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: diffuseTempFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: densityFieldStorage[1 - i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[1 - i] }, // Does not matter
        },
    ]
}));


///// Velocity X
const diffuseGSVelocityX_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Diffusion Gauss-Seidel Relaxation Step for VelocityX Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[i] },
        },
    ]
}));

const setBoundsVelocityXBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Set Bounds VelocityX Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: setBoundsTypeScalarStorage },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[i] }, // Does not matter
        },
    ]
}));

const fieldCopy_DiffuseTemp_VelocityX_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy DiffuseTempField to VelocityX Field Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: diffuseTempFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: velocityFieldXStorage[1 - i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[1 - i] }, // Does not matter
        },
    ]
}));


///// Velocity Y
const diffuseGSVelocityY_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Diffusion Gauss-Seidel Relaxation Step for VelocityY Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: velocityFieldYStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[i] },
        },
    ]
}));

const setBoundsVelocityYBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Set Bounds VelocityY Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: setBoundsTypeScalarStorage },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[i] }, // Does not matter
        },
    ]
}));

const fieldCopy_DiffuseTemp_VelocityY_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy DiffuseTempField to VelocityY Field Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: diffuseTempFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: velocityFieldYStorage[1 - i] },
        },
        {
            binding: 7,
            resource: { buffer: diffuseTempFieldStorage[1 - i] }, // Does not matter
        },
    ]
}));


// =========================================================
// Resize Handling
// =========================================================

function resizeCanvas() {

    const devicePixelRatio = window.devicePixelRatio || 1;

    canvas.width = Math.floor(canvas.clientWidth * devicePixelRatio);
    canvas.height = Math.floor(canvas.clientHeight * devicePixelRatio);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// =========================================================
// Example Texture Update
// =========================================================

let time = 0;

// Update texture
function updateTexture() {

    time += 0.01;

    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {

            const i = (y * GRID_WIDTH + x) * 4;

            const wave =
                Math.sin(x * 0.1 + time) *
                Math.cos(y * 0.1 + time);

            pixels[i + 0] = (x / GRID_WIDTH) * 255;
            pixels[i + 1] = (y / GRID_HEIGHT) * 255;
            pixels[i + 2] = ((wave + 1) * 0.5) * 255;
            pixels[i + 3] = 255;
        }
    }

    uploadTexture();
}

// =========================================================
// Compute Shader Passes
// =========================================================
// Compute pass functions

let encoder;

function simComputePass() {
    const simPass = encoder.beginComputePass();

    simPass.setPipeline(simulationPipeline);
    simPass.setBindGroup(0, bindGroups[pingPongIndex]);

    simPass.dispatchWorkgroups(workgroupCount, workgroupCount);

    simPass.end();
}

///// Diffuse Density /////
function diffuseGSDensity_ComputePass() {
    const diffuseGSDensity_Pass = encoder.beginComputePass();

    diffuseGSDensity_Pass.setPipeline(diffuseGS_Pipeline);
    diffuseGSDensity_Pass.setBindGroup(0, diffuseGSDensity_BindGroups[pingPongIndex]);

    diffuseGSDensity_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    diffuseGSDensity_Pass.end();
}

function setBoundsDensity_ComputePass() {
    const setBoundsDensity_Pass = encoder.beginComputePass();

    setBoundsDensity_Pass.setPipeline(setBoundsPipeline);
    setBoundsDensity_Pass.setBindGroup(0, setBoundsDensityBindGroups[pingPongIndex]);

    setBoundsDensity_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    setBoundsDensity_Pass.end();
}

function fieldCopy_Temp_DiffuseTemp_ComputePass() {
    const fieldCopy_Temp_DiffuseTemp_Pass = encoder.beginComputePass();

    fieldCopy_Temp_DiffuseTemp_Pass.setPipeline(fieldCopyPipeline);
    fieldCopy_Temp_DiffuseTemp_Pass.setBindGroup(0, fieldCopy_Temp_DiffuseTemp_BindGroups[pingPongIndex]);

    fieldCopy_Temp_DiffuseTemp_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    fieldCopy_Temp_DiffuseTemp_Pass.end();
}

function fieldCopy_DiffuseTemp_Density_ComputePass() {
    const fieldCopy_DiffuseTemp_Density_Pass = encoder.beginComputePass();

    fieldCopy_DiffuseTemp_Density_Pass.setPipeline(fieldCopyPipeline);
    fieldCopy_DiffuseTemp_Density_Pass.setBindGroup(0, fieldCopy_DiffuseTemp_Density_BindGroups[pingPongIndex]);

    fieldCopy_DiffuseTemp_Density_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    fieldCopy_DiffuseTemp_Density_Pass.end();
}

///// Diffuse VelocityX /////
function diffuseGSVelocityX_ComputePass() {
    const diffuseGSVelocityX_Pass = encoder.beginComputePass();

    diffuseGSVelocityX_Pass.setPipeline(diffuseGS_Pipeline);
    diffuseGSVelocityX_Pass.setBindGroup(0, diffuseGSVelocityX_BindGroups[pingPongIndex]);

    diffuseGSVelocityX_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    diffuseGSVelocityX_Pass.end();
}

function setBoundsVelocityX_ComputePass() {
    const setBoundsVelocityX_Pass = encoder.beginComputePass();

    setBoundsVelocityX_Pass.setPipeline(setBoundsPipeline);
    setBoundsVelocityX_Pass.setBindGroup(0, setBoundsVelocityXBindGroups[pingPongIndex]);

    setBoundsVelocityX_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    setBoundsVelocityX_Pass.end();
}

function fieldCopy_DiffuseTemp_VelocityX_ComputePass() {
    const fieldCopy_DiffuseTemp_VelocityX_Pass = encoder.beginComputePass();

    fieldCopy_DiffuseTemp_VelocityX_Pass.setPipeline(fieldCopyPipeline);
    fieldCopy_DiffuseTemp_VelocityX_Pass.setBindGroup(0, fieldCopy_DiffuseTemp_VelocityX_BindGroups[pingPongIndex]);

    fieldCopy_DiffuseTemp_VelocityX_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    fieldCopy_DiffuseTemp_VelocityX_Pass.end();
}

///// Diffuse VelocityY /////
function diffuseGSVelocityY_ComputePass() {
    const diffuseGSVelocityY_Pass = encoder.beginComputePass();

    diffuseGSVelocityY_Pass.setPipeline(diffuseGS_Pipeline);
    diffuseGSVelocityY_Pass.setBindGroup(0, diffuseGSVelocityY_BindGroups[pingPongIndex]);

    diffuseGSVelocityY_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    diffuseGSVelocityY_Pass.end();
}

function setBoundsVelocityY_ComputePass() {
    const setBoundsVelocityY_Pass = encoder.beginComputePass();

    setBoundsVelocityY_Pass.setPipeline(setBoundsPipeline);
    setBoundsVelocityY_Pass.setBindGroup(0, setBoundsVelocityYBindGroups[pingPongIndex]);

    setBoundsVelocityY_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    setBoundsVelocityY_Pass.end();
}

function fieldCopy_DiffuseTemp_VelocityY_ComputePass() {
    const fieldCopy_DiffuseTemp_VelocityY_Pass = encoder.beginComputePass();

    fieldCopy_DiffuseTemp_VelocityY_Pass.setPipeline(fieldCopyPipeline);
    fieldCopy_DiffuseTemp_VelocityY_Pass.setBindGroup(0, fieldCopy_DiffuseTemp_VelocityY_BindGroups[pingPongIndex]);

    fieldCopy_DiffuseTemp_VelocityY_Pass.dispatchWorkgroups(workgroupCount, workgroupCount);

    fieldCopy_DiffuseTemp_VelocityY_Pass.end();
}


// =========================================================
// Fluid Simulation Steps
// =========================================================

function diffuseVelocityX() {
    for (let i = 0; i < GAUSS_SEIDEL; i++) {
        diffuseGSVelocityX_ComputePass();
        setBoundsVelocityX_ComputePass();
        fieldCopy_Temp_DiffuseTemp_ComputePass();
    }
    fieldCopy_DiffuseTemp_VelocityX_ComputePass();
    // pingPongIndex = 1 - pingPongIndex;
}

function diffuseVelocityY() {
    for (let i = 0; i < GAUSS_SEIDEL; i++) {
        diffuseGSVelocityY_ComputePass();
        setBoundsVelocityY_ComputePass();
        fieldCopy_Temp_DiffuseTemp_ComputePass();
    }
    fieldCopy_DiffuseTemp_VelocityY_ComputePass();
    // pingPongIndex = 1 - pingPongIndex;
}

function diffuseDensity() {
    for (let i = 0; i < GAUSS_SEIDEL; i++) {
        diffuseGSDensity_ComputePass();
        setBoundsDensity_ComputePass();
        fieldCopy_Temp_DiffuseTemp_ComputePass();
    }
    fieldCopy_DiffuseTemp_Density_ComputePass();
    pingPongIndex = 1 - pingPongIndex;
}

// =========================================================
// Render Loop
// =========================================================

const UPDATE_INTERVAL = 100; // in ms
const workgroupCount = Math.ceil(Math.sqrt(GRID_WIDTH * GRID_HEIGHT / WORKGROUP_SIZE / WORKGROUP_SIZE));
let step = 0;
let pingPongIndex = 0;

// Runs each frame
function frame() {
    encoder = device.createCommandEncoder();

    // Compute passes
    // for (let i = 0; i < GAUSS_SEIDEL; i++) {
    //     simComputePass();
    //     pingPongIndex = 1 - pingPongIndex;
    // }

    diffuseVelocityX();
    diffuseVelocityY();

    diffuseDensity();



    // updateTexture();
    step++;
    // pingPongIndex = 1 - pingPongIndex;


    const view = context
        .getCurrentTexture()
        .createView();

    // Render pass for density grid
    const densityRenderPass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view,
                clearValue: {
                    r: 0,
                    g: 0,
                    b: 0,
                    a: 1,
                },
                loadOp: "clear",
                storeOp: "store",
            }
        ]
    });

    densityRenderPass.setPipeline(densityPipeline);
    densityRenderPass.setBindGroup(0, densityRenderBindGroups[pingPongIndex]);

    // Draw fullscreen quad
    densityRenderPass.draw(6, GRID_WIDTH * GRID_HEIGHT);

    densityRenderPass.end();

    // Render pass for velocity
    const velocityRenderPass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view,
                clearValue: {
                    r: 0,
                    g: 0,
                    b: 0,
                    a: 0,
                },
                loadOp: "load",
                storeOp: "store",
            }
        ]
    });

    velocityRenderPass.setPipeline(velocityPipeline);
    velocityRenderPass.setBindGroup(0, velocityRenderBindGroups[pingPongIndex]);

    // Draw line segment
    velocityRenderPass.draw(2, GRID_WIDTH * GRID_HEIGHT);

    velocityRenderPass.end();


    device.queue.submit([encoder.finish()]);

    // requestAnimationFrame(frame);
}


// requestAnimationFrame(frame);
setInterval(frame, UPDATE_INTERVAL);





// main().catch(err => {
//     console.error(err);
// });
