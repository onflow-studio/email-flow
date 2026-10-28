export const SECTIONS = [
  { slug: "accounts", label: "accounts" },
  { slug: "rules", label: "rules" },
  { slug: "people", label: "people" },
  { slug: "keyboard", label: "keyboard" },
  { slug: "digest", label: "digest" },
] as const;

/** `/settings` itself opens accounts. */
export function currentSection(pathname: string) {
  const slug = pathname.split("/")[2] ?? "accounts";
  return SECTIONS.find((s) => s.slug === slug) ?? SECTIONS[0];
}
