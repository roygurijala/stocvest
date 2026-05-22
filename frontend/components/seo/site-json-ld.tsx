import { SITE_NAME, SITE_TAGLINE, SITE_URL, SUPPORT_EMAIL } from "@/lib/seo/site";

/** Organization + WebSite JSON-LD for the marketing homepage. */
export function SiteJsonLd() {
  const payload = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/brand/full_logo_with_tagline_1200w.png`,
        email: SUPPORT_EMAIL,
        description: SITE_TAGLINE
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_TAGLINE,
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en-US"
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#application`,
        name: SITE_NAME,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: SITE_URL,
        description:
          "Six-layer swing and day trading signal platform with transparent reasoning, regime context, and setup maturation — not trade recommendations.",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: "Free tier with paid plans for full swing and day desk access"
        },
        publisher: { "@id": `${SITE_URL}/#organization` }
      }
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}
