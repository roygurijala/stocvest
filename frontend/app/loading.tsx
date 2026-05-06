import { CuteLoader } from "@/components/cute-loader";

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
      <CuteLoader label="Loading app" sublabel="Warming up your workspace" />
    </div>
  );
}

