package main

// Group the whole catalog before pagination. Grouping a partial page in the
// browser lets later pages add rows to sections that appeared complete.
// Keep these presentation orders aligned with the library section headings.
const featCatalogGroupOrder = `CASE category
 WHEN 'origin' THEN 0
 WHEN 'general' THEN 1
 WHEN 'fighting_style' THEN 2
 WHEN 'epic_boon' THEN 3
 ELSE 4 END`

const effectCatalogGroupOrder = `CASE effect_type
 WHEN 'condition' THEN 0
 WHEN 'weapon_mastery' THEN 1
 WHEN 'fighting_style' THEN 2
 WHEN 'feat_ability' THEN 3
 WHEN 'item_effect' THEN 4
 WHEN 'spell_effect' THEN 5
 WHEN 'eldritch_invocation' THEN 6
 WHEN 'maneuver_variant' THEN 7
 WHEN 'class_ability' THEN 8
 WHEN 'species_ability' THEN 9
 WHEN 'run_aura' THEN 10
 WHEN 'passive' THEN 11
 WHEN 'conditional' THEN 12
 WHEN 'triggered' THEN 13
 WHEN 'positive_effect' THEN 14
 WHEN 'negative_effect' THEN 15
 ELSE 16 END`
