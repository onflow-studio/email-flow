import { createCn } from "cn/config"

// Teach the merger the DESIGN.md scale so `text-13` and `text-bg` don't collide.
export const cn = createCn({
  extend: {
    theme: {
      spacing: ["row", "touch", "status", "rail", "list"],
      container: ["palette"],
      radius: ["sm", "md"],
      ease: ["snap"],
    },
    classGroups: {
      "font-size": [{ text: ["11", "12", "13", "15", "20"] }],
      leading: [{ leading: ["list", "prose"] }],
    },
  },
})
