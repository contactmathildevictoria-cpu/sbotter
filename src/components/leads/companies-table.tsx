import { getTranslations } from "next-intl/server";
import { ArrowUpRight, Globe, Mail, Phone, ShieldCheck, User } from "lucide-react";
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

// Bare hostname for a compact, clickable website link.
function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function CompaniesTable({ page }: { page: CompaniesPage }) {
  const t = await getTranslations("Leads.columns");
  const tEnrich = await getTranslations("Leads.enrich");

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
            // CVR is preferred; fall back to website-scraped values per field.
            const phone = row.phone ?? row.website_phone;
            const email = row.email ?? row.website_email;
            const contactName =
              row.contact_person_name ?? row.website_contact_person;
            const title = row.website_contact_title; // CVR provides no title
            const hasCvrContact = Boolean(
              row.contact_person_name || row.phone || row.email,
            );
            // Any displayed contact came from the website (not CVR)?
            const usesWebsite =
              !hasCvrContact &&
              Boolean(
                row.website_phone ||
                  row.website_email ||
                  row.website_contact_person,
              );
            const hasAnyContact = Boolean(contactName || phone || email);
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
                  {row.website ? (
                    <a
                      href={row.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                    >
                      <Globe className="size-3" />
                      {displayHost(row.website)}
                    </a>
                  ) : null}
                </TableCell>

                <TableCell className="text-sm">
                  <div className="space-y-0.5">
                    {contactName ? (
                      <div className="flex items-center gap-1.5">
                        <User className="text-muted-foreground size-3.5" />
                        <span>{contactName}</span>
                        {title ? (
                          <span className="text-muted-foreground">· {title}</span>
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
                      </a>
                    ) : null}
                    {email ? (
                      <a
                        href={`mailto:${email}`}
                        className="flex items-center gap-1.5 underline-offset-4 hover:underline"
                      >
                        <Mail className="text-muted-foreground size-3.5" />
                        {email}
                      </a>
                    ) : null}
                    {usesWebsite ? (
                      <div className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Globe className="size-3" />
                        {tEnrich("fromWebsite")}
                      </div>
                    ) : null}
                    {!hasAnyContact ? (
                      <EnrichStatus
                        companyId={row.id}
                        cvrStatus={row.cvr_enrichment_status}
                        websiteStatus={row.website_scrape_status}
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
