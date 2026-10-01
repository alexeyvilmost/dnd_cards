import {describe,expect,it} from 'vitest';
import {Color} from 'three';
import {coinAppearanceColor,fallenPortraitFragment} from './coinAppearance';

describe('fallen enemy portraits are fully desaturated',()=>{
  it.each(['#e33432','#288be3'])('removes all hue from %s while preserving its living color',value=>{
    expect(coinAppearanceColor(value,false)).toBe(value);
    const gray=new Color(coinAppearanceColor(value,true));
    expect(gray.r).toBe(gray.g);
    expect(gray.g).toBe(gray.b);
  });
  it('desaturates the sampled portrait instead of merely multiplying it by gray',()=>{
    expect(fallenPortraitFragment('#include <map_fragment>\n#include <color_fragment>'))
      .toContain('diffuseColor.rgb = vec3(dot(diffuseColor.rgb');
  });
});
