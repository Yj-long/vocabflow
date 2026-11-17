/* Frequency/priority-aware random selection. Pure functions, no persistence here.
   Numeric frequency: larger means more frequent. Numeric priority: smaller means higher priority.
   When no valid metadata exists, all never-studied words form one random pool. */
(function(global){
'use strict';
function asNumber(value){
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const n=Number(String(value).trim());return Number.isFinite(n)&&n>=0?n:null;
}
function tagTier(value){
 if(value===null||value===undefined)return null;
 const s=String(value).trim().toLowerCase();
 if(!s)return null;
 if(['最高','极高','very high','critical','p0','p1','a','核心','重点','高频','high','core','top'].includes(s))return 0;
 if(['中高','较高','important','medium-high','upper'].includes(s))return 1;
 if(['一般','普通','中频','中等','mid','medium','normal','p2','b'].includes(s))return 2;
 if(['较低','低频','low','p3','c'].includes(s))return 3;
 if(['很低','极低','rare','very low','p4','d'].includes(s))return 4;
 return null;
}
function quantileTier(value,sortedDistinct,descending=false){
 if(value===null)return null;
 const index=sortedDistinct.indexOf(value);
 if(index<0)return null;
 if(sortedDistinct.length<=4)return index;
 return Math.min(3,Math.floor(index*4/sortedDistinct.length));
}
function rankLinks(links){
 const priorityNumbers=[...new Set(links.map(x=>asNumber(x.priority)).filter(x=>x!==null))].sort((a,b)=>a-b);
 const frequencyNumbers=[...new Set(links.map(x=>asNumber(x.frequency)).filter(x=>x!==null))].sort((a,b)=>b-a);
 return links.map(link=>{
  const rawPriority=link.priority,rawFreq=link.frequency;
  let tier=tagTier(rawPriority);
  if(tier===null)tier=quantileTier(asNumber(rawPriority),priorityNumbers);
  if(tier===null)tier=tagTier(rawFreq);
  if(tier===null)tier=quantileTier(asNumber(rawFreq),frequencyNumbers,true);
  return {...link,tier:tier===null?Number.POSITIVE_INFINITY:tier};
 });
}
function shuffle(array,rng){
 const result=[...array];
 for(let i=result.length-1;i>0;i--){const random=Math.max(0,Math.min(.999999999999,Number(rng())||0));const j=Math.floor(random*(i+1));[result[i],result[j]]=[result[j],result[i]]}
 return result;
}
function choose(links,states,count,rng=Math.random){
 const n=Math.max(0,Math.floor(Number(count)||0));if(!n)return [];
 const eligible=rankLinks(links).filter(link=>!states.get(`recognition:${link.wordId}`)?.reps);
 const tiers=[...new Set(eligible.map(r=>r.tier))].sort((a,b)=>a-b);
 const selected=[];
 for(const tier of tiers){
  const bucket=shuffle(eligible.filter(r=>r.tier===tier),rng);
  for(const item of bucket){if(selected.length===n)break;selected.push(item.wordId)}
  if(selected.length===n)break;
 }
 return selected;
}
function policy(links){return rankLinks(links).some(link=>Number.isFinite(link.tier))?'priority-random':'random'}
global.VFSelection={choose,policy,rankLinks,tagTier,asNumber};
})(window);
