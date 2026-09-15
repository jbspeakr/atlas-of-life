import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateConfig, collapseVisits, dateBounds } from '../scripts/config.ts';
import type { Visit } from '../scripts/config.ts';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import { bands } from '../src/map/expressions.ts';
import { BoundaryRepository } from '../scripts/boundaries.ts';
const good:Visit = {id:'berlin',label:'Berlin',country:'DE',city:'Berlin',coordinates:[13.405,52.52]};
it('accepts Natural Earth Kosovo territory identity',()=>expect(validateConfig({visits:[{id:'kosovo',label:'Kosovo',country:'XK'}]}).visits[0].country).toBe('XK'));
describe('authored config corpus',()=>{
 const valid = [good,{id:'france',label:'France',country:'FR'}, {...good,region:'DE-BE'},{...good,date:'2020-02-29'},{...good,dateRange:['2019-01-01','']},{...good,tags:['city'],publishPrecision:'exact'}];
 for (const [i,visit] of valid.entries()) it('valid '+i,()=>expect(validateConfig({visits:[visit]}).visits).toHaveLength(1));
 const broken = [ [{...good,country:undefined},'country is required'],[{...good,country:'ZZ'},'country must be an assigned ISO 3166-1 alpha-2 code'],[{...good,region:'FR-IDF'},'region FR-IDF does not belong to DE'],[{...good,date:'2021-02-29'},'date must be a real ISO date'],[{...good,address:'Unknown impossible address',coordinates:undefined,city:undefined},'geocache miss for berlin; run npm run geocode or add explicit coordinates'],[{...good,id:'bad id'},'id must be a stable lowercase slug'] ];
 for(const [i,[visit,message]] of broken.entries()) it('invalid '+i,()=>expect(()=>validateConfig({visits:[visit]},{})).toThrow(String(message)));
 it('duplicate ids',()=>expect(()=>validateConfig({visits:[good,good]})).toThrow('duplicate id: berlin'));
 it('rejects personal fields',()=>expect(()=>validateConfig({visits:[{...good,notes:'private'}]})).toThrow('Unrecognized key'));
});
it('upstream region names resolve within their country',async()=>{
 const previous=process.env.ATLAS_FIXTURE;process.env.ATLAS_FIXTURE='1';
 try {
  const config=validateConfig({visits:[{id:'berlin-region',label:'Berlin',country:'DE',region:'Berlin'}]});
  const repository=await BoundaryRepository.open();
  const found=await repository.regions('DE','DEU',config.visits);
  expect(found.map(feature=>feature.id)).toEqual(['DE-BE']);
  await expect(repository.regions('DE','DEU',[{region:'Île-de-France'}])).rejects.toThrow('ATLAS_FIXTURE=1: missing committed boundary coverage for data/.geocache/gbOpen-DEU-ADM1.geojson; network and mutable download caches are disabled');
 } finally {if(previous===undefined)delete process.env.ATLAS_FIXTURE;else process.env.ATLAS_FIXTURE=previous;}
});
describe('date and collapse properties',()=>{
 it('collapse conserves visits and deduplicates cities',()=>fc.assert(fc.property(fc.array(fc.integer({min:0,max:5}),{minLength:1,maxLength:60}),xs=>{const pins=collapseVisits(xs.map((n,i)=>({...good,id:'v-'+i,city:'city-'+n,date:'2020-01-01'})));expect(pins.reduce((sum,p)=>sum+p.visitCount,0)).toBe(xs.length);expect(pins.length).toBe(new Set(xs).size);}),{seed:20260915}));
 it('ranges contain their endpoints and are ordered',()=>fc.assert(fc.property(fc.integer({min:1900,max:2099}),fc.integer({min:1900,max:2099}),(a,b)=>{const start=Math.min(a,b)+'-01-01',end=Math.max(a,b)+'-12-31';expect(dateBounds({dateRange:[start,end]})).toEqual([start,end]);}),{seed:20260915}));
 it('open intervals remain open',()=>expect(dateBounds({dateRange:['2020-01-01','']})).toEqual(['2020-01-01','9999-12-31']));
});
it('actual MapLibre zoom expressions have continuous overlapping bands',()=>{
 const samples=Object.values(bands).map(value=>{const parsed=expression.createExpression(value,{type:'number',default:1,transition:true,'property-type':'data-driven',expression:{interpolated:true,parameters:['zoom','feature','feature-state']}});if(parsed.result==='error')throw new Error(JSON.stringify(parsed.value));return Array.from({length:65},(_,i)=>Number(parsed.value.evaluate({zoom:i/4})));});
 for(let i=0;i<65;i++){expect(Math.max(...samples.map(v=>v[i])), 'opacity gap at z'+i/4).toBeGreaterThan(0.05);for(const v of samples)if(i)expect(Math.abs(v[i]-v[i-1]),'opacity discontinuity z'+i/4).toBeLessThanOrEqual(.26);}
 for(const v of samples){const peak=v.indexOf(Math.max(...v));for(let i=1;i<=peak;i++)expect(v[i]).toBeGreaterThanOrEqual(v[i-1]);for(let i=peak+1;i<v.length;i++)expect(v[i]).toBeLessThanOrEqual(v[i-1]);}
 for(let band=0;band<2;band++)expect(samples[band].filter((v,i)=>v>.05&&samples[band+1][i]>.05).length*.25).toBeGreaterThanOrEqual(.5);
});
