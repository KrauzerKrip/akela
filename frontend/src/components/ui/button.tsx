import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary px-3 py-2 text-white hover:bg-blue-500",
        secondary: "bg-zinc-800 px-3 py-2 text-zinc-100 hover:bg-zinc-700",
        ghost: "px-2 py-2 text-zinc-100 hover:bg-zinc-800",
        danger: "bg-danger px-3 py-2 text-white hover:bg-red-500",
      },
      size: {
        default: "h-9",
        sm: "h-8 px-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
