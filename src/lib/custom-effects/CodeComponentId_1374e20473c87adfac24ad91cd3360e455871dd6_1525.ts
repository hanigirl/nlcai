// @ts-nocheck

// Property metadata is only used in Figma Design, so this is a no-op.
function defineProperties(
  _component: unknown,
  _properties: unknown,
): void {}

export default function Effect() { }
export function setup(device, frame) {
    frame.state.shaderModule = device.createShaderModule({
        code: `
diagnostic(off,derivative_uniformity);

struct Uniforms {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  bg: vec4f,
  c1: vec4f,
  c2: vec4f,
  c3: vec4f,
  c4: vec4f,
  cd: vec4f,
  co0: vec4f,
  co1: vec4f,
  co2: vec4f,
  co3: vec4f,
  co4: vec4f,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VsIn { @location(0) pos: vec2f, @location(1) uv: vec2f };
struct VsOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };

@vertex fn vs_main(inp: VsIn) -> VsOut {
  var o: VsOut;
  o.position = vec4f(inp.pos, 0.0, 1.0);
  o.uv = inp.uv;
  return o;
}

fn hash11(p: f32) -> f32 {
  return fract(sin(p * 127.1 + 311.7) * 43758.5453);
}

fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3f {
  let cv = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = (h % 1.0 + 1.0) % 1.0 * 6.0;
  let x = cv * (1.0 - abs(hp % 2.0 - 1.0));
  var rgb: vec3f;
  if (hp < 1.0) { rgb = vec3f(cv, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, cv, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, cv, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, cv); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, cv); }
  else { rgb = vec3f(cv, 0.0, x); }
  let m = l - cv * 0.5;
  return rgb + vec3f(m);
}

fn blobDist(pos: vec2f, cx: f32, cy: f32, rx: f32, ry: f32, rot: f32, sd: f32, phase: f32, rAngle: f32, rStr: f32) -> f32 {
  let d = pos - vec2f(cx, cy);
  let cs = cos(rot);
  let sn = sin(rot);
  let rd = vec2f(d.x * cs + d.y * sn, -d.x * sn + d.y * cs);
  let dist = length(rd / vec2f(rx, ry));
  let angle = atan2(rd.y, rd.x);

  let w1a = 0.08 + hash11(sd + 10.0) * 0.12;
  let w1f = 1.0 + floor(hash11(sd + 11.0) * 3.0);
  let w1p = hash11(sd + 12.0) * 6.283 + phase * 0.3;

  let w2a = 0.06 + hash11(sd + 13.0) * 0.10;
  let w2f = 2.0 + floor(hash11(sd + 14.0) * 2.0);
  let w2p = hash11(sd + 15.0) * 6.283 + phase * 0.25;

  let w3a = 0.03 + hash11(sd + 16.0) * 0.05;
  let w3f = 4.0 + floor(hash11(sd + 17.0) * 4.0);
  let w3p = hash11(sd + 18.0) * 6.283 + phase * 0.4;

  let w4a = 0.02 + hash11(sd + 19.0) * 0.03;
  let w4f = 5.0 + floor(hash11(sd + 20.0) * 4.0);
  let w4p = hash11(sd + 21.0) * 6.283 + phase * 0.35;

  let deform = 1.0
    + w1a * sin(angle * w1f + w1p)
    + w2a * sin(angle * w2f + w2p)
    + w3a * sin(angle * w3f + w3p)
    + w4a * sin(angle * w4f + w4p);

  // Collision ripple deformation
  var ripple = 0.0;
  if (rStr > 0.001) {
    let prox = max(0.0, cos(angle - rAngle));
    ripple = rStr * pow(prox, 4.0) * (0.85 + 0.15 * sin(angle * 10.0 + phase * 3.0));
  }

  return dist / deform + ripple;
}

@fragment fn fs_main(inp: VsOut) -> @location(0) vec4f {
  let phase = u.a.x;
  let blur = u.a.y;
  let bscale = u.a.z;
  let istr = u.a.w;
  let dims = u.b.xy;
  let seed = u.b.z;
  let palRand = u.b.w;
  let mpos = u.c.xy;
  let mvel = u.c.zw;
  let collEnabled = u.cd.x;

  let shortSide = min(dims.x, dims.y);
  let px = (inp.uv * dims - dims * 0.5) / shortSide;

  var p = px;

  // Pointer displacement
  let mUV = (mpos - dims * 0.5) / shortSide;
  let toMouse = p - mUV;
  let md = length(toMouse);
  let iRadius = 0.4;
  let falloff = exp(-md * md / (iRadius * iRadius * 0.5));
  let strength = istr;
  if (strength > 0.0 && md > 0.001) {
    let outward = toMouse / md;
    let tangent = vec2f(-outward.y, outward.x);
    let velContrib = mvel / shortSide * 0.15;
    p = p + (outward * 0.18 + tangent * 0.042 + velContrib) * falloff * strength;
  }

  // Blob base centers
  let cx0 = (0.76 - 0.5) + (hash11(seed * 7.0 + 1.0) - 0.5) * 0.06;
  let cy0 = (0.10 - 0.5) + (hash11(seed * 7.0 + 2.0) - 0.5) * 0.06;
  let cx1 = (0.60 - 0.5) + (hash11(seed * 7.0 + 138.0) - 0.5) * 0.06;
  let cy1 = (1.02 - 0.5) + (hash11(seed * 7.0 + 139.0) - 0.5) * 0.06;
  let cx2 = (1.05 - 0.5) + (hash11(seed * 7.0 + 275.0) - 0.5) * 0.06;
  let cy2 = (0.60 - 0.5) + (hash11(seed * 7.0 + 276.0) - 0.5) * 0.06;
  let cx3 = (0.08 - 0.5) + (hash11(seed * 7.0 + 412.0) - 0.5) * 0.06;
  let cy3 = (0.51 - 0.5) + (hash11(seed * 7.0 + 413.0) - 0.5) * 0.06;
  let cx4 = (-0.10 - 0.5) + (hash11(seed * 7.0 + 549.0) - 0.5) * 0.06;
  let cy4 = (-0.14 - 0.5) + (hash11(seed * 7.0 + 550.0) - 0.5) * 0.06;

  let arx = dims.x / shortSide;
  let ary = dims.y / shortSide;

  // Animated drift
  let dp0 = hash11(seed * 7.0 + 3.0) * 6.283;
  let dx0 = sin(phase * 0.7 + dp0) * 0.35 + sin(phase * 0.31 + dp0 + 1.0) * 0.18;
  let dy0 = cos(phase * 0.53 + dp0 + 2.0) * 0.30 + sin(phase * 0.22 + dp0 + 3.0) * 0.15;

  let dp1 = hash11(seed * 7.0 + 140.0) * 6.283;
  let dx1 = sin(phase * 0.6 + dp1) * 0.40 + sin(phase * 0.28 + dp1 + 1.5) * 0.15;
  let dy1 = cos(phase * 0.45 + dp1 + 2.5) * 0.35 + sin(phase * 0.19 + dp1 + 3.5) * 0.20;

  let dp2 = hash11(seed * 7.0 + 277.0) * 6.283;
  let dx2 = sin(phase * 0.55 + dp2) * 0.32 + sin(phase * 0.33 + dp2 + 0.7) * 0.20;
  let dy2 = cos(phase * 0.48 + dp2 + 1.8) * 0.38 + sin(phase * 0.25 + dp2 + 2.8) * 0.16;

  let dp3 = hash11(seed * 7.0 + 414.0) * 6.283;
  let dx3 = sin(phase * 0.65 + dp3) * 0.38 + sin(phase * 0.27 + dp3 + 1.2) * 0.17;
  let dy3 = cos(phase * 0.5 + dp3 + 2.2) * 0.33 + sin(phase * 0.21 + dp3 + 3.2) * 0.18;

  let dp4 = hash11(seed * 7.0 + 551.0) * 6.283;
  let dx4 = sin(phase * 0.58 + dp4) * 0.30 + sin(phase * 0.35 + dp4 + 0.9) * 0.22;
  let dy4 = cos(phase * 0.42 + dp4 + 1.5) * 0.36 + sin(phase * 0.24 + dp4 + 2.5) * 0.19;

  // Blob radii
  let sd0 = seed * 7.0 + 0.0 * 137.0;
  let rx0 = (0.42 + hash11(sd0 + 4.0) * 0.18) * bscale;
  let ry0 = (0.36 + hash11(sd0 + 5.0) * 0.16) * bscale;
  let rot0 = hash11(sd0 + 6.0) * 6.283;

  let sd1 = seed * 7.0 + 1.0 * 137.0;
  let rx1 = (0.50 + hash11(sd1 + 4.0) * 0.24) * bscale;
  let ry1 = (0.38 + hash11(sd1 + 5.0) * 0.20) * bscale;
  let rot1 = hash11(sd1 + 6.0) * 6.283;

  let sd2 = seed * 7.0 + 2.0 * 137.0;
  let rx2 = (0.30 + hash11(sd2 + 4.0) * 0.16) * bscale;
  let ry2 = (0.34 + hash11(sd2 + 5.0) * 0.18) * bscale;
  let rot2 = hash11(sd2 + 6.0) * 6.283;

  let sd3 = seed * 7.0 + 3.0 * 137.0;
  let rx3 = (0.34 + hash11(sd3 + 4.0) * 0.20) * bscale;
  let ry3 = (0.32 + hash11(sd3 + 5.0) * 0.18) * bscale;
  let rot3 = hash11(sd3 + 6.0) * 6.283;

  let sd4 = seed * 7.0 + 4.0 * 137.0;
  let rx4 = (0.28 + hash11(sd4 + 4.0) * 0.16) * bscale;
  let ry4 = (0.28 + hash11(sd4 + 5.0) * 0.14) * bscale;
  let rot4 = hash11(sd4 + 6.0) * 6.283;

  // Feather width
  let featherMin = 1.25 / shortSide;
  let feather = max(featherMin, pow(blur, 1.25) * 0.40 * bscale);

  // Final blob centers: natural + collision offset
  let fc0x = cx0 * arx + dx0 + u.co0.x;
  let fc0y = cy0 * ary + dy0 + u.co0.y;
  let fc1x = cx1 * arx + dx1 + u.co1.x;
  let fc1y = cy1 * ary + dy1 + u.co1.y;
  let fc2x = cx2 * arx + dx2 + u.co2.x;
  let fc2y = cy2 * ary + dy2 + u.co2.y;
  let fc3x = cx3 * arx + dx3 + u.co3.x;
  let fc3y = cy3 * ary + dy3 + u.co3.y;
  let fc4x = cx4 * arx + dx4 + u.co4.x;
  let fc4y = cy4 * ary + dy4 + u.co4.y;

  // Compute blob distances with collision ripple
  let b0 = blobDist(p, fc0x, fc0y, rx0, ry0, rot0, sd0, phase, u.co0.z, u.co0.w);
  let b1 = blobDist(p, fc1x, fc1y, rx1, ry1, rot1, sd1, phase, u.co1.z, u.co1.w);
  let b2 = blobDist(p, fc2x, fc2y, rx2, ry2, rot2, sd2, phase, u.co2.z, u.co2.w);
  let b3 = blobDist(p, fc3x, fc3y, rx3, ry3, rot3, sd3, phase, u.co3.z, u.co3.w);
  let b4 = blobDist(p, fc4x, fc4y, rx4, ry4, rot4, sd4, phase, u.co4.z, u.co4.w);

  // Alpha from SDF
  let a0 = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, b0);
  let a1 = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, b1);
  let a2 = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, b2);
  let a3 = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, b3);
  let a4 = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, b4);

  // Colors
  let col0 = u.c1;
  let col1 = u.c2;
  let col2 = vec4f(col1.rgb * 0.81 + u.bg.rgb * 0.19, col1.a);
  let col3 = u.c3;
  let col4 = u.c4;

  // Composite: bg, then blob 0-4
  var color = u.bg.rgb;
  var alpha = u.bg.a;

  let ba0 = a0 * col0.a;
  color = mix(color, col0.rgb, ba0);
  alpha = alpha * (1.0 - ba0) + ba0;

  let ba1 = a1 * col1.a;
  color = mix(color, col1.rgb, ba1);
  alpha = alpha * (1.0 - ba1) + ba1;

  let ba2 = a2 * col2.a;
  color = mix(color, col2.rgb, ba2);
  alpha = alpha * (1.0 - ba2) + ba2;

  let ba3 = a3 * col3.a;
  color = mix(color, col3.rgb, ba3);
  alpha = alpha * (1.0 - ba3) + ba3;

  let ba4 = a4 * col4.a;
  color = mix(color, col4.rgb, ba4);
  alpha = alpha * (1.0 - ba4) + ba4;

  return vec4f(color, alpha);
}
    `,
    });
    frame.state.quad = device.createBuffer({
        size: 6 * 4 * 4,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(frame.state.quad.getMappedRange()).set([
        -1, -1, 0, 1,
        1, -1, 1, 1,
        -1, 1, 0, 0,
        -1, 1, 0, 0,
        1, -1, 1, 1,
        1, 1, 1, 0,
    ]);
    frame.state.quad.unmap();
    frame.state.uniformBuf = device.createBuffer({
        size: 14 * 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    frame.state.phase = 0;
    frame.state.lastTime = -1;
    frame.state.smoothVelX = 0;
    frame.state.smoothVelY = 0;
    frame.state.lastMouseX = 0;
    frame.state.lastMouseY = 0;
    frame.state.mouseInfluence = 0;
    // Collision state: per-blob offset + velocity
    frame.state.collOffsets = [
        { x: 0, y: 0, vx: 0, vy: 0 },
        { x: 0, y: 0, vx: 0, vy: 0 },
        { x: 0, y: 0, vx: 0, vy: 0 },
        { x: 0, y: 0, vx: 0, vy: 0 },
        { x: 0, y: 0, vx: 0, vy: 0 },
    ];
    frame.state.collRipple = [
        { angle: 0, strength: 0 },
        { angle: 0, strength: 0 },
        { angle: 0, strength: 0 },
        { angle: 0, strength: 0 },
        { angle: 0, strength: 0 },
    ];
}
export function render(device, frame) {
    // Phase accumulation
    var t = frame.time * 0.001;
    if (frame.state.lastTime < 0) {
        frame.state.lastTime = t;
    }
    var dt = t - frame.state.lastTime;
    dt = Math.min(dt, 0.1);
    frame.state.lastTime = t;
    var drift = frame.params.drift;
    frame.state.phase += dt * Math.pow(drift / 100, 1.5) * 2.5;
    // Mouse smoothing
    var mx = frame.mousePosition.x;
    var my = frame.mousePosition.y;
    var hasM = (mx !== 0 || my !== 0);
    if (hasM) {
        var rawVx = (mx - frame.state.lastMouseX) / Math.max(dt, 0.001);
        var rawVy = (my - frame.state.lastMouseY) / Math.max(dt, 0.001);
        var smooth = Math.min(1, dt * 8);
        frame.state.smoothVelX += (rawVx - frame.state.smoothVelX) * smooth;
        frame.state.smoothVelY += (rawVy - frame.state.smoothVelY) * smooth;
        frame.state.mouseInfluence = Math.min(1, frame.state.mouseInfluence + dt * 4);
    }
    else {
        frame.state.smoothVelX *= Math.max(0, 1 - dt * 5);
        frame.state.smoothVelY *= Math.max(0, 1 - dt * 5);
        frame.state.mouseInfluence = Math.max(0, frame.state.mouseInfluence - dt * 3);
    }
    frame.state.lastMouseX = mx;
    frame.state.lastMouseY = my;
    var istr = (frame.params.interactionStrength / 100) * frame.state.mouseInfluence;
    // Colors
    var palRand = frame.params.paletteRandomize;
    var bgR, bgG, bgB, bgA;
    var c1R, c1G, c1B, c1A;
    var c2R, c2G, c2B, c2A;
    var c3R, c3G, c3B, c3A;
    var c4R, c4G, c4B, c4A;
    if (palRand === 0) {
        var bg = frame.params.background;
        bgR = bg.r;
        bgG = bg.g;
        bgB = bg.b;
        bgA = bg.a;
        var b1 = frame.params.blob1;
        c1R = b1.r;
        c1G = b1.g;
        c1B = b1.b;
        c1A = b1.a;
        var b2 = frame.params.blob2;
        c2R = b2.r;
        c2G = b2.g;
        c2B = b2.b;
        c2A = b2.a;
        var b3 = frame.params.blob3;
        c3R = b3.r;
        c3G = b3.g;
        c3B = b3.b;
        c3A = b3.a;
        var b4 = frame.params.blob4;
        c4R = b4.r;
        c4G = b4.g;
        c4B = b4.b;
        c4A = b4.a;
    }
    else {
        var ps = palRand * 1.618033988749895;
        var hf = function (n) { return (Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1; };
        var absHf = function (n) { var v = hf(n); return v < 0 ? v + 1 : v; };
        var baseHue = absHf(ps + 0.5);
        var scheme = Math.floor(absHf(ps + 1.5) * 3);
        var hues = [baseHue];
        if (scheme === 0) {
            hues.push((baseHue + 0.08) % 1);
            hues.push((baseHue + 0.16) % 1);
            hues.push((baseHue - 0.08 + 1) % 1);
        }
        else if (scheme === 1) {
            hues.push((baseHue + 0.42) % 1);
            hues.push((baseHue + 0.58) % 1);
            hues.push((baseHue + 0.12) % 1);
        }
        else {
            hues.push((baseHue + 0.333) % 1);
            hues.push((baseHue + 0.667) % 1);
            hues.push((baseHue + 0.167) % 1);
        }
        var hsl2rgbJS = function (h, s, l) {
            var c = (1 - Math.abs(2 * l - 1)) * s;
            var hp = ((h % 1) + 1) % 1 * 6;
            var x = c * (1 - Math.abs(hp % 2 - 1));
            var r1, g1, b1;
            if (hp < 1) {
                r1 = c;
                g1 = x;
                b1 = 0;
            }
            else if (hp < 2) {
                r1 = x;
                g1 = c;
                b1 = 0;
            }
            else if (hp < 3) {
                r1 = 0;
                g1 = c;
                b1 = x;
            }
            else if (hp < 4) {
                r1 = 0;
                g1 = x;
                b1 = c;
            }
            else if (hp < 5) {
                r1 = x;
                g1 = 0;
                b1 = c;
            }
            else {
                r1 = c;
                g1 = 0;
                b1 = x;
            }
            var m = l - c * 0.5;
            return [r1 + m, g1 + m, b1 + m];
        };
        var bgSat = 0.3 + absHf(ps + 2.5) * 0.35;
        var bgLit = 0.78 + absHf(ps + 3.5) * 0.12;
        var bgC = hsl2rgbJS(baseHue, bgSat, bgLit);
        bgR = bgC[0];
        bgG = bgC[1];
        bgB = bgC[2];
        bgA = 1;
        var blobSats = [0.65, 0.75, 0.6, 0.5];
        var blobLits = [0.65, 0.55, 0.6, 0.8];
        var bc1 = hsl2rgbJS(hues[0], blobSats[0], blobLits[0]);
        c1R = bc1[0];
        c1G = bc1[1];
        c1B = bc1[2];
        c1A = 1;
        var bc2 = hsl2rgbJS(hues[1], blobSats[1], blobLits[1]);
        c2R = bc2[0];
        c2G = bc2[1];
        c2B = bc2[2];
        c2A = 1;
        var bc3 = hsl2rgbJS(hues[2], blobSats[2], blobLits[2]);
        c3R = bc3[0];
        c3G = bc3[1];
        c3B = bc3[2];
        c3A = 1;
        var bc4 = hsl2rgbJS(hues[3], blobSats[3], blobLits[3]);
        c4R = bc4[0];
        c4G = bc4[1];
        c4B = bc4[2];
        c4A = 1;
    }
    var phase = frame.state.phase;
    var blur = frame.params.blur / 100;
    var blobScale = frame.params.blobScale / 100;
    var collisionsEnabled = frame.params.collisions;
    var bounciness = frame.params.bounciness / 100;
    // Collision physics computation
    var collData = new Float32Array(20); // 5 blobs * 4 floats (offsetX, offsetY, rippleAngle, rippleStrength)
    if (collisionsEnabled && dt > 0) {
        // JS hash11 replica
        var h11 = function (p) {
            var v = Math.sin(p * 127.1 + 311.7) * 43758.5453;
            return v - Math.floor(v);
        };
        var seed = frame.params.seed;
        var w = frame.output.width;
        var h = frame.output.height;
        var shortSide = Math.min(w, h);
        var arx = w / shortSide;
        var ary = h / shortSide;
        // Compute natural positions for each blob (same math as shader)
        var baseCenters = [
            [0.76, 0.10, 1.0, 2.0],
            [0.60, 1.02, 138.0, 139.0],
            [1.05, 0.60, 275.0, 276.0],
            [0.08, 0.51, 412.0, 413.0],
            [-0.10, -0.14, 549.0, 550.0]
        ];
        var seedMults = [0, 137, 274, 411, 548];
        var driftPhaseOffsets = [3.0, 140.0, 277.0, 414.0, 551.0];
        var driftFreqs = [
            [0.7, 0.31, 0.53, 0.22],
            [0.6, 0.28, 0.45, 0.19],
            [0.55, 0.33, 0.48, 0.25],
            [0.65, 0.27, 0.5, 0.21],
            [0.58, 0.35, 0.42, 0.24]
        ];
        var driftAmps = [
            [0.35, 0.18, 0.30, 0.15],
            [0.40, 0.15, 0.35, 0.20],
            [0.32, 0.20, 0.38, 0.16],
            [0.38, 0.17, 0.33, 0.18],
            [0.30, 0.22, 0.36, 0.19]
        ];
        var driftXOffsets = [1.0, 1.5, 0.7, 1.2, 0.9];
        var driftYOffsets = [
            [2.0, 3.0],
            [2.5, 3.5],
            [1.8, 2.8],
            [2.2, 3.2],
            [1.5, 2.5]
        ];
        var natPositions = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
        var radii = [0, 0, 0, 0, 0];
        var rotations = [0, 0, 0, 0, 0];
        for (var bi = 0; bi < 5; bi++) {
            var bc = baseCenters[bi];
            var cxBase = (bc[0] - 0.5) + (h11(seed * 7.0 + bc[2]) - 0.5) * 0.06;
            var cyBase = (bc[1] - 0.5) + (h11(seed * 7.0 + bc[3]) - 0.5) * 0.06;
            var dpOff = h11(seed * 7.0 + driftPhaseOffsets[bi]) * 6.283;
            var df = driftFreqs[bi];
            var da = driftAmps[bi];
            var dxo = driftXOffsets[bi];
            var dyo = driftYOffsets[bi];
            var dxVal = Math.sin(phase * df[0] + dpOff) * da[0] + Math.sin(phase * df[1] + dpOff + dxo) * da[1];
            var dyVal = Math.cos(phase * df[2] + dpOff + dyo[0]) * da[2] + Math.sin(phase * df[3] + dpOff + dyo[1]) * da[3];
            natPositions[bi] = { x: cxBase * arx + dxVal, y: cyBase * ary + dyVal };
            // Compute radii
            var sdVal = seed * 7.0 + bi * 137.0;
            var rxBases = [0.42, 0.50, 0.30, 0.34, 0.28];
            var rxRanges = [0.18, 0.24, 0.16, 0.20, 0.16];
            var ryBases = [0.36, 0.38, 0.34, 0.32, 0.28];
            var ryRanges = [0.16, 0.20, 0.18, 0.18, 0.14];
            var rxVal = (rxBases[bi] + h11(sdVal + 4.0) * rxRanges[bi]) * blobScale;
            var ryVal = (ryBases[bi] + h11(sdVal + 5.0) * ryRanges[bi]) * blobScale;
            radii[bi] = (rxVal + ryVal) * 0.5;
            rotations[bi] = h11(sdVal + 6.0) * 6.283;
        }
        // Effective positions = natural + collision offset
        var co = frame.state.collOffsets;
        var effPos = [
            { x: natPositions[0].x + co[0].x, y: natPositions[0].y + co[0].y },
            { x: natPositions[1].x + co[1].x, y: natPositions[1].y + co[1].y },
            { x: natPositions[2].x + co[2].x, y: natPositions[2].y + co[2].y },
            { x: natPositions[3].x + co[3].x, y: natPositions[3].y + co[3].y },
            { x: natPositions[4].x + co[4].x, y: natPositions[4].y + co[4].y },
        ];
        // Reset ripple tracking
        var rippleData = [
            { angle: 0, strength: 0 },
            { angle: 0, strength: 0 },
            { angle: 0, strength: 0 },
            { angle: 0, strength: 0 },
            { angle: 0, strength: 0 },
        ];
        // Pairwise collision resolution
        var repulsionBase = 0.5 + bounciness * 4.5; // 0.5 at bounce=0, 5.0 at bounce=1
        var overlapTolerance = 0.15 * (1.0 - bounciness * 0.9); // more tolerance at low bounciness
        var rippleScale = 0.05 + bounciness * 0.25;
        for (var ci = 0; ci < 5; ci++) {
            for (var cj = ci + 1; cj < 5; cj++) {
                var ddx = effPos[cj].x - effPos[ci].x;
                var ddy = effPos[cj].y - effPos[ci].y;
                var dist = Math.sqrt(ddx * ddx + ddy * ddy);
                var minDist = (radii[ci] + radii[cj]) * (1.0 - overlapTolerance);
                if (dist < minDist && dist > 0.001) {
                    var overlap = minDist - dist;
                    var nx = ddx / dist;
                    var ny = ddy / dist;
                    var force = overlap * repulsionBase * dt;
                    co[ci].vx -= nx * force;
                    co[ci].vy -= ny * force;
                    co[cj].vx += nx * force;
                    co[cj].vy += ny * force;
                    // Track ripple for each blob (keep strongest)
                    var rStr = overlap * rippleScale;
                    if (rStr > rippleData[ci].strength) {
                        // Angle of contact in blob i's local frame
                        var csi = Math.cos(rotations[ci]);
                        var sni = Math.sin(rotations[ci]);
                        var lxi = ddx * csi + ddy * sni;
                        var lyi = -ddx * sni + ddy * csi;
                        rippleData[ci].angle = Math.atan2(lyi, lxi);
                        rippleData[ci].strength = rStr;
                    }
                    if (rStr > rippleData[cj].strength) {
                        var csj = Math.cos(rotations[cj]);
                        var snj = Math.sin(rotations[cj]);
                        var lxj = -ddx * csj + -ddy * snj;
                        var lyj = ddx * snj + -ddy * csj;
                        rippleData[cj].angle = Math.atan2(lyj, lxj);
                        rippleData[cj].strength = rStr;
                    }
                }
            }
        }
        // Integrate and damp
        var damping = Math.pow(0.02 + 0.08 * (1.0 - bounciness), dt * 10); // lower bounciness = more damping
        var springBack = 2.0 + (1.0 - bounciness) * 3.0; // spring back to natural position
        for (var ui = 0; ui < 5; ui++) {
            // Spring force back to origin
            co[ui].vx -= co[ui].x * springBack * dt;
            co[ui].vy -= co[ui].y * springBack * dt;
            // Damping
            co[ui].vx *= damping;
            co[ui].vy *= damping;
            // Integrate
            co[ui].x += co[ui].vx * dt;
            co[ui].y += co[ui].vy * dt;
            // Smooth ripple
            var prevR = frame.state.collRipple[ui];
            var rSmooth = Math.min(1.0, dt * 8.0);
            prevR.angle = prevR.angle + (rippleData[ui].angle - prevR.angle) * rSmooth;
            prevR.strength = prevR.strength + (rippleData[ui].strength - prevR.strength) * rSmooth;
            collData[ui * 4 + 0] = co[ui].x;
            collData[ui * 4 + 1] = co[ui].y;
            collData[ui * 4 + 2] = prevR.angle;
            collData[ui * 4 + 3] = prevR.strength;
        }
    }
    else {
        // Collisions off: decay offsets to zero
        var co2 = frame.state.collOffsets;
        for (var di = 0; di < 5; di++) {
            co2[di].x *= Math.max(0, 1 - dt * 5);
            co2[di].y *= Math.max(0, 1 - dt * 5);
            co2[di].vx = 0;
            co2[di].vy = 0;
            frame.state.collRipple[di].strength *= Math.max(0, 1 - dt * 5);
            collData[di * 4 + 0] = co2[di].x;
            collData[di * 4 + 1] = co2[di].y;
            collData[di * 4 + 2] = frame.state.collRipple[di].angle;
            collData[di * 4 + 3] = frame.state.collRipple[di].strength;
        }
    }
    device.queue.writeBuffer(frame.state.uniformBuf, 0, new Float32Array([
        phase, blur, blobScale, istr,
        frame.output.width, frame.output.height, frame.params.seed, palRand,
        mx * frame.state.mouseInfluence, my * frame.state.mouseInfluence,
        frame.state.smoothVelX * frame.state.mouseInfluence,
        frame.state.smoothVelY * frame.state.mouseInfluence,
        bgR, bgG, bgB, bgA,
        c1R, c1G, c1B, c1A,
        c2R, c2G, c2B, c2A,
        c3R, c3G, c3B, c3A,
        c4R, c4G, c4B, c4A,
        collisionsEnabled ? 1.0 : 0.0, bounciness, 0, 0,
        collData[0], collData[1], collData[2], collData[3],
        collData[4], collData[5], collData[6], collData[7],
        collData[8], collData[9], collData[10], collData[11],
        collData[12], collData[13], collData[14], collData[15],
        collData[16], collData[17], collData[18], collData[19],
    ]));
    if (frame.state.pipelineFormat !== frame.output.format) {
        frame.state.pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: frame.state.shaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                        arrayStride: 16,
                        attributes: [
                            { shaderLocation: 0, format: 'float32x2', offset: 0 },
                            { shaderLocation: 1, format: 'float32x2', offset: 8 },
                        ],
                    }],
            },
            fragment: {
                module: frame.state.shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: frame.output.format }],
            },
            primitive: { topology: 'triangle-list' },
        });
        frame.state.pipelineFormat = frame.output.format;
    }
    var bindGroup = device.createBindGroup({
        layout: frame.state.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: frame.state.uniformBuf } },
        ],
    });
    var encoder = device.createCommandEncoder();
    var pass = encoder.beginRenderPass({
        colorAttachments: [{
                view: frame.output.createView(),
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                storeOp: 'store',
            }],
    });
    pass.setPipeline(frame.state.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, frame.state.quad);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);
}
defineProperties(Effect, {
    seed: {
        type: "number",
        label: "⬡ Seed",
        defaultValue: 8,
        control: "input",
        min: 0,
        max: 9999,
        step: 1,
    },
    blur: {
        type: "number",
        label: "⬡ Blur",
        defaultValue: 78,
        control: "slider",
        min: 0,
        max: 100,
        step: 1,
    },
    blobScale: {
        type: "number",
        label: "⬡ Blob Scale",
        defaultValue: 100,
        control: "slider",
        min: 50,
        max: 150,
        step: 1,
    },
    drift: {
        type: "number",
        label: "⬡ Drift",
        defaultValue: 32,
        control: "slider",
        min: 0,
        max: 100,
        step: 1,
    },
    interactionStrength: {
        type: "number",
        label: "⬡ Interaction Strength",
        defaultValue: 85,
        control: "slider",
        min: 0,
        max: 100,
        step: 1,
    },
    paletteRandomize: {
        type: "number",
        label: "◉ Palette Randomize",
        defaultValue: 0,
        control: "input",
        min: 0,
        max: 9999,
        step: 1,
    },
    background: {
        type: "color",
        label: "◉ Background",
        defaultValue: { r: 0.976, g: 0.800, b: 0.667, a: 1.0 },
    },
    blob1: {
        type: "color",
        label: "◉ Blob 1",
        defaultValue: { r: 1.0, g: 0.827, b: 0.416, a: 1.0 },
    },
    blob2: {
        type: "color",
        label: "◉ Blob 2",
        defaultValue: { r: 0.980, g: 0.478, b: 0.255, a: 1.0 },
    },
    blob3: {
        type: "color",
        label: "◉ Blob 3",
        defaultValue: { r: 0.945, g: 0.490, b: 0.596, a: 1.0 },
    },
    blob4: {
        type: "color",
        label: "◉ Blob 4",
        defaultValue: { r: 1.0, g: 0.880, b: 0.780, a: 1.0 },
    },
    collisions: {
        type: "boolean",
        label: "⟡ Collisions",
        defaultValue: false,
    },
    bounciness: {
        type: "number",
        label: "⟡ Bounciness",
        defaultValue: 50,
        control: "slider",
        min: 0,
        max: 100,
        step: 1,
    },
});

export const manifest = {
  "name": "Rad Soup",
  "version": 2,
  "isAnimated": true,
  "usesMouse": true
}
