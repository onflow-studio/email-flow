"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

import { useCompose } from "./compose";
import { rememberAccount } from "./last-account";

/** Reply actions under an open thread. Reading a thread makes its account the default for new mail. */
export function ReplyBar({ threadId, accountId }: { threadId: string; accountId: string }) {
  const compose = useCompose();

  useEffect(() => {
    rememberAccount(accountId);
  }, [accountId]);

  const touch = "h-touch md:h-row";
  return (
    <div className="flex flex-wrap gap-2">
      <Button shortcut="r" className={touch} onClick={() => compose.open("reply", threadId)}>
        reply
      </Button>
      <Button shortcut="a" className={touch} onClick={() => compose.open("reply-all", threadId)}>
        reply all
      </Button>
      <Button shortcut="f" className={touch} onClick={() => compose.open("forward", threadId)}>
        forward
      </Button>
    </div>
  );
}
