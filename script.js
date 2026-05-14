async function loadShader(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to load shader: ${url}`);
    }

    return await response.text();
}




async function main() {

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
    const uniformArray = new Float32Array([GRID_WIDTH, GRID_HEIGHT]);
    const uniformBuffer = device.createBuffer({
        label: "Grid Uniforms",
        size: uniformArray.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

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

    const densityFieldArray = new Uint32Array(GRID_WIDTH * GRID_HEIGHT);
    // const densityFieldArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
    const velocityFieldXArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT * 2);
    const velocityFieldYArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT * 2);
    const diffuseTempFieldArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
    const tempFieldArray = new Float32Array(GRID_WIDTH * GRID_HEIGHT);
    const setBoundsType = new Uint32Array( [SetBoundsType.SCALAR] );

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

    const setBoundsTypeStorage = device.createBuffer({
        label: "Single setBounds Instruction",
        size: setBoundsType.byteLength,
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

    // Initialization : Velocity field X Y
    for (let i = 0; i < velocityFieldXArray.length; i++) {
        velocityFieldXArray[i] = 0;
    }
    // Write to Storage Buffer
    device.queue.writeBuffer(velocityFieldXStorage[0], 0, velocityFieldXArray);
    device.queue.writeBuffer(velocityFieldXStorage[1], 0, velocityFieldXArray);
    for (let i = 0; i < velocityFieldYArray.length; i++) {
        velocityFieldYArray[i] = 0;
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
    device.queue.writeBuffer(setBoundsTypeStorage, 0, setBoundsType);


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
    function uploadPixels() {

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

    uploadPixels();

    // =========================================================
    // Shader Modules
    // =========================================================

    const WORKGROUP_SIZE = 8; // WORKGROUP_SIZE is also in Compute Shader code

    const vertShaderModuleCode = await loadShader("./shader_vert.wgsl");
    const fragShaderModuleCode = await loadShader("./shader_frag.wgsl");
    let simShaderModuleCode = await loadShader("./shader_comp.wgsl");
    simShaderModuleCode = simShaderModuleCode.replaceAll(/\$\{WORKGROUP_SIZE\}/g, WORKGROUP_SIZE);

    const vertShaderModule = device.createShaderModule({
        label: "Vertex shader",
        code: vertShaderModuleCode
    });
    const fragShaderModule = device.createShaderModule({
        label: "Fragment shader",
        code: fragShaderModuleCode
    });
    const simShaderModule = device.createShaderModule({
        label: "Game of Life simulation shader",
        code: simShaderModuleCode
    });

    // =========================================================
    // Sampler
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
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" } // Cell state input buffer
        },
        {
            binding: 4,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" } // Cell state output buffer
        },
        ]
    });



    const pipelineLayout = device.createPipelineLayout({
        label: "Cell Pipeline Layout",
        bindGroupLayouts: [ bindGroupLayout ],
    });

    const pipeline = device.createRenderPipeline({
        label: "Vertex and Fragment Pipeline",
        layout: pipelineLayout,

        vertex: {
            module: vertShaderModule,
            entryPoint: "vsMain",
        },

        fragment: {
            module: fragShaderModule,
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

    // Create a compute pipeline that updates the game state.
    const simulationPipeline = device.createComputePipeline({
        label: "Simulation pipeline",
        layout: pipelineLayout,
        compute: {
            module: simShaderModule,
            entryPoint: "csMain",
        }
    });



    const bindGroups = [
        device.createBindGroup({
            label: "Cell renderer bind group A",
            layout: pipeline.getBindGroupLayout(0),
    
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformBuffer },
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
                    resource: { buffer: densityFieldStorage[0] },
                },
                {
                    binding: 4,
                    resource: { buffer: densityFieldStorage[1] },
                },
            ]
        }),
        device.createBindGroup({
            label: "Cell renderer bind group B",
            layout: pipeline.getBindGroupLayout(0),
    
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniformBuffer },
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
                    resource: { buffer: densityFieldStorage[1] },
                },
                {
                    binding: 4,
                    resource: { buffer: densityFieldStorage[0] },
                },
            ]
        }),
    ];

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
    // Example Pixel Update
    // =========================================================

    let time = 0;

    // Update texture
    function updatePixels() {

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

        uploadPixels();
    }

    // =========================================================
    // Render Loop
    // =========================================================

    const UPDATE_INTERVAL = 50; // in ms
    let step = 0;
    let pingPongIndex = 0;

    function frame() {
        const encoder = device.createCommandEncoder();

        // Compute pass
        const simPass = encoder.beginComputePass();

        simPass.setPipeline(simulationPipeline);
        simPass.setBindGroup(0, bindGroups[pingPongIndex]);

        const workgroupCount = Math.ceil(Math.sqrt(GRID_WIDTH * GRID_HEIGHT / WORKGROUP_SIZE / WORKGROUP_SIZE));
        simPass.dispatchWorkgroups(workgroupCount, workgroupCount);

        simPass.end();


        // updatePixels();
        step++;
        pingPongIndex = 1 - pingPongIndex;


        const view = context
            .getCurrentTexture()
            .createView();

        // Render pass
        const pass = encoder.beginRenderPass({
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

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroups[pingPongIndex]);

        // Draw fullscreen quad
        pass.draw(6, GRID_WIDTH * GRID_HEIGHT);

        pass.end();

        device.queue.submit([encoder.finish()]);

        // requestAnimationFrame(frame);
    }


    // requestAnimationFrame(frame);
    setInterval(frame, UPDATE_INTERVAL);
}





main().catch(err => {
    console.error(err);
});
