import fs from 'fs';
const a = JSON.parse(fs.readFileSync('_spells_parsed.json', 'utf8'));
console.log('CANTRIPS (' + a.filter(x => x.level === 0).length + '):');
console.log(a.filter(x => x.level === 0).map(x => x.name).join(', '));
console.log('\nSPOT CHECKS:');
for (const s of a) {
  if (/снаряд|ладони|волна|Лечение ран|Волшебная стрела|Луч холода|Леденящее/.test(s.name))
    console.log(`${s.name} | L${s.level} ${s.school} atk=${s.attack_roll} save=${JSON.stringify(s.save_types)} dmg=${JSON.stringify(s.damage)} heal=${s.heal_dice} area=${s.area} conc=${s.concentration}`);
}
