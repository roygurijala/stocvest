export function LegalSignupEmbedIntro({ documentLabel }: { documentLabel: string }) {
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/40 p-4 text-sm leading-relaxed text-cyan-100/95">
      <p className="m-0 font-medium text-cyan-50">Registration review — {documentLabel}</p>
      <p className="mt-2 mb-0 text-cyan-100/90">
        Read this document carefully as part of creating your STOCVEST account. Scroll to the bottom and click{" "}
        <span className="font-semibold text-white">I Agree</span> before continuing signup.
      </p>
    </div>
  );
}
