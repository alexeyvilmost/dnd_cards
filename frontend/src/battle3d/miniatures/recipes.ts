/** Presentation assets only. These recipes never supply combat rules or statistics. */
export type MiniatureBody = 'humanoid' | 'wolf' | 'rat' | 'spider' | 'dummy';
export type MiniatureHead = 'human' | 'goblin' | 'reptile' | 'skull' | 'helmet' | 'orc' | 'furry';
export type MiniatureWeapon = 'none' | 'sword' | 'greatsword' | 'scimitar' | 'dagger' | 'spear' | 'bow' | 'mace' | 'club' | 'axe' | 'hammer';
export interface MiniaturePalette {
  skin: string;
  armor: string;
  cloth: string;
  leather: string;
  metal: string;
  accent: string;
  eyes: string;
}
export interface MiniatureRecipe {
  id: string;
  label: string;
  body: MiniatureBody;
  head: MiniatureHead;
  height: number;
  bulk: number;
  weapon: MiniatureWeapon;
  palette: MiniaturePalette;
  shield?: boolean;
  cape?: boolean;
  hood?: boolean;
  armored?: boolean;
  horns?: boolean;
  mane?: boolean;
  beard?: boolean;
  plume?: boolean;
  quiver?: boolean;
  tail?: boolean;
  ragged?: boolean;
}

const palette = (skin: string, armor: string, cloth: string, accent = '#d5b778', eyes = '#f4e8b2'): MiniaturePalette => ({
  skin, armor, cloth, accent, eyes, leather: '#423226', metal: '#c0c9cf',
});
const humanoid = (id: string, label: string, values: Partial<MiniatureRecipe>): MiniatureRecipe => ({
  id, label, body: 'humanoid', head: 'human', height: 1, bulk: 1, weapon: 'sword',
  palette: palette('#bf9175', '#647888', '#4a5965'), ...values,
});

