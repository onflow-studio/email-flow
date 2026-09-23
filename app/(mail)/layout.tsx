import { UndoProvider } from "@/components/mail/actions/undo";
import { ComposeProvider } from "@/components/mail/compose/compose";
import { KeyMapOverlay } from "@/components/mail/keys/key-map-overlay";
import { KeymapProvider } from "@/components/mail/keys/keymap";
import { FocusStoreProvider } from "@/components/mail/selection";

export default function MailLayout({ children }: { children: React.ReactNode }) {
  return (
    <KeymapProvider>
      <FocusStoreProvider>
        <UndoProvider>
          <ComposeProvider>{children}</ComposeProvider>
        </UndoProvider>
      </FocusStoreProvider>
      <KeyMapOverlay />
    </KeymapProvider>
  );
}
