/**
 * web/src/context/theme.tsx — 明暗双主题
 * localStorage 持久化，切换 document.documentElement.dataset.theme
 */
import { createSignal } from "solid-js";

type Theme = "dark" | "light";

const [theme, setTheme] = createSignal<Theme>(
  (localStorage.getItem("theme") as Theme) || "dark"
);

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("theme", t);
  setTheme(t);
}

// 初始化应用
apply(theme());

export function toggleTheme() {
  apply(theme() === "dark" ? "light" : "dark");
}

export { theme };
