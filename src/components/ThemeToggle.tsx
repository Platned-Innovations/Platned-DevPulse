"use client";

import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";
const KEY = "devpulse-theme";
const NEXT: Record<Choice, Choice> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Choice, string> = { system: "Auto", light: "Light", dark: "Dark" };
const ICON: Record<Choice, string> = { system: "◐", light: "☀", dark: "☾" };

function read(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** Cycles Auto (follow the system) -> Light -> Dark. The choice is remembered in this browser. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    setChoice(read());
  }, []);

  const change = () => {
    const next = NEXT[choice];
    setChoice(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: the choice just lasts for this page view */
    }
  };

  return (
    <button type="button" className="theme-toggle" onClick={change} title={`Theme: ${LABEL[choice]} (click to change)`} aria-label={`Theme: ${LABEL[choice]}. Click to switch.`}>
      <span aria-hidden>{ICON[choice]}</span> {LABEL[choice]}
    </button>
  );
}
