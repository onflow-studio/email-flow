import type { SearchScope } from "@/lib/search/search";

import { accountsOff, accountsOn } from "./account-filter";
import { listAccounts } from "./queries";

/** Search covers only the accounts toggled on in the header. */
export async function scope(): Promise<SearchScope> {
  return { accountIds: accountsOn(await listAccounts(), await accountsOff()) };
}
