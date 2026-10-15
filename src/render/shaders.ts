// GLSL ES 3.00 sources for the simulation and post chain.

const HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 o;
`;

export const NOISE = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * snoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
vec2 curlNoise(vec2 p, float t) {
  const float e = 0.02;
  float n1 = snoise(vec3(p.x, p.y + e, t));
  float n2 = snoise(vec3(p.x, p.y - e, t));
  float n3 = snoise(vec3(p.x + e, p.y, t));
  float n4 = snoise(vec3(p.x - e, p.y, t));
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
`;

const PALETTE = `
uniform vec3 uPal[5];
vec3 palAt(float x) {
  x = mod(x, 5.0);
  int i = int(floor(x));
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(uPal[i], uPal[(i + 1) % 5], f);
}
vec3 ramp(float x) {
  x = clamp(x, 0.0, 1.0) * 4.0;
  int i = min(int(floor(x)), 3);
  return mix(uPal[i], uPal[i + 1], x - float(i));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// ── Fluid ──────────────────────────────────────────────────────────────────

export const SPLAT_FS = `${HEAD}
uniform sampler2D uVel;
uniform float uAspect;
uniform int uCount;
uniform vec4 uSplat[8];
uniform vec4 uSplatR[8];
void main() {
  vec2 v = texture(uVel, vUv).xy;
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    vec4 s = uSplat[i];
    vec2 d = vUv - s.xy;
    d.x *= uAspect;
    float g = exp(-dot(d, d) / uSplatR[i].x);
    if (uSplatR[i].y > 0.5) v += vec2(-d.y, d.x) * inversesqrt(uSplatR[i].x) * s.z * g;
    else v += s.zw * g;
  }
  o = vec4(v, 0.0, 1.0);
}`;

export const CURL_FS = `${HEAD}
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).y;
  float R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).y;
  float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture(uVel, vUv - vec2(0.0, uTexel.y)).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

export const VORTICITY_FS = `${HEAD}
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uStrength;
uniform float uDt;
void main() {
  float L = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uStrength * C;
  force.y *= -1.0;
  vec2 v = texture(uVel, vUv).xy + force * uDt;
  o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`;

export const DIVERGENCE_FS = `${HEAD}
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).y;
  float B = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;
  vec2 C = texture(uVel, vUv).xy;
  if (vUv.x - uTexel.x < 0.0) L = -C.x;
  if (vUv.x + uTexel.x > 1.0) R = -C.x;
  if (vUv.y + uTexel.y > 1.0) T = -C.y;
  if (vUv.y - uTexel.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

export const PRESSURE_FS = `${HEAD}
uniform sampler2D uP;
uniform sampler2D uDiv;
uniform vec2 uTexel;
void main() {
  float L = texture(uP, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uP, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uP, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture(uP, vUv - vec2(0.0, uTexel.y)).x;
  float d = texture(uDiv, vUv).x;
  o = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
}`;

export const GRADIENT_FS = `${HEAD}
uniform sampler2D uP;
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float L = texture(uP, vUv - vec2(uTexel.x, 0.0)).x;
  float R = texture(uP, vUv + vec2(uTexel.x, 0.0)).x;
  float T = texture(uP, vUv + vec2(0.0, uTexel.y)).x;
  float B = texture(uP, vUv - vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVel, vUv).xy - vec2(R - L, T - B);
  o = vec4(v, 0.0, 1.0);
}`;

export const ADVECT_VEL_FS = `${HEAD}
uniform sampler2D uVel;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 coord = vUv - uDt * texture(uVel, vUv).xy * uTexel;
  vec2 v = texture(uVel, coord).xy / (1.0 + uDissipation * uDt);
  o = vec4(v, 0.0, 1.0);
}`;

export const SCALE_FS = `${HEAD}
uniform sampler2D uTex;
uniform float uScale;
void main() { o = texture(uTex, vUv) * uScale; }`;

export const CLEAR_FS = `${HEAD}
uniform vec4 uValue;
void main() { o = uValue; }`;

// ── Paint: advect the colour field, decay it, and emit new colour ───────────

export const PAINT_FS = `${HEAD}
${NOISE}
${PALETTE}
uniform sampler2D uDye;
uniform sampler2D uVel;
uniform sampler2D uWave;
uniform sampler2D uSpec;
uniform vec2 uSimTexel;
uniform vec2 uRef;
uniform float uAspect;
uniform float uDt;
uniform float uTime;
uniform float uSeed;
uniform float uLowPrec;

