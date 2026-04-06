# Auto-fulfill and auto-pay (draft for counsel review)

**Not legal advice.** This document summarizes product behavior and suggested disclosures for Terms of Service, Privacy Policy, and in-app acknowledgments. Have qualified counsel review before production.

## Auto-fulfill (companies)

- Companies may enable **Auto-fulfill** on a job with parameters (budget window, optional minimum contractor rating and review count, rate limits derived from budget ÷ hours or explicit caps).
- When enabled and terms are acknowledged, the platform may **automatically accept** an applicant who satisfies those rules, without a manual hire click.
- Companies remain responsible for job accuracy, budget adequacy, and funding payment methods.

## Timesheets, location, and auto-pay

- **Payments** may be processed after timesheets are **company-approved** or **auto-approved** after the platform’s stated review window (e.g. pending timesheets past a deadline), subject to platform rules and successful payment processing.
- Recorded **hours**, **clock in/out**, and **location/time data** may be used to verify work, prevent fraud, and calculate amounts.
- Companies should review timesheets within the dispute window described in the Terms.

## Disputes

- Companies may **dispute** a timesheet or charge **only within the timeframe** stated in the Terms (aligned with the platform’s review/auto-approval window). After that window, the platform may treat the timesheet as approved and **initiate payout** to the worker per policy.
- Workers and companies must use in-platform dispute flows where provided.

## Privacy (summary)

- Location and timing data are processed as described in the Privacy Policy for **service delivery, safety, verification, and billing**.

## Versioning

- In-app acknowledgment is tied to `AUTO_FULFILL_LEGAL_VERSION` in code (`shared/autoFulfillLegal.ts`). Bump when substantive terms change; new published jobs with Auto-fulfill require re-acknowledgment.
