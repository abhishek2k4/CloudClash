import { useState } from "react";
import { signIn, signUp } from "../../services/auth";


export default function Account({ onAuthenticated, onBack, initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const result = await signUp(email.trim(), password);
        if (result.session) {
          onAuthenticated(result.session);
        } else {
          setNotice("Account created. Check your email for the confirmation link, then come back and sign in.");
          setMode("login");
        }
      } else {
        const session = await signIn(email.trim(), password);
        onAuthenticated(session);
      }
    } catch (err) {
      setError(err.message || "Could not authenticate.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="account-shell">
      <section className="account-card">
        <button type="button" className="back-link" onClick={onBack}>← Back to CloudClash</button>
        <div className="account-brand-mark">⚡</div>
        <p className="eyebrow">CLOUD CLASH ACCOUNT</p>
        <h1>{mode === "signup" ? "Create your account." : "Welcome back."}</h1>
        <p className="account-description">
          {mode === "signup"
            ? "One account for hosting quizzes and joining them with your saved identity."
            : "Sign in to host quizzes or use your account as a participant."}
        </p>
        <form className="account-form" onSubmit={submit}>
          <div className="field-group">
            <label className="field-label" htmlFor="account-email">Email address</label>
            <input id="account-email" className="input-control" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="account-password">Password</label>
            <input id="account-password" className="input-control" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
          </div>
          {error && <div className="error-banner">{error}</div>}
          {notice && <div className="success-banner">{notice}</div>}
          <button className="btn btn-primary btn-full" type="submit" disabled={busy}>
            {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="account-switch">
          {mode === "signup" ? "Already have an account?" : "New to CloudClash?"}{" "}
          <button type="button" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); setNotice(""); }}>
            {mode === "signup" ? "Sign in" : "Create an account"}
          </button>
        </p>
        <p className="account-footnote">Joining a quiz? You can still play as a guest without signing in.</p>
      </section>
    </main>
  );
}
