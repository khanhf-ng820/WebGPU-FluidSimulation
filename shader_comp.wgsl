// @group(0) @binding(0)
// var srcTex : texture_2d<f32>;
// 
// @group(0) @binding(1)
// var dstTex : texture_storage_2d<rgba8unorm, write>;

@group(0) @binding(0) var<uniform> grid : vec2f;

@group(0) @binding(3) var<storage> cellStateIn : array<u32>;
@group(0) @binding(4) var<storage, read_write> cellStateOut: array<u32>;



fn positive_mod_i32(x: i32, y: i32) -> u32 {
    return u32(((x % y) + y) % y);
}

fn cellIndex(cell_coor : vec2u) -> u32 {
    // Wrap-around
    return cell_coor.x % u32(grid.x) + (cell_coor.y % u32(grid.y)) * u32(grid.x);
}

fn cellIndexi(cell_coor : vec2i) -> u32 {
    // Wrap-around (safer)
    return positive_mod_i32(cell_coor.x, i32(grid.x))
         + positive_mod_i32(cell_coor.y, i32(grid.y)) * u32(grid.x);
}



// global_invocation_id: three-dimensional vector of where in the grid of shader invocations
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn csMain(@builtin(global_invocation_id) cell : vec3<u32>) {

    let liveNeighbors = cellStateIn[cellIndexi(vec2i(cell.xy) - vec2i( 1,  1))]
                      + cellStateIn[cellIndexi(vec2i(cell.xy) - vec2i( 1,  0))]
                      + cellStateIn[cellIndexi(vec2i(cell.xy) - vec2i( 1, -1))]
                      + cellStateIn[cellIndexi(vec2i(cell.xy) - vec2i(-1,  1))]
                      + cellStateIn[cellIndexi(vec2i(cell.xy) - vec2i(-1,  0))]
                      + cellStateIn[cellIndexi(vec2i(cell.xy) - vec2i(-1, -1))]
                      + cellStateIn[cellIndexi(vec2i(cell.xy) - vec2i( 0,  1))]
                      + cellStateIn[cellIndexi(vec2i(cell.xy) - vec2i( 0, -1))];

    switch liveNeighbors {
        case 2: {
            cellStateOut[cellIndex(cell.xy)] = cellStateIn[cellIndex(cell.xy)];
        }
        case 3: {
            cellStateOut[cellIndex(cell.xy)] = 1;
        }
        default: {
            cellStateOut[cellIndex(cell.xy)] = 0;
        }
    }

    // let dims = textureDimensions(srcTex);

    // if (gid.x >= dims.x || gid.y >= dims.y) {
    //     return;
    // }

    // let p = vec2<i32>(gid.xy);

    // let center = textureLoad(srcTex, p, 0);

    // let left  = textureLoad(srcTex, p + vec2(-1, 0), 0);
    // let right = textureLoad(srcTex, p + vec2(1, 0), 0);

    // let result = (center + left + right) / 3.0;

    // textureStore(dstTex, p, result);
}
