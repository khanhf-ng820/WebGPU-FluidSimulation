async function loadShader(url) {
    const cacheBustUrl = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
    const response = await fetch(cacheBustUrl);

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
const divFieldArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
const pressureFieldArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);

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

const divFieldStorage = device.createBuffer({
    label: "Divergence of Field",
    size: divFieldArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const pressureFieldStorage = device.createBuffer({
    label: "Pressure Field",
    size: pressureFieldArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});


const placeholderStorage = Array.from({ length: 3 }, (_, i) => device.createBuffer({
    label: "Placeholder Storage",
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
}));

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



// Initialization : All fields start at zero (user paints with mouse)
// Write to Storage Buffers
device.queue.writeBuffer(densityFieldStorage[0], 0, densityFieldArray);
device.queue.writeBuffer(densityFieldStorage[1], 0, densityFieldArray);
device.queue.writeBuffer(velocityFieldXStorage[0], 0, velocityFieldXArray);
device.queue.writeBuffer(velocityFieldXStorage[1], 0, velocityFieldXArray);
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

// Initialization : Divergence of field
// Write to Storage Buffer
device.queue.writeBuffer(divFieldStorage, 0, divFieldArray);

// Initialization : Pressure field
// Write to Storage Buffer
device.queue.writeBuffer(pressureFieldStorage, 0, pressureFieldArray);

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
const advectShaderModuleCode = (await loadShader("./advect.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const fieldCopyShaderModuleCode = (await loadShader("./fieldcopy.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const setBoundsShaderModuleCode = (await loadShader("./setbounds.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const diffuseGS_ShaderModuleCode = (await loadShader("./diffuse_gs_step.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const calcDivShaderModuleCode = (await loadShader("./calculate_divergence.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const calcPressureGS_ShaderModuleCode = (await loadShader("./calculate_pressure_gs_step.wgsl"))
    .replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);
const projectShaderModuleCode = (await loadShader("./project_field.wgsl"))
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
const advectShaderModule = device.createShaderModule({
    label: "Advection shader",
    code: advectShaderModuleCode
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

const calcDivShaderModule = device.createShaderModule({
    label: "Calculate Divergence of Field shader",
    code: calcDivShaderModuleCode
});
const calcPressureGS_ShaderModule = device.createShaderModule({
    label: "Calculate Pressure Field with Gauss-Seidel Step shader",
    code: calcPressureGS_ShaderModuleCode
});
const projectShaderModule = device.createShaderModule({
    label: "Project Field (Removing Divergence) shader",
    code: projectShaderModuleCode
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
    {
        binding: 8,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "storage" }           // Field output buffer
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

const calcDivPipeline = device.createComputePipeline({
    label: "Calculate Divergence pipeline",
    layout: pipelineLayout,
    compute: {
        module: calcDivShaderModule,
        entryPoint: "csMain",
    }
});

const calcPressureGS_Pipeline = device.createComputePipeline({
    label: "Calculate Pressure Gauss-Seidel Step pipeline",
    layout: pipelineLayout,
    compute: {
        module: calcPressureGS_ShaderModule,
        entryPoint: "csMain",
    }
});

const projectPipeline = device.createComputePipeline({
    label: "Project Field pipeline",
    layout: pipelineLayout,
    compute: {
        module: projectShaderModule,
        entryPoint: "csMain",
    }
});

const advectPipeline = device.createComputePipeline({
    label: "Advection pipeline",
    layout: pipelineLayout,
    compute: {
        module: advectShaderModule,
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
        {
            binding: 8,
            resource: { buffer: placeholderStorage[0] } // Placeholder
        }
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
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 7,
            resource: { buffer: velocityFieldYStorage[i] },
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
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
        {
            binding: 8,
            resource: { buffer: placeholderStorage[0] } // Placeholder
        }
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
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
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
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
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
            resource: { buffer: densityFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
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
        {
            binding: 8,
            resource: { buffer: placeholderStorage[0] } // Placeholder
        }
    ]
}));

const setBoundsVelocityXBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Set Bounds VelocityX Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: setBoundsTypeVectorXStorage },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
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
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
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
        {
            binding: 8,
            resource: { buffer: placeholderStorage[0] } // Placeholder
        }
    ]
}));

const setBoundsVelocityYBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Set Bounds VelocityY Bind group " + i,
    layout: velocityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: setBoundsTypeVectorYStorage },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
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
            resource: { buffer: velocityFieldYStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
    ]
}));


// =========================================================
// Bind Groups for Project (removeDiv)
// =========================================================

const calcDivBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Calculate Divergence Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: divFieldStorage },
        },
        {
            binding: 7,
            resource: { buffer: velocityFieldYStorage[i] },
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[0] } // Placeholder
        }
    ]
}));

