import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { UpdateChip } from "./UpdateChip";

it.each([
   ["ready", "automatic", "Restart to update", "download"],
   ["downloaded", "download", "Show in Downloads", "folder-open"],
] as const)("keeps the %s update actionable without a completion checkmark", (phase, mode, label, icon) => {
   const html = renderToStaticMarkup(
      createElement(UpdateChip, {
         update: { version: "1.2.3", name: "AttaCut 1.2.3", mode, url: "https://example.com/release" },
         status: { phase, version: "1.2.3", percent: 100 },
         onDownload: () => {},
         onRestart: () => {},
         onRelease: () => {},
         onReveal: () => {},
         onCancelRestart: () => {},
      })
   );
   expect(html).toContain(`aria-label="${label}"`);
   expect(html).toContain('aria-disabled="false"');
   expect(html).toContain(`data-icon="${icon}"`);
   expect(html).not.toContain('data-icon="check"');
});

it.each([
   [{ phase: "installing", percent: 40, waitingFor: "export" }, "automatic", "Updating after export 40%", "false"],
   [{ phase: "installing", percent: null }, "automatic", "Restarting to update", "true"],
   [{ phase: "not-applied", percent: null }, "releases", "Update didn't apply", "false"],
] as const)("explains the restart state %j", (status, mode, label, disabled) => {
   const html = renderToStaticMarkup(
      createElement(UpdateChip, {
         update: { version: "1.2.3", name: "AttaCut 1.2.3", mode, url: "https://example.com/release" },
         status: { version: "1.2.3", ...status },
         onDownload: () => {},
         onRestart: () => {},
         onRelease: () => {},
         onReveal: () => {},
         onCancelRestart: () => {},
      })
   );
   expect(html).toContain(`aria-label="${label.replace("'", "&#x27;")}"`);
   expect(html).toContain(`aria-disabled="${disabled}"`);
});
