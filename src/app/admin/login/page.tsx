import { redirect } from "next/navigation";
import { adminConfigured, isAdmin } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Admin sign in" };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  if (!adminConfigured()) {
    return (
      <div className="notice err form-card" style={{ maxWidth: 520 }}>
        <h2>Admin account not configured</h2>
        <p className="muted">
          Set <code>ADMIN_USERNAME</code>, <code>ADMIN_PASSWORD</code> and a random <code>SESSION_SECRET</code> (16+ characters) in the environment, then restart.
        </p>
      </div>
    );
  }
  return <LoginForm />;
}
