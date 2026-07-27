/** Provides shared descriptive statistics for numeric populations. */

const AUTO_BIN_LIMIT = 10;

export type NumericStats = {
  count: number;
  mean: number;
  std: number;
  min: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  bins: Record<string, number>;
};

/** Describes one numeric population with pandas-like quantiles and automatic bins. */
export function describeNumbers(values: number[]): NumericStats {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return {
      count: 0,
      mean: 0,
      std: 0,
      min: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p90: 0,
      max: 0,
      bins: {},
    };
  }

  const min = sorted[0]!;
  const max = sorted.at(-1)!;
  let bins: Record<string, number>;
  if (min === max) {
    const label = Number(min.toPrecision(6));
    bins = { [`${label}-${label}`]: sorted.length };
  } else {
    const targetCount = Math.min(AUTO_BIN_LIMIT, Math.ceil(Math.log2(sorted.length) + 1));
    const integers = sorted.every(Number.isInteger);
    const span = max - min + (integers ? 1 : 0);
    const width = integers ? Math.ceil(span / targetCount) : span / targetCount;
    const binCount = integers ? Math.ceil(span / width) : targetCount;
    const counts = new Array<number>(binCount).fill(0);
    for (const value of sorted) {
      counts[Math.min(binCount - 1, Math.floor((value - min) / width))]! += 1;
    }
    bins = Object.fromEntries(
      counts.map((count, index) => {
        const start = min + index * width;
        const end = index === binCount - 1 ? max : start + width - (integers ? 1 : 0);
        const startLabel = Number(start.toPrecision(6));
        const endLabel = Number(end.toPrecision(6));
        return integers
          ? [`${startLabel}-${endLabel}`, count]
          : [`[${startLabel},${endLabel}${index === binCount - 1 ? "]" : ")"}`, count];
      }),
    );
  }

  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const variance =
    sorted.length === 1
      ? 0
      : sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / (sorted.length - 1);
  return {
    count: sorted.length,
    mean: Number(mean.toFixed(2)),
    std: Number(Math.sqrt(variance).toFixed(2)),
    min,
    p25: Number(percentile(sorted, 0.25).toFixed(2)),
    p50: Number(percentile(sorted, 0.5).toFixed(2)),
    p75: Number(percentile(sorted, 0.75).toFixed(2)),
    p90: Number(percentile(sorted, 0.9).toFixed(2)),
    max,
    bins,
  };
}

/** Interpolates one percentile from sorted numeric values. */
function percentile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}
