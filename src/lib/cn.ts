import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and lets later Tailwind utilities win over earlier ones,
 * so a component's default padding can be overridden by a caller without
 * both classes ending up in the output and the cascade deciding at random.
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
