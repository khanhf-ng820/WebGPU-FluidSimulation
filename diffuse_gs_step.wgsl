@group(0) @binding(0) var<uniform> grid : vec2f;
@group(0) @binding(3) var<uniform> dt : f32;
@group(0) @binding(4) var<uniform> diff : f32; // diffusion rate

@group(0) @binding(5) var<storage> fieldIn : array<f32>;
@group(0) @binding(6) var<storage, read_write> tempFieldOut : array<f32>;
@group(0) @binding(7) var<storage> diffuseTempFieldIn : array<f32>;



fn cellIndex(cell_coor : vec2u) -> u32 {
    return cell_coor.x % u32(grid.x) + (cell_coor.y % u32(grid.y)) * u32(grid.x);
}



// global_invocation_id: three-dimensional vector of where in the grid of shader invocations
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn csMain(@builtin(global_invocation_id) cell : vec3<u32>) {

    if (cell.x == 0 || cell.y == 0 || cell.x == u32(grid.x) - 1 || cell.y == u32(grid.y) - 1) {
        return;
    }
    let idx : u32 = cellIndex(cell.xy);
    let i : u32 = cell.x;
    let j : u32 = cell.y;
    let a : f32 = dt * diff * grid.x * grid.y; // constant for diffusion

    // One step of Gauss-Seidel relaxation
    tempFieldOut[idx] = (fieldIn[idx] + a * (
          diffuseTempFieldIn[cellIndex(vec2u(i-1, j))]
        + diffuseTempFieldIn[cellIndex(vec2u(i+1, j))]
        + diffuseTempFieldIn[cellIndex(vec2u(i, j-1))]
        + diffuseTempFieldIn[cellIndex(vec2u(i, j+1))]
    )) / (1. + 4. * a);
}
