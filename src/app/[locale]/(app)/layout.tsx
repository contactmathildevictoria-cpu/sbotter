import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-svh flex-1">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar email={user.email ?? ""} />
        <main className="bg-muted/30 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