uniform float uFluidAmt;
uniform vec4 uFlow;
uniform vec4 uDrift;
uniform float uDriftCols;
uniform vec2 uWarp;
uniform float uLifeRate;
uniform float uBleed;
uniform float uPalOff;

uniform int uOrbCount;
uniform int uOrbShape;
uniform vec4 uOrbs[6];
uniform float uOrbAlpha;

uniform vec4 uSpecP;
uniform float uSpecGain;

uniform vec4 uWaveP;
uniform float uWaveThick;

uniform int uDropCount;
uniform vec4 uDrops[12];
uniform vec3 uDropCol[12];

uniform vec4 uCloud;

void over(inout vec4 acc, vec3 c, float a) {
  a = clamp(a, 0.0, 1.0);
  acc.rgb = c * a + acc.rgb * (1.0 - a);
  acc.a = a + acc.a * (1.0 - a);
}
float rate(float a) { return 1.0 - pow(1.0 - clamp(a, 0.0, 0.999), uDt * 30.0); }

float specAt(float x) {
  float f = clamp(x, 0.0, 1.0) * 31.0;
  int i = int(floor(f));
  float a = texelFetch(uSpec, ivec2(i, 0), 0).r;
  float b = texelFetch(uSpec, ivec2(min(i + 1, 31), 0), 0).r;
  return mix(a, b, fract(f));
}
float waveAt(float x) {
  float f = clamp(x, 0.0, 1.0) * 255.0;
  int i = int(floor(f));
  float a = texelFetch(uWave, ivec2(i, 0), 0).r;
  float b = texelFetch(uWave, ivec2(min(i + 1, 255), 0), 0).r;
  return mix(a, b, fract(f));
}

