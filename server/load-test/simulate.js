import "dotenv/config";
import {io} from "socket.io-client";
import {performance} from "node:perf_hooks";
const url=process.env.LOAD_TEST_URL||"http://localhost:5000",count=Number(process.env.LOAD_TEST_PARTICIPANTS||50);
const ack=(s,event,payload,timeout=15000)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error(event+" acknowledgement timed out")),timeout);const cb=r=>{clearTimeout(t);resolve(r);};payload===undefined?s.emit(event,cb):s.emit(event,payload,cb);});
const wait=(s,event,pred=()=>true)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>{s.off(event,h);reject(Error("Timed out waiting for "+event));},600000);const h=d=>{if(!pred(d))return;clearTimeout(t);s.off(event,h);resolve(d);};s.on(event,h);});
const connect=async()=>{const s=io(url,{transports:["websocket"],reconnection:false,timeout:10000});await new Promise((r,j)=>{s.once("connect",r);s.once("connect_error",j);});return s;};
const rows=["round,question,option_a,option_b,option_c,option_d,correct_option,explanation"];for(let round=1;round<=2;round++)for(let q=1;q<=25;q++)rows.push(`${round},"Load test R${round} Q${q}",Correct answer,Wrong B,Wrong C,Wrong D,A,"Synthetic load test"`);
const clients=[];let accepted=0,rejected=0,events=0;const latencies=[];
try{
 const health=await fetch(url+"/health");if(!health.ok)throw Error("Backend health check failed: "+health.status);
 const host=await connect();const login=await ack(host,"host_login");if(!login.success)throw Error(login.message);
 const created=await ack(host,"create_quiz",{rounds:2,roundSeconds:{1:5,2:5},marks:{1:5,2:10}});if(!created.success)throw Error(created.message);
 const imported=await ack(host,"import_questions",{csv:rows.join("\n")});if(!imported.success)throw Error(imported.message);
 for(let i=0;i<count;i++){const s=await connect();const joined=await ack(s,"join_competition",{name:"Load Tester "+String(i+1).padStart(3,"0"),code:created.roomCode});if(!joined.success)throw Error(joined.message);s.pid=joined.participant.id;s.on("question_started",q=>{events++;const delay=100+(i*37)%500;setTimeout(async()=>{const start=performance.now();try{const a=await ack(s,"submit_answer",{participantId:s.pid,questionNumber:q.questionNumber,selectedOption:0});latencies.push(performance.now()-start);if(a.success&&a.accepted)accepted++;else rejected++;}catch{rejected++;}},delay);});clients.push(s);}
 console.log(`Connected ${clients.length}/${count} simulated players to room ${created.roomCode}.`);
 const r1=wait(host,"round_finished",d=>d.round===1);const started=await ack(host,"start_quiz");if(!started.success)throw Error(started.message);await r1;
 const r2=wait(host,"round_finished",d=>d.round===2);const next=await ack(host,"start_next_round");if(!next.success)throw Error(next.message);const final=await r2;
 const entries=final.leaderboard.filter(p=>p.name.startsWith("Load Tester ")),expected=count*50,scoreOk=entries.length===count&&entries.every(p=>p.score===375&&p.correct===50);
 const sorted=latencies.sort((a,b)=>a-b),pct=p=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]||0;
 console.log("\nCLOUD CLASH LOAD TEST");console.log("---------------------");
 console.log("Room code:          "+created.roomCode);console.log("Participants:       "+clients.length+"/"+count);console.log("Question events:    "+events+"/"+count*50);console.log("Accepted answers:   "+accepted+"/"+expected);console.log("Rejected answers:   "+rejected);console.log("Answer latency p50: "+pct(.5).toFixed(1)+" ms");console.log("Answer latency p95: "+pct(.95).toFixed(1)+" ms");console.log("Answer latency p99: "+pct(.99).toFixed(1)+" ms");console.log("Final scores:       "+(scoreOk?"PASS":"FAIL")+" (375 points, 50 correct each)");
 if(accepted!==expected||rejected||events!==count*50||!scoreOk)process.exitCode=1;
 host.disconnect();
}catch(e){console.error("LOAD TEST FAILED:",e.message);process.exitCode=1;}
finally{clients.forEach(s=>s.disconnect());}
