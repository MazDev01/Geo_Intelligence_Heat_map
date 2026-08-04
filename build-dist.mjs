// รีบิลด์โฟลเดอร์ deploy (static bundle กรองเหลือเฉพาะ Thailand) แล้ว re-deploy ลิงก์เดิมบน Vercel
// วิธีอัปเดตเว็บ:  node build-dist.mjs   แล้ว   cd geo-intel && npx vercel@latest --prod
import {rmSync, mkdirSync, cpSync, readFileSync, writeFileSync} from 'node:fs';
const OUT = 'geo-intel';
// ลบเฉพาะไฟล์แอป — เก็บ .vercel (การเชื่อมโปรเจกต์) ไว้ เพื่อ deploy ทับลิงก์เดิม
for(const item of ['index.html','src','data']) rmSync(OUT+'/'+item,{recursive:true,force:true});
mkdirSync(OUT+'/data',{recursive:true});
cpSync('index.html', OUT+'/index.html');
cpSync('src', OUT+'/src', {recursive:true});
for(const f of ['countries.json','areas.json','districts.json','thailand-provinces.geojson','world.geojson'])
  cpSync('data/'+f, OUT+'/data/'+f);
for(const f of ['customers','prospects']){
  const a = JSON.parse(readFileSync('data/'+f+'.json','utf8'));
  const th = a.filter(r=>r && r.country==='Thailand');
  writeFileSync(OUT+'/data/'+f+'.json', JSON.stringify(th));
  console.log(f+': '+a.length+' -> '+th.length+' (Thailand)');
}
console.log('✅ '+OUT+'/ พร้อม — รัน:  cd '+OUT+' && npx vercel@latest --prod');
