# Battle map assets · 254

Generated with the built-in ImageGen tool, using the imagegen skill. These are background plates and a transparent sprite atlas; collision, cover and hazards are independent declarations in `frontend/src/solo-combat/data/battleMaps.json`. No gameplay is inferred from pixels.

## forest-floor-v1.png

Output: `frontend/public/assets/battle-maps/forest-floor-v1.png`

Use case: stylized-concept
Asset type: top-down tactical game map ground plate, landscape 3:2.
Primary request: painterly enchanted woodland FLOOR for a D&D tactical battlefield, directly overhead orthographic 90 degrees. Mossy dark olive ground, patches of grass, tiny scattered fallen leaves, softly worn earthen texture. Beautiful hand-painted fantasy strategy game style, not photorealism. Calm even diffuse lighting, subdued contrast so character tokens and grid remain readable.
Composition: floor fills every edge, no horizon, broad uncluttered traversable area over entire image. No large objects; all obstacles and difficult terrain will be separate sprites placed by the game. Texture scale small and consistent throughout, slight organic variation without focal point.
Avoid: tree crowns, trees, trunks, branches above ground, roofs, walls, buildings, people, creatures, weapons, text, symbols, grid lines, vignette, UI, rivers, paths that imply game geometry. Generate an actual bitmap illustration.

## crypt-floor-v1.png

Output: `frontend/public/assets/battle-maps/crypt-floor-v1.png`

Use case: stylized-concept
Asset type: top-down tactical game map floor plate, landscape 4:3.
Primary request: dark ancient crypt FLOOR only for a D&D battlefield, strictly orthographic overhead 90 degrees. Large worn grey-blue stone slabs, hairline cracks, dusty edges, sparse old grit. Evocative hand-painted fantasy strategy game texture, not photorealism. Dim cool even light, readable neutral middle-dark stone. Ground fills image edge-to-edge.
Composition: completely open playable floor throughout. Walls, sarcophagi, webs and characters are separate game sprites, so do NOT paint any of them. Consistent texture scale. No strong vignette.
Avoid: perspective, horizon, columns, walls, roofs, doors, stairs, tombs, skulls, candles, symbols, runes, text, grid overlays, UI.

## valley-floor-v1.png

Output: `frontend/public/assets/battle-maps/valley-floor-v1.png`

Use case: stylized-concept
Asset type: overhead tactical battlefield ground plate, landscape 5:3.
Primary request: ground of a goblin camp in a grassy valley. FLOOR ONLY. Strict straight-down orthographic view, no perspective. Hand-painted fantasy strategy game environment texture: warm dusty olive-brown soil, short dry grass, trampled earth, tiny pebbles, muted and readable. Even daylight with subtle broad mottling. Beautiful illustration, not photorealistic.
Composition: empty navigable ground covers entire canvas edge-to-edge with consistent small texture scale. The game places the river, fire, rocks, barrels, obstacles, grid and tokens as separate layers.
Avoid: hills viewed from side, horizon, trees, crowns, roofs, tents, furniture, fires, rivers, large objects, paths, people, monsters, symbols, text, borders, grid, UI.

## tavern-floor-v1.png

Output: `frontend/public/assets/battle-maps/tavern-floor-v1.png`

Use case: stylized-concept
Asset type: top-down tactical game floor plate, landscape 4:3.
Primary request: warm dark oak plank FLOOR of a fantasy roadside tavern, strictly orthographic overhead 90 degrees, no perspective. Hand-painted game environment illustration, subtle grain and scuff marks, a few uneven plank joins and iron nail heads, rich muted umber wood. Cozy amber diffuse lighting, not photorealistic. Beautiful restrained texture readable beneath combat tokens.
Composition: bare wooden floor filling the entire image edge-to-edge. Furniture, fireplace, walls and character tokens are rendered separately by the game. Uniform scale with wide uncluttered playable space.
Avoid: rugs, tables, chairs, bar counter, fireplaces, walls, roofs, drinks, characters, light shafts, text, logos, grid lines, symbols, borders, UI, strong vignette.

## props-atlas-v1.png

Output: `frontend/public/assets/battle-maps/props-atlas-v1.png`

Use case: stylized-concept
Asset type: single 3x3 sprite atlas PNG for a top-down fantasy tactical game, square image, genuinely transparent alpha background.
Primary request: nine separate small hand-painted tactical terrain sprites, each centred in its own equal square cell in an exact three-column three-row layout. No grid lines. Generous transparent margins around every sprite; each object entirely inside its own cell. Consistent STRICT vertical overhead orthographic view, attractive painterly fantasy style, no perspective.
Cell order is essential, left to right:
TOP ROW: 1 an oak tree TRUNK cross-section and short roots, NO branches/leaves/crown; 2 a thick square grey stone masonry wall block viewed from above; 3 a rectangular dark oak tavern tabletop viewed directly from above.
MIDDLE ROW: 4 a wet brown mud patch irregular outline; 5 tangled white spiderweb strands, visible fine strands on transparency; 6 a square patch of shallow turquoise rippling stream water, irregular bank-free edges.
BOTTOM ROW: 7 a small glowing campfire with crossed logs and orange embers seen from directly overhead; 8 the round lid and metal bands of an upright wooden barrel viewed from above; 9 a low broad grey stone slab/sarcophagus lid viewed directly from above.
All nine sprites use the same scale/muted fantasy palette with readable silhouettes and short soft grounding shadows. Each cell centre exactly at one-sixth, one-half, five-sixths of image width/height.
Constraints: actual alpha transparency, no opaque background or checkerboard painted into image; no labels, text, symbols, frames, UI, token rings, characters, roofs or tree canopies. This is one atlas asset, not nine framed cards.
