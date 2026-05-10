@group(0) @binding(0) var<uniform> grid : vec2f;


@group(0) @binding(1)
var prevTex : texture_2d<f32>;

@group(0) @binding(2)
var prevSampler : sampler;

struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) cell_idx : vec2f
};


@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {

    // Example: no ping-pong rendering
    return textureSample(prevTex, prevSampler, in.cell_idx / grid.xy);


    // Example: diffusion
    let dims = vec2<f32>(textureDimensions(prevTex));

    let texel = 1.0 / dims;

    let center = textureSample(prevTex, prevSampler, in.uv);

    let left  = textureSample(prevTex, prevSampler, in.uv + vec2(-texel.x, 0.0));
    let right = textureSample(prevTex, prevSampler, in.uv + vec2(texel.x, 0.0));

    let color = (center + left + right) / 3.0;

    return color;
}
