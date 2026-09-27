import { BAND_XYZ } from './spectral'

const common = /* wgsl */ `
struct Cell { wetA: vec4f, wetB: vec4f, dryA: vec4f, dryB: vec4f, water: vec4f }
// water = surface water, suspended pigment mass, deposited pigment mass,
// paper saturation. All pigment arrays store K/S multiplied by mass.
struct Params {
  grid: vec4u, // width, height, region x, region y
  region: vec4u, // region width/height, mode, seed
  brush: vec4f, // x, y, radius, pressure
  paint: vec4f, // water, pigment, softness, dry brush
  ksA: vec4f, ksB: vec4f,
  time: vec4f // dt, opacity, output width, output height
}
fn grain(p: vec2u, seed: u32) -> f32 {
  var n = p.x * 374761393u + p.y * 668265263u + seed * 1274126177u;
  n = (n ^ (n >> 13u)) * 1274126177u;
  return f32(n ^ (n >> 16u)) / 4294967295.0;
}
`

export const computeShader = common + /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> cells: array<Cell>;
@group(0) @binding(1) var<storage, read_write> scratch: array<Cell>;
@group(0) @binding(2) var<uniform> p: Params;
fn index(q: vec2u) -> u32 { return q.y * p.grid.x + q.x; }
fn location(gid: vec3u) -> vec2u { return gid.xy + p.grid.zw; }

@compute @workgroup_size(8, 8)
fn deposit(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= p.region.xy)) { return; }
  let q = location(gid); if (any(q >= p.grid.xy)) { return; }
  let radius = max(.7, p.brush.z * (.35 + .65 * p.brush.w));
  let edgeTexture = (grain(q / 3u, p.region.w) - .5) * .045 + (grain(q / 11u, p.region.w) - .5) * .035;
  let d = distance(vec2f(q) + .5, p.brush.xy) / radius + edgeTexture;
  if (d >= 1.0) { return; }
  var cover = 1.0 - smoothstep(max(.05, 1.0 - p.paint.z * .44), 1.0, d);
  let tooth = grain(q, p.region.w);
  cover *= mix(.72 + .45 * tooth, smoothstep(.3, .85, tooth), p.paint.w);
  var c = cells[index(q)];
  let amount = cover * (.5 + .5 * p.brush.w);
  if (p.region.z == 3u) { // eraser
    let retain = 1.0 - amount * .3;
    c.wetA *= retain; c.wetB *= retain; c.dryA *= retain; c.dryB *= retain;
    c.water *= retain;
  } else if (p.region.z == 2u) { // lift: wet pigment is easier to lift
    let wetRetain = 1.0 - amount * .38;
    let dryRetain = 1.0 - amount * .065;
    c.wetA *= wetRetain; c.wetB *= wetRetain; c.water.y *= wetRetain;
    c.dryA *= dryRetain; c.dryB *= dryRetain; c.water.z *= dryRetain;
    c.water.x = min(1.2, c.water.x + amount * .035);
  } else {
    let water = amount * p.paint.x * .17;
    c.water.x = min(1.2, c.water.x + water);
    // Rewet only a fraction of a stain; dry marks retain their character.
    let lift = min(.045, water * .18);
    c.wetA += c.dryA * lift; c.wetB += c.dryB * lift;
    c.water.y += c.water.z * lift;
    c.dryA *= 1.0 - lift; c.dryB *= 1.0 - lift; c.water.z *= 1.0 - lift;
    if (p.region.z == 0u) {
      let mass = amount * p.paint.y * .105;
      let mobile = smoothstep(.01, .18, c.water.x);
      c.wetA += p.ksA * mass * mobile; c.wetB += p.ksB * mass * mobile;
      c.dryA += p.ksA * mass * (1.0 - mobile); c.dryB += p.ksB * mass * (1.0 - mobile);
      c.water.y += mass * mobile; c.water.z += mass * (1.0 - mobile);
    }
  }
  cells[index(q)] = c;
}

