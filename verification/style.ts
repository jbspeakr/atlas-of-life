import {readFileSync} from 'node:fs';
import {expression} from '@maplibre/maplibre-gl-style-spec';
import type {Check} from './types';
export function styleChecks():Check[]{
 const style=JSON.parse(readFileSync('src/generated/style.json','utf8')) as {layers:{id:string;paint?:Record<string,unknown>}[]};
 const samples=['countries','regions','pins'].map(id=>{
  const layer=style.layers.find(layer=>layer.id===id);const paint=layer?.paint?.[id==='pins'?'circle-opacity':'fill-opacity'];
  const parsed=expression.createExpression(paint);
  if(parsed.result==='error')throw new Error(`src/generated/style.json ${id}: invalid opacity ${JSON.stringify(parsed.value)}`);
  return {id,visible:Array.from({length:65},(_,i)=>Number(parsed.value.evaluate({zoom:i/4},undefined,{visibility:1}))),hidden:Array.from({length:65},(_,i)=>Number(parsed.value.evaluate({zoom:i/4},undefined,{visibility:0})))};
 });
 const checks:Check[]=[];
 const gate=(id:string,metric:number,threshold:number,comparator:Check['comparator'],cause:string)=>checks.push({id,category:'correctness',status:(Number.isFinite(metric)&&(comparator==='lte'?metric<=threshold:metric>=threshold))?'pass':'fail',metric,threshold,comparator,unit:'opacity / zoom',message:`src/generated/style.json: ${cause}; measured ${metric}, threshold ${comparator} ${threshold}`});
 gate('zoom.coverage',Math.min(...Array.from({length:65},(_,i)=>Math.max(...samples.map(s=>s.visible[i])))),.05,'gte','no empty semantic band at quarter-zoom samples');
 gate('zoom.continuity',Math.max(...samples.flatMap(s=>s.visible.slice(1).map((v,i)=>Math.abs(v-s.visible[i])))),.26,'lte','adjacent sample opacity delta');
 let violations=0;for(const s of samples){const peak=s.visible.indexOf(Math.max(...s.visible));for(let i=1;i<s.visible.length;i++)if(i<=peak?s.visible[i]<s.visible[i-1]:s.visible[i]>s.visible[i-1])violations++;}
 gate('zoom.monotonic',violations,0,'lte','each rise and fall must be monotonic');
 gate('zoom.overlap',Math.min(...[0,1].map(b=>samples[b].visible.filter((v,i)=>v>.05&&samples[b+1].visible[i]>.05).length*.25)),.5,'gte','adjacent bands overlap for at least half a zoom');
 gate('zoom.hidden-state',Math.max(...samples.flatMap(s=>s.hidden.map(Math.abs))),0,'lte','filtered feature-state must actually extinguish the emitted layers');
 return checks;
}