void main() {
  vec2 uv = vUv;
  vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5);

  // Combined velocity field in uv / second.
  vec2 vel = texture(uVel, uv).xy * uSimTexel * uFluidAmt;
  if (uFlow.x > 0.0) {
    vec2 c = curlNoise(p * uFlow.y, uTime * uFlow.z + uSeed);
    c.x /= uAspect;
    vel += c * uFlow.x * 0.06;
  }
  if (uDrift.z > 0.0) {
    vec2 dir = uDrift.xy;
    vec2 perp = vec2(-dir.y, dir.x);
    float across = dot(p, perp) * uDriftCols;
    float col = floor(across);
    float hc = hash12(vec2(col, uSeed));
    float stepN = hash12(vec2(col * 1.31, floor(uTime * 0.35 + hc * 3.0) + uSeed));
    float wide = vnoise(vec2(across * 0.15, uTime * 0.1 + uSeed));
    float n = stepN * 0.7 + wide * 0.6;
    float sp = uDrift.z * mix(1.0, n * 1.55, uDrift.w);
    vec2 v = dir * sp * 0.45;
    v.x /= uAspect;
    vel += v;
  }
  if (uWarp.x != 0.0 || uWarp.y != 0.0) {
    vec2 v = p * uWarp.x * 0.5 + vec2(-p.y, p.x) * uWarp.y * 0.9;
    v.x /= uAspect;
    vel += v;
  }

  vec2 src = uv - vel * uDt;
  vec4 prev = texture(uDye, src);
  if (uBleed > 0.0) {
    vec2 r = uRef * (1.0 + uBleed * 3.0);
    vec4 nb = texture(uDye, src + vec2(r.x, 0.0)) + texture(uDye, src - vec2(r.x, 0.0))
            + texture(uDye, src + vec2(0.0, r.y)) + texture(uDye, src - vec2(0.0, r.y));
    prev = mix(prev, nb * 0.25, clamp(uBleed * uDt * 40.0, 0.0, 1.0));
  }
  prev *= step(0.0, src.x) * step(src.x, 1.0) * step(0.0, src.y) * step(src.y, 1.0);

  // Ageing: alpha is remaining life. Stochastic rounding keeps half floats moving.
  float life = prev.a;
  float jitter = (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * uLowPrec;
  float nl = max(life - uLifeRate * uDt * (1.0 + jitter), 0.0);
  prev *= life > 1e-6 ? nl / life : 0.0;

  vec4 acc = vec4(0.0);

  // Cloud
  if (uCloud.x > 0.0) {
    float n = fbm(vec3(p * uCloud.y, uCloud.w)) * 0.5 + 0.5;
    float a = smoothstep(uCloud.z, uCloud.z + 0.16, n) * uCloud.x;
    over(acc, palAt(uPalOff + n * 3.0 + 0.5), a * min(1.0, uDt * 2.5));
  }

  // Spectrum
  if (uSpecP.x > 0.5) {
    int lay = int(uSpecP.y + 0.5);
    float pos = uSpecP.z;
    float th = uSpecP.w;
    float a = 0.0;
    float band = 0.0;
    if (lay == 0) {
      float y0 = pos - th;
      float y1 = pos + th;
      if (uv.y > y0 && uv.y < y1) {
        band = (uv.y - y0) / (y1 - y0);
        float v = specAt(band) * uSpecGain;
        float edge = abs(uv.x - 0.5) * 2.0;
        float torn = (vnoise(vec2(uv.x * 48.0, band * 32.0 + uTime * 3.0)) - 0.5) * 0.3;
        a = smoothstep(edge - 0.04, edge + 0.04, v * 1.05 + torn - 0.12) * smoothstep(0.05, 0.3, v) * min(1.0, v * 0.9);
        float st = fract(band * 32.0);
        a *= mix(1.0, smoothstep(0.0, 0.2, st) * smoothstep(1.0, 0.8, st), 0.5);
      }
    } else if (lay == 1) {
      band = uv.x;
      float v = specAt(band) * uSpecGain;
      float h = v * th;
      a = 1.0 - smoothstep(h - uRef.y * 2.0, h, abs(uv.y - pos));
      float st = fract(band * 32.0);
      a *= smoothstep(0.0, 0.12, st) * smoothstep(1.0, 0.88, st) * smoothstep(0.03, 0.2, v);
    } else if (lay == 2) {
      float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
      band = abs(ang * 2.0 - 1.0);
      float v = specAt(band) * uSpecGain;
      float base = pos * 0.42;
      float w = v * th * 0.5 + 0.002;
      a = 1.0 - smoothstep(w * 0.8, w, abs(length(p) - base - w));
      a *= smoothstep(0.03, 0.2, v);
    } else {
      band = abs(uv.x - 0.5) * 2.0;
      float v = specAt(band) * uSpecGain;
      float w = v * th * 0.5;
      a = 1.0 - smoothstep(w * 0.6, w + uRef.y, abs(uv.y - pos));
      a *= smoothstep(0.03, 0.2, v);
    }
    over(acc, palAt(uPalOff + band * 4.0), rate(a * 0.95));
  }

  // Orbs
  for (int i = 0; i < 6; i++) {
    if (i >= uOrbCount) break;
    vec4 ob = uOrbs[i];
    vec2 d = p - ob.xy;
    float r = ob.z;
    float sd;
    if (uOrbShape == 1) {
      vec2 q = d;
      float hh = r * 0.9;
      q.y -= clamp(q.y, -hh, hh);
      sd = length(q) - r * 0.72;
    } else if (uOrbShape == 2) {
      sd = abs(length(d) - r) - r * 0.14;
    } else {
      sd = length(d) - r;
    }
    float e = max(0.003, r * ob.w * 0.9);
    float a = 1.0 - smoothstep(-e, e * 0.6, sd);
    float gy = clamp(d.y / (r * 1.8) * 0.5 + 0.5, 0.0, 1.0);
    vec3 c = mix(palAt(uPalOff + float(i) + 1.0), palAt(uPalOff + float(i)), gy);
    over(acc, c, rate(a * uOrbAlpha));
  }

  // Waveform
  if (uWaveP.x > 0.5) {
    int ori = int(uWaveP.y + 0.5);
    float pos = uWaveP.z;
    float amp = uWaveP.w;
    float d;
    if (ori == 0) {
      d = abs(uv.y - pos - waveAt(uv.x) * amp * 0.5);
    } else if (ori == 1) {
      d = abs(uv.x - pos - waveAt(uv.y) * amp * 0.5 / uAspect) * uAspect;
    } else {
      float ang = atan(p.y, p.x) / 6.2831853 + 0.5;
      float R = pos * 0.42 + waveAt(abs(ang * 2.0 - 1.0)) * amp * 0.25;
      d = abs(length(p) - R);
    }
    float a = 1.0 - smoothstep(uWaveThick * 0.5, uWaveThick * 0.5 + uRef.y * 1.5, d);
    over(acc, palAt(uPalOff + 2.0), a);
  }

  // Beat ink drops
  for (int i = 0; i < 12; i++) {
    if (i >= uDropCount) break;
    vec4 dr = uDrops[i];
    vec2 d = p - dr.xy;
    float n = snoise(vec3(d * 3.5 / max(dr.z, 0.05), float(i) * 7.3 + uSeed));
    float dist = length(d) * (1.0 + n * 0.25);
    float a = 1.0 - smoothstep(dr.z * 0.25, dr.z, dist);
    over(acc, uDropCol[i], rate(a * dr.w * 0.4));
  }

  o = acc + prev * (1.0 - acc.a);
}`;

// ── Composite: colour field → image (UV effects, blend, colour mapping) ─────

export const COMPOSITE_FS = `${HEAD}
${NOISE}
${PALETTE}
uniform sampler2D uDye;
uniform vec3 uBg;
uniform float uAspect;
uniform float uTime;
uniform float uFadeFrac;
uniform float uIntro;
uniform int uMode;
uniform int uBlend;
uniform float uHue;
uniform float uSat;
uniform float uContrast;
uniform float uExposure;
uniform vec4 uMirror;
uniform vec4 uStretch;
uniform float uStretchCols;
uniform vec4 uGlitch;
uniform vec4 uChroma;

