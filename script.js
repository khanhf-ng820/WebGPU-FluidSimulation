async function loadShader(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to load shader: ${url}`);
    }

    return await response.text();
}




async function main() {

    // =========================================================
    // WebGPU Setup
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
    // Pixel Grid Settings
    // =========================================================

    const GRID_WIDTH = 128;
    const GRID_HEIGHT = 128;

    // RGBA per pixel
    // Uint8Array = 0-255 color values
    const pixels = new Uint8Array(GRID_WIDTH * GRID_HEIGHT * 4);

    // Example initialization
    for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {

            const i = (y * GRID_WIDTH + x) * 4;

            // Example pattern
            pixels[i + 0] = x * 2;      // R
            pixels[i + 1] = y * 2;      // G
            pixels[i + 2] = 255;        // B
            pixels[i + 3] = 255;        // A
        }
    }

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
    // Fullscreen Quad Shader
    // =========================================================

    const shaderModuleCode = await loadShader("./shader_vert.wgsl");

    const shaderModule = device.createShaderModule({
        code: shaderModuleCode
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

    const pipeline = device.createRenderPipeline({
        layout: "auto",

        vertex: {
            module: shaderModule,
            entryPoint: "vsMain",
        },

        fragment: {
            module: shaderModule,
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

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),

        entries: [
            {
                binding: 0,
                resource: texture.createView(),
            },

            {
                binding: 1,
                resource: sampler,
            }
        ]
    });

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

    function frame() {

        updatePixels();

        const encoder = device.createCommandEncoder();

        const view = context
            .getCurrentTexture()
            .createView();

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
        pass.setBindGroup(0, bindGroup);

        // Draw fullscreen quad
        pass.draw(6);

        pass.end();

        device.queue.submit([encoder.finish()]);

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}





main().catch(err => {
    console.error(err);
});