const calcPressureGS_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Calculate Pressure GS Step Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: divFieldStorage },
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: pressureFieldStorage },
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[0] } // Placeholder
        }
    ]
}));

const fieldCopy_Temp_Pressure_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy TempField to PressureField Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: pressureFieldStorage },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
    ]
}));

const projectFieldBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Project Field Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: pressureFieldStorage },
        },
        {
            binding: 6,
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: velocityFieldYStorage[i] }
        }
    ]
}));

const setBoundsVelXAfterProject_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Set Bounds VelocityX After Project Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: setBoundsTypeVectorXStorage },
        },
        {
            binding: 6,
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
    ]
}));

const setBoundsVelYAfterProject_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Set Bounds VelocityY After Project Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: setBoundsTypeVectorYStorage },
        },
        {
            binding: 6,
            resource: { buffer: velocityFieldYStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
    ]
}));


// =========================================================
// Bind Groups for Advection
// =========================================================

const advectDensityBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Advect Density Bind group " + i,
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
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 8,
            resource: { buffer: velocityFieldYStorage[i] }
        }
    ]
}));

const advectVelXBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Advect VelocityX Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

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
            resource: { buffer: velocityFieldXStorage[i] }, // Same as binding 5 (self-advect, both read-only)
        },
        {
            binding: 8,
            resource: { buffer: velocityFieldYStorage[i] }
        }
    ]
}));

// For advecting velY, we need velY at both read-only (binding 5) and read-write (binding 8).
// WebGPU does not allow the same buffer in both access modes simultaneously.
// Solution: copy velY to diffuseTemp first, use diffuseTemp at binding 5.
const fieldCopy_VelY_DiffuseTemp_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy VelocityY to DiffuseTemp for Advect Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: velocityFieldYStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: diffuseTempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
    ]
}));

const advectVelYBindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Advect VelocityY Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: diffuseTempFieldStorage[i] }, // Copy of velY
        },
        {
            binding: 6,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 8,
            resource: { buffer: velocityFieldYStorage[i] }
        }
    ]
}));

// Copy advection results back to field buffers
const fieldCopy_Temp_Density_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy Temp to Density (after advect) Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: densityFieldStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
    ]
}));

const fieldCopy_Temp_VelX_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy Temp to VelocityX (after advect) Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: velocityFieldXStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
    ]
}));

