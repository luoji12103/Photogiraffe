/**
 * GLRenderer — WebGL2 real-time image renderer with colour-adjustment pipeline.
 *
 * Features:
 *  - WebGL2 with fallback to WebGL1
 *  - Accepts Uint8Array (RAW frame) or HTMLImageElement (proxy WebP) as texture
 *  - Fragment Shader pipeline: exposure → brightness → contrast → saturation
 *  - requestAnimationFrame-based render loop for smooth slider feedback
 */

import type { RawFrame } from "./useRawDecoder";

export interface AdjustParams {
  /** Exposure in stops: -3.0 ~ +3.0, default 0 */
  exposure: number;
  /** Brightness offset: -1.0 ~ +1.0, default 0 */
  brightness: number;
  /** Contrast boost: -1.0 ~ +1.0, default 0 */
  contrast: number;
  /** Saturation multiplier: 0.0 ~ 2.0, default 1 */
  saturation: number;
  /** ACES filmic tone mapping (default false) */
  tonemap: boolean;
}

export const DEFAULT_ADJUST: AdjustParams = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 1,
  tonemap: false,
};

// ---------- GLSL source ----------

const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = vec2(a_position.x * 0.5 + 0.5, 1.0 - (a_position.y * 0.5 + 0.5));
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
uniform sampler2D u_image;
uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_tonemap;
varying vec2 v_texCoord;

vec3 srgbToLinear(vec3 c) { return pow(max(c, vec3(0.001)), vec3(2.2)); }
vec3 linearToSrgb(vec3 c) { return pow(max(c, vec3(0.001)), vec3(1.0 / 2.2)); }

// ACES filmic tone map (approximate)
vec3 acesFilmic(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c2 = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c2 * x + d) + e), 0.0, 1.0);
}

void main() {
  vec4 sample = texture2D(u_image, v_texCoord);
  vec3 linear = srgbToLinear(sample.rgb);

  // 1. Exposure (multiplicative, linear space)
  linear *= pow(2.0, u_exposure);

  // 2. Brightness (additive)
  linear = clamp(linear + u_brightness * 0.5, 0.0, 4.0);

  // 3. Contrast (pivot at 0.18 middle grey)
  linear = clamp(mix(vec3(0.18), linear, u_contrast + 1.0), 0.0, 4.0);

  // 4. Saturation (rec.709 luma weights, luma-preserving)
  float luma = dot(linear, vec3(0.2126, 0.7152, 0.0722));
  linear = mix(vec3(luma), linear, u_saturation);

  // 5. Optional ACES filmic tone mapping (mix avoids shader divergence)
  linear = mix(linear, acesFilmic(linear), u_tonemap);

  gl_FragColor = vec4(linearToSrgb(clamp(linear, 0.0, 1.0)), sample.a);
}
`;

// ---------- helpers ----------

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`GLRenderer: shader compile error — ${msg}`);
  }
  return shader;
}

function linkProgram(
  gl: WebGLRenderingContext,
  vert: WebGLShader,
  frag: WebGLShader
): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vert);
  gl.attachShader(prog, frag);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`GLRenderer: program link error — ${msg}`);
  }
  return prog;
}

// ---------- main class ----------

export class GLRenderer {
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private _ready = false;
  private _hasTexture = false;

  /** Initialise WebGL on the given canvas. Returns false on failure.
   * @param colorSpace  "srgb" (default) or "display-p3" for wide-gamut canvas
   */
  init(canvas: HTMLCanvasElement, colorSpace: "srgb" | "display-p3" = "srgb"): boolean {
    const ctxOpts = { colorSpace };
    const gl =
      (canvas.getContext("webgl2", ctxOpts) as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl", ctxOpts) as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl", ctxOpts) as WebGLRenderingContext | null);

    if (!gl) {
      console.warn("GLRenderer: WebGL not supported");
      return false;
    }
    this.gl = gl;

    try {
      const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      this.prog = linkProgram(gl, vert, frag);

      // Full-screen quad: [-1,+1]² NDC space
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      const aPos = gl.getAttribLocation(this.prog, "a_position");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      this._ready = true;
      return true;
    } catch (e) {
      console.error("GLRenderer: init failed —", e);
      return false;
    }
  }

  /**
   * Upload a decoded RAW frame (packed RGB Uint8Array, 8-bit / channel).
   */
  uploadFrame(frame: RawFrame): void {
    const gl = this.gl;
    if (!gl || !this._ready) return;

    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.width = frame.width;
    canvas.height = frame.height;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      frame.width,
      frame.height,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      frame.data
    );

    gl.viewport(0, 0, frame.width, frame.height);
    this._hasTexture = true;
  }

  /**
   * Upload a loaded HTMLImageElement (e.g., WebP proxy).
   */
  uploadImage(img: HTMLImageElement): void {
    const gl = this.gl;
    if (!gl || !this._ready) return;

    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    gl.viewport(0, 0, canvas.width, canvas.height);
    this._hasTexture = true;
  }

  /**
   * Draw one frame with the given adjustment parameters.
   * Should be called inside a requestAnimationFrame callback for smooth updates.
   */
  render(params: AdjustParams): void {
    const gl = this.gl;
    if (!gl || !this._ready || !this._hasTexture) return;

    gl.useProgram(this.prog);

    // Bind uniforms
    const set1 = (name: string, v: number) =>
      gl.uniform1f(gl.getUniformLocation(this.prog!, name), v);

    set1("u_exposure", params.exposure);
    set1("u_brightness", params.brightness);
    set1("u_contrast", params.contrast);
    set1("u_saturation", params.saturation);
    set1("u_tonemap", params.tonemap ? 1.0 : 0.0);

    gl.uniform1i(gl.getUniformLocation(this.prog!, "u_image"), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Release all WebGL resources. */
  destroy(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.prog) gl.deleteProgram(this.prog);
    this._ready = false;
    this._hasTexture = false;
    this.gl = null;
  }

  get isReady(): boolean { return this._ready; }
  get hasTexture(): boolean { return this._hasTexture; }
}
