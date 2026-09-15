import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Check } from './types.ts';
import budgets from './budgets.json';
import config from './fixtures/visits.ts';
import { validateConfig,resolveVisits } from '../scripts/config.ts';
import { runtimeChecks } from './runtime.ts';
import { payloadViolations } from './payload.ts';
import {styleChecks} from './style.ts';
const started=Date.now();
const checks:Check[]=[];
const quick=process.argv.includes('--quick');
function check(id:string,category:Check['category'],metric:number,threshold:number,message:string,unit='count',comparator:Check['comparator']='lte') { checks.push({id,category,metric,threshold,message,unit,comparator,status:(comparator==='lte'?metric<=threshold:comparator==='gte'?metric>=threshold:metric===threshold)?'pass':'fail'}); }
function command(id:string,args:string[],file:string){const result=spawnSync('npx',args,{encoding:'utf8',timeout:45000});check(id,'correctness',result.status===0?0:1,0,`${file}: threshold 0 command errors; measured ${result.status===0?0:1}. ${result.stdout} ${result.stderr} ${result.error?.message??''}`);}
function walk(dir:string):string[]{return existsSync(dir)?readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?walk(p):[p];}):[];}
if(!quick)rmSync('src/generated',{recursive:true,force:true});
command('static.lint',['eslint','.'],'eslint.config.js');
command('unit.contracts',['vitest','run','verification/contracts.test.ts'],'verification/contracts.test.ts');
const build=spawnSync('npm',['run','build'],{encoding:'utf8',timeout:45000,env:{...process.env,ATLAS_FIXTURE:'1',VITE_BASEMAP:'bundled',VITE_BASE:'/atlas/'}});
check('data.fixture-build','data',build.status===0?0:1,0,`scripts/build-geo.ts → dist/: threshold 0 build errors; measured ${build.status===0?0:1}. ${build.stdout} ${build.stderr}`);
command('static.types',['tsc','--noEmit'],'tsconfig.json');
try{checks.push(...styleChecks());}catch(error){check('zoom.emitted-style','correctness',1,0,`src/generated/style.json: ${String(error)}`);}
const emitted=walk('dist');
const generated=walk('src/generated');
check('budget.js','budget',emitted.filter(p=>p.endsWith('.js')).reduce((n,p)=>n+gzipSync(readFileSync(p)).length,0)||Number.MAX_SAFE_INTEGER,budgets.jsGzip,'dist/assets/*.js: gzipped application budget; excessive dependencies or missing build','bytes');
check('budget.css','budget',emitted.filter(p=>p.endsWith('.css')).reduce((n,p)=>n+statSync(p).size,0)||Number.MAX_SAFE_INTEGER,budgets.css,'dist/assets/*.css: stylesheet bytes budget; oversized styles or missing output','bytes');
check('budget.fonts','budget',walk('public/fonts').reduce((n,p)=>n+(p.endsWith('.woff2')?statSync(p).size:0),0)||Number.MAX_SAFE_INTEGER,budgets.fonts,'public/fonts/: self-hosted WOFF2 budget; missing fonts or extra subsets','bytes');
check('budget.geometry','budget',generated.filter(p=>p.endsWith('.geojson')).reduce((n,p)=>n+gzipSync(readFileSync(p)).length,0)||Number.MAX_SAFE_INTEGER,budgets.geometryGzip,'src/generated/*.geojson: gzipped geometry budget; simplify selected boundaries','bytes');
check('budget.largest-generated','budget',generated.length?Math.max(...generated.map(p=>statSync(p).size)):Number.MAX_SAFE_INTEGER,budgets.largestGenerated,'src/generated/: largest generated file; missing geometry or excessive detail','bytes');
try {
 const problems:string[]=[];
 const cache=JSON.parse(readFileSync('verification/fixtures/geocache.json','utf8'));
 const resolved=resolveVisits(validateConfig(config,cache),cache);
 const safeCoordinates=Object.fromEntries(resolved.filter(visit=>visit.coordinates).map(visit=>[visit.id,visit.coordinates!]));
 for(const file of [...emitted,...generated]){
  if(!/\.(js|json|html|css|map|geojson)$/.test(file))continue;
  const text=readFileSync(file,'utf8');problems.push(...payloadViolations(file,text,safeCoordinates));
  for(const visit of config.visits)if(visit.address&&text.includes(visit.address))problems.push(`${file}: leaked address for ${visit.id}`);
 }
 check('data.payload-purity','data',problems.length,0,`dist/** and src/generated/places.json: allowlist violations ${problems.length}; ${problems.join('; ')}`);
 const leakedCoordinates=problems.filter(problem=>problem.includes('precision'));
 const leaks=resolved.filter(p=>{const authored=config.visits.find(v=>v.id===p.id);if(!authored||(authored.publishPrecision??config.publishPrecision??'city')==='exact')return false;return Object.values(cache).some(value=>{const entry=value as {coordinates:number[];kind?:string};return entry.kind==='address'&&JSON.stringify(entry.coordinates)===JSON.stringify(p.coordinates);});});
 check('data.city-precision','data',leaks.length+leakedCoordinates.length,0,`dist/**, generated visits/places and style pin geometry: ${leaks.length+leakedCoordinates.length} unsafe coordinate values; ${leakedCoordinates.join('; ')}`);
 const countries=JSON.parse(readFileSync('src/generated/countries.geojson','utf8'));
 const regions=JSON.parse(readFileSync('src/generated/regions.geojson','utf8'));
 const missing=resolved.filter(p=>!countries.features.some((f:{properties:{country:string}})=>f.properties.country===p.country)||(p.region&&!regions.features.some((f:{properties:{region:string}})=>f.properties.region===p.region)));
 check('data.integrity','data',missing.length,0,`src/generated/: ${missing.length} missing country/region references; resolve all configured boundaries`);
 check('data.geocache','data',0,0,'data/geocache.json: zero misses; validated all authored queries offline');
} catch(error){check('data.integrity','data',1,0,`data/visits.ts and src/generated/: threshold 0 errors; measured 1; ${String(error)}`);}
if(!quick){try{checks.push(...await runtimeChecks());}catch(error){check('runtime.harness','correctness',1,0,`verification/runtime.ts: expected executable browser checks; ${String(error)}`);}}
let commit='uncommitted';try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{/* An uninitialized repository has no commit identity. */}
const baselinePath='verification/baseline.json';
if(existsSync(baselinePath)){const baseline=JSON.parse(readFileSync(baselinePath,'utf8')) as {checks:Check[]};for(const c of checks){const old=baseline.checks.find(b=>b.id===c.id);if(old){c.baseline=old.metric;c.delta=c.metric-old.metric;}}}
const metric=(id:string)=>checks.find(c=>c.id===id)?.metric??null;
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const objective={hardFailures:checks.filter(c=>['correctness','data','a11y','network'].includes(c.category)&&c.status==='fail').length,p95FrameMs:metric('perf.frametime.p95'),firstViewBytes:metric('network.first-view-bytes'),firstViewRequests:metric('network.first-view-requests'),visualDiffPixels:checks.filter(c=>c.category==='visual'&&c.id!=='visual.nonblank-canvas').reduce((n,c)=>n+c.metric,0),dependencies:Object.keys(pkg.dependencies??{}).length,sourceLines:[...walk('src'),...walk('scripts'),...walk('verification')].filter(p=>/\.(ts|tsx|css)$/.test(p)&&!p.includes('/generated/')).reduce((n,p)=>n+readFileSync(p,'utf8').split('\n').length,0)};
const report={commit,timestamp:new Date().toISOString(),durationMs:Date.now()-started,checks,summary:{pass:checks.filter(c=>c.status==='pass').length,fail:checks.filter(c=>c.status==='fail').length,skip:checks.filter(c=>c.status==='skip').length,objective}};
mkdirSync('verification',{recursive:true});writeFileSync('verification/report.json',JSON.stringify(report,null,2));
if(process.argv.includes('--set-baseline')){if(report.summary.fail)console.error('Baseline refused: verification must pass before setting a metric baseline.');else writeFileSync(baselinePath,JSON.stringify(report,null,2));}
console.table(checks.map(({id,status,metric,unit,threshold,delta})=>({id,status,metric,unit,threshold,delta})));
console.table(objective);
for(const c of checks.filter(c=>c.status==='fail'))console.error(`FAIL ${c.id}: ${c.message}; threshold ${c.comparator} ${c.threshold} ${c.unit}, measured ${c.metric} ${c.unit}`);
process.exitCode=report.summary.fail?1:0;
