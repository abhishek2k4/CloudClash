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
          <span className="brand-mark"><img src="/assets/cloudclash/logo-mark.svg" alt="" /></span>
          <span className="brand-name">CLOUD<span>CLASH</span></span>
        </a>
        <nav className="landing-nav-links" aria-label="Main navigation">
          <a className="is-active" href="#" onClick={(event) => { event.preventDefault(); navigate("/"); }}>Home</a>
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#built-for">Use cases</a>
        </nav>
        <div className="landing-header-actions">
          <span className="live-arena-pill"><i /> LIVE ARENA</span>
          {session ? (
            <div className="account-header">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/profile")}>Profile</button>
              <span className="header-account-email" title={session.user?.email}>{session.user?.email || "Account"}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSignOut}>Sign out</button>
            </div>
          ) : (
            <><button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/account")}>Sign in</button><button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/account/signup")}>Create account</button></>
          )}
        </div>
      </header>

      <section className="landing-hero-section">
        <div className="landing-hero-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> REAL-TIME QUIZ PLATFORM</p>
          <h1 className="hero-display-title"><span className="hero-title-light">THINK FAST.</span><span className="hero-title-highlight">CLASH HARDER.</span></h1>
          <p className="landing-hero-description">Host engaging, multi-round trivia quizzes for college fests, workshops, team events or just a fun game night.</p>
          <div className="hero-proof"><span>⚡︎</span> No installs. Just bring your competitive side.</div>
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

        <div className="hero-artwork" aria-hidden="true">
          <img className="hero-art-explosion" src="/assets/cloudclash/explosion.svg" alt="" />
          <img className="hero-art-trophy" src="/assets/cloudclash/trophy.svg" alt="" />
          <img className="hero-art-lightning" src="/assets/cloudclash/lightning-bolt.svg" alt="" />
          <img className="hero-art-strokes" src="/assets/cloudclash/accent-strokes.svg" alt="" />
        </div>
      </section>

      <section className="showcase-section" id="features" aria-labelledby="showcase-title">
        <div className="section-kicker">THE GAME IS ON</div>
        <div className="showcase-heading">
          <h2 id="showcase-title">More than a quiz.<br /><em>It's game time.</em></h2>
          <p>Every second counts. Every point matters. Watch the room come alive as the leaderboard shifts.</p>
        </div>
        <div className="feature-ribbon">
          <article><span><img src="/assets/cloudclash/icons/live.svg" alt="" /></span><div><h3>Live & interactive</h3><p>Questions, timers and results in real time.</p></div></article>
          <article><span><img src="/assets/cloudclash/icons/scoring.svg" alt="" /></span><div><h3>Smart scoring</h3><p>Fast answers. Weighted points. Real stakes.</p></div></article>
          <article><span><img src="/assets/cloudclash/icons/events.svg" alt="" /></span><div><h3>Built for events</h3><p>Bring a room full of people into the game.</p></div></article>
        </div>
      </section>

      <section className="built-for-section" id="built-for">
        <div className="section-kicker">MADE FOR THE MOMENT</div>
        <div className="built-for-heading"><h2>Bring your people.<br /><em>Bring the pressure.</em></h2><p>From a quick team face-off to a full-on campus showdown, CloudClash keeps the energy moving.</p></div>
        <div className="use-case-grid">
          <article className="use-case-card use-case-orange"><span className="use-case-number">01</span><span className="use-case-icon"><img src="/assets/cloudclash/icons/college.svg" alt="" /></span><h3>Campus events</h3><p>Turn your college crowd into a live, competitive arena.</p><span className="use-case-tag">STUDENT CLUBS · FESTS</span></article>
          <article className="use-case-card use-case-yellow"><span className="use-case-number">02</span><span className="use-case-icon"><img src="/assets/cloudclash/icons/workshop.svg" alt="" /></span><h3>Team battles</h3><p>Get teams thinking together and competing for the top spot.</p><span className="use-case-tag">OFFICES · COMMUNITIES</span></article>
          <article className="use-case-card use-case-ink"><span className="use-case-number">03</span><span className="use-case-icon"><img src="/assets/cloudclash/icons/party.svg" alt="" /></span><h3>Just for fun</h3><p>Make your next hangout a little more interesting.</p><span className="use-case-tag">FRIENDS · GAME NIGHTS</span></article>
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
        <a className="brand-lockup" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}><span className="brand-mark"><img src="/assets/cloudclash/logo-mark.svg" alt="" /></span><span className="brand-name">CLOUD<span>CLASH</span></span></a>
        <span>ONE ROOM · ONE WINNER · NO INSTALLATION</span>
        <span>MADE FOR THE CLASH.</span>
      </footer>
    </main>
  );
}
