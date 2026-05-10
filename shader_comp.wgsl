@group(0) @binding(0)
var srcTex : texture_2d<f32>;

@group(0) @binding(1)
var dstTex : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn csMain(@builtin(global_invocation_id) gid : vec3<u32>) {

    let dims = textureDimensions(srcTex);

    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let p = vec2<i32>(gid.xy);

    let center = textureLoad(srcTex, p, 0);

    let left  = textureLoad(srcTex, p + vec2(-1, 0), 0);
    let right = textureLoad(srcTex, p + vec2(1, 0), 0);

    let result = (center + left + right) / 3.0;

    textureStore(dstTex, p, result);
}
