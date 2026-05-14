@group(0) @binding(0) var<uniform> grid : vec2f;
@group(0) @binding(1) var<uniform> dt : f32;
@group(0) @binding(2) var<uniform> diff : f32; // diffusion rate

@group(0) @binding(3) var<storage> fieldSource : array<f32>;
@group(0) @binding(4) var<storage, read_write> fieldDestination : array<f32>;



fn cellIndex(cell_coor : vec2u) -> u32 {
    return cell_coor.x % u32(grid.x) + (cell_coor.y % u32(grid.y)) * u32(grid.x);
}



// global_invocation_id: three-dimensional vector of where in the grid of shader invocations
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn csMain(@builtin(global_invocation_id) cell : vec3<u32>) {

    let idx : u32 = cellIndex(cell.xy);
    fieldDestination[idx] = fieldSource[idx];
}
