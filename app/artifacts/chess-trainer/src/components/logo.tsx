import { Link } from "wouter";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** Show the tagline under the wordmark. */
  showTagline?: boolean;
  /** Link the logo to the home page. */
  linkHome?: boolean;
  /** Inline mark + text, or stacked for a hero-style landing header. */
  layout?: "inline" | "stacked";
  /** Show the mark on a green tile (best with stacked / large sizes). */
  markTile?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
};

const sizeStyles = {
  sm: {
    mark: "w-8 h-8",
    title: "text-xl",
    tagline: "text-sm",
    gap: "gap-2.5",
    textGap: "space-y-1",
  },
  md: {
    mark: "w-10 h-10",
    title: "text-3xl",
    tagline: "text-lg",
    gap: "gap-3",
    textGap: "space-y-1",
  },
  lg: {
    mark: "w-12 h-12",
    title: "text-3xl",
    tagline: "text-lg",
    gap: "gap-3.5",
    textGap: "space-y-1.5",
  },
  xl: {
    mark: "w-20 h-20 md:w-24 md:h-24",
    title: "text-4xl md:text-5xl",
    tagline: "text-lg md:text-xl",
    gap: "gap-5 md:gap-6",
    textGap: "space-y-2 md:space-y-2.5",
  },
} as const;

export function Logo({
  className,
  showTagline = false,
  linkHome = false,
  layout = "inline",
  markTile = false,
  size = "md",
}: LogoProps) {
  const styles = sizeStyles[size];
  const stacked = layout === "stacked";

  const content = (
    <div
      className={cn(
        stacked ? "flex flex-col items-start" : "flex items-start",
        styles.gap,
        className,
      )}
    >
      <BrandMark tile={markTile} className={styles.mark} />
      <div className={cn("min-w-0", styles.textGap)}>
        <p className={cn("font-serif text-primary tracking-tight leading-none", styles.title)}>
          Chess Opening Trainer
        </p>
        {showTagline && (
          <p className={cn("text-muted-foreground leading-snug max-w-prose", styles.tagline)}>
            Master the most essential openings move by move.
          </p>
        )}
      </div>
    </div>
  );

  if (linkHome) {
    return (
      <Link href="/" className="block no-underline hover:opacity-90 transition-opacity">
        {content}
      </Link>
    );
  }

  return content;
}
