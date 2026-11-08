import { z } from "zod";
import { isValidTimeZone as isIanaTimeZone } from "@intgetion/kit";
import { publicHttpUrl } from "../lib/company-mark";

const optionalUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => publicHttpUrl(value) !== null, "http_url_required")
  .nullable()
  .optional();
const domainInput = z
  .string()
  .trim()
  .max(253)
  .regex(
    /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i,
  )
  .nullable()
  .optional();
export const createCompanyInput = z.object({
  name: z.string().trim().min(2).max(160),
  domain: domainInput,
  websiteUrl: optionalUrl,
  linkedinUrl: optionalUrl,
  telegramUrl: optionalUrl,
  xUrl: optionalUrl,
  description: z.string().trim().max(5000).nullable().optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullable()
    .optional(),
  size: z
    .enum(["s1_10", "s11_50", "s51_200", "s201_1000", "s1000_plus"])
    .nullable()
    .optional(),
  timezone: z
    .string()
    .trim()
    .max(80)
    .refine(isIanaTimeZone, { error: "invalid_timezone" })
    .nullable()
    .optional(),
});

export const patchCompanyInput = createCompanyInput.partial().extend({
  legalName: z.string().trim().max(240).nullable().optional(),
  registrationNumber: z.string().trim().max(120).nullable().optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanyInput>;
export type PatchCompanyInput = z.infer<typeof patchCompanyInput>;

/** `POST /api/companies/:id/verification` (10B). */
export const requestVerificationInput = z
  .object({
    method: z.enum(["corporate_email", "dns_txt"]),
    target: z.string().trim().max(254).optional(),
  })
  .strict();

/** `POST /api/companies/:id/verification/confirm` (10B). */
export const confirmVerificationInput = z
  .object({ token: z.string().trim().min(20).max(200) })
  .strict();
