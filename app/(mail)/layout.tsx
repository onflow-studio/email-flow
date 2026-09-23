import { UndoProvider } from "@/components/mail/actions/undo";
import { ComposeProvider } from "@/components/mail/compose/compose";
import { KeyMapOverlay } from "@/components/mail/keys/key-map-overlay";
import { KeymapProvider } from "@/components/mail/keys/keymap";
import { FocusStoreProvider } from "@/components/mail/selection";
import { loadOverrides } from "@/lib/db/keybindings";

export default async function MailLayout({ children }: { children: React.ReactNode }) {
  const overrides = await loadOverrides();
  return (
    <KeymapProvider overrides={overrides}>
      <FocusStoreProvider>
        <UndoProvider>
          <ComposeProvider>{children}</ComposeProvider>
        </UndoProvider>
      </FocusStoreProvider>
      <KeyMapOverlay />
    </KeymapProvider>
  );
}
