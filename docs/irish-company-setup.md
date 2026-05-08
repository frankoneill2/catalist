# Irish Limited Company Setup

A practical guide to incorporating an Irish limited company for Catalist. This is not legal or tax advice — for anything beyond the mechanics, get a real accountant. The mechanics themselves are well-trodden and not complicated.

## Why incorporate

A limited company is a separate legal entity from you. Three things this buys:

1. **Limited liability.** If something goes badly wrong (a data breach with a regulatory fine, a contract dispute), the company is liable, not you personally — your house and savings sit behind a corporate wall. The wall isn't absolute (directors can still be personally liable for fraud, certain GDPR breaches if grossly negligent) but it's substantial and meaningful.

2. **Counterparty credibility.** HSE hospitals and voluntary hospitals contract with limited companies, not individuals. The DPA template, the privacy policy, and the terms of service all want a "the Company" to refer to. Without one, the conversation with a hospital's procurement and legal teams is much harder.

3. **Tax efficiency, eventually.** Below ~€30k of company profit it makes very little difference. Above that, salary plus dividends planning starts to matter. The Irish corporation tax rate on trading income is 12.5% — among the lowest in Europe. Don't bank on this until you talk to an accountant.

## When to incorporate

**Before** any of the following:

- Taking real money from anyone (paying customers, investors, grants).
- Signing any DPA with a hospital.
- Processing real patient data at scale (i.e. before the security rebuild's Phase 1 launches publicly).
- Public launch.

**Not before** you start building. Catalist can sit as a personal hobby project in your name for as long as it's pre-launch. The incorporation step belongs in [Phase 0 of the rebuild plan](security-rebuild-plan.md), alongside the DPIA and privacy policy work.

## The structure

The standard private company in Ireland since the Companies Act 2014 is **LTD** — a private company limited by shares. Other forms exist (DAC, CLG, ULC, LLP) but unless you have a specific reason, LTD is what you want for a software company. The rest of this guide assumes LTD.

## Step-by-step

### 1. Pick names

Two separate decisions:

- **Legal name** — filed with the Companies Registration Office (CRO), appears on contracts and the public register.
- **Trading name / brand** — what users see (Wardround).

They don't have to match. Many founders deliberately separate them so the entity can hold multiple products if you ever pivot. Common patterns: *Wardround Ltd* (aligned), or *[YourSurname] Health Ltd* (more flexible).

Sensitive words ("Bank", "Royal", "Insurance") need permission. Names too similar to existing companies get rejected. CORE — the CRO's online portal — lets you check availability before submitting.

### 2. Decide on the people

- **At least one director.** EEA residence requirement applies — at least one director must be resident in an EEA country. You're in Ireland, so you satisfy this as the sole director.

- **Company secretary — separate from the sole director.** Irish-specific catch: a sole director cannot also be the company secretary. You need a separate person or a corporate body in the secretary role. Most sole founders use a company secretary service (€150–300/year, usually bundled with a formation service or your accountant).

- **Beneficial owner.** Under the Central Register of Beneficial Ownership (RBO), you'll need to file beneficial ownership details within 5 months of incorporation. As sole shareholder, you're the only beneficial owner. The filing is free, online, and takes about 15 minutes.

### 3. Decide on share structure

Keep it simple unless you have specific plans:

- 100 ordinary shares at €1 each, all issued to you.
- One share class.

Authorised share capital was abolished for LTD companies in 2014, so there's nothing to specify there. You can issue more shares later if you take investment.

### 4. Pick a registered office

Must be a real Irish address. It goes on the public register and is permanently public. Three options:

- **Your home address.** Free, but it's permanently public. Worth thinking about whether you mind.
- **A registered office service.** €100–200/year for privacy.
- **Your accountant's address.** Often included as part of an annual service package.

### 5. Incorporate

Three routes:

- **DIY via CORE.** Around €50, takes a few business days.
- **Formation service** (1stFormations.ie, CompanyBureau, or similar). €150–300, typically includes registered office service and company secretary for the first year. Faster turnaround, less paperwork.
- **Through your accountant.** More expensive but they handle everything and you start the relationship.

Given you need a separate company secretary anyway, a formation service is probably the cleanest route for a solo founder. You're not saving meaningful money DIY-ing it.

### 6. Immediately after incorporation

The company exists; now wire it up.

- **Open a business bank account.** Revolut Business, N26 Business, Fire.com (Irish), or Wise Business open in days online. AIB / Bank of Ireland take longer (weeks) and typically want an in-person meeting, but some hospitals' procurement prefers seeing an Irish high-street bank.

- **Register for Corporation Tax** with Revenue via ROS.

- **Decide on the accounting period.** Default is the day after incorporation, with year-end 12 months later. Many people shift this to 31 December for tidiness.

- **VAT:** register if turnover exceeds €42,500 (services). Voluntary registration below that — sometimes worth it for credibility or for reclaiming input VAT.

- **PAYE:** register if you'll pay yourself a salary, even nominally. Most directors do.

- **Set up bookkeeping.** Surf Accounts, Bullet, or Xero. Don't try to do it in spreadsheets.

- **File the RBO** within 5 months. Free, online, takes 15 minutes.

### 7. Get an accountant

For a small Irish company, expect €1,500–3,000/year. Worth every euro:

- They handle the annual filings (CRO Annual Return, Revenue CT1).
- They advise on salary vs dividends — relevant if you're already on PAYE income from clinical work, since the optimisation is more nuanced for higher-rate earners.
- They flag things you'd otherwise miss (preliminary tax dates, R&D tax credits if applicable).

Find one who knows tech / SaaS specifically. Don't pick the one who does your local pub.

## Ongoing obligations

- **Annual Return** to CRO every year on your Annual Return Date (first one is 6 months post-incorporation, then yearly). ~€20 fee.
- **Financial statements** filed with the CRO with the Annual Return.
- **CT1 Corporation Tax return** to Revenue annually.
- **Preliminary tax** payments to Revenue (catches a lot of people the first year).
- **Maintain RBO** — update if beneficial ownership changes.
- **Director's Form 11** for personal tax (you, separately).

An accountant handles most of this once they're engaged.

## Cost summary, year one

| Item | Cost |
|---|---|
| Incorporation + first year company secretary + registered office (formation service) | ~€300 |
| Accountant | €1,500–3,000 |
| Annual return fee | ~€20 |
| Bank account | free (digital) |
| Professional indemnity insurance for clinical software | €500–1,500 |

**Total year one: roughly €2,000–4,500** beyond your normal personal expenses. Then ~€1,500–3,000/year thereafter.

## Timeline

| When | What |
|---|---|
| Day 1 | Apply via CORE or formation service |
| Day 3–7 | Company exists, start opening bank account |
| Week 1–2 | Bank account active, register for CT/PAYE/VAT |
| Month 1–3 | Find accountant, set up bookkeeping, file RBO |
| Month 6 | First Annual Return Date |

The whole process is well under two months of low-effort steps.

## Things to discuss with an accountant before incorporating

Worth a paid initial consultation (often €100–200, sometimes free as a first conversation):

- **Optimal salary vs dividend split** given your existing PAYE income from clinical work.
- **Whether to bring family members in as shareholders** for tax efficiency (a sometimes-controversial area, needs careful structuring).
- **R&D tax credits** — Catalist development could qualify under Irish R&D credit rules (currently 25%); the accountant can tell you whether the work qualifies and what records to keep.
- **Pension contributions through the company** — significantly more efficient than personal pension contributions for higher-rate taxpayers.

These all benefit from being decided early — retroactive restructuring is painful.

## What changes once the company exists

Once incorporated, several things in the rebuild plan move forward:

- The Google **DPA** can be moved to the company's name.
- The **privacy policy** identifies the company as the data controller.
- The **DPIA** references the company.
- Any **DPA you sign with a hospital** is between the hospital and the company, not you personally.
- **Professional indemnity insurance** can be obtained in the company's name.

This is what unlocks the "talking to hospitals as a real software company" conversation.
