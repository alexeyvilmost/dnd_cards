import {describe, expect, it} from 'vitest';
import {d20Faces, d20Mesh, d20Rotation, dot, type Vec3} from './d20Geometry';

describe('physical d20 geometry', () => {
  it('matches all edge neighbours in the Chessex d20_4 net, not just opposite sums', () => {
    const neighbours: Record<number, number[]> = {
      1:[7,13,19], 2:[12,18,20], 3:[16,17,19], 4:[11,14,18], 5:[13,15,18],
      6:[9,14,16], 7:[1,15,17], 8:[10,16,20], 9:[6,11,19], 10:[8,12,17],
      11:[4,9,13], 12:[2,10,15], 13:[1,5,11], 14:[4,6,20], 15:[5,7,12],
      16:[3,6,8], 17:[3,7,10], 18:[2,4,5], 19:[1,3,9], 20:[2,8,14],
    };
    for (const face of d20Faces) {
      const adjacent = d20Faces.filter(other => other !== face
        && other.corners.filter(corner => face.corners.includes(corner)).length === 2);
      expect(adjacent.map(f => f.value).sort((a,b) => a-b)).toEqual(neighbours[face.value]);
    }
  });
  it('has twenty equilateral faces numbered once, with opposite faces adding to 21', () => {
    expect(d20Faces).toHaveLength(20);
    expect(d20Faces.map(f => f.value).sort((a,b) => a-b)).toEqual(Array.from({length:20},(_,i)=>i+1));
    for (const face of d20Faces) {
      const lengths = face.corners.map((a,i) => Math.hypot(...a.map((x,j) => x-face.corners[(i+1)%3][j])));
      expect(lengths[0]).toBeCloseTo(lengths[1], 10);
      expect(lengths[1]).toBeCloseTo(lengths[2], 10);
      expect(d20Faces.find(other => dot(other.normal,face.normal) < -.999)!.value + face.value).toBe(21);
    }
    expect([...d20Mesh()].every(Number.isFinite)).toBe(true);
  });
  it.each(Array.from({length:20},(_,i)=>i+1))('lands on committed %i with its number facing the camera upright', value => {
    const face=d20Faces.find(f=>f.value===value)!;
    const matrix=d20Rotation(value,1);
    const transform=(v:Vec3)=>[0,1,2].map(i=>matrix[i]*v[0]+matrix[i+3]*v[1]+matrix[i+6]*v[2]);
    expect(transform(face.normal)[2]).toBeCloseTo(1,10);
    expect(transform(face.up)[1]).toBeCloseTo(1,10);
    expect(d20Rotation(value,0)).not.toEqual(matrix);
  });
});
