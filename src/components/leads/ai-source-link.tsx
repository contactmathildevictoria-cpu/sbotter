import { Sparkles } from "lucide-react";

/**
 * The marker an AI-found value must always carry.
 *
 * A number from the AI layer is the only one not verified by a trusted source,
 * so it is never shown bare: this links to the page the model read it from, so
 * the seller can see it was found automatically and check it themselves.
 *
 * Shared by the lead card and the pool table so the two can't drift — an AI
 * value must not appear unmarked anywhere. See docs/ai-phone-layer.md.
 *
 * Renders an <a>, so place it as a SIBLING of a tel:/mailto: link, never
 * inside one — nested anchors are invalid HTML. Kept free of event handlers so
 * it works in server components too.
 */
export function AiSourceLink({
  href,
  label,
  className,
}: {
  href: string;
  /** Translated: "Found automatically — click to see the source." */
  label: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className={
        className ??
        "text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center"
      }
    >
      <Sparkles className="size-3.5" aria-hidden />
    </a>
  );
}
