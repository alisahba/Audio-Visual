// GPU particles and the scope figure. Both draw into a "sprite" layer that the
// paint pass mixes into the colour field, so what they leave behind is advected,
// faded and coloured exactly like the rest of the paint.
//
// Particle state lives in two float textures (128 × 128 = 16 384 particles):
//   A = position.xy, velocity.xy   (canvas space: x ∈ ±aspect/2, y ∈ ±0.5)
//   B = life (1 → 0), lifetime (s), palette position, random seed
// New particles are written into a ring buffer, so spawning needs no readback.

import { FULLSCREEN_VS, Program, createTarget, deleteTarget, type Format, type Formats, type Target } from './gl';
import { NOISE, PALETTE } from './shaders';

export const SIDE = 128;
export const MAX_PARTICLES = SIDE * SIDE;
const SCOPE_N = 256;
const SCOPE_SUB = 16;
const TRAIL_SUB = 3;

const UPDATE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
${NOISE}
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uVel;
uniform sampler2D uSpec;
uniform vec2 uSimTexel;
uniform float uAspect;
uniform float uDt;
uniform float uTime;
uniform int uMode;
uniform int uSpawnStart;
uniform int uSpawnCount;
uniform float uSpawnSeed;
uniform vec4 uEmit;   // x, y, spread, ring radius
uniform vec4 uPhys;   // speed, chaos, gravity, follow
uniform float uLife;
uniform float uColour;
uniform float uKick;
uniform float uFluidAmt;
uniform vec4 uFlow;   // speed, scale, evolve, seed
uniform vec4 uRide;   // drift velocity xy, zoom, spin