vec2 mirrorUv(vec2 uv) {
  if (uMirror.x < 0.5) return uv;
  int m = int(uMirror.y + 0.5);
  if (m == 0) uv.x = 0.5 - abs(uv.x - 0.5);
  else if (m == 1) uv.y = 0.5 + abs(uv.y - 0.5);
  else if (m == 2) {
    uv.x = 0.5 - abs(uv.x - 0.5);
    uv.y = 0.5 + abs(uv.y - 0.5);
  } else {
    vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y - 0.5);
    float r = length(p);
    float a = atan(p.y, p.x) + uMirror.w * 6.2831853;
    float seg = 6.2831853 / max(uMirror.z, 1.0);
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    p = vec2(cos(a), sin(a)) * r;
    uv = vec2(p.x / uAspect + 0.5, p.y + 0.5);
  }
  return uv;
}

vec2 stretchUv(vec2 uv) {
  if (uStretch.x < 0.5) return uv;
  int dir = int(uStretch.y + 0.5);
  float along = dir == 0 ? 1.0 - uv.y : dir == 1 ? uv.y : dir == 2 ? 1.0 - uv.x : uv.x;
  float across = dir < 2 ? uv.x : uv.y;
  float col = floor(across * uStretchCols);
  float n = vnoise(vec2(col * 0.37, uTime * 0.5)) - 0.5;
  float n2 = hash12(vec2(col, floor(uTime * 4.0))) - 0.5;
  float c = uStretch.z + uStretch.w * (n * 0.8 + n2 * 0.2);
  along = min(along, c);
  if (dir == 0) uv.y = 1.0 - along;
  else if (dir == 1) uv.y = along;
  else if (dir == 2) uv.x = 1.0 - along;
  else uv.x = along;
  return uv;
}

