// Hand, face and body tracking with MediaPipe, drawn as soft abstract shapes
// (never the camera image itself). The shapes are a mask: alpha is the shape,
// rgb carries interior shading so the palette can model them like the paint.

import type { FaceLandmarker, HandLandmarker, ImageSegmenter, NormalizedLandmark } from '@mediapipe/tasks-vision';
// The runtime ships with the app so tracking does not depend on a CDN.
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

export type Subject = 'hands' | 'face' | 'body';

const MODELS: Record<Subject, string> = {
  hands: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
  body: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
};

type Vision = typeof import('@mediapipe/tasks-vision');
let visionP: Promise<{ vision: Vision; fileset: { wasmLoaderPath: string; wasmBinaryPath: string } }> | null = null;

function loadVision() {
  if (!visionP) {
    visionP = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      return { vision, fileset: { wasmLoaderPath, wasmBinaryPath } };
    })();
    visionP.catch(() => (visionP = null));
  }
  return visionP;
}

type Model = HandLandmarker | FaceLandmarker | ImageSegmenter;

/** Detects one kind of subject and paints it as a stylised mask. */
export class Tracker {
  readonly canvas: HTMLCanvasElement;
  /** Number of hands / faces / people found in the last frame. */
  found = 0;
  private ctx: CanvasRenderingContext2D;
  private shape: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private lastTs = -1;
  private bodyBuf: ImageData | null = null;
  private bodyCanvas = document.createElement('canvas');

