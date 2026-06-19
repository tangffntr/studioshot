/* web/src/index.tsx — 入口 */
import { render } from "solid-js/web";
import App from "./App";

const root = document.getElementById("root");
if (root) render(() => <App />, root);
