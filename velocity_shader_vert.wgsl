struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
    @location(1) cell_coor : vec2f,
    @location(2) magnitude : f32
};

@group(0) @binding(0) var<uniform> grid : vec2f;

@group(0) @binding(5) var<storage> cellStateX : array<f32>;
@group(0) @binding(7) var<storage> cellStateY : array<f32>;

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32,
    @builtin(instance_index) instance : u32) -> VertexOutput {

    let vel = vec2<f32>(cellStateX[instance], cellStateY[instance]);
    let mag = length(vel);
    
    // Normalize and scale to half a cell size (similar to Processing)
    // 1 cell is 2.0 / grid.x in clip space. Half a cell is 1.0 / grid.x.
    var disp = vec2<f32>(0.0, 0.0);
    if (mag > 0.0001) {
        if (vertexIndex == 1u) {
            disp = normalize(vel) * (1.0 / grid.x);
        }
    }

    var out : VertexOutput;
    
    let cell = vec2f(f32(instance % u32(grid.x)), f32(instance / u32(grid.x)));
    let cellOffset = cell / grid * 2.0;
    
    // Base position is the center of the cell
    let basePos = vec2<f32>(1.0/grid.x, 1.0/grid.y) - 1.0 + cellOffset;
    let outPos = basePos + disp;

    out.position = vec4<f32>(outPos, 0.0, 1.0);
    out.uv = vec2<f32>(0.0); // unused
    out.cell_coor = cell;
    out.magnitude = mag;

    return out;
}
