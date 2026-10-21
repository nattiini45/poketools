"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";

export default function AppTooltipProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  );
}
