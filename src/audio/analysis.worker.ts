/// <reference lib="webworker" />
import { analyse, type AnalysisRequest } from './analysis-core';

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  try {
    const res = analyse(e.data, (v) => self.postMessage({ type: 'progress', value: v }));
    const transfer = [res.bands, res.low, res.mid, res.high, res.level, res.peaks, res.rms].map((a) => a.buffer);
    (self as unknown as Worker).postMessage({ type: 'done', result: res }, transfer as Transferable[]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
