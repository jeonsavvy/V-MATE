import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="top-center"
      richColors
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast rounded-lg border border-border bg-card text-card-foreground shadow-panel",
          title: "text-sm font-semibold tracking-[-0.015em]",
          description: "text-sm text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-secondary-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
