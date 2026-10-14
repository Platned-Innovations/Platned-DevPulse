"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="card form-card">
      <h1 style={{ fontSize: 22 }}>Admin sign in</h1>
      <p className="muted">Only administrators sign in. Everyone else can browse the leaderboard freely.</p>
      <label htmlFor="username">Username</label>
      <input id="username" name="username" type="text" autoComplete="username" required />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      {state?.error && <p className="error-text" role="alert">{state.error}</p>}
      <p><button className="primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button></p>
    </form>
  );
}
