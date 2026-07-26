@group(0) @binding(0) var<uniform> grid : vec2f;
@group(0) @binding(3) var<uniform> dt : f32;
@group(0) @binding(4) var<uniform> diff : f32; // diffusion rate (unused here)

@group(0) @binding(5) var<storage> fieldIn : array<f32>;
@group(0) @binding(6) var<storage, read_write> fieldOut : array<f32>;
@group(0) @binding(7) var<storage> velFieldXIn : array<f32>;
@group(0) @binding(8) var<storage, read_write> velFieldYIn : array<f32>;



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
    let i : f32 = f32(cell.x);
    let j : f32 = f32(cell.y);

    // Look up velocity at this cell
    let velX : f32 = velFieldXIn[idx];
    let velY : f32 = velFieldYIn[idx];

    // Backtrace through velocity field (semi-Lagrangian) with displacement safety clamp
    let maxDisp : f32 = grid.x * 0.15;
    let dispX : f32 = clamp(velX * dt * grid.x, -maxDisp, maxDisp);
    let dispY : f32 = clamp(velY * dt * grid.x, -maxDisp, maxDisp);

    var originX : f32 = i - dispX;
    var originY : f32 = j - dispY;

    // Clamp to grid interior bounds
    originX = clamp(originX, 0.5, grid.x - 1.5);
    originY = clamp(originY, 0.5, grid.y - 1.5);

    // Integer and fractional parts for bilinear interpolation
    let floorX : f32 = floor(originX);
    let floorY : f32 = floor(originY);
    let fractX : f32 = originX - floorX;
    let fractY : f32 = originY - floorY;

    let ix0 : u32 = u32(floorX);
    let iy0 : u32 = u32(floorY);

    // Bilinear interpolation of source field
    let v00 : f32 = fieldIn[cellIndex(vec2u(ix0, iy0))];
    let v10 : f32 = fieldIn[cellIndex(vec2u(ix0 + 1, iy0))];
    let v01 : f32 = fieldIn[cellIndex(vec2u(ix0, iy0 + 1))];
    let v11 : f32 = fieldIn[cellIndex(vec2u(ix0 + 1, iy0 + 1))];

    let top : f32 = mix(v00, v10, fractX);
    let bottom : f32 = mix(v01, v11, fractX);

    fieldOut[idx] = mix(top, bottom, fractY);
}
