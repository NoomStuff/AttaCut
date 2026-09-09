import { createRoot } from "react-dom/client";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import App from "./App";
import "./styles.css";
config.autoAddCss = false;
createRoot(document.getElementById("root")!).render(<App />);