const fieldCopy_Temp_VelY_BindGroups = Array.from({ length: 2 }, (_, i) => device.createBindGroup({
    label: "Copy Temp to VelocityY (after advect) Bind group " + i,
    layout: densityPipeline.getBindGroupLayout(0),

    entries: [
        ...uniformBindings,
        {
            binding: 5,
            resource: { buffer: tempFieldStorage[i] },
        },
        {
            binding: 6,
            resource: { buffer: velocityFieldYStorage[i] },
        },
        {
            binding: 7,
            resource: { buffer: placeholderStorage[0] }, // Placeholder
        },
        {
            binding: 8,
            resource: { buffer: placeholderStorage[1] } // Placeholder
        }
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
// Compute Shader Passes — Project (removeDiv)
// =========================================================

function calcDiv_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(calcDivPipeline);
    pass.setBindGroup(0, calcDivBindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function calcPressureGS_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(calcPressureGS_Pipeline);
    pass.setBindGroup(0, calcPressureGS_BindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function fieldCopy_Temp_Pressure_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(fieldCopyPipeline);
    pass.setBindGroup(0, fieldCopy_Temp_Pressure_BindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function projectField_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(projectPipeline);
    pass.setBindGroup(0, projectFieldBindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function setBoundsVelXAfterProject_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(setBoundsPipeline);
    pass.setBindGroup(0, setBoundsVelXAfterProject_BindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function setBoundsVelYAfterProject_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(setBoundsPipeline);
    pass.setBindGroup(0, setBoundsVelYAfterProject_BindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}


// =========================================================
// Compute Shader Passes — Advection
// =========================================================

function advectDensity_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(advectPipeline);
    pass.setBindGroup(0, advectDensityBindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function advectVelX_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(advectPipeline);
    pass.setBindGroup(0, advectVelXBindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function fieldCopy_VelY_DiffuseTemp_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(fieldCopyPipeline);
    pass.setBindGroup(0, fieldCopy_VelY_DiffuseTemp_BindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function advectVelY_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(advectPipeline);
    pass.setBindGroup(0, advectVelYBindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function fieldCopy_Temp_Density_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(fieldCopyPipeline);
    pass.setBindGroup(0, fieldCopy_Temp_Density_BindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function fieldCopy_Temp_VelX_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(fieldCopyPipeline);
    pass.setBindGroup(0, fieldCopy_Temp_VelX_BindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
}

function fieldCopy_Temp_VelY_ComputePass() {
    const pass = encoder.beginComputePass();
    pass.setPipeline(fieldCopyPipeline);
    pass.setBindGroup(0, fieldCopy_Temp_VelY_BindGroups[pingPongIndex]);
    pass.dispatchWorkgroups(workgroupCount, workgroupCount);
    pass.end();
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
}

function diffuseVelocityY() {
    for (let i = 0; i < GAUSS_SEIDEL; i++) {
        diffuseGSVelocityY_ComputePass();
        setBoundsVelocityY_ComputePass();
        fieldCopy_Temp_DiffuseTemp_ComputePass();
    }
    fieldCopy_DiffuseTemp_VelocityY_ComputePass();
}

function diffuseDensity() {
    for (let i = 0; i < GAUSS_SEIDEL; i++) {
        diffuseGSDensity_ComputePass();
        setBoundsDensity_ComputePass();
        fieldCopy_Temp_DiffuseTemp_ComputePass();
    }
    fieldCopy_DiffuseTemp_Density_ComputePass();
}

// Project (removeDiv): makes velocity field divergence-free
function removeDiv() {
    // Clear pressure field to zero before solving
    encoder.clearBuffer(pressureFieldStorage);

    // Step 1: Calculate divergence of velocity field
    calcDiv_ComputePass();

    // Step 2: Solve for pressure field using Gauss-Seidel iterations
    for (let i = 0; i < GAUSS_SEIDEL; i++) {
        calcPressureGS_ComputePass();
        // setBounds(SCALAR) on temp field — reuse density setBounds (same type + target)
        setBoundsDensity_ComputePass();
        fieldCopy_Temp_Pressure_ComputePass();
    }

    // Step 3: Subtract pressure gradient from velocity field
    projectField_ComputePass();

    // Step 4: Apply boundary conditions to velocity
    setBoundsVelXAfterProject_ComputePass();
    setBoundsVelYAfterProject_ComputePass();
}

// Advect density field through velocity field
function advectDensity() {
    advectDensity_ComputePass();
    // setBounds on tempField (SCALAR) — reuse existing setBounds density bind groups
    setBoundsDensity_ComputePass();
    // Copy result back to density field
    fieldCopy_Temp_Density_ComputePass();
}

// Advect velocity X field through velocity field
function advectVelocityX() {
    advectVelX_ComputePass();
    // setBounds on tempField (VECTOR_X) — reuse existing setBounds velocityX bind groups
    setBoundsVelocityX_ComputePass();
    // Copy result back to velocity X field
    fieldCopy_Temp_VelX_ComputePass();
}

// Advect velocity Y field through velocity field
function advectVelocityY() {
    // Copy velY to diffuseTemp first (avoids read-only + read-write conflict on same buffer)
    fieldCopy_VelY_DiffuseTemp_ComputePass();
    advectVelY_ComputePass();
    // setBounds on tempField (VECTOR_Y) — reuse existing setBounds velocityY bind groups
    setBoundsVelocityY_ComputePass();
    // Copy result back to velocity Y field
    fieldCopy_Temp_VelY_ComputePass();
}


// =========================================================
// Mouse Interaction
// =========================================================

const MAX_VEL = 1.0;
const ADD_AMOUNT = 0.75;

let prevMouseX = -1;
let prevMouseY = -1;

canvas.addEventListener('mousemove', (e) => {
    if (e.buttons !== 1) return; // Only on left-click drag

    const rect = canvas.getBoundingClientRect();
    const cellX = Math.floor((e.clientX - rect.left) / rect.width * GRID_WIDTH);
    // Flip Y axis to match WebGPU clip space
    const cellY = GRID_HEIGHT - 1 - Math.floor((e.clientY - rect.top) / rect.height * GRID_HEIGHT);

    if (cellX < 0 || cellX >= GRID_WIDTH || cellY < 0 || cellY >= GRID_HEIGHT) return;

    const idx = cellY * GRID_WIDTH + cellX;

    // Add density at mouse position
    // For simplicity, just set a fixed density value (will quickly diffuse)
    device.queue.writeBuffer(densityFieldStorage[pingPongIndex], idx * 4, new Float32Array([1.0]));

    // Add velocity in the direction of mouse movement
    if (prevMouseX >= 0) {
        const velMult = MAX_VEL * 5;
        const dx = (cellX - prevMouseX) * velMult;
        const dy = (cellY - prevMouseY) * velMult;
        
        // Only write if there's actual movement, to avoid killing existing momentum with zero
        if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
            device.queue.writeBuffer(velocityFieldXStorage[pingPongIndex], idx * 4, new Float32Array([dx]));
            device.queue.writeBuffer(velocityFieldYStorage[pingPongIndex], idx * 4, new Float32Array([dy]));
        }
    }

    prevMouseX = cellX;
    prevMouseY = cellY;
});

canvas.addEventListener('mouseup', () => {
    prevMouseX = -1;
    prevMouseY = -1;
});

canvas.addEventListener('mouseleave', () => {
    prevMouseX = -1;
    prevMouseY = -1;
});


// =========================================================
// Render Loop
// =========================================================

const workgroupCount = Math.ceil(Math.sqrt(GRID_WIDTH * GRID_HEIGHT / WORKGROUP_SIZE / WORKGROUP_SIZE));
let step = 0;
let pingPongIndex = 0;

// Runs each frame (60 FPS via requestAnimationFrame)
function frame() {
    encoder = device.createCommandEncoder();

    // ===== Full Jos Stam Fluid Simulation Pipeline =====

    // 1. Diffuse velocity
    diffuseVelocityX();
    diffuseVelocityY();

    // 2. Project (make velocity divergence-free)
    removeDiv();

    // 3. Advect velocity
    advectVelocityX();
    advectVelocityY();

    // 4. Project again
    removeDiv();

    // 5. Diffuse density
    diffuseDensity();

    // 6. Advect density
    advectDensity();

    // 7. Final project
    removeDiv();

    step++;


    // ===== Rendering =====

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

    // Render pass for velocity arrows
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

    // Draw line segment per cell
    velocityRenderPass.draw(2, GRID_WIDTH * GRID_HEIGHT);

    velocityRenderPass.end();


    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
