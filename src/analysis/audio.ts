import { ANALYSIS_SAMPLE_RATE } from "../services/shared";

export interface CanonicalAudio {
  sampleRate: number;
  samples: Float32Array;
  durationSeconds: number;
}

export function canonicalizeAudioBuffer(buffer: AudioBuffer, targetRate = ANALYSIS_SAMPLE_RATE): CanonicalAudio {
  const mono = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    let sum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      sum += buffer.getChannelData(channel)[i] ?? 0;
    }
    mono[i] = sum / buffer.numberOfChannels;
  }
  if (buffer.sampleRate === targetRate) {
    return { sampleRate: targetRate, samples: mono, durationSeconds: mono.length / targetRate };
  }
  const ratio = targetRate / buffer.sampleRate;
  const length = Math.max(1, Math.round(mono.length * ratio));
  const resampled = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const sourceIndex = i / ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(mono.length - 1, left + 1);
    const frac = sourceIndex - left;
    resampled[i] = (mono[left] ?? 0) * (1 - frac) + (mono[right] ?? 0) * frac;
  }
  return { sampleRate: targetRate, samples: resampled, durationSeconds: length / targetRate };
}

export function computePeaks(samples: Float32Array, buckets = 400) {
  const peaks: Array<{ min: number; max: number }> = [];
  const bucketSize = Math.max(1, Math.floor(samples.length / buckets));
  for (let i = 0; i < buckets; i += 1) {
    const start = i * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    let min = 0;
    let max = 0;
    for (let j = start; j < end; j += 1) {
      const value = samples[j] ?? 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    peaks.push({ min, max });
  }
  return peaks;
}

export function energyEnvelope(samples: Float32Array, windowSize = 256) {
  const envelope = new Float32Array(Math.ceil(samples.length / windowSize));
  for (let i = 0; i < envelope.length; i += 1) {
    let sum = 0;
    const start = i * windowSize;
    const end = Math.min(samples.length, start + windowSize);
    for (let j = start; j < end; j += 1) {
      const value = samples[j] ?? 0;
      sum += value * value;
    }
    envelope[i] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return envelope;
}

export function detectOnsetSeconds(samples: Float32Array, sampleRate: number, thresholdRatio = 0.15) {
  const envelope = energyEnvelope(samples);
  let peak = 0;
  for (const value of envelope) peak = Math.max(peak, value);
  const threshold = peak * thresholdRatio;
  const windowSize = 256;
  for (let i = 0; i < envelope.length; i += 1) {
    if ((envelope[i] ?? 0) >= threshold) return (i * windowSize) / sampleRate;
  }
  return 0;
}

export function crossCorrelateOffset(reference: Float32Array, learner: Float32Array, windowSize = 256) {
  const refEnv = energyEnvelope(reference, windowSize);
  const learnEnv = energyEnvelope(learner, windowSize);
  const maxLag = Math.min(80, Math.floor(refEnv.length / 2));
  let bestLag = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < refEnv.length; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= learnEnv.length) continue;
      score += (refEnv[i] ?? 0) * (learnEnv[j] ?? 0);
      count += 1;
    }
    if (count === 0) continue;
    const normalized = score / count;
    if (normalized > bestScore) {
      bestScore = normalized;
      bestLag = lag;
    }
  }
  return (bestLag * windowSize);
}
