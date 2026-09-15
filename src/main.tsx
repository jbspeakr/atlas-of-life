import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createMap,places,visits,visitsByPlace} from './map/create-map';
import type {Atlas} from './map/create-map';
import regionLabelsData from './generated/region-labels.json';
const regionLabels:Record<string,string>=regionLabelsData;
const dateFormatter=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
import './styles/map.css';
import './styles/tokens.css';
import './styles/app.css';
const countryNames=new Intl.DisplayNames(['en'],{type:'region'});
const years=visits.flatMap(v=>[v.date,...(v.dateRange??[])].filter((s):s is string=>Boolean(s)).map(s=>Number(s.slice(0,4))));
const firstYear=Math.min(...years,new Date().getUTCFullYear());
const lastYear=Math.max(...years,firstYear);
const chronology=[...places].sort((a,b)=>(a.date??a.dateRange?.[0]??'9999').localeCompare(b.date??b.dateRange?.[0]??'9999')||a.id.localeCompare(b.id));
function App(){
 const host=useRef<HTMLDivElement>(null);const atlas=useRef<Atlas|null>(null);const closeButton=useRef<HTMLButtonElement>(null);const origin=useRef<string|null>(null);
 const [selected,setSelected]=useState<string|null>(null);const [year,setYear]=useState(lastYear);const [view,setView]=useState('The world, with visited countries illuminated.');const [zoom,setZoom]=useState(1.8);const [error,setError]=useState('');
 const place=places.find(p=>p.id===selected);
 useEffect(()=>{
  if(!host.current)return;
  const abort=new AbortController();
  let controller:Atlas|undefined;
  void createMap(host.current,id=>{
   setSelected(id);
   if(id)origin.current=id;
   else if(origin.current)document.querySelector<HTMLButtonElement>(`[data-place-id="${origin.current}"]`)?.focus({preventScroll:true});
  },(message,z)=>{setView(message);setZoom(z);},abort.signal).then(value=>{
   if(abort.signal.aborted){value.destroy();return;}
   controller=value;atlas.current=value;
   value.map.on('error',event=>setError('The map could not load its geographic data. '+event.error.message));
  }).catch(error=>{if(!abort.signal.aborted)setError(String(error));});
  return()=>{abort.abort();controller?.destroy();};
 },[]);
 useEffect(()=>{if(place)closeButton.current?.focus({preventScroll:true});},[place]);
 function dismiss(){setSelected(null);history.replaceState(null,'',location.pathname+location.search);if(origin.current)document.querySelector<HTMLButtonElement>(`[data-place-id="${origin.current}"]`)?.focus({preventScroll:true});}
 useEffect(()=>{function escape(event:KeyboardEvent){if(event.key==='Escape'){setSelected(null);history.replaceState(null,'',location.pathname+location.search);if(origin.current)document.querySelector<HTMLButtonElement>(`[data-place-id="${origin.current}"]`)?.focus({preventScroll:true});}}window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[]);
 const placeVisits=place?visitsByPlace[place.id]??[]:[];
 return <main className={zoom>=6.5?'atlas atlas-close':'atlas'}>
  <div ref={host} className="map" aria-label="Interactive world map"/>
  <header><h1>Atlas of a Life</h1><p>A little more of the world.</p><div className="atlas-count">{new Set(visits.map(v=>v.country)).size} countries <span aria-hidden="true">·</span> {places.length} places <span aria-hidden="true">·</span> {firstYear}–{lastYear}</div></header>
  <nav className="navigation" aria-label="Map controls"><button type="button" onClick={()=>atlas.current?.reset()}><span aria-hidden="true">↗</span> Back to the world</button></nav>
  <section className="place-index" aria-label="Places in chronological order"><h2>Places, so far</h2><ol>{chronology.map(p=><li key={p.id}><button type="button" data-place-id={p.id} aria-pressed={selected===p.id} onClick={()=>atlas.current?.select(p.id)}><span className="place-mark" aria-hidden="true"/><span className="index-name">{p.label}</span><span className="index-year">{(p.date??p.dateRange?.[0]??'').slice(0,4)}</span>{p.visitCount>1&&<span className="visit-count" aria-label={`${p.visitCount} visits`}>×{p.visitCount}</span>}</button></li>)}</ol></section>
  {place&&<section className="place-caption" role="dialog" aria-label="Place" aria-describedby="place-geography">
   <button className="dismiss" ref={closeButton} type="button" aria-label="Close place label" onClick={dismiss}>×</button>
   <h2>{place.label}</h2>
   <p id="place-geography">{place.region&&<>{regionLabels[place.region]??place.region} <span aria-hidden="true">/</span> </>}{countryNames.of(place.country)}</p>
   <p className="visit-dates">{placeVisits.map(v=>v.date?dateFormatter.format(new Date(v.date+'T00:00:00Z')):(v.dateRange?v.dateRange.map((date,i)=>date?dateFormatter.format(new Date(date+'T00:00:00Z')):i?'onwards':'Earlier').join(' — '):'')).filter(Boolean).join(' · ')}</p>
   {place.visitCount>1&&<p className="caption-count">{place.visitCount} visits</p>}
  </section>}
  <form className="timeline" onSubmit={e=>e.preventDefault()}><label htmlFor="year">Through <output htmlFor="year">{Math.floor(year)}</output></label><span className="timeline-bound" aria-hidden="true">{firstYear}</span><input id="year" aria-label="Year" type="range" min={firstYear} max={lastYear||firstYear+1} step="0.05" value={year} aria-valuetext={`Through ${Math.floor(year)}`} onChange={e=>{const value=Number(e.target.value);setYear(value);atlas.current?.filter(value);}}/><span className="timeline-bound" aria-hidden="true">{lastYear}</span></form>
  <details className="attribution"><summary>© OpenStreetMap contributors · Map credits</summary><div><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a><a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps · basemap & style</a><a href="https://www.geoboundaries.org" target="_blank" rel="noreferrer">geoBoundaries · Runfola et al., 2020 · CC-BY 4.0</a><a href="https://www.naturalearthdata.com" target="_blank" rel="noreferrer">Natural Earth · public domain</a></div></details>
  <p className="sr-only" aria-live="polite" aria-atomic="true">{place?`${place.label}, ${countryNames.of(place.country)}. ${place.visitCount} ${place.visitCount===1?'visit':'visits'}.`:view}</p>
  {error&&<p className="map-error" role="alert">{error}</p>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
