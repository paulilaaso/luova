"use client";

import { ChevronDown } from "lucide-react";
import type React from "react";
import { Card } from "@/components/luova-ui/card";
import { cn } from "@/lib/luova-utils";

interface ExpandableCardProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  leading?: React.ReactNode;
  headerAction?: React.ReactNode;
  noPadding?: boolean;
}

export function ExpandableCard({
  title,
  isExpanded,
  onToggle,
  children,
  leading,
  headerAction,
  noPadding,
}: ExpandableCardProps) {
  return (
    <Card className="!py-0 p-0 overflow-hidden shadow-none border gap-0 flex flex-col">
      {/* biome-ignore lint/a11y/useSemanticElements: role=button inside card header */}
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-3 px-4 hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {leading}
        <div
          className={cn(
            "flex items-center justify-between py-2 text-xs font-medium text-muted-foreground tracking-wider uppercase flex-1"
          )}
        >
          <span className="text-left">{title}</span>
          <div className="flex items-center gap-2">
            {headerAction && (
              // biome-ignore lint/a11y/useSemanticElements: button role inside clickable header
              <div
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
              >
                {headerAction}
              </div>
            )}
            <ChevronDown
              className={cn(
                "w-4 h-4 transition-transform",
                isExpanded && "rotate-180"
              )}
            />
          </div>
        </div>
      </div>
      {isExpanded && (
        <div
          className={cn(
            noPadding ? "p-0" : "px-4 pt-3 pb-4",
            "border-t border-border"
          )}
        >
          {children}
        </div>
      )}
    </Card>
  );
}
