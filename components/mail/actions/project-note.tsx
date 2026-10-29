"use client";

import { useRouter } from "next/navigation";

import type { ThreadDetail } from "@/app/(mail)/_lib/queries";
import { dismissProjectSuggestion } from "@/app/(mail)/thread-actions";
import { Kbd } from "@/components/ui/kbd";

import { useKeys, useShortcut } from "../keys/keymap";
import { useProjects } from "../projects-context";
import { useMailSelection } from "../selection";
import { useThreadActions } from "./actions";
import { useUndo } from "./undo";

const LINK =
  "flex items-center gap-1 underline decoration-info/40 underline-offset-2 transition-colors duration-80 ease-snap hover:decoration-info focus-visible:decoration-info outline-none";

/** `>> cohort?` above the subject when sorting is unsure: `y` moves the thread in, `n` never asks again. */
export function ProjectNote({ thread }: { thread: ThreadDetail }) {
  const sel = useMailSelection();
  const router = useRouter();
  const { run } = useThreadActions();
  const { notify } = useUndo();
  const project = useProjects().find((p) => p.id === thread.projectSuggestedId);
  const yesKey = useShortcut("project.yes");
  const noKey = useShortcut("project.no");

  const yes = () => project && void run({ type: "project", projectId: project.id }, [thread.id]);
  const no = async () => {
    if (!project) return;
    await dismissProjectSuggestion(thread.id);
    notify(`not ${project.name}`, "success");
    router.refresh();
  };
  const here = () => !!project && sel.target === thread.id;
  useKeys([
    { id: "project.yes", when: here, run: yes },
    { id: "project.no", when: here, run: () => void no() },
  ]);

  if (!project) return null;
  return (
    <div className="flex flex-col items-end gap-1 self-end text-right text-info">
      <p>
        {">>"} {project.name}?
      </p>
      <p className="flex items-center gap-3 text-12">
        <button type="button" onClick={yes} className={LINK}>
          ✓ move there {yesKey ? <Kbd keys={yesKey} /> : null}
        </button>
        <button type="button" onClick={() => void no()} className={LINK}>
          not {project.name} {noKey ? <Kbd keys={noKey} /> : null}
        </button>
      </p>
    </div>
  );
}
