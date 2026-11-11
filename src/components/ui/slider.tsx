"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** shadcn Slider on the design system's tokens. */
function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none select-none items-center data-[disabled]:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-gray-90 dark:bg-gray-20">
        <SliderPrimitive.Range className="absolute h-full bg-text-primary-default" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className="block size-4 cursor-grab rounded-full border-2 border-text-primary-default bg-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-50 active:cursor-grabbing dark:bg-gray-10"
        aria-label={props["aria-label"]}
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