  private constructor(
    readonly subject: Subject,
    private model: Model,
    private vision: Vision,
  ) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.shape = document.createElement('canvas');
    this.sctx = this.shape.getContext('2d')!;
  }

  static async create(subject: Subject): Promise<Tracker> {
    const { vision, fileset } = await loadVision();
    const make = async (delegate: 'GPU' | 'CPU'): Promise<Model> => {
      const baseOptions = { modelAssetPath: MODELS[subject], delegate };
      if (subject === 'hands') return vision.HandLandmarker.createFromOptions(fileset, { baseOptions, runningMode: 'VIDEO', numHands: 2 });
      if (subject === 'face') return vision.FaceLandmarker.createFromOptions(fileset, { baseOptions, runningMode: 'VIDEO', numFaces: 2 });
      return vision.ImageSegmenter.createFromOptions(fileset, { baseOptions, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
    };
    let model: Model;
    try {
      model = await make('GPU');
    } catch {
      model = await make('CPU');
    }
    return new Tracker(subject, model, vision);
  }

  /** Run detection on a frame and redraw the mask. `ts` must increase (ms). */
  update(frame: TexImageSource, width: number, height: number, ts: number): void {
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const W = 384;
    const H = Math.max(16, Math.round((W * height) / Math.max(1, width)));
    for (const c of [this.canvas, this.shape]) {
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
    }
    const src = frame as unknown as HTMLVideoElement;
    if (this.subject === 'hands') {
      const res = (this.model as HandLandmarker).detectForVideo(src, ts);
      this.found = res.landmarks.length;
      this.drawHands(res.landmarks, W, H);
    } else if (this.subject === 'face') {
      const res = (this.model as FaceLandmarker).detectForVideo(src, ts);
      this.found = res.faceLandmarks.length;
      this.drawFaces(res.faceLandmarks, W, H);
    } else {
      (this.model as ImageSegmenter).segmentForVideo(src, ts, (res) => {
        const m = res.confidenceMasks?.[0];
        if (!m) return;
        this.drawBody(m.getAsFloat32Array(), m.width, m.height, W, H);
      });
    }
  }

  private blurInto(px: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.filter = `blur(${px}px)`;
    c.drawImage(this.shape, 0, 0);
    c.filter = 'none';
  }

  private drawHands(hands: NormalizedLandmark[][], W: number, H: number): void {
    const s = this.sctx;
    s.clearRect(0, 0, W, H);
    s.lineCap = 'round';
    s.lineJoin = 'round';
    let minSize = W;
    for (const lm of hands) {
      const P = (i: number) => [lm[i].x * W, lm[i].y * H] as const;
      const size = Math.hypot(P(0)[0] - P(9)[0], P(0)[1] - P(9)[1]);
      minSize = Math.min(minSize, size);
      const [cx, cy] = P(9);
      const g = s.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 1.6);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(110,110,110,1)');
      s.fillStyle = g;
      s.strokeStyle = g;
      // Palm.
      s.beginPath();
      for (const [k, i] of [0, 1, 5, 9, 13, 17].entries()) {
        const [x, y] = P(i);
        if (k === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
      }
      s.closePath();
      s.fill();
      s.lineWidth = size * 0.3;
      s.stroke();
      // Fingers, tapering toward the tips.
      const fingers = [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
        [17, 18, 19, 20],
      ];
      for (const f of fingers) {
        for (let j = 0; j < f.length - 1; j++) {
          const [x0, y0] = P(f[j]);
          const [x1, y1] = P(f[j + 1]);
          s.lineWidth = size * (0.26 - j * 0.045);
          s.beginPath();
          s.moveTo(x0, y0);
          s.lineTo(x1, y1);
          s.stroke();
        }
      }
    }
    // Soften relative to the smallest hand so fingers stay readable.
    this.blurInto(Math.min(W / 90, Math.max(1.5, minSize * 0.07)));
  }

  private hull(pts: [number, number][]): [number, number][] {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: [number, number][] = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: [number, number][] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  private polygon(pts: [number, number][]): void {
    const s = this.sctx;
    s.beginPath();
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    s.closePath();
  }

  private drawFaces(faces: NormalizedLandmark[][], W: number, H: number): void {
    const s = this.sctx;
    s.clearRect(0, 0, W, H);
    const FL = this.vision.FaceLandmarker;
    const idx = (conns: { start: number; end: number }[]) => [...new Set(conns.flatMap((c) => [c.start, c.end]))];
    const ovalI = idx(FL.FACE_LANDMARKS_FACE_OVAL);
    const lipsI = idx(FL.FACE_LANDMARKS_LIPS);
    const leI = idx(FL.FACE_LANDMARKS_LEFT_EYE);
    const reI = idx(FL.FACE_LANDMARKS_RIGHT_EYE);
    for (const lm of faces) {
      const pts = (ii: number[]) => ii.map((i) => [lm[i].x * W, lm[i].y * H] as [number, number]);
      const oval = this.hull(pts(ovalI));
      const nose = lm[1];
      const r = Math.max(...oval.map(([x, y]) => Math.hypot(x - nose.x * W, y - nose.y * H)));
      const g = s.createRadialGradient(nose.x * W, nose.y * H, r * 0.05, nose.x * W, nose.y * H, r * 1.1);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(90,90,90,1)');
      s.fillStyle = g;
      this.polygon(oval);
      s.fill();
      // Carve the eyes and mouth so the face reads without being a likeness.
      s.globalCompositeOperation = 'destination-out';
      s.fillStyle = 'rgba(0,0,0,0.85)';
      for (const feat of [leI, reI, lipsI]) {
        this.polygon(this.hull(pts(feat)));
        s.fill();
      }
      s.globalCompositeOperation = 'source-over';
    }
    this.blurInto(Math.max(2, W / 120));
  }

  private drawBody(mask: Float32Array, mw: number, mh: number, W: number, H: number): void {
    if (!this.bodyBuf || this.bodyBuf.width !== mw || this.bodyBuf.height !== mh) {
      this.bodyBuf = new ImageData(mw, mh);
      this.bodyCanvas.width = mw;
      this.bodyCanvas.height = mh;
    }
    const d = this.bodyBuf.data;
    let on = 0;
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i];
      // Shade toward the top of the frame lighter, like a heat map of the figure.
      const shade = 140 + 115 * (1 - Math.floor(i / mw) / mh);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = shade;
      d[i * 4 + 3] = Math.round(v * 255);
      if (v > 0.5) on++;
    }
    this.found = on > mask.length * 0.01 ? 1 : 0;
    this.bodyCanvas.getContext('2d')!.putImageData(this.bodyBuf, 0, 0);
    const s = this.sctx;
    s.clearRect(0, 0, W, H);
    s.drawImage(this.bodyCanvas, 0, 0, W, H);
    this.blurInto(Math.max(2, W / 70));
  }

  close(): void {
    try {
      this.model.close();
    } catch {
      /* ignore */
    }
  }
}
