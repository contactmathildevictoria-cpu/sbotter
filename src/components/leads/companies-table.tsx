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
import type { CompaniesPage } from "@/lib/leads/queries";
import { formatRelativeDate } from "@/lib/format";

export async function CompaniesTable({ page }: { page: CompaniesPage }) {
  const t = await getTranslations("Leads.columns");

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("location")}</TableHead>
            <TableHead>{t("industry")}</TableHead>
            <TableHead className="text-right">{t("openJobs")}</TableHead>
            <TableHead>{t("lastSeen")}</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium">{row.name}</div>
                {row.website ? (
                  <a
                    href={row.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground text-xs underline-offset-4 hover:underline"
                  >
                    {row.domain ?? row.website}
                  </a>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {[row.location_city, row.country].filter(Boolean).join(", ") ||
                  "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {row.industry ?? "—"}
              </TableCell>
              <TableCell className="text-right">
                <Badge variant="secondary" className="tabular-nums">
                  {row.open_jobs_count}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatRelativeDate(row.last_seen_at)}
              </TableCell>
              <TableCell>
                {row.website ? (
                  <a
                    href={row.website}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open website"
                    className="text-muted-foreground hover:text-foreground inline-flex"
                  >
                    <ArrowUpRight className="size-4" />
                  </a>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
