// node tools/assemble.js <srcDir> <outIndexHtml>
const fs=require('fs'),path=require('path');const [src,out]=process.argv.slice(2);
let h=fs.readFileSync(path.join(src,'app3.html'),'utf8');
const put=(tag,file)=>{const s=fs.readFileSync(path.join(src,file),'utf8');if(!h.includes(tag))throw new Error('missing '+tag);h=h.split(tag).join(s)};
put('/*__CORE__*/','core.js');put('/*__PLAYER__*/','player.js');put('/*__KORF__*/','korf.js');put('/*__FACTORY__*/','factory.js');
if(h.includes('/*__SAMPLER__*/'))put('/*__SAMPLER__*/','sampler.js');
fs.writeFileSync(out,h);console.log('wrote',out,h.length);
