import { getServerSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/auth/login-form";
import { redirect } from "next/navigation";

export default function LoginPage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
      <section style={{ width: "100%", maxWidth: 640, background: "#101a32", padding: "24px", borderRadius: 12 }}>
        <h1 style={{ marginTop: 0 }}>STOCVEST login</h1>
        <p>Phase 5a auth foundation: sign in with a valid Cognito ID token.</p>
        <LoginForm />
      </section>
    </main>
  );
}
