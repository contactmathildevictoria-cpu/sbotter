import { Inbox } from "lucide-react";

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="bg-card text-muted-foreground flex flex-col items-center justify-center rounded-xl border px-6 py-16 text-center">
      <Inbox className="mb-3 size-8 opacity-60" />
      <h3 className="text-foreground text-base font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm">{body}</p>
    </div>
  );
}
