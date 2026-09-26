import { useMemo } from 'react';
import { getMiniatureGeometry, miniaturePaintColor } from './geometry';
import type { MiniatureRecipe } from './recipes';
import {miniatureBaseGeometry,miniatureBaseGritGeometry,miniatureBaseGroundGeometry,miniatureBaseTrimGeometry} from './base';
import {miniatureMaterial} from './materials';

export interface MiniatureModelProps {
  recipe: MiniatureRecipe;
  pedestalColor?: string;
  damaged?: boolean;
  fallen?: boolean;
}

/** Static sculpt, +Z forward, Y up, floor at zero. Its parent owns movement and strike animation. */
export function MiniatureModel({recipe, pedestalColor = '#5a686d', damaged = false, fallen = false}: MiniatureModelProps) {
  const parts = useMemo(() => getMiniatureGeometry(recipe), [recipe]);
  return <group name={`miniature:${recipe.id}`}>
    <mesh geometry={miniatureBaseGeometry} receiveShadow castShadow>
      <meshStandardMaterial color={pedestalColor} roughness={.65} metalness={.17} />
    </mesh>
    <mesh geometry={miniatureBaseGroundGeometry} position={[0, .092, 0]} receiveShadow>
      <meshStandardMaterial color="#58594e" roughness={.98} />
    </mesh>
    <mesh geometry={miniatureBaseTrimGeometry} position={[0, .038, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color="#8d8067" roughness={.53} metalness={.42} />
    </mesh>
    <mesh geometry={miniatureBaseGritGeometry} receiveShadow castShadow>
      <meshStandardMaterial color="#77766a" roughness={.98} />
    </mesh>
    <group rotation={fallen ? [0, 0, -Math.PI / 2.15] : [0, 0, 0]} position={fallen ? [-.25, .15, 0] : [0, .005, 0]}>
      {parts.map(part => <mesh key={part.paint} geometry={part.geometry} dispose={null} castShadow receiveShadow
        material={miniatureMaterial(miniaturePaintColor(recipe, part.paint), part.paint)} />)}
    </group>
    {damaged && <group name="decorative-chips">
      {[[-.27, .12, .14], [.21, .114, -.2], [.28, .11, .12]].map((point, index) => <mesh
        key={index} position={point as [number, number, number]} rotation={[.2 * index, index, .4]} castShadow>
        <icosahedronGeometry args={[.035 + index * .006, 0]} />
        <meshStandardMaterial color={index === 1 ? pedestalColor : recipe.palette.armor} roughness={.75} />
      </mesh>)}
    </group>}
  </group>;
}