/** Each named asset can be reused by several source entities without identity branches in the renderer. */
export const MINIATURE_RECIPES = {
  bandit: humanoid('bandit', 'Бандит', {weapon: 'scimitar', hood: true, cape: true,
    palette: palette('#be936f', '#68645b', '#754838', '#b49e73')}),
  guard: humanoid('guard', 'Стражник', {head: 'helmet', armored: true, shield: true, weapon: 'spear',
    palette: palette('#d4af8b', '#819195', '#376478')}),
  'giant-rat': humanoid('giant-rat', 'Гигантская крыса', {body: 'rat', height: .82, weapon: 'none', tail: true,
    palette: palette('#90736c', '#67534e', '#ad8077', '#d5b8a5', '#d8746a')}),
  'kobold-warrior': humanoid('kobold-warrior', 'Кобольд-воин', {head: 'reptile', height: .73, bulk: .85,
    weapon: 'dagger', horns: true, tail: true, palette: palette('#b66b46', '#655349', '#557262', '#cfb07b')}),
  'goblin-warrior': humanoid('goblin-warrior', 'Гоблин-воин', {head: 'goblin', height: .73, bulk: .93,
    weapon: 'scimitar', shield: true, palette: palette('#829f59', '#605e48', '#8d5540', '#caaa69')}),
  'goblin-minion': humanoid('goblin-minion', 'Гоблин-прислужник', {head: 'goblin', height: .66, bulk: .86,
    weapon: 'dagger', hood: true, ragged: true, palette: palette('#a6b873', '#655b44', '#77664a')}),
  skeleton: humanoid('skeleton', 'Скелет', {head: 'skull', bulk: .69, weapon: 'sword', quiver: true,
    palette: palette('#d7cfac', '#989784', '#65717a', '#b8aa83', '#58c5c3')}),
  zombie: humanoid('zombie', 'Зомби', {height: .94, bulk: 1.05, weapon: 'none', ragged: true,
    palette: palette('#87977a', '#736b58', '#655369', '#a8997f', '#d9d6b7')}),
  wolf: humanoid('wolf', 'Волк', {body: 'wolf', weapon: 'none', height: .86, tail: true,
    palette: palette('#9babb1', '#69767e', '#c5c9be', '#e5ded0', '#e9c978')}),
  'giant-wolf-spider': humanoid('giant-wolf-spider', 'Гигантский волчий паук', {body: 'spider', weapon: 'none', height: .83,
    palette: palette('#604a42', '#3c302e', '#a88462', '#d2a578', '#df9666')}),
  'hobgoblin-warrior': humanoid('hobgoblin-warrior', 'Хобгоблин-воин', {head: 'goblin', armored: true, plume: true,
    height: 1.02, weapon: 'sword', quiver: true, palette: palette('#af7254', '#576775', '#8e3941', '#c3a474')}),
  tough: humanoid('tough', 'Громила', {bulk: 1.3, height: 1.02, weapon: 'mace', beard: true,
    palette: palette('#c69d7c', '#686a62', '#596847', '#c7b17c')}),
  'animated-armor': humanoid('animated-armor', 'Оживший доспех', {head: 'helmet', armored: true, bulk: 1.13,
    weapon: 'none', plume: true, palette: palette('#637c85', '#7f98a0', '#314b61', '#d1b06c', '#67e2e2')}),
  'dire-wolf': humanoid('dire-wolf', 'Лютый волк', {body: 'wolf', weapon: 'none', height: 1.04, bulk: 1.16,
    mane: true, tail: true, palette: palette('#5f6b79', '#394652', '#9faaa7', '#c9d0bb', '#f2c272')}),
  'bugbear-warrior': humanoid('bugbear-warrior', 'Багбир-воин', {head: 'furry', height: 1.11, bulk: 1.27,
    weapon: 'hammer', mane: true, palette: palette('#97734e', '#565b50', '#6a6245', '#d0b183')}),
  ogre: humanoid('ogre', 'Огр', {head: 'orc', height: 1.13, bulk: 1.52, weapon: 'club', ragged: true,
    palette: palette('#baa18b', '#73604a', '#76503b', '#e0c6a0')}),
  berserker: humanoid('berserker', 'Берсерк', {height: 1.03, bulk: 1.2, weapon: 'axe', horns: true,
    beard: true, mane: true, palette: palette('#c8a083', '#778389', '#675941', '#cfb682')}),
  'bandit-captain': humanoid('bandit-captain', 'Капитан бандитов', {weapon: 'scimitar', cape: true, plume: true,
    beard: true, palette: palette('#bd977d', '#5d6971', '#874957', '#dfbf72')}),
  'warrior-veteran': humanoid('warrior-veteran', 'Воин-ветеран', {weapon: 'greatsword', armored: true, cape: true,
    beard: true, bulk: 1.08, palette: palette('#bb967a', '#929ea0', '#3e6576', '#d4b77e')}),
  'training-dummy': humanoid('training-dummy', 'Тренировочный манекен', {body: 'dummy', weapon: 'none',
    palette: palette('#bba17a', '#755a3a', '#9d6960', '#cfbd97', '#493d30')}),
  'training-dummy-red': humanoid('training-dummy-red', 'Тренировочный манекен', {body: 'dummy', weapon: 'none',
    palette: palette('#a99172', '#644d3c', '#974e46', '#d2b37d', '#44342e')}),
  swordsman: humanoid('swordsman', 'Мечник · драконорождённый', {head: 'reptile', armored: true, horns: true,
    tail: true, weapon: 'greatsword', cape: true, height: 1.09, bulk: 1.12,
    palette: palette('#af5141', '#9baab2', '#345c83', '#e6c477', '#f3d279')}),
  archer: humanoid('archer', 'Лучник · человек', {weapon: 'bow', hood: true, cape: true, quiver: true,
    bulk: .89, palette: palette('#d0a986', '#7a6957', '#497a70', '#d6b980')}),
  line: humanoid('line', 'Линейный боец · орк', {head: 'orc', armored: true, shield: true, weapon: 'sword',
    bulk: 1.16, height: 1.07, palette: palette('#82966c', '#95a1a4', '#4d6081', '#e0c18b')}),
  adventurer: humanoid('adventurer', 'Искатель приключений', {cape: true, palette: palette('#c4a184', '#8096a0', '#426e85')}),
} satisfies Record<string, MiniatureRecipe>;

export type MiniatureRecipeId = keyof typeof MINIATURE_RECIPES;
