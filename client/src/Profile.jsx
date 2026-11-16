import { useEffect, useState } from "react";
import { getProfile, updateProfile } from "./auth";
import "./App.css";

export default function Profile({ session, onBack, onProfileUpdated }) {
  const saved = getProfile(session);
  const [gameName, setGameName] = useState(saved.gameName);
  const [bio, setBio] = useState(saved.bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setGameName(saved.gameName);
    setBio(saved.bio);
  }, [session?.user?.id, saved.gameName, saved.bio]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await updateProfile({ gameName, bio });
      onProfileUpdated?.(result.session, result.profile);
      setNotice("Your profile has been saved.");
    } catch (err) {
      setError(err.message || "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="account-shell profile-shell">
      <section className="account-card profile-card">
        <button type="button" className="back-link" onClick={onBack}>← Back to CloudClash</button>
        <div className="profile-avatar">{(gameName.trim()[0] || session?.user?.email?.[0] || "P").toUpperCase()}</div>
        <p className="eyebrow">YOUR PLAYER IDENTITY</p>
        <h1>Your profile.</h1>
        <p className="account-description">Set how you appear in CloudClash rooms. Your game name will be filled in automatically whenever you join a quiz.</p>
        <form className="account-form" onSubmit={submit}>
          <div className="field-group">
            <label className="field-label" htmlFor="profile-game-name">Game name</label>
            <input id="profile-game-name" className="input-control" value={gameName} onChange={(e) => setGameName(e.target.value)} maxLength={40} placeholder="e.g. Abhi" />
            <span className="profile-hint">This name appears on room participant lists and leaderboards. Leave blank if you prefer entering it each time.</span>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="profile-bio">Bio</label>
            <textarea id="profile-bio" className="textarea-control" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={240} placeholder="A little about you..." />
            <span className="profile-counter">{bio.length}/240</span>
          </div>
          {error && <div className="error-banner">{error}</div>}
          {notice && <div className="success-banner">{notice}</div>}
          <button className="btn btn-primary btn-full" type="submit" disabled={busy || gameName.trim().length > 40}>
            {busy ? "Saving..." : "Save profile"}
          </button>
        </form>
        <p className="account-footnote">Signed in as {session?.user?.email}</p>
      </section>
    </main>
  );
}
