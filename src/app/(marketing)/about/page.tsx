import type { Metadata } from "next";
import Link from "next/link";

// Every claim on this page traces to a line in docs/client-facts.md. Section
// headings are interface furniture. The "chaired the board committee, then
// joined as HR Director" narrative is conflict 3 in that file and is
// deliberately not written — the two facts sit in separate sections with no
// bridging sentence.

export const metadata: Metadata = {
  title: "About",
  description:
    "Fifteen years in human resources across seven organisations and six " +
    "sectors — Yangeni Chendela's career, board work and consultancy.",
};

// Verbatim from the Career-history table (organisation, role, location) plus the
// obvious sector label from the Sectors line. Oldest first.
const CAREER = [
  { years: "2011–2014", role: "Regional Human Resources", org: "Zambeef Products PLC", where: "Kitwe", sector: "agri-processing" },
  { years: "2014–2016", role: "HR Manager", org: "Mika Group of Hotels", where: null, sector: "hospitality" },
  { years: "2016–2018", role: "Human Resources", org: "Smollan", where: "Lusaka", sector: "retail merchandising" },
  { years: "2018–2023", role: "HR and Administration Manager", org: "BDO Zambia Ltd", where: "Lusaka", sector: "professional services" },
  { years: "2023–2026", role: "HR Manager", org: "Oryx Energies", where: "Lusaka", sector: "energy" },
  { years: "2026–present", role: "Human Resources Director", org: "Lubona Meat Products Ltd", where: null, sector: "meat processing" },
] as const;

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <h1 className="text-title font-semibold text-ink">About Yangeni Chendela</h1>

      <p className="mt-6 text-lg text-ink">
        Yangeni Chendela has worked in human resources without a break since
        January 2011 — fifteen years, across seven organisations and six sectors:
        from agri-processing and hospitality to retail merchandising,
        professional services and energy.
      </p>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink">Career</h2>
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {CAREER.map((job) => (
            <li key={job.org} className="py-3">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="font-medium text-ink">
                  {job.role}, {job.org}
                  {job.where ? `, ${job.where}` : ""}
                </span>
                <span className="shrink-0 text-sm text-ink-muted">{job.years}</span>
              </div>
              <p className="text-sm text-ink-muted">{job.sector}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink">WANGA HR Consultancy</h2>
        <p className="mt-3 text-ink">
          Since January 2014, alongside those in-house roles, Yangeni has been a
          Director of WANGA HR Consultancy. It is an established HR consultancy,
          and he has directed it for twelve years.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink">
          On the board at Lubona Meat Products
        </h2>
        <p className="mt-3 text-ink">
          From January 2020 to December 2025, Yangeni served on the board of
          Lubona Meat Products as chairperson of its HR and Legal Committee.
        </p>
        <p className="mt-3 text-ink">
          By his own account, the committee&rsquo;s remit was to oversee HR
          initiatives, keep the business compliant with legal standards, and
          align HR strategy with business objectives at board level.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-ink">Based in Lusaka</h2>
        <p className="mt-3 text-ink">
          Yangeni is based in Lusaka. His earlier work took him to the Copperbelt
          — the Zambeef role was at Kitwe — so his experience reaches beyond the
          capital.
        </p>
      </section>

      <section className="mt-12">
        <p className="text-ink">
          Among the skills he lists publicly are public speaking, board
          governance and administration, payroll and onboarding, and problem
          solving. He is the author of two books,{" "}
          <Link href="/books" className="text-accent-ink underline">
            Become Unstoppable and Level Up
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