float specAt(float x) {
  float f = clamp(x, 0.0, 1.0) * 31.0;
  int i = int(floor(f));
  return mix(texelFetch(uSpec, ivec2(i, 0), 0).r, texelFetch(uSpec, ivec2(min(i + 1, 31), 0), 0).r, fract(f));
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int id = ij.y * ${SIDE} + ij.x;
  vec4 A = texelFetch(uA, ij, 0);
  vec4 B = texelFetch(uB, ij, 0);
  int rel = (id - uSpawnStart + ${MAX_PARTICLES}) % ${MAX_PARTICLES};
  if (rel < uSpawnCount) {
    float fid = float(id);
    float h1 = hash12(vec2(fid * 0.137, uSpawnSeed));
    float h2 = hash12(vec2(fid * 0.291 + 17.3, uSpawnSeed * 1.37 + 3.1));
    float h3 = hash12(vec2(fid * 0.713 + 5.7, uSpawnSeed + 11.0));
    float h4 = hash12(vec2(fid * 1.931 + 2.3, uSpawnSeed - 7.0));
    float sp = uPhys.x;
    vec2 pos;
    vec2 vel;
    float alive = 1.0;
    if (uMode == 0) {
      // Burst: a ring of sparks thrown out from one point.
      float a = h1 * 6.2831853;
      vec2 dir = vec2(cos(a), sin(a));
      pos = uEmit.xy + dir * sqrt(h2) * uEmit.z * 0.08;
      vel = dir * sp * (0.15 + 0.85 * pow(h3, 0.7)) * 1.4;
    } else if (uMode == 1) {
      // Fountain: a jet from the bottom edge.
      pos = vec2(uEmit.x + (h1 - 0.5) * (0.04 + uEmit.z * 0.5), -0.52);
      vel = vec2((h2 - 0.5) * (0.1 + uEmit.z) * sp * 0.7, sp * (0.75 + 0.6 * h3));
    } else if (uMode == 2) {
      // Swarm: anywhere, carried by the field.
      pos = vec2((h1 - 0.5) * uAspect, h2 - 0.5) * (0.35 + 0.65 * uEmit.z);
      vel = (vec2(h3, h4) - 0.5) * sp * 0.2;
    } else if (uMode == 3) {
      // Rain: from the top edge.
      pos = vec2((h1 - 0.5) * uAspect * 1.04, 0.51 + h2 * 0.03);
      vel = vec2((h4 - 0.5) * uEmit.z * 0.1, -sp * (0.45 + 0.9 * h3));
    } else {
      // Ring: each band fires from its own angle, as hard as it sounds.
      float u = h1;
      float e = specAt(u);
      alive = step(h4, e * 1.15);
      float a = 1.5707963 + (h2 < 0.5 ? 1.0 : -1.0) * u * 3.1415926;
      vec2 dir = vec2(cos(a), sin(a));
      pos = dir * (0.06 + uEmit.w * 0.36) + uEmit.xy;
      vel = dir * sp * (0.2 + e) * (0.6 + 0.6 * h3);
    }
    oA = vec4(pos, vel);
    float lifeK = uMode == 3 ? 1.8 : 1.0;
    oB = vec4(alive, uLife * lifeK * (0.55 + 0.9 * h2), uColour + (h3 - 0.5) * 0.3, h4);
    return;
  }
  if (B.x <= 0.0) {
    oA = A;
    oB = B;
    return;
  }
  vec2 pos = A.xy;
  vec2 vel = A.zw;
  // The motion section's field, so particles travel with the paint.
  vec2 uv = vec2(pos.x / uAspect + 0.5, pos.y + 0.5);
  vec2 ride = vec2(0.0);
  if (uFluidAmt > 0.0) {
    vec2 fv = texture(uVel, uv).xy * uSimTexel;
    ride += vec2(fv.x * uAspect, fv.y);
  }
  if (uFlow.x > 0.0) ride += curlNoise(pos * uFlow.y, uTime * uFlow.z + uFlow.w) * uFlow.x * 0.06;
  ride += uRide.xy + pos * uRide.z * 0.5 + vec2(-pos.y, pos.x) * uRide.w * 0.9;

  float chaos = uPhys.y * (1.0 + uKick * 2.0);
  vel += curlNoise(pos * 3.2 + B.w * 5.0, uTime * 0.4 + B.w * 9.0) * chaos * 0.35 * uDt;
  vel.y -= uPhys.z * 0.7 * uDt;
  if (uMode == 2) {
    vel += curlNoise(pos * 1.7, uTime * 0.25 + 4.0) * uPhys.x * (0.5 + uKick * 2.5) * 0.4 * uDt;
    vel -= pos * 0.12 * uDt;
  }
  vel *= exp(-uDt * (uMode == 0 ? 1.8 : 0.35 + uPhys.y * 0.5));
  pos += (vel + ride * uPhys.w) * uDt;
  float life = B.x - uDt / max(0.05, B.y);
  if (abs(pos.x) > uAspect * 0.5 + 0.1 || abs(pos.y) > 0.6) life = 0.0;
  oA = vec4(pos, vel);
  oB = vec4(max(life, 0.0), B.yzw);
}`;

const DRAW_VS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uAspect;
uniform float uSize;
uniform float uStep;
uniform int uSub;
out float vAlpha;
out float vCol;
void main() {
  int id = gl_VertexID;
  ivec2 ij = ivec2(id % ${SIDE}, id / ${SIDE});
  vec4 A = texelFetch(uA, ij, 0);
  vec4 B = texelFetch(uB, ij, 0);
  if (B.x <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vCol = 0.0;
    return;
  }
  // Sub-steps back along the velocity fill the gap since the last frame.
  float k = float(gl_InstanceID) / float(uSub);
  vec2 pos = A.xy - A.zw * uStep * k;
  gl_Position = vec4(pos.x / uAspect * 2.0, pos.y * 2.0, 0.0, 1.0);
  float life = B.x;
  gl_PointSize = max(1.5, uSize * (0.5 + B.w) * (0.3 + 0.7 * life));
  vAlpha = smoothstep(1.0, 0.94, life) * smoothstep(0.0, 0.3, life);
  vCol = B.z;
}`;

const DRAW_FS = `#version 300 es
precision highp float;
precision highp int;
in float vAlpha;
in float vCol;
out vec4 o;
uniform float uOpacity;
${PALETTE}
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.45, 1.0, r)) * vAlpha * uOpacity;
  o = vec4(palAt(vCol) * a, a);
}`;

