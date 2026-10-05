import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  { variants: {
    variant: {
      default: "bg-foreground text-background hover:opacity-85",
      outline: "border border-border bg-transparent hover:bg-muted",
      ghost: "hover:bg-muted text-foreground",
      destructive: "bg-destructive text-white hover:opacity-85",
    },
    size: { default: "px-5 py-2.5", sm: "px-4 py-2", icon: "size-11" },
  }, defaultVariants: { variant: "default", size: "default" } },
);

function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
export { Button, buttonVariants };
