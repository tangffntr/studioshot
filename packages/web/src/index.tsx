/* web/src/index.tsx — 入口，Router 装配 */
import "./styles/global.css";
import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { AppLayout } from "./App";
import ChatView from "./views/ChatView";
import HistoryView from "./views/HistoryView";
import AssetsView from "./views/AssetsView";
import SettingsView from "./views/SettingsView";

const root = document.getElementById("root");
if (root) render(() => (
  <Router root={AppLayout}>
    <Route path="/" component={ChatView} />
    <Route path="/history" component={HistoryView} />
    <Route path="/assets" component={AssetsView} />
    <Route path="/settings" component={SettingsView} />
  </Router>
), root);
