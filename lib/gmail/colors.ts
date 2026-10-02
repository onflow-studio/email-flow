// DESIGN.md account hues. Never used for anything else. Client-safe, no server imports.
// The first three are the original defaults and keep their values so existing accounts look the same.
export const ACCOUNT_COLORS = [
  { name: "green", hex: "#39FF9E" },
  { name: "yellow", hex: "#EDE95C" },
  { name: "violet", hex: "#C792EA" },
  { name: "lime", hex: "#A6E22E" },
  { name: "peach", hex: "#F5A97F" },
  { name: "rose", hex: "#FF9CC2" },
  { name: "sand", hex: "#D8C8A0" },
  { name: "slate", hex: "#A9B8C2" },
] as const;
