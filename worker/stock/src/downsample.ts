// Largest-Triangle-Three-Buckets: keeps the first and last points and, from each bucket in
// between, the point that best preserves the line's shape. A day of 5-minute bars stays as it
// is; five years of weekly bars come down to MAX_SERIES_POINTS without flattening the peaks.

export type Point = readonly [number, number];

/** At most `threshold` points (at least 3) from `points`, which must be in time order. */
export function downsample(points: readonly Point[], requested: number): Point[] {
  const length = points.length;
  const threshold = Math.max(3, Math.floor(requested));
  if (length <= threshold) return [...points];

  const sampled: Point[] = [];
  const bucketSize = (length - 2) / (threshold - 2);
  let anchor = points[0] as Point;
  sampled.push(anchor);

  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    // The average of the next bucket is the third corner of each candidate triangle.
    const nextStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, length);
    let avgX = 0;
    let avgY = 0;
    for (let i = nextStart; i < nextEnd; i += 1) {
      const point = points[i] as Point;
      avgX += point[0];
      avgY += point[1];
    }
    const count = Math.max(nextEnd - nextStart, 1);
    avgX /= count;
    avgY /= count;

    const start = Math.floor(bucket * bucketSize) + 1;
    const end = Math.floor((bucket + 1) * bucketSize) + 1;
    let best = points[start] as Point;
    let bestArea = -1;
    for (let i = start; i < end; i += 1) {
      const point = points[i] as Point;
      const area = Math.abs(
        (anchor[0] - avgX) * (point[1] - anchor[1]) - (anchor[0] - point[0]) * (avgY - anchor[1]),
      );
      if (area > bestArea) {
        bestArea = area;
        best = point;
      }
    }
    sampled.push(best);
    anchor = best;
  }

  sampled.push(points[length - 1] as Point);
  return sampled;
}