@compute @workgroup_size(8, 8)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= p.region.xy)) { return; }
  let q = location(gid); if (any(q >= p.grid.xy)) { return; }
  let c = cells[index(q)]; var result = c;
  let dt = p.time.x;
  let tooth = grain(q, p.region.w);
  // Pairwise fluxes are antisymmetric: pigment and water are transported,
  // never created by diffusion. Four-neighbor CFL is bounded below 1/4.
  let dirs = array<vec2i, 4>(vec2i(-1,0), vec2i(1,0), vec2i(0,-1), vec2i(0,1));
  var edge = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let nq = vec2i(q) + dirs[k];
    if (any(nq < vec2i(0)) || any(nq >= vec2i(p.grid.xy))) { continue; }
    let n = cells[index(vec2u(nq))];
    let conductance = min(.19, dt * 5.0) * smoothstep(.002, .08, max(c.water.x, n.water.x));
    let flux = (n.water.x - c.water.x) * conductance;
    result.water.x += flux;
    let incoming = max(0.0, flux) / max(.001, n.water.x);
    let outgoing = max(0.0, -flux) / max(.001, c.water.x);
    let diffuse = dt * .85 * smoothstep(.012, .16, min(c.water.x, n.water.x));
    result.wetA += n.wetA * incoming - c.wetA * outgoing + (n.wetA - c.wetA) * diffuse;
    result.wetB += n.wetB * incoming - c.wetB * outgoing + (n.wetB - c.wetB) * diffuse;
    result.water.y += n.water.y * incoming - c.water.y * outgoing + (n.water.y - c.water.y) * diffuse;
    edge += max(0.0, c.water.x - n.water.x);
  }
  let absorption = min(result.water.x, dt * .008 * (1.0 - c.water.w));
  result.water.w = clamp(c.water.w + absorption - dt * .002, 0.0, 1.0);
  result.water.x = max(0.0, result.water.x - absorption - dt * .026);
  let settling = clamp(dt * (.026 + .032 * tooth + edge * 3.2) +
    (1.0 - smoothstep(.0, .025, result.water.x)) * .15, 0.0, 1.0);
  result.wetA = max(vec4f(0), result.wetA); result.wetB = max(vec4f(0), result.wetB);
  result.water.y = max(0.0, result.water.y);
  result.dryA += result.wetA * settling; result.dryB += result.wetB * settling;
  result.water.z += result.water.y * settling;
  result.wetA *= 1.0 - settling; result.wetB *= 1.0 - settling;
  result.water.y *= 1.0 - settling;
  scratch[index(q)] = result;
}
@compute @workgroup_size(8, 8)
fn commit(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= p.region.xy)) { return; }
  let q = location(gid); if (any(q >= p.grid.xy)) { return; }
  cells[index(q)] = scratch[index(q)];
}
@compute @workgroup_size(8, 8)
fn dry(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= p.region.xy)) { return; }
  let q = location(gid); if (any(q >= p.grid.xy)) { return; }
  var c = cells[index(q)];
  c.dryA += c.wetA; c.dryB += c.wetB; c.water.z += c.water.y;
  c.wetA = vec4f(0); c.wetB = vec4f(0); c.water = vec4f(0, 0, c.water.z, 0);
  cells[index(q)] = c;
}
`

const colorFunction = /* wgsl */ `
fn rgb(ksA: vec4f, ksB: vec4f) -> vec3f {
  let a = 1.0 / (1.0 + ksA + sqrt(ksA * ksA + 2.0 * ksA));
  let b = 1.0 / (1.0 + ksB + sqrt(ksB * ksB + 2.0 * ksB));
  let r = array<f32, 8>(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w);
  var xyz = vec3f(0);
  ${BAND_XYZ.map((xyz, i) => `xyz += r[${i}] * vec3f(${xyz.map(v => v.toFixed(12)).join(',')});`).join('\n')}
  let linear = max(vec3f(0), vec3f(
    dot(xyz, vec3f(3.24096994,-1.53738318,-.49861076)),
    dot(xyz, vec3f(-.96924364,1.87596750,.04155506)),
    dot(xyz, vec3f(.05563008,-.20397696,1.05697151))));
  return clamp(select(1.055 * pow(linear, vec3f(1.0/2.4)) - .055,
    12.92 * linear, linear <= vec3f(.0031308)), vec3f(0), vec3f(1));
}
`

export const renderShader = common + colorFunction + /* wgsl */ `
@group(0) @binding(0) var<storage, read> cells: array<Cell>;
@group(0) @binding(1) var<uniform> p: Params;
struct Vertex { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vert(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var v: Vertex; v.pos = vec4f(uv * vec2f(2,-2) + vec2f(-1,1),0,1); v.uv = uv; return v;
}
fn at(q: vec2i) -> Cell {
  let c = vec2u(clamp(q, vec2i(0), vec2i(p.grid.xy) - 1));
  return cells[c.y * p.grid.x + c.x];
}
fn shade(c: Cell) -> vec4f {
  let mass = c.water.y + c.water.z;
  if (mass < .00001) { return vec4f(0); }
  let color = rgb((c.wetA + c.dryA) / mass, (c.wetB + c.dryB) / mass);
  let alpha = (1.0 - exp(-mass * 2.6)) * p.time.y;
  return vec4f(color * alpha, alpha);
}
@fragment fn frag(v: Vertex) -> @location(0) vec4f {
  let pos = v.uv * vec2f(p.grid.xy) - .5;
  let q = vec2i(floor(pos)); let f = fract(pos);
  return mix(mix(shade(at(q)), shade(at(q + vec2i(1,0))), f.x),
    mix(shade(at(q + vec2i(0,1))), shade(at(q + vec2i(1,1))), f.x), f.y);
}
@fragment fn paper(v: Vertex) -> @location(0) vec4f {
  let q = vec2u(v.uv * p.time.zw);
  let noise = grain(q, p.region.w) - .5;
  let fibers = grain(q / 3u, p.region.w) - .5;
  return vec4f(vec3f(.986,.978,.956) + noise * .024 + fibers * .012, 1);
}
`

export const rasterShader = /* wgsl */ `
struct Vertex { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> opacity: vec4f;
@vertex fn vert(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var v: Vertex; v.pos = vec4f(uv * vec2f(2,-2) + vec2f(-1,1),0,1); v.uv = uv; return v;
}
@fragment fn frag(v: Vertex) -> @location(0) vec4f {
  let c = textureSample(img, samp, v.uv); let a = c.a * opacity.x;
  let premult = select(c.rgb * c.a, c.rgb, opacity.y > .5);
  return vec4f(premult * opacity.x, a);
}
`
