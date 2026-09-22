import { Button } from "@/components/ui/button";

const buckets = [
  { name: "inbox", count: 0 },
  { name: "news", count: 0 },
  { name: "paper trail", count: 0 },
  { name: "triage", count: 0 },
];

export default function Home() {
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-rail shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 md:flex">
          {buckets.map((bucket, i) => (
            <div
              key={bucket.name}
              className={
                i === 0
                  ? "glow-focus flex h-row items-center justify-between rounded-sm border-l-2 border-accent bg-surface-raised px-2 font-medium"
                  : "flex h-row items-center justify-between rounded-sm border-l-2 border-transparent px-2 text-text-muted"
              }
            >
              <span>{bucket.name}</span>
              <span className="text-11 text-text-dim">{bucket.count}</span>
            </div>
          ))}
        </nav>
        <main className="pane-depth flex flex-1 flex-col items-start justify-center gap-4 p-8">
          <p className="text-11 text-text-dim">superfer</p>
          <h1 className="text-20 font-semibold">inbox clear</h1>
          <p className="text-info">{">>"} no accounts connected yet</p>
          <div className="flex gap-2">
            <Button variant="primary" shortcut="c">
              connect account
            </Button>
            <Button shortcut="?">keys</Button>
          </div>
        </main>
      </div>
      <footer className="status-rule flex h-status shrink-0 items-center justify-between bg-surface px-3 text-11 text-text-muted">
        <span>sync idle</span>
        <span>cmd+k palette</span>
      </footer>
    </div>
  );
}
