// Dependency-free line chart: one View segment per point pair, rotated into
// place. Tap-and-drag reads any point (Swift Charts' chartXSelection).
import React, { useState } from "react";
import { View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import type { MetricPoint } from "@cloud-console/core/aws/cloudwatch-metrics";

export function Sparkline({ points, max, color, height = 40, onSelect }: { points: MetricPoint[]; max: number; color: string; height?: number; onSelect?: (p: MetricPoint | undefined) => void }) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number>();
  const n = points.length;
  const xy = (i: number) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * width;
    const y = height - Math.min(points[i]!.value / (max || 1), 1) * height;
    return { x, y };
  };
  const pick = (e: GestureResponderEvent) => {
    if (n === 0 || width === 0) return;
    const i = Math.max(0, Math.min(n - 1, Math.round((e.nativeEvent.locationX / width) * (n - 1))));
    setSelected(i);
    onSelect?.(points[i]);
  };
  const release = () => {
    setSelected(undefined);
    onSelect?.(undefined);
  };
  return (
    <View
      style={{ height }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={release}
      onResponderTerminate={release}
    >
      {width > 0
        ? points.slice(1).map((_, k) => {
            const a = xy(k);
            const b = xy(k + 1);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            return (
              <View
                key={k}
                style={{
                  position: "absolute",
                  left: (a.x + b.x) / 2 - len / 2,
                  top: (a.y + b.y) / 2 - 1,
                  width: len,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: color,
                  transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                }}
              />
            );
          })
        : null}
      {selected !== undefined && width > 0 ? (
        <View style={{ position: "absolute", left: xy(selected).x - 4, top: xy(selected).y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      ) : null}
    </View>
  );
}
