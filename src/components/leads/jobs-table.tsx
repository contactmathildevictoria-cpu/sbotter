import { getTranslations } from "next-intl/server";
import { ArrowUpRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { JobsPage } from "@/lib/leads/queries";
import { formatRelativeDate } from "@/lib/format";

export async function JobsTable({ page }: { page: JobsPage }) {
  const t = await getTranslations("Leads.columns");

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("title")}</TableHead>
            <TableHead>{t("company")}</TableHead>
            <TableHead>{t("location")}</TableHead>
            <TableHead>{t("category")}</TableHead>
            <TableHead>{t("postedAt")}</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.title}</div>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {row.company?.name ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {[row.location_city, row.country].filter(Boolean).join(", ") ||
                  "—"}
              </TableCell>
              <TableCell>
                {row.category ? (
                  <Badge variant="outline" className="capitalize">
                    {row.category}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {row.posted_at ? formatRelativeDate(row.posted_at) : "—"}
              </TableCell>
              <TableCell>
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open job posting"
                  className="text-muted-foreground hover:text-foreground inline-flex"
                >
                  <ArrowUpRight className="size-4" />
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
