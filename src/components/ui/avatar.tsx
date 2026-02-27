import * as React from "react"
import { cn } from "@/lib/utils"

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string
  alt?: string
  fallback?: string
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, alt, fallback, children, ...props }, ref) => {
    const [imgError, setImgError] = React.useState(false)
    const normalizedAlt = typeof alt === "string" && alt.trim() ? alt : fallback || "avatar"

    return (
      <div
        ref={ref}
        className={cn(
          "relative flex size-10 shrink-0 overflow-hidden rounded-full",
          className
        )}
        {...props}
      >
        {src && !imgError ? (
          <img
            src={src}
            alt={normalizedAlt}
            className="aspect-square size-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="bg-muted flex size-full items-center justify-center rounded-full text-sm font-medium">
            {fallback || "?"}
          </div>
        )}
        {children}
      </div>
    )
  }
)
Avatar.displayName = "Avatar"

export { Avatar }


