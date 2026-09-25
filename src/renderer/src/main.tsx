import { createRoot } from "react-dom/client";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import App from "./App";
import "./styles.css";
config.autoAddCss = false;
createRoot(document.getElementById("root")!).render(<App />);
// Tell main once the first app frame has painted: the window is presented then, so the
// splash hands over to real content instead of an empty root element.
requestAnimationFrame(() => {
   requestAnimationFrame(() => window.desktop.rendererReady());
});
