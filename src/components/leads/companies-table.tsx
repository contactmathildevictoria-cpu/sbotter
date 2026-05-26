import { getTranslations } from "next-intl/server";
import { ArrowUpRight, Mail, Phone, ShieldCheck, User } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EnrichStatus } from "@/components/leads/enrich-status";
import type { CompaniesPage } from "@/lib/leads/queries";
import { formatRelativeDate } from "@/lib/format";

// Danish numbers come from CVR without a country code; prefix +45 for tel: links.
function telHref(phone: string): string {
  const trimmed = phone.replace(/\s+/g, "");
  return trimmed.startsWith("+") ? trimmed : `+45${trimmed}`;
}

export async function CompaniesTable({ page }: { page: CompaniesPage }) {
  const t = await getTranslations("Leads.columns");
  const tEnrich = await getTranslations("Leads.enrich");
  const tKrak = await getTranslations("Leads.krak");

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("contact")}</TableHead>
            <TableHead>{t("location")}</TableHead>
            <TableHead className="text-right">{t("openJobs")}</TableHead>
            <TableHead>{t("lastSeen")}</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.map((row) => {
            // CVR is always preferred; fall back to Krak data only when the CVR
            // field is empty. krak_* are never written over CVR columns, so the
            // fallback is the only place Krak data surfaces.
            const phone = row.phone ?? row.krak_phone;
            const contactName =
              row.contact_person_name ?? row.krak_contact_person;
            const contactTitle = row.contact_person_name
              ? null
              : row.krak_contact_title;
            const phoneFromKrak = !row.phone && Boolean(row.krak_phone);
            const nameFromKrak =
              !row.contact_person_name && Boolean(row.krak_contact_person);
            const hasContact = Boolean(contactName || phone || row.email);
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5 font-medium">
                    {row.name}
                    {row.is_ad_protected ? (
                      <span
                        title={tEnrich("adProtected")}
                        className="inline-flex"
                      >
                        <ShieldCheck className="text-muted-foreground size-3.5 shrink-0" />
                      </span>
                    ) : null}
                    {row.is_bankrupt ? (
                      <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                        {tEnrich("bankrupt")}
                      </Badge>
                    ) : null}
                  </div>
                  {row.cvr_industry_text || row.industry ? (
                    <div className="text-muted-foreground text-xs">
                      {row.cvr_industry_text ?? row.industry}
                    </div>
                  ) : null}
                </TableCell>

                <TableCell className="text-sm">
                  <div className="space-y-0.5">
                    {contactName ? (
                      <div className="flex items-center gap-1.5">
                        <User className="text-muted-foreground size-3.5" />
                        <span>{contactName}</span>
                        {contactTitle ? (
                          <span className="text-muted-foreground">
                            · {contactTitle}
                          </span>
                        ) : null}
                        {nameFromKrak ? (
                          <span
                            title={tKrak("sourceKrak")}
                            className="text-muted-foreground text-[10px] uppercase"
                          >
                            {tKrak("source")}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {phone ? (
                      <a
                        href={`tel:${telHref(phone)}`}
                        className="flex items-center gap-1.5 underline-offset-4 hover:underline"
                      >
                        <Phone className="text-muted-foreground size-3.5" />
                        {phone}
                        {phoneFromKrak ? (
                          <span
                            title={tKrak("sourceKrak")}
                            className="text-muted-foreground text-[10px] uppercase"
                          >
                            {tKrak("source")}
                          </span>
                        ) : null}
                      </a>
                    ) : null}
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        className="flex items-center gap-1.5 underline-offset-4 hover:underline"
                      >
                        <Mail className="text-muted-foreground size-3.5" />
                        {row.email}
                      </a>
                    ) : null}
                    {!hasContact ? (
                      <EnrichStatus
                        companyId={row.id}
                        status={row.cvr_enrichment_status}
                      />
                    ) : null}
                  </div>
                </TableCell>

                <TableCell className="text-muted-foreground text-sm">
                  {[row.location_city, row.country].filter(Boolean).join(", ") ||
                    "—"}
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
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
