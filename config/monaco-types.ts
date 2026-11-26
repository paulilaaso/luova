export const MONACO_EXTRA_LIB = `
    declare module "@/lib/utils" {
        export function cn(...classes: any[]): string;
    }
    declare module "lucide-react";
    declare module "framer-motion";
    declare module "@radix-ui/*";
    declare module "@base-ui/*";
    
    declare module "react" {
        export type ComponentType<P = {}> = any;
        export type ReactNode = any;
        export default any;
    }
`;
