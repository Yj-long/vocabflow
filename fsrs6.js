/* FSRS-6 DSR model, 21 published default parameters. Explicit local learning step policy.
   Source math: https://open-spaced-repetition.github.io/ts-fsrs/guide/model/fsrs-6
   Important: NOT the ts-fsrs FSRS-7 library. Algorithm tag fsrs6-local-1. */
(function(global){
'use strict';
const W=[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542];
const DAY=86400000;
const FACTOR=Math.pow(.9,-1/W[20])-1;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const difficulty0=grade=>clamp(W[4]-Math.exp(W[5]*(grade-1))+1,1,10);
const gradeMap={'忘记':1,'困难':2,'记得':3,'简单':4};
function forgetting(stability,elapsedDays){if(!stability)return 0;return Math.pow(1+FACTOR*Math.max(0,elapsedDays)/stability,-W[20]);}
function nextInterval(stability,retention=.9){return Math.max(1,Math.round(stability/FACTOR*(Math.pow(retention,-1/W[20])-1)));}
function calculate(before,gradeLabel,now=new Date(),retention=.9){
  const grade=gradeMap[gradeLabel]; if(!grade)throw new Error('未知记忆评分');
  const nowMs=now instanceof Date?now.getTime():Number(now);
  const validRetention=Number.isFinite(retention)&&retention>=.7&&retention<=.97?retention:.9;
  const prev=before&&before.reps>0?before:null;
  let stability,difficulty,phase,minutes=null;
  let reps=(prev?.reps||0)+1, lapses=(prev?.lapses||0)+(grade===1&&prev?.phase==='review'?1:0);
  if(!prev){
    stability=W[grade-1]; difficulty=difficulty0(grade);
    if(grade===1){phase='learning';minutes=1}
    else if(grade===2){phase='learning';minutes=5}
    else if(grade===3){phase='learning';minutes=10}
    else phase='review';
  }else{
    const elapsed=Math.max(0,Math.floor((nowMs-new Date(prev.lastReviewAt).getTime())/DAY));
    const S=clamp(Number(prev.stability)||.1,.01,36500),D=clamp(Number(prev.difficulty)||5,1,10);
    const R=forgetting(S,elapsed);
    difficulty=clamp(W[7]*difficulty0(4)+(1-W[7])*(D-W[6]*(grade-3)*(10-D)/9),1,10);
    if(elapsed===0){
      const m=Math.pow(S,-W[19])*Math.exp(W[17]*(grade-3+W[18]));
      stability=clamp(S*(grade===1?m:Math.max(m,1)),.01,36500);
    }else if(grade===1){
      stability=clamp(Math.min(W[11]*Math.pow(D,-W[12])*(Math.pow(S+1,W[13])-1)*Math.exp(W[14]*(1-R)),S*Math.exp(-W[17]*W[18])),.01,36500);
    }else{
      const hard=grade===2?W[15]:1,easy=grade===4?W[16]:1;
      stability=clamp(S*(1+Math.exp(W[8])*(11-D)*Math.pow(S,-W[9])*(Math.exp(W[10]*(1-R))-1)*hard*easy),.01,36500);
    }
    if(grade===1){phase=prev.phase==='learning'?'learning':'relearning';minutes=1;}
    else if(grade===2&&(prev.phase==='learning'||prev.phase==='relearning')){phase=prev.phase;minutes=5;}
    else phase='review';
  }
  const delay=minutes!==null?minutes*60000:nextInterval(stability,validRetention)*DAY;
  return {cardId:before?.cardId||null,phase,stability,difficulty,reps,lapses,dueAt:new Date(nowMs+delay).toISOString(),lastReviewAt:new Date(nowMs).toISOString(),algorithm:'fsrs6-local-1',retention:validRetention};
}
/* A cautious optional cloze-evidence correction. This is a VocabFlow heuristic,
   NOT an official FSRS review: it does not change dueAt, phase, reps, lapses,
   or lastReviewAt. The next full recognition review uses the adjusted D and S. */
function applyClozeEvidence(before,correct,now=new Date(),eventId=null){
  if(!before||!(before.reps>0))throw new Error('只有学过的认识卡能接受填空辅助信号');
  const at=now instanceof Date?now:new Date(now);
  if(!Number.isFinite(at.getTime()))throw new Error('填空练习时间无效');
  const day=[at.getFullYear(),String(at.getMonth()+1).padStart(2,'0'),String(at.getDate()).padStart(2,'0')].join('-');
  if(before.lastClozeDay===day)return {state:{...before},applied:false,day};
  const s=clamp(Number(before.stability)||.01,.01,36500);
  const d=clamp(Number(before.difficulty)||5,1,10);
  // Correct: modest positive evidence. Incorrect: modest negative evidence.
  // These small, capped shifts must not be interpreted as calibrated FSRS weights.
  const stability=clamp(s*(correct?1.04:.94),.01,36500);
  const difficulty=clamp(d+(correct?-.06:.12),1,10);
  const state={...before,stability,difficulty,lastClozeDay:day,lastClozeAt:at.toISOString(),lastClozeEventId:eventId,clozeEvidenceCount:(before.clozeEvidenceCount||0)+1};
  return {state,applied:true,day};
}
function daysUntil(iso,now=new Date()){return Math.ceil((Date.parse(iso)-now.getTime())/DAY)}
global.VFFSRS={calculate,forgetting,nextInterval,daysUntil,applyClozeEvidence,version:'fsrs6-local-1',weights:W};
})(window);