vec2 glitchUv(vec2 uv) {
  float amt = uGlitch.x;
  if (amt <= 0.001) return uv;
  float blocks = uGlitch.y;
  float seed = uGlitch.w;
  vec2 g = floor(vec2(uv.x * blocks * 0.5 * uAspect, uv.y * blocks));
  float r = hash12(g + seed * 13.1);
  if (r < amt * 0.5) uv.x += (hash12(g * 1.7 + seed) - 0.5) * uGlitch.z * 0.35;
  float row = hash12(vec2(floor(uv.y * blocks * 3.0), seed * 7.7));
  if (row < amt * 0.2) uv.x += (hash12(vec2(row, seed)) - 0.5) * uGlitch.z * 0.6;
  return uv;
}

vec3 shade(vec2 uv) {
  vec4 d = texture(uDye, uv);
  float life = d.a;
  vec3 col = life > 1e-5 ? d.rgb / life : vec3(0.0);
  float op = smoothstep(0.0, max(uFadeFrac, 1e-3), life) * uIntro;
  if (uBlend == 1) return uBg + col * op;
  if (uBlend == 2) return mix(uBg, uBg * col, op);
  if (uBlend == 3) return 1.0 - (1.0 - uBg) * (1.0 - col * op);
  return mix(uBg, col, op);
}

