import {html, useRef, useEffect} from "./lib.js";
import * as THREE from "three";

const D2R = Math.PI/180;
// ความเร็วหมุนอัตโนมัติของลูกโลก (เรเดียนต่อเฟรม) — ~0.1 เรเดียน/วินาที ที่ 60 เฟรม/วินาที ครบรอบราว 65 วินาที
const AUTO_SPIN = 0.0016;
function latLngVec(lat, lng, r=1){
  const phi=(90-lat)*D2R, theta=(lng+180)*D2R;
  return new THREE.Vector3(-r*Math.sin(phi)*Math.cos(theta), r*Math.cos(phi), r*Math.sin(phi)*Math.sin(theta));
}
// tiny deterministic PRNG so the globe scatter is stable across renders
function rng(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed);
  t=t+Math.imul(t^t>>>7,61|t)^t; return((t^t>>>14)>>>0)/4294967296; }; }
function makeGlow(){const cv=document.createElement("canvas");cv.width=cv.height=64;const g=cv.getContext("2d");
  const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,"rgba(255,255,255,1)");
  gr.addColorStop(.35,"rgba(255,255,255,.5)");gr.addColorStop(1,"rgba(255,255,255,0)");
  g.fillStyle=gr;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(cv);}

export function Globe({countries=[], world, flyTo, onArrive, small, pins=[], hover=null, apiRef}){
  const mountRef = useRef();
  const S = useRef({});

  useEffect(()=>{
    const mount = mountRef.current;
    let W = mount.clientWidth, H = mount.clientHeight;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(45, W/H, .1, 100);
    cam.position.z = small?3.55:2.7;   // login-page globe sits further back → lighter visual weight
    const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.setSize(W,H); mount.appendChild(renderer.domElement);

    const world3 = new THREE.Group(); scene.add(world3);

    world3.add(new THREE.Mesh(new THREE.SphereGeometry(0.995,64,64),
      new THREE.MeshPhongMaterial({color:0x0a1424, emissive:0x061426, emissiveIntensity:.55, shininess:8})));
    world3.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(1.001,24,16)),
      new THREE.LineBasicMaterial({color:0x1c4a86, transparent:true, opacity:.10})));
    // Outer atmosphere glow — tighter + dimmer on the login page so the globe reads as a backdrop.
    // NOTE: the intensity multiplier MUST be interpolated via .toFixed(2). `${1.0}` stringifies to "1",
    // which is an int literal in GLSL ES — `float * int` fails to compile (no implicit conversion).
    world3.add(new THREE.Mesh(new THREE.SphereGeometry(small?1.09:1.14,64,64), new THREE.ShaderMaterial({
      side:THREE.BackSide, transparent:true,
      vertexShader:"varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:`varying vec3 vN;void main(){float i=pow(.66-dot(vN,vec3(0,0,1.)),2.4);gl_FragColor=vec4(.24,.6,1.,1.)*i*${(small?0.75:1.0).toFixed(2)};}`})));

    // Country borders (from world GeoJSON) and density dots (from aggregates) are
    // built as OVERLAYS in the two effects below — they attach to world3 as their
    // data arrives, so the sphere above shows instantly with no data dependency.
    const glow=makeGlow();
    const halos=new THREE.Group(); world3.add(halos);

    scene.add(new THREE.AmbientLight(0x8fb0ff,.7));
    const dir=new THREE.DirectionalLight(0xffffff,1.05); dir.position.set(3,2,4); scene.add(dir);
    const sp=[]; for(let i=0;i<700;i++){const rr=16+Math.random()*22, th=Math.random()*6.283, ph=Math.acos(2*Math.random()-1);
      sp.push(rr*Math.sin(ph)*Math.cos(th), rr*Math.sin(ph)*Math.sin(th), rr*Math.cos(ph));}
    scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(sp,3)),
      new THREE.PointsMaterial({color:0x9fb8e0,size:.07,transparent:true,opacity:.6})));

    // ---- interaction: globe spins on its OWN VERTICAL AXIS only. Camera fixed. ----
    const st=S.current;
    st.world=world3; st.cam=cam; st.renderer=renderer; st.scene=scene; st.halos=halos; st.glow=glow; st.small=small;
    world3.rotation.x=0; world3.rotation.z=0;
    // มุมมองเริ่มต้น: หันประเทศไทย (ครอบทั้ง 4 จังหวัด ~lng 100.5) เข้าหากล้อง แล้วหมุนอัตโนมัติต่อเนื่อง
    const _hv=latLngVec(13.5,100.5,1); st.homeSpin = -Math.atan2(_hv.x,_hv.z);
    // st.auto=true ตั้งแต่ประกอบร่าง → ลูกโลกหมุนเองทันทีที่โหลดหน้าแรก (ทั้งหน้าเข้าสู่ระบบและหน้าเลือกจังหวัด)
    st.spin=st.homeSpin; st.targetSpin=st.homeSpin; st.flyCamTarget=null; st.flyCb=null; st.flying=false; st.auto=true; st.homing=false; st.drag=null; st.targetZ=cam.position.z;
    world3.rotation.y=st.spin;
    // ── สถานะ hover การ์ดจังหวัด: หมุน+ยกกล้องพาจังหวัดมากึ่งกลางจอ (ไม่ยุ่งกับ flyTo ของการคลิก) ──
    st.hoverId=null; st.hoverTarget=null; st.pinObjs=null;
    st.setHover=(id)=>{ st.hoverId=id||null;
      if(id){ const p=(st.pinObjs||[]).find(x=>x.id===id); if(p){ st.hoverTarget={lat:p.lat,lng:p.lng}; st.auto=false; st.flying=false; } }
      else { st.hoverTarget=null; setTimeout(()=>{ if(!st.hoverTarget && !st.drag && !st.flying) st.auto=true; }, 400); } };
    // เปิดให้ปุ่ม "รีเซ็ตมุมมอง" เรียกกลับไปมุมกว้างเริ่มต้น (เห็นครบทั้ง 4 จังหวัด)
    if(apiRef) apiRef.current = { resetView:()=>{ st.hoverId=null; st.hoverTarget=null; st.resetView && st.resetView(); } };
    const norm=a=>{ a=(a+Math.PI)%(2*Math.PI); if(a<0)a+=2*Math.PI; return a-Math.PI; };

    const el=renderer.domElement; el.style.cursor="grab";
    const down=e=>{st.drag={x:e.clientX};st.auto=false;st.flying=false;el.style.cursor="grabbing";};
    const move=e=>{ if(!st.drag)return; st.spin += (e.clientX-st.drag.x)*0.006; st.drag={x:e.clientX}; };
    const up=()=>{ if(st.drag){st.drag=null;el.style.cursor="grab"; setTimeout(()=>{if(!st.drag&&!st.flying)st.auto=true;},2500);} };
    const wheel=e=>{ e.preventDefault(); if(st.flying)return; st.targetZ=Math.max(1.35,Math.min(4, st.targetZ + (e.deltaY>0?0.28:-0.28))); };
    el.addEventListener("pointerdown",down); window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",up); el.addEventListener("wheel",wheel,{passive:false});

    let raf,t=0; const _home=new THREE.Vector3(), _tv=new THREE.Vector3();
    (function loop(){ raf=requestAnimationFrame(loop); t+=.016;
      if(st.flying){
        st.spin += norm(st.targetSpin-st.spin)*0.07;
        cam.position.lerp(st.flyCamTarget, 0.05); cam.lookAt(0,0,0);
        if(Math.abs(norm(st.targetSpin-st.spin))<0.01 && cam.position.distanceTo(st.flyCamTarget)<0.03){
          st.flying=false; const cb=st.flyCb; st.flyCb=null; cb&&cb(); }
      } else if(st.hoverTarget){
        // hover: หมุนลองจิจูดจังหวัดมาด้านหน้า + ยกกล้องตามละติจูด → จังหวัดอยู่กึ่งกลางจอแบบนุ่มนวล
        const hv=latLngVec(st.hoverTarget.lat, st.hoverTarget.lng, 1);
        st.spin += norm((-Math.atan2(hv.x,hv.z)) - st.spin)*0.08;
        const cd=small?2.55:2.0;
        _tv.set(0, Math.sin(st.hoverTarget.lat*D2R)*cd, Math.cos(st.hoverTarget.lat*D2R)*cd);
        cam.position.lerp(_tv,0.07); cam.lookAt(0,0,0);
      } else {
        // ── สถานะว่าง: หมุนอัตโนมัติต่อเนื่อง ──
        // ลำดับความสำคัญ: กำลังลาก (ผู้ใช้คุมเอง) → กำลังดึงกลับมุมเริ่มต้น (ปุ่มรีเซ็ตมุมมอง) → หมุนเอง
        if(st.drag){ /* กำลังลากด้วยเมาส์ → ปล่อยให้ผู้ใช้คุมมุมเอง ไม่แทรกแซง */ }
        else if(st.homing){          // กดรีเซ็ตมุมมอง → ค่อยๆดึงกลับมุมประเทศไทย ถึงแล้วคืนการหมุนอัตโนมัติ
          const d=norm(st.homeSpin - st.spin); st.spin += d*0.06;
          if(Math.abs(d)<0.02){ st.homing=false; st.auto=true; }
        }
        else if(st.auto) st.spin += AUTO_SPIN;   // หมุนเองรอบแกนตั้ง (หยุดชั่วคราวตอนลาก/บิน/ชี้การ์ดจังหวัด)
        _home.set(0,0,st.targetZ); cam.position.lerp(_home,0.08); cam.lookAt(0,0,0);
      }
      world3.rotation.y = st.spin;
      halos.children.forEach((h,i)=>{const s=(small?0.14:0.16)+Math.abs(Math.sin(t*1.5+i))*0.05;h.scale.set(s,s,1);});
      // pulse หมุดจังหวัด (ใบที่ hover = ใหญ่ขึ้น/สว่างขึ้น)
      if(st.pinObjs) for(const p of st.pinObjs){ const hvd=p.id===st.hoverId;
        const s=hvd? .12+Math.abs(Math.sin(t*4))*.05 : .075; p.spr.scale.set(s,s,1); p.spr.material.opacity=hvd?1:.82; }
      renderer.render(scene,cam);
    })();

    const onResize=()=>{W=mount.clientWidth;H=mount.clientHeight;cam.aspect=W/H;cam.updateProjectionMatrix();renderer.setSize(W,H);};
    window.addEventListener("resize",onResize);
    // Fly INTO a country: rotate its longitude to the front AND raise the camera to its latitude (~75% fill).
    st.flyToLatLng=(lat,lng,cb)=>{ const v=latLngVec(lat,lng,1);
      const desired = -Math.atan2(v.x, v.z);
      st.targetSpin = st.spin + norm(desired - st.spin);
      const camDist = small?2.0:1.5;
      st.flyCamTarget = new THREE.Vector3(0, Math.sin(lat*D2R), Math.cos(lat*D2R)).multiplyScalar(camDist);
      st.flyCb=cb; st.auto=false; st.flying=true; };
    // Un-zoom back to the default wide view (used when returning to the province-picker screen, e.g. clicking
    // the logo while this globe is still mounted) — flies the camera straight back out along its current
    // bearing, then hands control back to the idle auto-spin.
    // รีเซ็ตมุมมอง: กลับไปหันประเทศไทยเห็นครบทั้ง 4 จังหวัด (idle จะค่อยๆดึง spin กลับ homeSpin + กล้องกลับมุมกว้างเอง)
    // สั่งดึงมุมกลับไปหันประเทศไทยก่อน (st.homing) แล้ว loop จะคืนการหมุนอัตโนมัติให้เองเมื่อถึงมุมเป้าหมาย
    st.resetView=()=>{ st.hoverTarget=null; st.hoverId=null; st.targetZ = small?3.0:2.7; st.flying=false; st.homing=true; st.auto=false; };

    return ()=>{ cancelAnimationFrame(raf); window.removeEventListener("resize",onResize);
      window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
      renderer.dispose(); try{mount.removeChild(renderer.domElement);}catch(e){} };
  },[]);

  // flyTo set → fly in. flyTo cleared (back to the picker) → zoom back out, but only if THIS mounted globe had
  // actually flown somewhere (hadFlyTo) — a freshly mounted globe already starts at the wide view.
  useEffect(()=>{
    if(flyTo && S.current.flyToLatLng){
      S.current.flyToLatLng(flyTo.center[0], flyTo.center[1], ()=>onArrive&&onArrive(flyTo.country));
    } else if(!flyTo && S.current.resetView && S.current.hadFlyTo){
      S.current.resetView();
    }
    S.current.hadFlyTo = !!flyTo;
  },[flyTo && flyTo.seq]);

  // OVERLAY 1 — country borders, attached once the world GeoJSON has loaded (progressive)
  useEffect(()=>{
    const st=S.current; if(!st.world || !world || !world.features) return;
    if(st.borderLayer){ st.world.remove(st.borderLayer); st.borderLayer.geometry.dispose(); st.borderLayer.material.dispose(); }
    const segs=[]; const addRing=ring=>{ for(let i=0;i<ring.length-1;i++){
      const a=latLngVec(ring[i][1],ring[i][0],1.002), b=latLngVec(ring[i+1][1],ring[i+1][0],1.002);
      segs.push(a.x,a.y,a.z,b.x,b.y,b.z);} };
    for(const f of world.features){ const g=f.geometry; if(!g)continue;
      if(g.type==="Polygon") g.coordinates.forEach(addRing);
      else if(g.type==="MultiPolygon") g.coordinates.forEach(p=>p.forEach(addRing)); }
    const bg=new THREE.BufferGeometry(); bg.setAttribute("position",new THREE.Float32BufferAttribute(segs,3));
    st.borderLayer=new THREE.LineSegments(bg, new THREE.LineBasicMaterial({color:0x3a7fd0, transparent:true, opacity:.34}));
    st.world.add(st.borderLayer);
  },[world]);

  // OVERLAY 2 — density dots + opportunity halos, from country AGGREGATES (tiny; no customer list)
  useEffect(()=>{
    const st=S.current; if(!st.world || !countries || !countries.length) return;
    if(st.dotLayer){ st.world.remove(st.dotLayer); st.dotLayer.geometry.dispose(); st.dotLayer.material.dispose(); }
    const pts=[], cols=[]; const cRed=new THREE.Color(0xff4d33), cOrange=new THREE.Color(0xff9a3c), cWarm=new THREE.Color(0xffd24d);
    const rand=rng(12345);
    countries.forEach(c=>{ const lat=c.center[0], lng=c.center[1];
      const n=Math.min(70, Math.max(6, Math.round((c.customerCount+c.prospectCount)/40)));
      const spread=Math.min(6, 1.4+Math.sqrt(c.customerCount)/9);
      for(let i=0;i<n;i++){ const v=latLngVec(lat+(rand()-.5)*spread*2, lng+(rand()-.5)*spread*2, 1.012);
        pts.push(v.x,v.y,v.z); const t=rand(); const col=t<.6?cRed:(t<.85?cOrange:cWarm); cols.push(col.r,col.g,col.b); } });
    const pg=new THREE.BufferGeometry();
    pg.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));
    pg.setAttribute("color",new THREE.Float32BufferAttribute(cols,3));
    st.dotLayer=new THREE.Points(pg, new THREE.PointsMaterial({size:st.small?0.02:0.024, map:st.glow, vertexColors:true,
      transparent:true, opacity:.95, blending:THREE.AdditiveBlending, depthWrite:false}));
    st.world.add(st.dotLayer);
    st.halos.clear();
    [...countries].sort((a,b)=>b.opportunityScore-a.opportunityScore).slice(0,6).forEach(c=>{ const v=latLngVec(c.center[0],c.center[1],1.02);
      const s=new THREE.Sprite(new THREE.SpriteMaterial({map:st.glow,color:0xff5a3c,transparent:true,
        blending:THREE.AdditiveBlending,depthWrite:false})); s.position.copy(v); s.scale.set(.16,.16,1); st.halos.add(s);});
  },[countries]);

  // OVERLAY 3 — หมุดจังหวัดเด่น ปักตามพิกัดจริง ติดกับลูกโลก (หมุนตามลูกโลก) แล้วฉายลงจอในลูป render
  useEffect(()=>{
    const st=S.current; if(!st.world) return;
    if(st.pinGroup){ st.world.remove(st.pinGroup); st.pinGroup.traverse(o=>{ o.material&&o.material.dispose&&o.material.dispose(); }); }
    st.pinGroup=new THREE.Group(); st.world.add(st.pinGroup);
    st.pinObjs=(pins||[]).map(p=>{ const v=latLngVec(p.lat,p.lng,1.03);
      const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:st.glow,color:0xffffff,transparent:true,
        blending:THREE.AdditiveBlending,depthWrite:false})); spr.position.copy(v); spr.scale.set(.075,.075,1);
      st.pinGroup.add(spr); return {id:p.id, lat:p.lat, lng:p.lng, spr}; });
  },[pins]);

  // hover การ์ด → โฟกัสจังหวัดนั้นบนลูกโลก
  useEffect(()=>{ const st=S.current; if(st.setHover) st.setHover(hover||null); },[hover]);

  return html`<div id="globe-canvas" ref=${mountRef}></div>`;
}
