import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names, letting later Tailwind utilities win (shadcn/ui helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
