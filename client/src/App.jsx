import AppParticipant from "./Participant";
import Host from "./Host";

function App() {
  const isHost = window.location.pathname === "/host";

  return isHost ? <Host /> : <AppParticipant />;
}

export default App;