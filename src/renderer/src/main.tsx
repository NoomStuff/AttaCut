import { createRoot } from "react-dom/client";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import App from "./App";
import "./styles.css";
import { installKeyboardMode } from "./lib/keyboardMode";
import { createErrorReporter } from "./lib/error-reporting";
config.autoAddCss = false;
const reportError = createErrorReporter((error) => window.desktop.reportError(error));
window.addEventListener("error", (event) =>
   reportError("error", event.error ?? event.message, event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined)
);
window.addEventListener("unhandledrejection", (event) => reportError("rejection", event.reason));
installKeyboardMode();
createRoot(document.getElementById("root")!, {
   onUncaughtError: (error, info) => reportError("react", error, info.componentStack ?? undefined),
   onCaughtError: (error, info) => reportError("react", error, info.componentStack ?? undefined),
}).render(<App />);
// Tell main once the first app frame has painted: the window is presented then, so the
// splash hands over to real content instead of an empty root element.
requestAnimationFrame(() => {
   requestAnimationFrame(() => window.desktop.rendererReady());
});