const SCOPE_VS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uWave;
uniform float uAspect;
uniform vec4 uScope;   // scale, lag, spin angle, style
uniform float uGain;
uniform float uSize;
uniform vec2 uCentre;
out float vT;
float w1(float i) {
  i = mod(i, ${SCOPE_N}.0);
  int a = int(floor(i));
  return mix(texelFetch(uWave, ivec2(a, 0), 0).r, texelFetch(uWave, ivec2((a + 1) % ${SCOPE_N}, 0), 0).r, fract(i));
}
// Low-passed so the figure follows the bass and mids instead of the hiss.
float w(float i) {
  float s = w1(i) * 7.0;
  s += (w1(i - 1.0) + w1(i + 1.0)) * 6.0;
  s += (w1(i - 2.0) + w1(i + 2.0)) * 4.0;
  s += (w1(i - 3.0) + w1(i + 3.0)) * 2.0;
  s += (w1(i - 4.0) + w1(i + 4.0));
  return s / 33.0 * uGain;
}
void main() {
  float i = float(gl_VertexID) + float(gl_InstanceID) / ${SCOPE_SUB}.0;
  float t = i / ${SCOPE_N}.0;
  vec2 q;
  if (uScope.w < 0.5) {
    // Phase portrait: the signal against a delayed copy of itself.
    q = vec2(w(i), w(i + uScope.y)) * 0.42;
  } else {
    float a = t * 6.2831853 * 3.0;
    float r = 0.12 + t * 0.26 + w(i) * 0.12;
    q = vec2(cos(a), sin(a)) * r;
  }
  float c = cos(uScope.z);
  float s = sin(uScope.z);
  q = mat2(c, s, -s, c) * q * uScope.x + uCentre;
  gl_Position = vec4(q.x / uAspect * 2.0, q.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(1.5, uSize);
  vT = t;
}`;

const SCOPE_FS = `#version 300 es
precision highp float;
in float vT;
out vec4 o;
uniform float uOpacity;
uniform float uPalOff;
${PALETTE}
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.5, 1.0, r)) * uOpacity;
  o = vec4(palAt(uPalOff + vT * 2.0) * a, a);
}`;

export interface ParticleFrame {
  dt: number;
  time: number;
  aspect: number;
  mode: number;
  /** Particles to spawn this step. */
  spawn: number;
  emit: [number, number, number, number];
  phys: [number, number, number, number];
  life: number;
  colour: number;
  kick: number;
  size: number;
  opacity: number;
  fluid: WebGLTexture | null;
  simTexel: [number, number];
  spec: WebGLTexture;
  flow: [number, number, number, number];
  ride: [number, number, number, number];
  pal: Float32Array;
}

export interface ScopeFrame {
  wave: WebGLTexture;
  aspect: number;
  scale: number;
  lag: number;
  angle: number;
  style: number;
  gain: number;
  size: number;
  opacity: number;
  palOff: number;
  centre: [number, number];
}

interface StateFbo {
  a: WebGLTexture;
  b: WebGLTexture;
  fbo: WebGLFramebuffer;
}

export class Sprites {
  /** Layer the paint pass mixes in; cleared every step. */
  layer: Target | null = null;
  private state: [StateFbo, StateFbo];
  private update: Program;
  private draw: Program;
  private scope: Program;
  private quad: WebGLVertexArrayObject;
  private empty: WebGLVertexArrayObject;
  private cursor = 0;
  private seed = 0;
  private maxPoint = 64;
  /** Whether anything was drawn into the layer this step. */
  used = false;

  constructor(
    private gl: WebGL2RenderingContext,
    private formats: Formats,
  ) {
    const stateFmt: Format = formats.floatTextures ? { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, linear: false } : formats.half;
    const mk = (): StateFbo => {
      const tex = () => {
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, stateFmt.internal, SIDE, SIDE, 0, stateFmt.format, stateFmt.type, null);
        return t;
      };
      const a = tex();
      const b = tex();
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
      return { a, b, fbo };
    };
    this.state = [mk(), mk()];
    this.update = new Program(gl, FULLSCREEN_VS, UPDATE_FS, 'particles-update');
    this.draw = new Program(gl, DRAW_VS, DRAW_FS, 'particles-draw');
    this.scope = new Program(gl, SCOPE_VS, SCOPE_FS, 'scope');
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.empty = gl.createVertexArray()!;
    gl.bindVertexArray(null);
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
    if (range) this.maxPoint = range[1];
    this.reset();
  }

  resize(w: number, h: number): void {
    if (this.layer && this.layer.w === w && this.layer.h === h) return;
    deleteTarget(this.gl, this.layer);
    this.layer = createTarget(this.gl, w, h, this.formats.half);
  }

  reset(): void {
    const gl = this.gl;
    for (const s of this.state) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, SIDE, SIDE);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cursor = 0;
    this.seed = 0;
    this.clearLayer();
  }

  /** Start a step: empty the layer. */
  begin(): void {
    this.used = false;
  }

  private clearLayer(): void {
    const gl = this.gl;
    if (!this.layer) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.layer.fbo);
    gl.viewport(0, 0, this.layer.w, this.layer.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private target(): void {
    const gl = this.gl;
    if (!this.used) {
      this.clearLayer();
      this.used = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.layer!.fbo);
    gl.viewport(0, 0, this.layer!.w, this.layer!.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Advance the particles one step and draw them into the layer. */
  particles(fr: ParticleFrame): void {
    const gl = this.gl;
    if (!this.layer) return;
    const spawn = Math.max(0, Math.min(MAX_PARTICLES, Math.round(fr.spawn)));
    const [src, dst] = this.state;
    this.seed = (this.seed + 1) % 4096;
    const U = this.update.use();
    U.tex('uA', 0, src.a)
      .tex('uB', 1, src.b)
      .tex('uSpec', 3, fr.spec)
      .f('uSimTexel', ...fr.simTexel)
      .f('uAspect', fr.aspect)
      .f('uDt', fr.dt)
      .f('uTime', fr.time)
      .i('uMode', fr.mode)
      .i('uSpawnStart', this.cursor)
      .i('uSpawnCount', spawn)
      .f('uSpawnSeed', this.seed * 0.618 + 0.5)
      .f('uEmit', ...fr.emit)
      .f('uPhys', ...fr.phys)
      .f('uLife', fr.life)
      .f('uColour', fr.colour)
      .f('uKick', fr.kick)
      .f('uFluidAmt', fr.fluid ? 1 : 0)
      .f('uFlow', ...fr.flow)
      .f('uRide', ...fr.ride);
    if (fr.fluid) U.tex('uVel', 2, fr.fluid);
    else U.tex('uVel', 2, fr.spec);
    this.cursor = (this.cursor + spawn) % MAX_PARTICLES;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, SIDE, SIDE);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.state = [dst, src];

    this.target();
    this.draw
      .use()
      .tex('uA', 0, dst.a)
      .tex('uB', 1, dst.b)
      .f('uAspect', fr.aspect)
      .f('uSize', Math.min(this.maxPoint, fr.size))
      .f('uStep', fr.dt)
      .i('uSub', TRAIL_SUB)
      // "Over" blending saturates where sub-steps overlap, so each keeps full strength.
      .f('uOpacity', fr.opacity)
      .v3('uPal', fr.pal);
    gl.bindVertexArray(this.empty);
    gl.drawArraysInstanced(gl.POINTS, 0, MAX_PARTICLES, TRAIL_SUB);
    gl.disable(gl.BLEND);
  }

  /** Draw the scope figure into the layer. */
  drawScope(fr: ScopeFrame, pal: Float32Array): void {
    const gl = this.gl;
    if (!this.layer) return;
    this.target();
    this.scope
      .use()
      .tex('uWave', 0, fr.wave)
      .f('uAspect', fr.aspect)
      .f('uScope', fr.scale, fr.lag, fr.angle, fr.style)
      .f('uGain', fr.gain)
      .f('uSize', Math.min(this.maxPoint, fr.size))
      .f('uCentre', ...fr.centre)
      .f('uOpacity', fr.opacity)
      .f('uPalOff', fr.palOff)
      .v3('uPal', pal);
    gl.bindVertexArray(this.empty);
    gl.drawArraysInstanced(gl.POINTS, 0, SCOPE_N, SCOPE_SUB);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    const gl = this.gl;
    for (const s of this.state) {
      gl.deleteTexture(s.a);
      gl.deleteTexture(s.b);
      gl.deleteFramebuffer(s.fbo);
    }
    deleteTarget(gl, this.layer);
  }
}
