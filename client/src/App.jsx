import { useCallback, useEffect, useRef, useState } from "react";
import Host from "./Host";
import Participant from "./Participant";
import Account from "./Account";
import Profile from "./Profile";
import { getProfile, getSession, signOut } from "./auth";
import { socket } from "./socket";
import "./App.css";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [prefillJoin, setPrefillJoin] = useState({ name: "", code: "" });
  const activeSessionRef = useRef(false);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState({ gameName: "", bio: "" });
  const [authReady, setAuthReady] = useState(false);
  const [authToast, setAuthToast] = useState(null);

  const setActiveSession = useCallback((active) => {
    activeSessionRef.current = active;
  }, []);

  const navigate = (next) => {
    window.history.pushState({}, "", next);
    setPath(next);
  };

  useEffect(() => {
    // Supabase redirects successful email confirmations back with an auth
    // fragment. Read the result before cleaning the URL so users get feedback.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    const hasHashAuthResult = hashParams.has("type") || hashParams.has("error") || hashParams.has("error_code");
    const params = hasHashAuthResult ? hashParams : queryParams;
    const confirmationType = params.get("type");
    const hasConfirmationToken = params.has("access_token") || params.has("token_hash");

    if (confirmationType === "signup" && hasConfirmationToken) {
      setAuthToast({
        type: "success",
        message: "Email confirmed successfully. You can now sign in to your CloudClash account."
      });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.has("error") || params.has("error_code")) {
      setAuthToast({
        type: "error",
        message: "That confirmation link is invalid or has expired. Please request a new one and try again."
      });
      window.history.replaceState({}, "", window.location.pathname);
    }

    getSession().then((current) => { setSession(current); setProfile(getProfile(current)); }).catch(() => { setSession(null); setProfile({ gameName: "", bio: "" }); }).finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!authToast) return;
    const timeout = window.setTimeout(() => setAuthToast(null), 6500);
    return () => window.clearTimeout(timeout);
  }, [authToast]);

  useEffect(() => {
    const back = () => {
      if (activeSessionRef.current) {
        const leave = window.confirm(
          "You're currently in a quiz. Leaving this page will take you out of the session. Do you want to leave?"
        );
        if (!leave) {
          window.history.pushState({}, "", path);
          return;
        }
      }
      setPath(window.location.pathname);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [path]);

  const handleAuthenticated = (nextSession) => {
    setSession(nextSession);
    setProfile(getProfile(nextSession));
    setPrefillJoin((current) => ({ ...current, name: getProfile(nextSession).gameName || current.name }));
    navigate(path === "/host" ? "/host" : "/");
  };

  const handleSignOut = async () => {
    try {
      await signOut(session);
    } finally {
      socket.auth = {};
      setSession(null);
      setProfile({ gameName: "", bio: "" });
    }
  };

  const handleProfileUpdated = (nextSession, nextProfile) => {
    setSession(nextSession);
    setProfile(nextProfile);
    setPrefillJoin((current) => ({ ...current, name: nextProfile.gameName || current.name }));
  };

  useEffect(() => {
    if (profile.gameName) setPrefillJoin((current) => current.name ? current : { ...current, name: profile.gameName });
  }, [profile.gameName]);

  const handleQuickJoin = (e) => {
    e.preventDefault();
    navigate("/join");
  };

  if (path === "/host") {
    if (!authReady) return <main className="app-shell narrow"><section className="surface-card">Loading account...</section></main>;
    if (!session) return <Account onAuthenticated={handleAuthenticated} onBack={() => navigate("/")} />;
    return <Host onHome={() => navigate("/")} onActivityChange={setActiveSession} />;
  }

  if (path === "/profile") {
    if (!authReady) return <main className="app-shell narrow"><section className="surface-card">Loading account...</section></main>;
    if (!session) return <Account onAuthenticated={handleAuthenticated} onBack={() => navigate("/")} />;
    return <Profile session={session} onBack={() => navigate("/")} onProfileUpdated={handleProfileUpdated} />;
  }

  if (path === "/account" || path === "/account/signup") {
    return <Account initialMode={path.endsWith("signup") ? "signup" : "login"} onAuthenticated={handleAuthenticated} onBack={() => navigate("/")} />;
  }

  if (path === "/join") {
    return (
      <Participant
        initialName={prefillJoin.name}
        initialCode={prefillJoin.code}
        onHome={() => {
          setPrefillJoin({ name: "", code: "" });
          navigate("/");
        }}
        onActivityChange={setActiveSession}
      />
    );
  }

  return (
    <main className="landing-shell">
      {authToast && (
        <div className={`auth-toast ${authToast.type}`} role="status" aria-live="polite">
          <span className="auth-toast-icon" aria-hidden="true">{authToast.type === "success" ? "✓" : "!"}</span>
          <span>{authToast.message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setAuthToast(null)}>×</button>
        </div>
      )}
      <header className="brand-bar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          <span className="brand-name">CLOUD CLASH</span>
        </div>
        <div className="landing-header-actions">
          <span className="telemetry-pill"><span className="pulse-dot" />LIVE ARENA</span>
          {session ? (
            <div className="account-header">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/profile")}>Profile</button>
              <span title={session.user?.email}>{session.user?.email || "Account"}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleSignOut}>Sign out</button>
            </div>
          ) : (
            <><button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/account")}>Sign in</button><button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/account/signup")}>Create account</button></>
          )}
        </div>
      </header>

      <section className="landing-main">
        <div className="landing-hero">
          <p className="eyebrow">REAL-TIME QUIZ PLATFORM</p>
          <h1>
            Think fast.
            <br />
            <span>Clash harder.</span>
          </h1>
          <p>
            Launch custom multi-round trivia rooms with precision timers, weighted scoring, and real-time leaderboards. Zero installs required.
          </p>
        </div>

        <div className="landing-actions">
          <form className="quick-join-card" onSubmit={handleQuickJoin}>
            <div className="quick-join-header">
              <div>
                <p className="eyebrow" style={{ marginBottom: 2 }}>PLAYER ENTRY</p>
                <h2>Join a room</h2>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="landing-code">Room Code</label>
              <input
                id="landing-code"
                className="input-control input-code"
                placeholder="CODE"
                maxLength={12}
                value={prefillJoin.code}
                onChange={(e) => setPrefillJoin((state) => ({ ...state, code: e.target.value.toUpperCase() }))}
              />
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="landing-name">{profile.gameName ? "Saved game name" : "Display Name"}</label>
              <input
                id="landing-name"
                className="input-control"
                placeholder="Enter your name"
                maxLength={40}
                value={prefillJoin.name}
                onChange={(e) => setPrefillJoin((state) => ({ ...state, name: e.target.value }))}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-full">
              Enter Arena
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </form>

          <button type="button" className="host-launch-card" onClick={() => navigate("/host")}>
            <div className="host-launch-meta">
              <span className="icon-badge">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </span>
              <div>
                <h3 style={{ fontSize: "1.05rem", marginBottom: 2 }}>Host a new quiz</h3>
                <p className="muted" style={{ fontSize: "0.82rem" }}>
                  {session ? "Create and control your own quiz room" : "Sign in to configure rounds, upload CSV templates, and control live pacing"}
                </p>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b94a5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="7" y1="17" x2="17" y2="7" />
              <polyline points="7 7 17 7 17 17" />
            </svg>
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <span>ONE ROOM · ONE WINNER · NO INSTALLATION</span>
        <span>MULTI-ROUND REAL-TIME ENGINE</span>
      </footer>
    </main>
  );
}
