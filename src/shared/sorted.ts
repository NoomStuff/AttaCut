/** First index whose value is >= target, or > target when exclusive. Input must be sorted. */
export function lowerBound(points: readonly number[], target: number, exclusive = false): number {
   let low = 0;
   let high = points.length;
   while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (points[middle]! < target || (exclusive && points[middle] === target)) low = middle + 1;
      else high = middle;
   }
   return low;
}
