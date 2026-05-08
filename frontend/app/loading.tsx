import { ContentLoading } from "@/components/content-loading";

export default function AppLoading() {
  return (
    <div
      style={{
        minHeight: "72vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem"
      }}
    >
      <ContentLoading />
    </div>
  );
}
