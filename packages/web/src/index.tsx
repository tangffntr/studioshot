/* web/src/index.tsx — 入口，Router 装配 */
import "./styles/global.css";
import "./styles/canvas.css";
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { AppLayout } from "./App";
import ChatView from "./views/ChatView";
import HistoryView from "./views/HistoryView";
import MaterialsView from "./views/MaterialsView";
import AssetsView from "./views/AssetsView";
import CanvasView from "./views/CanvasView";
import SettingsView from "./views/SettingsView";

const root = document.getElementById("root");
if (root) render(() => (
  <Router root={AppLayout}>
    <Route path="/" component={ChatView} />
    <Route path="/history" component={HistoryView} />
    <Route path="/materials" component={MaterialsView} />
    <Route path="/assets" component={AssetsView} />
    <Route path="/canvas" component={CanvasView} />
    <Route path="/settings" component={SettingsView} />
  </Router>
), root);
