import {
    CircleCheckIcon,
    CircleXIcon,
    InfoIcon,
    LoaderCircleIcon,
    TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
    return (
        <Sonner
            position="top-center"
            theme="dark"
            className="toaster group"
            icons={{
                success: <CircleCheckIcon className="size-4" />,
                info: <InfoIcon className="size-4" />,
                warning: <TriangleAlertIcon className="size-4" />,
                error: <CircleXIcon className="size-4" />,
                loading: <LoaderCircleIcon className="size-4 animate-spin" />,
            }}
            toastOptions={{
                style: {
                    background: "rgba(0, 0, 0, 0.85)",
                    color: "#fff",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    backdropFilter: "blur(8px)",
                },
            }}
            {...props}
        />
    )
}

export { Toaster }
