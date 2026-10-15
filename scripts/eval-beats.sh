#!/usr/bin/env bash
# Compile the pure audio modules and run the beat-detection evaluation.
set -euo pipefail
OUT="${TMPDIR:-/tmp}/klangbild-eval"
rm -rf "$OUT"
npx tsc src/audio/analysis-core.ts src/audio/beats.ts src/audio/dsp.ts src/audio/bands.ts src/audio/fft.ts src/audio/demo.ts \
  --outDir "$OUT" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck --lib es2022,dom --ignoreConfig
# Node needs explicit extensions on relative imports.
find "$OUT" -name '*.js' -exec sed -i -E "s#(from '\.{1,2}/[^']+)';#\1.js';#g" {} +
node scripts/eval-beats.mjs "$OUT" "${1:-0.55}"
