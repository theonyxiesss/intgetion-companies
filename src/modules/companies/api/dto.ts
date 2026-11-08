import type { CompanyRow, CompanySummary } from "../service/company-service";

export function toCompanyDto(company: CompanyRow | CompanySummary) {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    domain: company.domain,
    websiteUrl: company.websiteUrl,
    linkedinUrl: company.linkedinUrl,
    telegramUrl: company.telegramUrl,
    xUrl: company.xUrl,
    description: company.description,
    logoPath: company.logoPath,
    country: company.country,
    size: company.size,
    status: company.status,
    origin: company.origin,
  };
}
