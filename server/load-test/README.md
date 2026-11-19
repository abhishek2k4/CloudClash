# CloudClash Socket.IO load test

This simulator opens up to **40 virtual participant Socket.IO connections** to a room that you create through the host dashboard. You can add your own phones/browsers to the same room as extra real participants; those are in addition to the bots.

The bots join the waiting room, remain connected while you operate the host dashboard, answer each question with a randomly selected option, observe round transitions and elimination events, and report answer acknowledgement latency and rejected post-elimination attempts.

## 1. Install dependencies

Open a terminal in the repository's `server` directory:

```powershell
npm install
```

## 2. Prepare a dedicated test room

1. Deploy the backend version you want to test.
2. Open CloudClash and sign in as the host.
3. Create a disposable quiz room and upload questions for **every configured round**.
4. Keep the quiz in **Waiting** state. Do not start it yet.
5. If testing elimination, enable it and configure a keep-count for an intermediate round.
6. Keep the host dashboard open.

The script checks `/health` and refuses to join unless the backend reports `status: ok` and `competition: waiting`.

## 3. Run the simulator

From the `server` directory:

```powershell
npm run test:load
```

It will ask for:
- The deployed backend URL (include `https://`)
- The room code shown in the host dashboard
- Number of virtual bots (default **40**, maximum **40**)
- Confirmation by typing `RUN`

Optional: set the backend URL and bot count before running:

```powershell
$env:LOAD_TEST_URL = "https://YOUR-BACKEND-DOMAIN"
$env:LOAD_TEST_PARTICIPANTS = "40"
npm run test:load
```

## 4. Run your own devices alongside the bots

Once the script reports that the bots have joined, use your phones/laptops to open the CloudClash participant page and join the **same room code**. These physical participants are additional to the 40 bots, so the total can be 40 bots + your devices.

Then:
1. Confirm the host dashboard shows the expected participant count.
2. Start the quiz from the host dashboard.
3. Keep the simulator terminal open through all rounds.
4. At each round break, review and confirm eliminations on the host dashboard if elimination is enabled.
5. Reveal results when the quiz finishes.
6. Press **Ctrl+C** in the simulator terminal to disconnect the bots and print the summary.

## What it measures

- Bot join successes and failures
- Unexpected disconnects and successful reconnects
- Number of question events received by bots
- Answer attempts accepted/rejected by the server
- Answer acknowledgement latency (p50 and p95)
- Whether eliminated bots are prevented from submitting further answers

Answers are intentionally random. This is a concurrency/load check, not a test of answer correctness or browser rendering performance.

## Safety notes

- Use a dedicated disposable room and a controlled staging/deployed backend.
- Do **not** run this against a real event or production room.
- The simulator sends real Socket.IO traffic and the bots appear in the host's participant list and leaderboard.
- The test does not automatically remove participants from a finished quiz. If you cancel before Round 1, the server's waiting-room cleanup removes disconnected bots; after the quiz has started, disconnects are retained as LEFT participants by design.
- The test can increase hosting usage and may trigger free-tier CPU/network limits. Start with 10 bots if you want a gentle smoke test, then repeat with 40.
- This is not a browser-performance benchmark. A successful run does not guarantee the hosting provider will sustain the same load during a public event.
