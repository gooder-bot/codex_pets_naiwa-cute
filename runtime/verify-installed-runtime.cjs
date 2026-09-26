const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readArchive } = require('./patch_current_runtime.cjs');
if (!process.argv[2]) throw new Error('Usage: node runtime/verify-installed-runtime.cjs /path/to/patched/app.asar');
const archive = readArchive(process.argv[2]);
const modulePath = archive.entries.find(e => /^webview\/assets\/app-initial-.*\.js$/.test(e.path)).path;
const source = archive.readEntry(modulePath).toString('utf8');
const start = source.indexOf('Lcc=({assetMap:');
const end = source.indexOf('function zcc(', start);
const suffix = '})))()}';
const fragment = source.slice(start + 4, end);
assert.ok(fragment.endsWith(suffix));
const arrow = fragment.slice(0, -suffix.length);
const supportStart = source.indexOf('function Ccc(');
const support = source.slice(supportStart, source.indexOf('var Mcc,Ncc;', supportStart));
function fixture() {
  const element = { style:{}, dataset:{} }, ref = { current:null }, events = [], states = [];
  let effects = [], pending = [], hookIndex = 0, jsx, reduced = false;
  let serial = 0;
  const timers = new Map();
  const context = {
    n:fn=>fn, Scc:()=>{}, J5:{columns:8,rows:11}, Ncc:{Root:'native-root'},
    Q:(...x)=>x.filter(Boolean).join(' '), Sce:()=>reduced,
    Fcc:{
      useState:initial=>[initial,value=>states.push(value)],
      useRef:()=>ref,
      useEffect:(setup,deps)=>{
        const index = hookIndex++, old = effects[index];
        if (!old || deps.some((value,i)=>value!==old.deps[i])) pending.push({index,setup,deps});
      },
    },
    Icc:{jsx:(type,props)=>(jsx={type,props})},
    installNaiwa:(node,input)=>{
      events.push({kind:'install',node,input});
      return {dispose:()=>events.push({kind:'dispose',node})};
    },
    updateNaiwa:(node,input)=>events.push({kind:'update',node,input}),
    window:{setTimeout:(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;},clearTimeout:id=>timers.delete(id)},
  };
  vm.createContext(context);
  vm.runInContext(support + ';jcc();this.component=' + arrow, context);
  const component = context.component;
  function render(petId, state='idle', extra={}) {
    hookIndex=0; pending=[];
    component({assetMap:{},source:{petId,spriteRowCount:11,spritesheetUrl:'data:image/webp,test'},state,...extra});
    ref.current=element; element.dataset.codexPetId=jsx.props['data-codex-pet-id'];
    for(const effect of pending) effects[effect.index]?.cleanup?.();
    for(const effect of pending) effects[effect.index]={deps:effect.deps,cleanup:effect.setup()};
    return jsx;
  }
  function unmount(){for(const effect of effects)effect?.cleanup?.();effects=[];ref.current=null;}
  return {element,events,states,timers,render,unmount,setReduced:v=>{reduced=v;}};
}
{
 const f=fixture();
 const jsx=f.render('custom:xiaohuangtuan','running',{respondToHover:true});
 assert.equal(jsx.props['data-codex-pet-id'],'custom:xiaohuangtuan');
 assert.deepEqual(f.events.map(e=>e.kind),['install','update']);
 assert.equal(f.events[0].input.state,'running');
 assert.equal(f.timers.size,0,'native timer must not compete with Naiwa');
 jsx.props.onPointerEnter();jsx.props.onPointerLeave();
 assert.equal(f.states.length,0,'inner native hover is gated');
 f.render('custom:xiaohuangtuan','review');
 assert.deepEqual(f.events.map(e=>e.kind),['install','update','update'],'state update must not dispose/reinstall');
 assert.equal(f.events.at(-1).input.state,'review');
 f.setReduced(true);f.render('custom:xiaohuangtuan','review');
 assert.deepEqual(f.events.slice(-3).map(e=>e.kind),['dispose','install','update']);
 assert.equal(f.events.at(-1).input.reducedMotion,true);
 f.unmount();assert.equal(f.events.at(-1).kind,'dispose');
}
{
 const f=fixture();
 const jsx=f.render('custom:otherpet','running',{respondToHover:true});
 assert.equal(f.events.length,0,'other pets must retain original renderer');
 assert.equal(f.element.style.backgroundPosition,'0% 70%');
 assert.equal(f.timers.size,1);
 assert.equal([...f.timers.values()][0].delay,120,'native state uses original first-frame duration');
 jsx.props.onPointerEnter();jsx.props.onPointerLeave();assert.deepEqual(f.states,[true,false]);
 f.render('custom:xiaohuangtuan','running');
 assert.equal(f.timers.size,0,'switching to Naiwa cleans native frame timer');
 assert.deepEqual(f.events.map(e=>e.kind),['install','update']);
 f.render('custom:otherpet','review');
 assert.equal(f.events.at(-1).kind,'dispose','switching away disposes Naiwa');
 assert.equal(f.timers.size,1);
 assert.equal([...f.timers.values()][0].delay,150);
 f.unmount();assert.equal(f.timers.size,0);
}
{
 const mascotPath=archive.entries.find(e=>/^webview\/assets\/avatar-mascot-button-.*\.js$/.test(e.path)).path;
 const mascot=archive.readEntry(mascotPath).toString('utf8');
 const begin=mascot.indexOf('v=e=>{e.currentTarget.querySelector('), finish=mascot.indexOf(',t[2]=v',begin);
 assert.ok(begin>=0&&finish>begin);
 const changes=[];const context={d:x=>changes.push(x)};vm.createContext(context);
 vm.runInContext('let '+mascot.slice(begin,finish)+';this.enter=v;this.leave=y;',context);
 const selectors=[];const eventFor=found=>({currentTarget:{querySelector:selector=>{selectors.push(selector);return found?{}:null;}}});
 context.enter(eventFor(true));context.leave(eventFor(true));assert.equal(changes.length,0);
 context.enter(eventFor(false));context.leave(eventFor(false));assert.deepEqual(changes,[true,false]);
 assert.ok(selectors.every(s=>s.includes('custom:xiaohuangtuan')));
}
console.log('PASS: actual installed Lcc + mascot gate use custom-prefixed identity; Naiwa install/update/unmount and reduced-motion lifecycle; pet switching cleans both controllers/timers; unrelated pets retain original frames and hover.');
