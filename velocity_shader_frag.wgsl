@group(0) @binding(0) var<uniform> grid : vec2f;

@group(0) @binding(1)
var prevTex : texture_2d<f32>;

@group(0) @binding(2)
var prevSampler : sampler;

@group(0) @binding(5) var<storage> cellStateX : array<f32>;
@group(0) @binding(7) var<storage> cellStateY : array<f32>;

struct VSOut {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) cell_coor : vec2f,
    @location(2) magnitude : f32
};



@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
    if (in.magnitude < 0.0001) {
        discard;
    }
    
    // Base color on magnitude
    let intensity = clamp(in.magnitude / 1.0, 0.2, 1.0);
    return vec4f(0.0, intensity, 0.0, 1.0);
}
