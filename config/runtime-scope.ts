import * as Accordion from "@radix-ui/react-accordion";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Avatar from "@radix-ui/react-avatar";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Collapsible from "@radix-ui/react-collapsible";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as HoverCard from "@radix-ui/react-hover-card";
import * as Label from "@radix-ui/react-label";
import * as Menubar from "@radix-ui/react-menubar";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Progress from "@radix-ui/react-progress";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Select from "@radix-ui/react-select";
import * as Separator from "@radix-ui/react-separator";
import * as Slider from "@radix-ui/react-slider";
import { Slot } from "@radix-ui/react-slot";
import * as Switch from "@radix-ui/react-switch";
import * as Tabs from "@radix-ui/react-tabs";
import * as Toast from "@radix-ui/react-toast";
import * as Toggle from "@radix-ui/react-toggle";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as FramerMotion from "framer-motion";
import * as LucideReact from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const RUNTIME_SCOPE: Record<string, any> = {
  react: React,
  "lucide-react": LucideReact,
  "framer-motion": FramerMotion,
  "@/lib/utils": { cn },
  "@radix-ui/react-accordion": Accordion,
  "@radix-ui/react-alert-dialog": AlertDialog,
  "@radix-ui/react-avatar": Avatar,
  "@radix-ui/react-checkbox": Checkbox,
  "@radix-ui/react-collapsible": Collapsible,
  "@radix-ui/react-context-menu": ContextMenu,
  "@radix-ui/react-dialog": Dialog,
  "@radix-ui/react-dropdown-menu": DropdownMenu,
  "@radix-ui/react-hover-card": HoverCard,
  "@radix-ui/react-label": Label,
  "@radix-ui/react-menubar": Menubar,
  "@radix-ui/react-navigation-menu": NavigationMenu,
  "@radix-ui/react-popover": Popover,
  "@radix-ui/react-progress": Progress,
  "@radix-ui/react-radio-group": RadioGroup,
  "@radix-ui/react-scroll-area": ScrollArea,
  "@radix-ui/react-select": Select,
  "@radix-ui/react-separator": Separator,
  "@radix-ui/react-slider": Slider,
  "@radix-ui/react-slot": { Slot },
  "@radix-ui/react-switch": Switch,
  "@radix-ui/react-tabs": Tabs,
  "@radix-ui/react-toast": Toast,
  "@radix-ui/react-toggle": Toggle,
  "@radix-ui/react-toggle-group": ToggleGroup,
  "@radix-ui/react-tooltip": Tooltip,
};

export async function customRequire(moduleId: string) {
  if (RUNTIME_SCOPE[moduleId]) {
    return RUNTIME_SCOPE[moduleId];
  }
  throw new Error(
    `[IMPORT_ERROR] Module "${moduleId}" is not available in the sandbox.`
  );
}
