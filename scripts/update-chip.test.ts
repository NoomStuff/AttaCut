import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { UpdateChip } from "../src/renderer/src/components/UpdateChip";

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
      })
   );
   expect(html).toContain(`aria-label="${label}"`);
   expect(html).toContain('aria-disabled="false"');
   expect(html).toContain(`data-icon="${icon}"`);
   expect(html).not.toContain('data-icon="check"');
});
