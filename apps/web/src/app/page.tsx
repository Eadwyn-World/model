import { Contribute } from "@/components/contribute";
import { FederationPanel } from "@/components/federation-panel";
import { Hero } from "@/components/hero";
import { LearningLoop } from "@/components/learning-loop";
import { Philosophy } from "@/components/philosophy";
import { Principles } from "@/components/principles";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getFederationSnapshot } from "@/lib/federation";

// Re-render at most every 30 s on the server; the live panel polls in between.
export const revalidate = 30;

export default async function AiModelPage() {
  const snapshot = await getFederationSnapshot();
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero snapshot={snapshot} />
        <Principles />
        <FederationPanel initial={snapshot} />
        <LearningLoop />
        <Philosophy />
        <Contribute />
      </main>
      <SiteFooter />
    </>
  );
}
