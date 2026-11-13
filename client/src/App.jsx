import { useEffect, useState } from "react";
import Host from "./Host";
import Participant from "./Participant";
import "./App.css";

export default function App(){
 const [path,setPath]=useState(window.location.pathname);
 const navigate=next=>{window.history.pushState({}, "", next);setPath(next);};
 useEffect(()=>{const back=()=>setPath(window.location.pathname);window.addEventListener("popstate",back);return()=>window.removeEventListener("popstate",back);},[]);
 if(path==="/host")return <Host onHome={()=>navigate("/")} />;
 if(path==="/join")return <Participant onHome={()=>navigate("/")} />;
 return <main className="landing">
  <div className="landing-brand"><span className="brand-mark">CC</span><span>CLOUD CLASH</span></div>
  <section className="landing-copy"><p className="eyebrow">REAL-TIME QUIZ PLATFORM</p><h1>Think fast.<br/><em>Clash harder.</em></h1><p>Create a room, bring your people together, and see who takes the top spot.</p></section>
  <section className="entry-grid">
   <button className="entry-card" onClick={()=>navigate("/host")}><span className="entry-icon">＋</span><strong>Create quiz</strong><small>Set up rounds, scoring and host a live quiz</small><span className="entry-arrow">↗</span></button>
   <button className="entry-card" onClick={()=>navigate("/join")}><span className="entry-icon">⌁</span><strong>Join quiz</strong><small>Enter your name and room code to play</small><span className="entry-arrow">↗</span></button>
  </section>
  <footer>ONE ROOM. ONE WINNER. NO INSTALLATION.</footer>
 </main>;
}