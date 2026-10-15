import { modulated } from '../state/modulate';
import type { Project } from '../state/project';
import { aspectRatio } from '../state/project';
import type { Features } from '../audio/features';
import { WAVE_SIZE } from '../audio/features';
import { BAND_COUNT } from '../audio/bands';
import {
  FULLSCREEN_VS,
  PingPong,
  Program,
  createTarget,
  deleteTarget,
  pickFormats,
  type Formats,
  type Target,
} from './gl';
import * as S from './shaders';

const SIM_LONG = 192;
const MAX_DROPS = 12;
const LEVELS = 6;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}

/** Deterministic PRNG (mulberry32). */
export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash1(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface MediaFrame {
  source: TexImageSource;
  /** Bumped whenever the pixels change, so unchanged images aren't re-uploaded. */
  version: number;
  /** Width / height. */
  aspect: number;
  /** True for stylised hand / face / body masks (alpha carries the shape). */
  mask: boolean;
  mirror?: boolean;
}

interface Drop {
  x: number;
  y: number;
  r: number;
  age: number;
  life: number;
  col: [number, number, number];
}

interface Splat {
  x: number;
  y: number;
  dx: number;
  dy: number;
  r: number;
  radial: boolean;
}

export interface RendererOptions {
  preserveDrawingBuffer?: boolean;
}

/**
 * GPU pipeline:
 *   fluid sim (velocity) ─┐
 *   paint (advect + age + emit) → dye ⟲
 *   composite (mirror/stretch/glitch/rgb split, blend, colour map)
 *   blur + bloom (dual Kawase) → final (contour, dither, grain, vignette) → canvas
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly formats: Formats;
  width = 0;
  height = 0;
  dyeW = 0;
  dyeH = 0;
  simW = 0;
  simH = 0;
  /** Simulation clock (s) since reset. */
  simTime = 0;
  frame = 0;

  private vao: WebGLVertexArrayObject;
  private progs: Record<string, Program> = {};
  private vel!: PingPong;
  private pressure!: PingPong;
  private divergence!: Target;
  private curl!: Target;
  private dye!: PingPong;
  private comp!: Target;
  private blurDown: Target[] = [];
  private blurUp: Target[] = [];
  private bloomDown: Target[] = [];
  private bloomUp: Target[] = [];
  private waveTex: WebGLTexture;
  private specTex: WebGLTexture;

  private drops: Drop[] = [];
  private ripples: { x: number; y: number; age: number }[] = [];
  private sliceSeed = 0;
  private barAge = 10;
  private mediaTex: WebGLTexture;
  private mediaVersion = -1;
  /** Current media frame (image, video, camera or stylised mask), set by the media manager. */
  media: MediaFrame | null = null;
  private splats: Splat[] = [];
  private rand = mulberry(1);
  private seed = 1;
  private palOff = 0;
  private palTarget = 0;
  private prevOrbs: number[] = [];
  private stirAcc = 0;
  private glitchSeed = 0;
  private lastDrop: { x: number; y: number } | null = null;
  private pal = new Float32Array(15);
  private features: Features | null = null;
  private project: Project | null = null;
  private lost = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: RendererOptions = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.formats = pickFormats(gl);
    if ('addEventListener' in canvas) {
      (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.lost = true;
      });
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    const P = (name: string, fs: string) => (this.progs[name] = new Program(gl, FULLSCREEN_VS, fs, name));
    P('splat', S.SPLAT_FS);
    P('curl', S.CURL_FS);
    P('vort', S.VORTICITY_FS);
    P('div', S.DIVERGENCE_FS);
    P('pres', S.PRESSURE_FS);
    P('grad', S.GRADIENT_FS);
    P('advVel', S.ADVECT_VEL_FS);
    P('scale', S.SCALE_FS);
    P('clear', S.CLEAR_FS);
    P('paint', S.PAINT_FS);
    P('comp', S.COMPOSITE_FS);
    P('down', S.DOWN_FS);
    P('buoy', S.BUOY_FS);
    P('up', S.UP_FS);
    P('final', S.FINAL_FS);

    const mkData = (w: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, 1, 0, gl.RED, gl.FLOAT, new Float32Array(w));
      return t;
    };
    this.waveTex = mkData(WAVE_SIZE);
    this.specTex = mkData(BAND_COUNT);
    this.mediaTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.mediaTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }

  get contextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  // ── Sizing ────────────────────────────────────────────────────────────

  resize(width: number, height: number, dyeScale = 1): void {
    width = Math.max(16, Math.round(width));
    height = Math.max(16, Math.round(height));
    const gl = this.gl;
    const aspect = width / height;
    const simW = aspect >= 1 ? SIM_LONG : Math.round(SIM_LONG * aspect);
    const simH = aspect >= 1 ? Math.round(SIM_LONG / aspect) : SIM_LONG;
    const longest = Math.max(width, height) * dyeScale;
    const cap = Math.min(1, 2048 / longest);
    const dyeW = Math.max(16, Math.round(width * dyeScale * cap));
    const dyeH = Math.max(16, Math.round(height * dyeScale * cap));

    const outChanged = width !== this.width || height !== this.height;
    const simChanged = simW !== this.simW || simH !== this.simH;
    const dyeChanged = dyeW !== this.dyeW || dyeH !== this.dyeH;
    if (!outChanged && !simChanged && !dyeChanged) return;

    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    if (simChanged) {
      this.vel?.dispose(gl);
      this.pressure?.dispose(gl);
      deleteTarget(gl, this.divergence);
      deleteTarget(gl, this.curl);
      const h = this.formats.half;
      this.vel = new PingPong(gl, simW, simH, h);
      this.pressure = new PingPong(gl, simW, simH, h);
      this.divergence = createTarget(gl, simW, simH, h);
      this.curl = createTarget(gl, simW, simH, h);
      this.simW = simW;
      this.simH = simH;
    }
    if (dyeChanged) {
      const old = this.dye;
      this.dye = new PingPong(gl, dyeW, dyeH, this.formats.dye);
      if (old) {
        // Carry the picture over when the preview is resized.
        this.blitTo(old.read.tex, this.dye.read);
        old.dispose(gl);
      }
      this.dyeW = dyeW;
      this.dyeH = dyeH;
    }
    if (outChanged) {
      deleteTarget(gl, this.comp);
      for (const t of [...this.blurDown, ...this.blurUp, ...this.bloomDown, ...this.bloomUp]) deleteTarget(gl, t);
      this.comp = createTarget(gl, width, height, this.formats.half);
      this.blurDown = [];
      this.blurUp = [];
      this.bloomDown = [];
      this.bloomUp = [];
      let w = width;
      let h = height;
      for (let i = 0; i < LEVELS; i++) {
        w = Math.max(2, Math.ceil(w / 2));
        h = Math.max(2, Math.ceil(h / 2));
        this.blurDown.push(createTarget(gl, w, h, this.formats.half));
        this.blurUp.push(createTarget(gl, w, h, this.formats.half));
        this.bloomDown.push(createTarget(gl, w, h, this.formats.half));
        this.bloomUp.push(createTarget(gl, w, h, this.formats.half));
      }
      this.width = width;
      this.height = height;
    }
  }

  private draw(target: Target | null): void {
    const gl = this.gl;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private blitTo(tex: WebGLTexture, target: Target): void {
    this.progs.scale.use().tex('uTex', 0, tex).f('uScale', 1);
    this.draw(target);
  }

  private clearTarget(t: Target, v: [number, number, number, number] = [0, 0, 0, 0]): void {
    this.progs.clear.use().f('uValue', ...v);
    this.draw(t);
  }

  // ── State ─────────────────────────────────────────────────────────────

  reset(seed: number): void {
    this.seed = seed;
    this.rand = mulberry(seed * 9973 + 17);
    this.simTime = 0;
    this.frame = 0;
    this.drops = [];
    this.splats = [];
    this.palOff = 0;
    this.palTarget = 0;
    this.prevOrbs = [];
    this.stirAcc = 0;
    this.glitchSeed = 0;
    this.ripples = [];
    this.sliceSeed = 0;
    this.barAge = 10;
    this.lastDrop = null;
    for (const pp of [this.vel, this.pressure, this.dye]) {
      if (!pp) continue;
      this.clearTarget(pp.read);
      this.clearTarget(pp.write);
    }
  }

  /** Effective value of a numeric param after audio drive. */
  private val(fx: string, key: string): number {
    return modulated(this.project!, this.features, fx, key);
  }

  private on(fx: string): boolean {
    return !!this.project?.fx[fx]?.on;
  }

  private sel(fx: string, key: string): string {
    return this.project!.fx[fx].p[key] as string;
  }

  /** Advance the simulation by dt seconds. */
  step(dt: number, f: Features, project: Project): void {
    this.features = f;
    this.project = project;
    const aspect = aspectRatio(project.aspect);
    const rnd = this.rand;
    this.simTime += dt;
    const t = this.simTime;

    for (let i = 0; i < 5; i++) {
      const c = hexToRgb(project.palette[i] ?? '#ffffff');
      this.pal.set(c, i * 3);
    }

    // Colour cycling.
    const cycle = this.sel('colour', 'cycle');
    if (cycle === 'beat' && f.beatNow) this.palTarget += 1;
    else if (cycle === 'bar' && f.barNow) this.palTarget += 1;
    else if (cycle === 'time') this.palTarget = t * 0.25;
    this.palOff += (this.palTarget - this.palOff) * (1 - Math.exp(-dt / 0.25));
    if (cycle === 'off') this.palOff = this.palTarget = 0;

    // Beat ink drops.
    const every = Number(this.sel('ink', 'every')) || 1;
    if (this.on('ink') && f.beatNow && f.beatCount % every === 0) {
      const n = Math.round(this.val('ink', 'drops'));
      const size = this.val('ink', 'size');
      const life = this.val('ink', 'bleed');
      const placement = this.sel('ink', 'placement');
      const ci = cycle === 'off' ? Math.floor(rnd() * 5) : Math.round(this.palTarget) % 5;
      for (let i = 0; i < n; i++) {
        let x = (rnd() - 0.5) * aspect * 0.85;
        let y = (rnd() - 0.5) * 0.85;
        if (placement === 'centre') {
          x = (rnd() - 0.5) * 0.12 * aspect;
          y = (rnd() - 0.5) * 0.12;
        } else if (placement === 'edges') {
          const side = Math.floor(rnd() * 4);
          const u = rnd() - 0.5;
          x = side < 2 ? (side === 0 ? -0.5 : 0.5) * aspect * 0.95 : u * aspect;
          y = side >= 2 ? (side === 2 ? -0.5 : 0.5) * 0.95 : u;
        } else if (placement === 'rise') {
          y = -0.42 + rnd() * 0.12;
        }
        const colIdx = (ci + i) % 5;
        const col: [number, number, number] = [this.pal[colIdx * 3], this.pal[colIdx * 3 + 1], this.pal[colIdx * 3 + 2]];
        this.drops.push({ x, y, r: size * (0.75 + rnd() * 0.5) * 0.5, age: 0, life, col });
        this.lastDrop = { x, y };
        if (this.on('fluid')) {
          // A vortex survives the pressure projection, so drops marble the paint around them.
          const push = this.val('ink', 'push') * 1400 * (0.5 + this.val('fluid', 'force')) * (rnd() < 0.5 ? -1 : 1);
          this.splats.push({ x: x / aspect + 0.5, y: y + 0.5, dx: push, dy: 0, r: (size * size * 0.05 + 0.002) * this.splatScale(), radial: true });
        }
      }
      while (this.drops.length > MAX_DROPS) this.drops.shift();
    }
    for (const d of this.drops) d.age += dt;
    this.drops = this.drops.filter((d) => d.age < d.life);

    // Orbs: deterministic orbit paths.
    const orbData = new Float32Array(24);
    let orbCount = 0;
    if (this.on('orbs')) {
      orbCount = Math.round(this.val('orbs', 'count'));
      const size = this.val('orbs', 'size');
      const speed = project.fx.orbs.p.speed as number;
      const spread = this.val('orbs', 'spread');
      const soft = this.val('orbs', 'soft');
      for (let i = 0; i < orbCount; i++) {
        const h = hash1(i + this.seed * 3.1);
        const ph = h * Math.PI * 2;
        const w = speed * (0.35 + h * 0.4);
        const base = orbCount === 1 ? 0 : spread * 0.36;
        const ang = (i / orbCount) * Math.PI * 2 + t * w * 0.6 + ph;
        const wob = spread * 0.08;
        const x = Math.cos(ang) * base * aspect * 0.8 + Math.sin(t * w * 1.3 + ph * 2) * wob;
        const y = Math.sin(ang * 0.8 + ph) * base + Math.cos(t * w * 0.9 + ph) * wob;
        const r = size * 0.5 * (orbCount === 1 ? 1 : 0.7 + hash1(i * 7.7 + this.seed) * 0.5);
        orbData.set([x, y, r, soft], i * 4);
        const px = this.prevOrbs[i * 2];
        const py = this.prevOrbs[i * 2 + 1];
        if (this.on('fluid') && px !== undefined && dt > 0) {
          const k = 900 * this.val('fluid', 'force');
          const vx = ((x - px) / dt) * k;
          const vy = ((y - py) / dt) * k;
          if (vx * vx + vy * vy > 1) this.splats.push({ x: x / aspect + 0.5, y: y + 0.5, dx: vx, dy: vy, r: (r * r * 0.25 + 0.0008) * this.splatScale(), radial: false });
        }
        this.prevOrbs[i * 2] = x;
        this.prevOrbs[i * 2 + 1] = y;
      }
    }

    // Ripples: one ring per beat.
    if (f.barNow) this.barAge = 0;
    else this.barAge += dt;
    if (f.beatNow) this.sliceSeed = (this.sliceSeed + 1 + rnd() * 3) % 1000;
    if (this.on('ripple') && f.beatNow) {
      const origin = this.sel('ripple', 'origin');
      let x = 0;
      let y = 0;
      if (origin === 'random') {
        x = (rnd() - 0.5) * aspect * 0.8;
        y = (rnd() - 0.5) * 0.8;
      } else if (origin === 'ink' && this.lastDrop) ({ x, y } = this.lastDrop);
      this.ripples.push({ x, y, age: 0 });
      if (this.ripples.length > 4) this.ripples.shift();
    }
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < 3);

    // Fluid stirring.
    if (this.on('fluid')) {
      const stir = project.fx.fluid.p.stir as number;
      const force = this.val('fluid', 'force');
      this.stirAcc += dt * stir * 4;
      while (this.stirAcc >= 1) {
        this.stirAcc -= 1;
        const a = rnd() * Math.PI * 2;
        const m = (600 + rnd() * 1400) * force * (0.4 + f.level);
        this.splats.push({ x: 0.1 + rnd() * 0.8, y: 0.1 + rnd() * 0.8, dx: Math.cos(a) * m, dy: Math.sin(a) * m, r: (0.004 + rnd() * 0.01) * this.splatScale(), radial: false });
      }
      if (f.beatNow && project.fx.fluid.drive === 'beat') {
        const a = rnd() * Math.PI * 2;
        const m = 2500 * force * project.fx.fluid.depth;
        this.splats.push({ x: 0.25 + rnd() * 0.5, y: 0.25 + rnd() * 0.5, dx: Math.cos(a) * m, dy: Math.sin(a) * m, r: 0.02 * this.splatScale(), radial: false });
      }
      this.stepFluid(dt, aspect, project);
    } else {
      this.splats.length = 0;
    }

    this.paint(dt, aspect, orbData, orbCount);
    this.frame++;
  }

  private splatScale(): number {
    return this.project?.fx.fluid ? (this.project.fx.fluid.p.splat as number) ?? 1 : 1;
  }

  private stepFluid(dt: number, aspect: number, project: Project): void {
    const gl = this.gl;
    const texel: [number, number] = [1 / this.simW, 1 / this.simH];
    const P = this.progs;
    // Splats in batches of 8.
    while (this.splats.length) {
      const batch = this.splats.splice(0, 8);
      const a = new Float32Array(32);
      const b = new Float32Array(32);
      batch.forEach((s, i) => {
        a.set([s.x, s.y, s.dx, s.dy], i * 4);
        b.set([s.r, s.radial ? 1 : 0, 0, 0], i * 4);
      });
      P.splat.use().tex('uVel', 0, this.vel.read.tex).f('uAspect', aspect).i('uCount', batch.length).v4('uSplat', a).v4('uSplatR', b);
      this.draw(this.vel.write);
      this.vel.swap();
    }
    const gravity = project.fx.fluid.p.gravity as number;
    if (gravity && this.dye) {
      // Buoyancy: paint rises (or sinks) and drags the fluid with it.
      P.buoy.use().tex('uVel', 0, this.vel.read.tex).tex('uDye', 1, this.dye.read.tex).f('uGravity', gravity * 900).f('uDt', dt);
      this.draw(this.vel.write);
      this.vel.swap();
    }
    const swirl = this.val('fluid', 'swirl');
    const visc = this.val('fluid', 'viscosity');
    P.curl.use().tex('uVel', 0, this.vel.read.tex).f('uTexel', ...texel);
    this.draw(this.curl);
    P.vort.use().tex('uVel', 0, this.vel.read.tex).tex('uCurl', 1, this.curl.tex).f('uTexel', ...texel).f('uStrength', swirl * 45).f('uDt', dt);
    this.draw(this.vel.write);
    this.vel.swap();
    P.div.use().tex('uVel', 0, this.vel.read.tex).f('uTexel', ...texel);
    this.draw(this.divergence);
    P.scale.use().tex('uTex', 0, this.pressure.read.tex).f('uScale', 0.8);
    this.draw(this.pressure.write);
    this.pressure.swap();
    P.pres.use().tex('uDiv', 1, this.divergence.tex).f('uTexel', ...texel);
    for (let i = 0; i < 20; i++) {
      P.pres.tex('uP', 0, this.pressure.read.tex);
      this.draw(this.pressure.write);
      this.pressure.swap();
    }
    P.grad.use().tex('uP', 0, this.pressure.read.tex).tex('uVel', 1, this.vel.read.tex).f('uTexel', ...texel);
    this.draw(this.vel.write);
    this.vel.swap();
    P.advVel.use().tex('uVel', 0, this.vel.read.tex).f('uTexel', ...texel).f('uDt', dt).f('uDissipation', 0.08 + visc * visc * 4);
    this.draw(this.vel.write);
    this.vel.swap();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private refTexel(w: number, h: number): [number, number] {
    const m = Math.min(w, h);
    return [m / w / 1080, m / h / 1080];
  }

  private paint(dt: number, aspect: number, orbData: Float32Array, orbCount: number): void {
    const gl = this.gl;
    const p = this.project!;
    const f = this.features!;
    const P = this.progs.paint.use();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WAVE_SIZE, 1, gl.RED, gl.FLOAT, f.samples);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BAND_COUNT, 1, gl.RED, gl.FLOAT, f.spectrum);

    P.tex('uDye', 0, this.dye.read.tex)
      .tex('uVel', 1, this.vel.read.tex)
      .i('uWave', 2)
      .i('uSpec', 3)
      .f('uSimTexel', 1 / this.simW, 1 / this.simH)
      .f('uRef', ...this.refTexel(this.dyeW, this.dyeH))
      .f('uAspect', aspect)
      .f('uDt', dt)
      .f('uTime', this.simTime)
      .f('uSeed', (this.seed % 97) * 1.37)
      .f('uLowPrec', this.formats.dye.type === gl.FLOAT ? 0 : 1)
      .v3('uPal', this.pal)
      .f('uPalOff', this.palOff);

    P.f('uFluidAmt', this.on('fluid') ? 1 : 0);
    P.f('uFlow', this.on('flow') ? this.val('flow', 'speed') : 0, this.val('flow', 'scale'), this.val('flow', 'evolve'), 0);
    {
      const la = (this.val('flow', 'angle') * Math.PI) / 180;
      P.f('uFlow2', this.val('flow', 'detail'), this.val('flow', 'bias'), Math.cos(la), Math.sin(la));
    }
    if (this.on('drift')) {
      const ang = (this.val('drift', 'angle') * Math.PI) / 180;
      P.f('uDrift', Math.cos(ang), Math.sin(ang), this.val('drift', 'speed'), this.val('drift', 'streak'));
      P.f('uDriftCols', this.val('drift', 'columns'));
      P.f('uDrift2', this.val('drift', 'hardness'), this.val('drift', 'wobble'), 0, 0);
    } else P.f('uDrift', 1, 0, 0, 0);
    if (this.on('warp')) {
      P.f('uWarp', this.val('warp', 'zoom'), this.val('warp', 'spin'), this.val('warp', 'twist'), 0);
      P.f('uWarpC', this.val('warp', 'cx') * aspect, this.val('warp', 'cy'));
    } else P.f('uWarp', 0, 0, 0, 0);
    if (this.on('melt')) {
      const ma = (this.val('melt', 'angle') * Math.PI) / 180;
      P.f('uMelt', this.val('melt', 'speed'), this.val('melt', 'threshold'), this.val('melt', 'columns'), this.val('melt', 'wobble'));
      P.f('uMelt2', Math.cos(ma), Math.sin(ma), 0, 0);
    } else P.f('uMelt', 0, 0.5, 10, 0);
    if (this.on('ripple')) {
      const rd = new Float32Array(16);
      const strength = this.val('ripple', 'strength');
      this.ripples.forEach((r, i) => rd.set([r.x, r.y, r.age, strength * 0.9 * Math.exp(-r.age * 1.2)], i * 4));
      P.i('uRippleCount', this.ripples.length).v4('uRipples', rd).f('uRippleP', this.val('ripple', 'speed') * 0.6, this.val('ripple', 'width') * 0.5);
    } else P.i('uRippleCount', 0);
    this.bindMedia(P, aspect);

    const hold = this.val('time', 'hold');
    const fade = this.val('time', 'fade');
    P.f('uLifeRate', 1 / Math.max(0.05, hold + fade)).f('uBleed', this.val('time', 'bleed'));

    const shape = this.sel('orbs', 'shape');
    P.i('uOrbCount', orbCount)
      .i('uOrbShape', shape === 'capsule' ? 1 : shape === 'ring' ? 2 : 0)
      .v4('uOrbs', orbData)
      .f('uOrbAlpha', 0.9);

    if (this.on('spectrum')) {
      const lay = ['strata', 'columns', 'radial', 'horizon'].indexOf(this.sel('spectrum', 'layout'));
      P.f('uSpecP', 1, Math.max(0, lay), this.val('spectrum', 'position'), this.val('spectrum', 'thickness')).f('uSpecGain', this.val('spectrum', 'gain'));
    } else P.f('uSpecP', 0, 0, 0, 0);

    if (this.on('wave')) {
      const ori = ['h', 'v', 'circle'].indexOf(this.sel('wave', 'orient'));
      P.f('uWaveP', 1, Math.max(0, ori), this.val('wave', 'position'), this.val('wave', 'amplitude')).f('uWaveThick', this.val('wave', 'thickness'));
    } else P.f('uWaveP', 0, 0, 0, 0);

    const dd = new Float32Array(MAX_DROPS * 4);
    const dc = new Float32Array(MAX_DROPS * 3);
    this.drops.forEach((d, i) => {
      const k = d.age / d.life;
      const grow = 1 - Math.pow(1 - Math.min(1, k * 1.6), 3);
      dd.set([d.x, d.y, d.r * (0.25 + grow * 0.75), Math.pow(1 - k, 1.5)], i * 4);
      dc.set(d.col, i * 3);
    });
    P.i('uDropCount', this.drops.length).v4('uDrops', dd).v3('uDropCol', dc);

    P.f(
      'uCloud',
      this.on('cloud') ? this.val('cloud', 'amount') : 0,
      this.val('cloud', 'scale'),
      this.val('cloud', 'threshold'),
      this.simTime * (p.fx.cloud.p.speed as number) * 0.25 + this.seed,
    );

    this.draw(this.dye.write);
    this.dye.swap();
  }

  private bindMedia(P: Program, aspect: number): void {
    const gl = this.gl;
    const m = this.media;
    const f = this.features!;
    if (!this.on('media') || !m) {
      P.f('uMediaP', 0, 0, 0, 0);
      return;
    }
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.mediaTex);
    if (m.version !== this.mediaVersion) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, m.source);
      } catch {
        /* frame not ready */
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.mediaVersion = m.version;
    }
    P.i('uMedia', 4);
    // Cover-fit the media to the canvas, then apply scale and offset.
    const scale = this.val('media', 'scale');
    const fitW = m.aspect > aspect ? aspect / m.aspect : 1;
    const fitH = m.aspect > aspect ? 1 : m.aspect / aspect;
    const sx = (1 / aspect) * fitW / scale;
    const sy = fitH / scale;
    P.f('uMediaXf', sx * (m.mirror ? -1 : 1), sy, this.val('media', 'x') * 0.5, this.val('media', 'y') * 0.5);
    const inject = this.sel('media', 'inject');
    let amount = this.val('media', 'amount');
    if (inject === 'beat') amount *= f.beat;
    else if (inject === 'bar') amount *= Math.exp(-this.barAge / 0.25);
    const look = ['palette', 'tint', 'ink', 'original'].indexOf(this.sel('media', 'look'));
    P.f('uMediaP', amount, this.val('media', 'key'), Math.max(0, look), m.mask ? 1 : 0);
  }

  // ── Output ────────────────────────────────────────────────────────────

  /** Render the current colour field through the post chain into the canvas. */
  render(project: Project, f: Features, clipTime: number): void {
    if (this.contextLost) return;
    this.project = project;
    this.features = f;
    const aspect = this.width / this.height;
    const P = this.progs;
    for (let i = 0; i < 5; i++) this.pal.set(hexToRgb(project.palette[i] ?? '#ffffff'), i * 3);
    const bg = hexToRgb(project.background);

    const hold = this.val('time', 'hold');
    const fade = this.val('time', 'fade');
    const intro = project.fx.time.p.intro as number;
    const introK = intro > 0 ? Math.min(1, Math.max(0, clipTime / intro)) : 1;

    const mode = this.sel('colour', 'mode');
    const blend = this.sel('colour', 'blend');
    const C = P.comp.use()
      .tex('uDye', 0, this.dye.read.tex)
      .v3('uPal', this.pal)
      .f('uBg', ...bg)
      .f('uAspect', aspect)
      .f('uTime', this.simTime)
      .f('uFadeFrac', fade / Math.max(0.05, hold + fade))
      .f('uIntro', introK)
      .i('uMode', mode === 'gradient' ? 1 : mode === 'spectral' ? 2 : 0)
      .i('uBlend', ['normal', 'add', 'multiply', 'screen'].indexOf(blend))
      .f('uHue', (this.val('colour', 'hue') * Math.PI) / 180)
      .f('uSat', this.val('colour', 'saturation'))
      .f('uContrast', this.val('colour', 'contrast'))
      .f('uExposure', this.val('colour', 'exposure'));

    if (this.on('mirror')) {
      const m = ['h', 'v', 'quad', 'kaleido'].indexOf(this.sel('mirror', 'mode'));
      C.f('uMirror', 1, m, Math.round(this.val('mirror', 'segments')), this.val('mirror', 'rotate'));
    } else C.f('uMirror', 0, 0, 0, 0);

    if (this.on('stretch')) {
      const d = ['down', 'up', 'left', 'right'].indexOf(this.sel('stretch', 'direction'));
      C.f('uStretch', 1, d, this.val('stretch', 'cut'), this.val('stretch', 'jitter')).f('uStretchCols', this.val('stretch', 'columns'));
    } else C.f('uStretch', 0, 0, 0, 0);

    if (this.on('glitch')) {
      if (f.beatNow || this.frame % 5 === 0) this.glitchSeed = (this.glitchSeed + 1 + f.beatCount * 0.37) % 997;
      C.f('uGlitch', this.val('glitch', 'amount'), this.val('glitch', 'blocks'), this.val('glitch', 'shift'), this.glitchSeed);
    } else C.f('uGlitch', 0, 1, 0, 0);

    if (this.on('chroma')) {
      C.f('uChroma', this.val('chroma', 'amount'), (this.val('chroma', 'angle') * Math.PI) / 180, this.val('chroma', 'radial'), 0);
    } else C.f('uChroma', 0, 0, 0, 0);
    if (this.on('slices')) {
      C.f('uSlices', 1, this.sel('slices', 'axis') === 'h' ? 1 : 0, Math.round(this.val('slices', 'count')), this.val('slices', 'offset'));
      C.f('uSliceSeed', this.sliceSeed).f('uSliceGap', this.val('slices', 'gap'));
    } else C.f('uSlices', 0, 0, 1, 0).f('uSliceGap', 0);
    const pxs = Math.min(this.width, this.height) / 1080;
    C.f('uRes', this.width, this.height);
    if (this.on('pixelate')) C.f('uPixel', Math.max(1, this.val('pixelate', 'size') * pxs), this.val('pixelate', 'mix'));
    else C.f('uPixel', 0, 1);
    if (this.on('liquid')) {
      C.f('uLiquid', Math.max(0.01, this.val('liquid', 'edge')), this.val('liquid', 'softness'), this.val('liquid', 'holes'), 0).f('uLiquidShine', this.val('liquid', 'shine'));
    } else C.f('uLiquid', 0, 0, 0, 0).f('uLiquidShine', 0);

    this.draw(this.comp);

    // Blur chain.
    let blurMix = 0;
    if (this.on('blur')) {
      const radius = this.val('blur', 'radius');
      if (radius > 0.001) {
        const depth = Math.max(1, Math.min(LEVELS, Math.ceil(radius * LEVELS)));
        const off = 0.6 + (radius * LEVELS - (depth - 1)) * 0.9;
        this.kawase(this.comp.tex, this.blurDown, this.blurUp, depth, off, false, 0);
        blurMix = this.val('blur', 'mix') * Math.min(1, radius * 8);
      }
    }
    // Bloom chain.
    let bloomInt = 0;
    if (this.on('glow')) {
      bloomInt = this.val('glow', 'intensity');
      if (bloomInt > 0.001) {
        const depth = Math.max(2, Math.round(2 + this.val('glow', 'radius') * (LEVELS - 2)));
        this.kawase(this.comp.tex, this.bloomDown, this.bloomUp, depth, 1, true, this.val('glow', 'threshold'));
      }
    }

    const pxScale = Math.min(this.width, this.height) / 1080;
    const F = P.final.use()
      .tex('uComp', 0, this.comp.tex)
      .tex('uBlur', 1, this.blurUp[0].tex)
      .tex('uBloom', 2, this.bloomUp[0].tex)
      .v3('uPal', this.pal)
      .f('uRes', this.width, this.height)
      .f('uPx', pxScale)
      .f('uAspect', aspect)
      .f('uFrame', this.frame % 100000)
      .f('uBlurMix', blurMix)
      .f('uBloomInt', bloomInt);
    if (this.on('contour')) {
      F.f('uContour', 1, Math.round(this.val('contour', 'lines')), this.val('contour', 'width'), this.val('contour', 'mix'));
      F.i('uContourInk', ['accent', 'dark', 'light', 'invert'].indexOf(this.sel('contour', 'ink')));
    } else F.f('uContour', 0, 1, 0, 0);
    if (this.on('dither')) {
      F.f('uDither', 1, this.val('dither', 'levels'), this.val('dither', 'scale'), this.val('dither', 'mix'));
      F.i('uDitherStyle', ['bayer', 'noise', 'halftone'].indexOf(this.sel('dither', 'style')));
    } else F.f('uDither', 0, 2, 1, 0);
    if (this.on('grain')) F.f('uGrain', this.val('grain', 'amount'), this.val('grain', 'size'), this.val('grain', 'colour'), 0);
    else F.f('uGrain', 0, 1, 0, 0);
    if (this.on('vignette')) F.f('uVignette', this.val('vignette', 'amount'), this.val('vignette', 'softness'));
    else F.f('uVignette', 0, 0);
    if (this.on('sheen')) F.f('uSheen', this.val('sheen', 'amount'), this.val('sheen', 'ridges'), this.val('sheen', 'scale'), Math.max(1, 1.5 * pxScale));
    else F.f('uSheen', 0, 0, 1, 1);
    this.draw(null);
  }

  private kawase(src: WebGLTexture, down: Target[], up: Target[], depth: number, off: number, prefilter: boolean, threshold: number): void {
    const P = this.progs;
    let srcTex = src;
    let srcW = this.width;
    let srcH = this.height;
    for (let i = 0; i < depth; i++) {
      P.down.use()
        .tex('uTex', 0, srcTex)
        .f('uHalf', 0.5 / srcW, 0.5 / srcH)
        .f('uOff', off)
        .f('uPrefilter', prefilter && i === 0 ? 1 : 0)
        .f('uThreshold', threshold);
      this.draw(down[i]);
      srcTex = down[i].tex;
      srcW = down[i].w;
      srcH = down[i].h;
    }
    let cur = down[depth - 1];
    for (let i = depth - 2; i >= 0; i--) {
      P.up.use()
        .tex('uTex', 0, cur.tex)
        .tex('uBase', 1, down[i].tex)
        .f('uHalf', 0.5 / cur.w, 0.5 / cur.h)
        .f('uOff', off)
        .f('uAdd', prefilter ? 1 : 0);
      this.draw(up[i]);
      cur = up[i];
    }
    if (depth === 1) {
      P.scale.use().tex('uTex', 0, down[0].tex).f('uScale', 1);
      this.draw(up[0]);
    } else if (prefilter) {
      // Normalise the summed bloom levels.
      P.scale.use().tex('uTex', 0, up[0].tex).f('uScale', 1 / depth);
      this.draw(down[0]);
      P.scale.use().tex('uTex', 0, down[0].tex).f('uScale', 1);
      this.draw(up[0]);
    }
  }

  dispose(): void {
    const gl = this.gl;
    this.vel?.dispose(gl);
    this.pressure?.dispose(gl);
    this.dye?.dispose(gl);
    for (const t of [this.divergence, this.curl, this.comp, ...this.blurDown, ...this.blurUp, ...this.bloomDown, ...this.bloomUp]) deleteTarget(gl, t);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
