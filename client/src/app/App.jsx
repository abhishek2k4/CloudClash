import { useCallback, useEffect, useRef, useState } from "react";
import Host from "../features/host/Host";
import Participant from "../features/participant/Participant";
import Account from "../features/account/Account";
import Profile from "../features/profile/Profile";
import { getProfile, getSession, signOut } from "../services/auth";
import { socket } from "../services/socket";
import "../styles/global.css";

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
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    const hasHashAuthResult = hashParams.has("type") || hashParams.has("error") || hashParams.has("error_code");
    const params = hasHashAuthResult ? hashParams : queryParams;
    const confirmationType = params.get("type");
    const hasConfirmationToken = params.has("access_token") || params.has("token_hash");

    if (confirmationType === "signup" && hasConfirmationToken) {
      setAuthToast({ type: "success", message: "Email confirmed successfully. You can now sign in to your CloudClash account." });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.has("error") || params.has("error_code")) {
      setAuthToast({ type: "error", message: "That confirmation link is invalid or has expired. Please request a new one and try again." });
      window.history.replaceState({}, "", window.location.pathname);
    }

    getSession().then((current) => { setSession(current); setProfile(getProfile(current)); }).catch(() => {
      setSession(null);
      setProfile({ gameName: "", bio: "" });
    }).finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!authToast) return;
    const timeout = window.setTimeout(() => setAuthToast(null), 6500);
    return () => window.clearTimeout(timeout);
  }, [authToast]);

  useEffect(() => {
    const back = () => {
      if (activeSessionRef.current) {
        const leave = window.confirm("You're currently in a quiz. Leaving this page will take you out of the session. Do you want to leave?");
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
      setPrefillJoin((current) => ({ ...current, name: "" }));
    }
  };

  const handleProfileUpdated = (nextSession, nextProfile) => {
    setSession(nextSession);
    setProfile(nextProfile);
    setPrefillJoin((current) => ({ ...current, name: nextProfile.gameName }));
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

      <header className="brand-bar landing-nav">
        <a className="brand-lockup" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }} aria-label="CloudClash home">
          <span className="brand-mark" aria-hidden="true">✳</span>
          <span className="brand-name">CLOUD<span>CLASH</span></span>
        </a>
        <nav className="landing-nav-links" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#built-for">Built for</a>
        </nav>
        <div className="landing-header-actions">
          {session ? (
            <div className="account-header">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/profile")}>Profile</button>
              <span title={session.user?.email}>{session.user?.email || "Account"}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleSignOut}>Sign out</button>
            </div>
          ) : (
            <><button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/account")}>Sign in</button><button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/account/signup")}>Create account <span aria-hidden="true">↗</span></button></>
          )}
        </div>
      </header>

      <section className="landing-hero-section">
        <div className="landing-hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> THE LIVE QUIZ ARENA</p>
          <h1>Think fast.<br /><span>Clash harder.</span></h1>
          <p className="landing-hero-description">Big-brain questions. Split-second decisions. One leaderboard that keeps everyone on their toes.</p>
          <div className="hero-proof"><span>✳</span> No installs. Just bring your competitive side.</div>
        </div>

        <div className="landing-entry-stack">
          <form className="quick-join-card" onSubmit={handleQuickJoin}>
            <div className="quick-join-header">
              <div><p className="eyebrow">01 / PLAYER ENTRY</p><h2>Got a room code?</h2></div>
              <span className="entry-icon" aria-hidden="true">↗</span>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="landing-code">Room code</label>
              <input id="landing-code" className="input-control input-code" placeholder="ENTER CODE" maxLength={12} value={prefillJoin.code} onChange={(e) => setPrefillJoin((state) => ({ ...state, code: e.target.value.toUpperCase() }))} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="landing-name">{profile.gameName ? "Saved game name" : "Your name"}</label>
              <input id="landing-name" className="input-control" placeholder="What should we call you?" maxLength={40} value={prefillJoin.name} onChange={(e) => setPrefillJoin((state) => ({ ...state, name: e.target.value }))} />
            </div>
            <button type="submit" className="btn btn-primary btn-full">Enter the arena <span aria-hidden="true">→</span></button>
            <p className="entry-footnote">Joining as a player? No account needed.</p>
          </form>

          <button type="button" className="host-launch-card" onClick={() => navigate("/host")}>
            <span className="host-launch-symbol" aria-hidden="true">＋</span>
            <span className="host-launch-copy"><strong>Hosting instead?</strong><small>{session ? "Set up your next quiz room" : "Build a quiz and run the room"}</small></span>
            <span className="host-launch-arrow" aria-hidden="true">↗</span>
          </button>
        </div>

        <div className="hero-stamp" aria-hidden="true"><span>FAST</span><span>THINKING</span><b>ONLY</b></div>
      </section>

      <section className="showcase-section" aria-labelledby="showcase-title">
        <div className="section-kicker">THE GAME IS ON</div>
        <div className="showcase-heading">
          <h2 id="showcase-title">More than a quiz.<br /><em>It's game time.</em></h2>
          <p>Every second counts. Every point matters. Watch the room come alive as the leaderboard shifts.</p>
        </div>
        <div className="arena-preview" aria-label="Illustrative preview of a live CloudClash quiz room">
          <div className="preview-topbar"><span className="preview-brand">✳ CLOUDCLASH</span><span className="preview-live"><i /> LIVE ROUND 02</span><span className="preview-room">ROOM / A7K2Q</span></div>
          <div className="preview-content">
            <div className="preview-question">
              <span className="preview-label">QUESTION 08 <b>·</b> SCIENCE & TECH</span>
              <h3>Which protocol powers the modern web?</h3>
              <div className="preview-options"><span><b>A</b> FTP</span><span className="preview-correct"><b>B</b> HTTP</span><span><b>C</b> SMTP</span><span><b>D</b> SSH</span></div>
            </div>
            <div className="preview-side">
              <div className="preview-timer"><small>TIME LEFT</small><strong>00:12</strong><span>SECONDS</span></div>
              <div className="preview-leaderboard"><div className="preview-board-title">TOP PLAYERS <span>↗</span></div><div><b>01</b><span>PixelPilot</span><strong>2,450</strong></div><div><b>02</b><span>byte_me</span><strong>2,180</strong></div><div><b>03</b><span>Nova.exe</span><strong>1,960</strong></div></div>
            </div>
          </div>
          <div className="preview-bottom"><span>⚡ REAL-TIME SCORING</span><span>● 32 PLAYERS IN THE ROOM</span><span>ROUND 2 / 3</span></div>
        </div>
        <p className="showcase-caption">A live-room concept preview · Actual gameplay UI may vary by screen and quiz state.</p>
      </section>

      <section className="built-for-section" id="built-for">
        <div className="section-kicker">MADE FOR THE MOMENT</div>
        <div className="built-for-heading"><h2>Bring your people.<br /><em>Bring the pressure.</em></h2><p>From a quick team face-off to a full-on campus showdown, CloudClash keeps the energy moving.</p></div>
        <div className="use-case-grid">
          <article className="use-case-card use-case-orange"><span className="use-case-number">01</span><span className="use-case-icon">✳</span><h3>Campus events</h3><p>Turn your college crowd into a live, competitive arena.</p><span className="use-case-tag">STUDENT CLUBS · FESTS</span></article>
          <article className="use-case-card use-case-yellow"><span className="use-case-number">02</span><span className="use-case-icon">⌁</span><h3>Team battles</h3><p>Get teams thinking together and competing for the top spot.</p><span className="use-case-tag">OFFICES · COMMUNITIES</span></article>
          <article className="use-case-card use-case-ink"><span className="use-case-number">03</span><span className="use-case-icon">↗</span><h3>Just for fun</h3><p>Make your next hangout a little more interesting.</p><span className="use-case-tag">FRIENDS · GAME NIGHTS</span></article>
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-kicker">NO MANUAL. NO FUSS.</div>
        <div className="how-heading"><h2>Three steps.<br /><em>One winner.</em></h2><p>Getting a game going is ridiculously simple.</p></div>
        <div className="how-steps">
          <article><span>01</span><div><h3>Set the stage</h3><p>Hosts create a room, add questions, and configure the rounds.</p></div></article>
          <article><span>02</span><div><h3>Get in the game</h3><p>Players enter the room code and join from any browser.</p></div></article>
          <article><span>03</span><div><h3>Clash for the top</h3><p>Answer before time runs out and chase the live leaderboard.</p></div></article>
        </div>
      </section>

      <section className="landing-cta">
        <p className="eyebrow">YOUR ARENA IS WAITING</p>
        <h2>Ready to make<br /><em>some noise?</em></h2>
        <button type="button" className="btn btn-primary" onClick={() => document.getElementById("landing-code")?.focus()}>Join a game <span aria-hidden="true">→</span></button>
      </section>

      <footer className="landing-footer">
        <a className="brand-lockup" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}><span className="brand-mark">✳</span><span className="brand-name">CLOUD<span>CLASH</span></span></a>
        <span>ONE ROOM · ONE WINNER · NO INSTALLATION</span>
        <span>MADE FOR THE CLASH.</span>
      </footer>
    </main>
  );
}
