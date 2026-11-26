"use client";

import { PaintBucket, SquareRoundCorner, Type } from "lucide-react";

function ShadowIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
      <path d="M13 12h5" />
      <path d="M13 15h4" />
      <path d="M13 18h1" />
      <path d="M13 9h4" />
      <path d="M13 6h1" />
    </svg>
  );
}

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/luova-ui/tabs";

import ColorSettings from "./ColorSettings";

import ShadowsSettings from "./ShadowsSettings";
import ShapeSettings from "./ShapeSettings";
import TypographySettings from "./TypographySettings";

export default function ThemeEditor() {
  return (
    <div className="theme-editor-root flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin min-h-0">
        <div className="scrollbar-thin-compensate">
          <div className="py-4 px-5 space-y-3">
            <Tabs defaultValue="colors" className="w-full">
              <TabsList
                className="grid w-full grid-cols-4"
                style={{ "--spacing": "0.25rem" } as React.CSSProperties}
              >
                <TabsTrigger value="colors" title="Colors" className="px-0">
                  <PaintBucket className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger
                  value="typography"
                  title="Typography"
                  className="px-0"
                >
                  <Type className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="shape" title="Shape" className="px-0">
                  <SquareRoundCorner className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="shadows" title="Shadows" className="px-0">
                  <ShadowIcon className="h-4 w-4" />
                </TabsTrigger>
              </TabsList>

              <TabsContent value="colors" className="space-y-3 mt-3">
                <ColorSettings />
              </TabsContent>

              <TabsContent value="typography" className="space-y-3 mt-3">
                <TypographySettings />
              </TabsContent>

              <TabsContent value="shape" className="space-y-3 mt-3">
                <ShapeSettings />
              </TabsContent>

              <TabsContent value="shadows" className="space-y-3 mt-3">
                <ShadowsSettings />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
