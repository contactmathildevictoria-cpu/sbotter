import { LocaleSwitcher } from "@/components/shell/locale-switcher";
import { SignOutButton } from "@/components/shell/sign-out-button";

export function Topbar({ email }: { email: string }) {
  return (
    <header className="border-border/60 bg-background flex h-14 items-center justify-between border-b px-6">
      <span className="text-muted-foreground text-sm">{email}</span>
      <div className="flex items-center gap-2">
        <LocaleSwitcher />
        <SignOutButton />
      </div>
    </header>
  );
}
