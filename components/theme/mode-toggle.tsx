"use client";

import { Moon, Sun } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/luova-ui/button";
import { isInteractiveTextElement } from "@/lib/luova-utils";
import { useThemeStore } from "@/stores/theme-store";

export function ModeToggle() {
  const currentMode = useThemeStore((state) => state.currentMode);
  const setCurrentMode = useThemeStore((state) => state.setCurrentMode);

  const handleToggle = React.useCallback(() => {
    const newMode = currentMode === "dark" ? "light" : "dark";
    // Toggle the class on the HTML element directly
    if (newMode === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    setCurrentMode(newMode);
  }, [currentMode, setCurrentMode]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInteractiveTextElement(e.target)) return;

      if (
        e.key.toLowerCase() === "d" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        handleToggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToggle]);

  return (
    <Button
      variant="outline"
      size="icon"
      className="text-foreground"
      onClick={handleToggle}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
