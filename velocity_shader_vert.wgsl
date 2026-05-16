struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) cell_coor : vec2f
};

@group(0) @binding(0) var<uniform> grid : vec2f;

@group(0) @binding(5) var<storage> cellStateX : array<f32>;
@group(0) @binding(7) var<storage> cellStateY : array<f32>;



@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32,
    @builtin(instance_index) instance : u32) -> VertexOutput {

    let scalingFactor : f32 = 1.;

    let positions = array<vec2<f32>, 2>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(cellStateX[instance], cellStateY[instance]) * scalingFactor
    );

    let uvs = array<vec2<f32>, 2>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 1.0)
    );

    var out : VertexOutput;

    // Calculate position for 'out'
    let cell = vec2f(f32(instance % u32(grid.x)), f32(instance / u32(grid.x)));
    let cellOffset = cell / grid * 2;
    let outPos = (positions[vertexIndex] + 1) / grid - 1 + cellOffset;

    out.position = vec4<f32>(outPos, 0.0, 1.0);
    out.uv = uvs[vertexIndex];
    out.cell_coor = cell;

    return out;
}