vec3 hueRotate(vec3 c, float a) {
  const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYiq * c;
  float cs = cos(a);
  float sn = sin(a);
  yiq.yz = mat2(cs, sn, -sn, cs) * yiq.yz;
  return toRgb * yiq;
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = glitchUv(stretchUv(mirrorUv(vUv)));
  vec3 c;
  if (uChroma.x > 0.0) {
    vec2 dir = vec2(cos(uChroma.y), sin(uChroma.y)) * uChroma.x * 0.012;
    vec2 rad = (vUv - 0.5) * uChroma.x * 0.03;
    vec2 off = mix(dir, rad, uChroma.z);
    c = vec3(shade(uv + off).r, shade(uv).g, shade(uv - off).b);
  } else {
    c = shade(uv);
  }
  if (uMode == 1) c = ramp(luma(c));
  else if (uMode == 2) {
    float l = luma(c);
    c = hsv2rgb(vec3(fract(l * 0.85 + uTime * 0.01), 0.85, 0.25 + 0.8 * l));
  }
  if (uHue != 0.0) c = hueRotate(c, uHue);
  float l = luma(c);
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c *= exp2(uExposure);
  o = vec4(max(c, 0.0), 1.0);
}`;

// ── Dual-Kawase blur chain (blur + bloom) ───────────────────────────────────

export const DOWN_FS = `${HEAD}
uniform sampler2D uTex;
uniform vec2 uHalf;
uniform float uOff;
uniform float uPrefilter;
uniform float uThreshold;
vec3 pre(vec3 c) {
  if (uPrefilter < 0.5) return c;
  float br = max(c.r, max(c.g, c.b));
  float knee = 0.25;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  return c * max(soft, br - uThreshold) / max(br, 1e-4);
}
void main() {
  vec2 h = uHalf * uOff;
  vec3 s = pre(texture(uTex, vUv).rgb) * 4.0;
  s += pre(texture(uTex, vUv - h).rgb);
  s += pre(texture(uTex, vUv + h).rgb);
  s += pre(texture(uTex, vUv + vec2(h.x, -h.y)).rgb);
  s += pre(texture(uTex, vUv - vec2(h.x, -h.y)).rgb);
  o = vec4(s / 8.0, 1.0);
}`;

export const UP_FS = `${HEAD}
uniform sampler2D uTex;
uniform sampler2D uBase;
uniform vec2 uHalf;
uniform float uOff;
uniform float uAdd;
void main() {
  vec2 h = uHalf * uOff;
  vec3 s = texture(uTex, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture(uTex, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture(uTex, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture(uTex, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture(uTex, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture(uTex, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture(uTex, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture(uTex, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  s /= 12.0;
  if (uAdd > 0.5) s += texture(uBase, vUv).rgb;
  o = vec4(s, 1.0);
}`;

// ── Final: surface effects, to screen ───────────────────────────────────────

export const FINAL_FS = `${HEAD}
${NOISE}
${PALETTE}
uniform sampler2D uComp;
uniform sampler2D uBlur;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uPx;
uniform float uAspect;
uniform float uFrame;
uniform float uBlurMix;
uniform float uBloomInt;
uniform vec4 uContour;
uniform int uContourInk;
uniform vec4 uDither;
uniform int uDitherStyle;
uniform vec4 uGrain;
uniform vec2 uVignette;

float bayer8(ivec2 p) {
  int x = p.x & 7;
  int y = p.y & 7;
  int xy = x ^ y;
  int v = ((xy & 1) << 5) | ((y & 1) << 4) | ((xy & 2) << 2) | ((y & 2) << 1) | ((xy & 4) >> 1) | ((y & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float rand3(ivec3 p) {
  return float(pcg(uint(p.x) + pcg(uint(p.y) + pcg(uint(p.z))))) / 4294967295.0;
}

void main() {
  vec2 uv = vUv;
  vec3 c = texture(uComp, uv).rgb;
  if (uBlurMix > 0.0) c = mix(c, texture(uBlur, uv).rgb, uBlurMix);
  if (uBloomInt > 0.0) c += texture(uBloom, uv).rgb * uBloomInt;

  if (uContour.x > 0.0) {
    float l = luma(clamp(c, 0.0, 1.0)) * uContour.y;
    float d = abs(fract(l - 0.5) - 0.5) / max(fwidth(l), 1e-4);
    float w = 0.4 + uContour.z * 3.5 * uPx;
    float line = 1.0 - clamp(d - w + 0.5, 0.0, 1.0);
    vec3 ink = uContourInk == 0 ? uPal[2] : uContourInk == 1 ? vec3(0.04) : uContourInk == 2 ? vec3(0.97) : 1.0 - c;
    c = mix(c, ink, line * uContour.w);
  }

  if (uDither.x > 0.0) {
    vec2 fc = gl_FragCoord.xy / max(1.0, uDither.z * uPx);
    float levels = max(2.0, uDither.y) - 1.0;
    vec3 q;
    if (uDitherStyle == 2) {
      float cell = 4.0;
      mat2 rot = mat2(0.7071, 0.7071, -0.7071, 0.7071);
      vec2 g = rot * fc / cell;
      vec2 f = fract(g) - 0.5;
      float l = luma(clamp(c, 0.0, 1.0));
      float r = sqrt(l) * 0.62;
      float aa = 0.08;
      float dotm = 1.0 - smoothstep(r - aa, r + aa, length(f));
      q = mix(c * 0.12, c * 1.15, dotm);
    } else {
      float t = uDitherStyle == 0 ? bayer8(ivec2(fc)) : rand3(ivec3(ivec2(fc), int(uFrame)));
      q = floor(c * levels + t) / levels;
    }
    c = mix(c, q, uDither.w);
  }

  if (uGrain.x > 0.0) {
    ivec2 gp = ivec2(gl_FragCoord.xy / max(1.0, uGrain.y * uPx));
    int f = int(uFrame);
    float n = rand3(ivec3(gp, f)) - 0.5;
    vec3 nc = vec3(rand3(ivec3(gp, f + 7919)), rand3(ivec3(gp, f + 15485)), rand3(ivec3(gp, f + 32452))) - 0.5;
    vec3 g = mix(vec3(n), nc, uGrain.z);
    float mid = 0.35 + 0.65 * (1.0 - abs(luma(clamp(c, 0.0, 1.0)) - 0.5) * 2.0);
    c += g * uGrain.x * 0.32 * mid;
  }

  if (uVignette.x > 0.0) {
    vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0);
    float d = length(p) * 1.414;
    float v = 1.0 - smoothstep(1.0 - uVignette.y * 0.9 - 0.05, 1.05, d);
    c *= mix(1.0, v, uVignette.x);
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
