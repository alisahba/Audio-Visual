// Minimal WebGL2 helpers: programs with cached uniforms, render targets, ping-pong.

export const FULLSCREEN_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(
    private gl: WebGL2RenderingContext,
    vs: string,
    fs: string,
    name: string,
  ) {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        const numbered = src
          .split('\n')
          .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
          .join('\n');
        console.error(`[${name}] shader compile error\n${log}\n${numbered}`);
        throw new Error(`Shader "${name}" failed to compile: ${log}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Program "${name}" failed to link: ${gl.getProgramInfoLog(p)}`);
    }
    this.prog = p;
  }
  use(): this {
    this.gl.useProgram(this.prog);
    return this;
  }
  u(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.prog, name);
      this.locs.set(name, l);
    }
    return l;
  }
  f(name: string, ...v: number[]): this {
    const l = this.u(name);
    if (!l) return this;
    const gl = this.gl;
    if (v.length === 1) gl.uniform1f(l, v[0]);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
    return this;
  }
  i(name: string, v: number): this {
    const l = this.u(name);
    if (l) this.gl.uniform1i(l, v);
    return this;
  }
  v3(name: string, data: Float32Array): this {
    const l = this.u(name);
    if (l) this.gl.uniform3fv(l, data);
    return this;
  }
  v4(name: string, data: Float32Array): this {
    const l = this.u(name);
    if (l) this.gl.uniform4fv(l, data);
    return this;
  }
  tex(name: string, unit: number, t: WebGLTexture): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    return this.i(name, unit);
  }
}

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export interface Format {
  internal: number;
  format: number;
  type: number;
  linear: boolean;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number, fmt: Format, filter?: number): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const f = filter ?? (fmt.linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo, w, h };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null | undefined): void {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

export class PingPong {
  read: Target;
  write: Target;
  constructor(gl: WebGL2RenderingContext, w: number, h: number, fmt: Format) {
    this.read = createTarget(gl, w, h, fmt);
    this.write = createTarget(gl, w, h, fmt);
  }
  swap(): void {
    const t = this.read;
    this.read = this.write;
    this.write = t;
  }
  dispose(gl: WebGL2RenderingContext): void {
    deleteTarget(gl, this.read);
    deleteTarget(gl, this.write);
  }
}

function supportsRenderTo(gl: WebGL2RenderingContext, fmt: Format): boolean {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, 4, 4, 0, fmt.format, fmt.type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.deleteTexture(tex);
  gl.deleteFramebuffer(fbo);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return ok;
}

export interface Formats {
  /** High-precision format for the persistent colour field. */
  dye: Format;
  /** Half-float (or best available) for simulation and post. */
  half: Format;
  rgba8: Format;
  floatTextures: boolean;
}

export function pickFormats(gl: WebGL2RenderingContext): Formats {
  const cbf = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');
  const f32Linear = !!gl.getExtension('OES_texture_float_linear');
  const rgba8: Format = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, linear: true };
  const half: Format = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, linear: true };
  const full: Format = { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, linear: true };
  const halfOk = cbf && supportsRenderTo(gl, half);
  const fullOk = cbf && f32Linear && supportsRenderTo(gl, full);
  return {
    dye: fullOk ? full : halfOk ? half : rgba8,
    half: halfOk ? half : rgba8,
    rgba8,
    floatTextures: halfOk,
  };
}
