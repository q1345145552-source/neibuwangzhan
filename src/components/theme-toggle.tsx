"use client";

import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={theme === "dark" ? "切换为浅色模式" : "切换为深色模式"}
      onClick={toggle}
      className="text-[var(--sidebar-foreground)]/60 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
    >
      {theme === "dark" ? (
        <Sun className="size-3.5" aria-hidden="true" />
      ) : (
        <Moon className="size-3.5" aria-hidden="true" />
      )}
    </Button>
  );
}
