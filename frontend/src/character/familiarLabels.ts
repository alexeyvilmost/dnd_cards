/** Display labels only; canonical catalog identities and replay data stay unchanged. */
const names: Record<string,string> = {
 bat:'Летучая мышь',cat:'Кошка',frog:'Лягушка',hawk:'Ястреб',lizard:'Ящерица',octopus:'Осьминог',owl:'Сова',rat:'Крыса',raven:'Ворон',spider:'Паук',weasel:'Ласка',
 imp:'Бес',pseudodragon:'Псевдодракон',quasit:'Квазит',skeleton:'Скелет',slaad_tadpole:'Головастик слаада',sphinx_of_wonder:'Сфинкс чудес',sprite:'Спрайт',venomous_snake:'Ядовитая змея',
};
export function familiarFormLabel(idOrName:string):string { return names[idOrName.toLowerCase().replaceAll(' ','_')] ?? idOrName; }
export function familiarPresenceLabel(presence:string):string {
 return ({present:'рядом',pocket_dimension:'в карманном измерении',disappeared_zero_hp:'исчез после потери хитов',dismissed_forever:'отпущен'} as Record<string,string>)[presence] ?? presence;
}
