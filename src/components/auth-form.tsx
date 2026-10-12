"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, Sparkles } from "lucide-react";
export default function AuthForm() {
  const [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: signup ? "signup" : "login",
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (data.confirmationRequired)
        setNotice("Check your email to confirm your account, then sign in.");
      else window.location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">t</span>tempo
          <span className="brand-dot">.</span>
        </a>
        <div>
          <span className="eyebrow">
            A LITTLE STRUCTURE. MORE ROOM TO BREATHE.
          </span>
          <h1>
            Make time for
            <br />
            what matters.
          </h1>
          <p>
            Your commitments, your tasks, and a plan that fits your real life.
          </p>
          <div className="auth-example">
            <CalendarDays size={22} />
            <div>
              <strong>A week with a little more space.</strong>
              <p>
                Tell Tempo what needs doing. Review a realistic plan. Make it
                yours.
              </p>
            </div>
          </div>
        </div>
        <span className="auth-footer">
          <Sparkles size={16} /> Thoughtfully planned. Always in your hands.
        </span>
      </section>
      <section className="auth-entry">
        <form onSubmit={submit}>
          <span className="eyebrow">YOUR PLANNING SPACE</span>
          <h2>{signup ? "Start your Tempo" : "Welcome back"}</h2>
          <p>
            {signup
              ? "A calmer week starts here."
              : "Pick up where you left off."}
          </p>
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              maxLength={320}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="success-message">
              {notice}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? "Please wait…" : signup ? "Create account" : "Sign in"}
            <ArrowRight size={17} />
          </button>
          <p className="auth-switch">
            {signup ? "Already have an account?" : "New here?"}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSignup(!signup);
                setError("");
                setNotice("");
              }}
            >
              {signup ? "Sign in" : "Create an account"}
            </button>
          </p>
        </form>
      </section>
    </main>
  );
}
