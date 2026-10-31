// iOS system colors (grouped list look), light and dark.
import { useColorScheme } from "react-native";
import type { VendorId } from "@cloud-console/core/catalog";

const light = {
  background: "#F2F2F7", // systemGroupedBackground
  card: "#FFFFFF", // secondarySystemGroupedBackground
  text: "#000000",
  secondary: "#3C3C4399",
  tertiary: "#3C3C434D",
  separator: "#3C3C4349",
  fill: "#7676801F",
  tint: "#007AFF",
  red: "#FF3B30",
  green: "#34C759",
  orange: "#FF9500",
  bar: "#F9F9F9F0",
  code: "#F2F2F7",
};

const dark: typeof light = {
  background: "#000000",
  card: "#1C1C1E",
  text: "#FFFFFF",
  secondary: "#EBEBF599",
  tertiary: "#EBEBF54D",
  separator: "#54545899",
  fill: "#7676803D",
  tint: "#0A84FF",
  red: "#FF453A",
  green: "#30D158",
  orange: "#FF9F0A",
  bar: "#1C1C1EF0",
  code: "#2C2C2E",
};

export type Palette = typeof light;

export function useTheme(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const VENDOR_ACCENT: Record<VendorId, string> = {
  aws: "#FF9500",
  azure: "#007AFF",
  gcp: "#FF3B30",
  tencent: "#30B0C7",
  alibaba: "#FF2D55",
  s3compat: "#8E8E93",
};

export const MONO = "Menlo";
