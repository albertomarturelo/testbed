import { useState } from "react";
import type { Covered } from "@/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatRoute } from "@/route";
import { CaseDetail } from "@/views/CaseDetail";

/**
 * One case over the case list, in a Sheet from the right (#146): the list and
 * the feature tree stay behind it, where the QA left them. `caseRef` is the
 * case the hash names; undefined closes the Sheet. Closing (the X, Esc, the
 * overlay) calls `onClose`, which puts the list's hash back; focus returns to
 * the case's row.
 */
export function CaseSheet({
  caseRef,
  reload,
  created,
  onWritten,
  onClose,
}: {
  caseRef: string | undefined;
  /** Bumped by Refresh: the case is read again from its file. */
  reload: number;
  /** The last case created here (#94): its page names that commit. */
  created: Covered | null;
  onWritten: () => void;
  onClose: () => void;
}) {
  // The case stays in the Sheet while it slides out, after the hash has left it.
  const [shown, setShown] = useState(caseRef);
  if (caseRef !== undefined && caseRef !== shown) setShown(caseRef);

  return (
    <Sheet open={caseRef !== undefined} onOpenChange={(open) => open || onClose()}>
      <SheetContent
        // Wide enough for the steps table; the whole window below 1024px.
        className="w-full gap-0 overflow-y-auto sm:max-w-none lg:w-[min(64rem,85vw)]"
        // No trigger opened it (the hash did): give focus back to the case's row.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (shown !== undefined) rowLink(shown)?.focus();
        }}
        aria-describedby={undefined}
      >
        <SheetHeader className="pb-0">
          {/* The dialog's name; the document's own heading is the case title. */}
          <SheetTitle className="font-mono font-normal text-muted-foreground text-sm">
            {shown}
          </SheetTitle>
        </SheetHeader>
        <div className="p-4 pt-2">
          {shown === undefined ? null : (
            <CaseDetail
              key={`${shown}:${reload}`}
              caseRef={shown}
              written={created?.created.some((c) => c.ref === shown) ? created : undefined}
              onWritten={onWritten}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The first link to the case in the list behind the Sheet: its id cell. */
function rowLink(ref: string): HTMLAnchorElement | undefined {
  const href = formatRoute({ view: "case", ref });
  return [...document.querySelectorAll<HTMLAnchorElement>("main a")].find(
    (a) => a.getAttribute("href") === href,
  );
}
