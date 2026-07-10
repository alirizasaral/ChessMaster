import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  /** When true, renders on a rounded green tile (favicon / app-icon style). */
  tile?: boolean;
};

/**
 * Closed opening book with a pawn on the cover — shared brand mark.
 */
export function BrandMark({ className, tile = false }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {tile && <rect width="32" height="32" rx="7" className="fill-primary" />}
      <rect x="7" y="9" width="3" height="14" rx="0.5" className="fill-secondary-foreground/25" />
      <rect x="10" y="9" width="15" height="14" rx="1.25" className="fill-primary-foreground" />
      <path
        d="M17.5 12.75a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5Zm-1.85 5.1h3.7l-.95 4.15h-1.8l-.95-4.15Zm-2.4 4.15h8.5v1.35h-8.5V22Z"
        className="fill-primary"
      />
    </svg>
  );
}
