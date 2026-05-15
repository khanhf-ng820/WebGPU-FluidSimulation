@group(0) @binding(0) var<uniform> grid : vec2f;
@group(0) @binding(3) var<uniform> dt : f32;
@group(0) @binding(4) var<uniform> diff : f32; // diffusion rate

@group(0) @binding(5) var<storage> setBoundsType : u32; // type of setBounds
@group(0) @binding(6) var<storage, read_write> field : array<f32>;



fn cellIndex(cell_coor : vec2u) -> u32 {
    return cell_coor.x % u32(grid.x) + (cell_coor.y % u32(grid.y)) * u32(grid.x);
}



// global_invocation_id: three-dimensional vector of where in the grid of shader invocations
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn csMain(@builtin(global_invocation_id) cell : vec3<u32>) {

    var verticalWalls : f32 = 1.;
    var horizontalWalls : f32 = 1.;
    switch setBoundsType {
        case 1: {
            // Vel field X
            verticalWalls = -1.;
        }
        case 2: {
            // Vel field Y
            horizontalWalls = -1.;
        }
        default: {}
    }

    let gridSize = u32(grid.x * grid.y);
    let gridWidth = u32(grid.x);
    let gridHeight = u32(grid.y);
    let idx : u32 = cellIndex(cell.xy);

    // Vertical walls
    if (idx % gridWidth == 0 && idx / gridWidth > 0 && idx / gridWidth < gridHeight - 1) {
        field[idx] = verticalWalls * field[idx + 1];
    } else if (idx % gridWidth == gridWidth-1 && idx / gridWidth > 0 && idx / gridWidth < gridHeight - 1) {
        field[idx] = verticalWalls * field[idx - 1];
    }

    // for (int i = 1; i < GRID_HEIGHT-1; i++) {
    //     int idx = i * GRID_WIDTH;
    //     field[idx] = verticalWalls * field[idx + 1];
    //     idx = (i + 1) * GRID_WIDTH - 1;
    //     field[idx] = verticalWalls * field[idx - 1];
    // }

    // Horizontal walls
    if (idx > 0 && idx < gridWidth - 1) {
        field[idx] = horizontalWalls * field[idx + gridWidth];
    } else if (idx > gridSize - gridWidth && idx < gridSize - 1) {
        field[idx] = horizontalWalls * field[idx - gridWidth];
    }
    // for (int i = 1; i < GRID_WIDTH-1; i++) {
    //     int idx = i;
    //     field[idx] = horizontalWalls * field[idx + GRID_WIDTH];
    //     idx = grProd - 1 - i;
    //     field[idx] = horizontalWalls * field[idx - GRID_WIDTH];
    // }

    // Four corner cells
    if (idx == 0) {
        field[0] = (field[1] + field[gridWidth]) / 2.;
    }
    if (idx == gridWidth - 1) {
        field[gridWidth - 1] = (field[gridWidth - 2] + field[gridWidth * 2 - 1]) / 2.;
    }
    if (idx == gridSize - 1) {
        field[gridSize - 1] = (field[gridSize - 2] + field[gridSize - 1 - gridWidth]) / 2.;
    }
    if (idx == gridSize - gridWidth) {
        field[gridSize - gridWidth] = (field[gridSize - gridWidth + 1] + field[gridSize - gridWidth * 2]) / 2.;
    }
}
