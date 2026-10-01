import {Color} from 'three';

export function coinAppearanceColor(value:string,fallen:boolean):string {
  if (!fallen) return value;
  const color = new Color(value);
  const gray = .2126*color.r+.7152*color.g+.0722*color.b;
  return `#${color.setRGB(gray,gray,gray).getHexString()}`;
}

/** Texture multiplication by gray alone leaves its original hue; desaturate
 * the sampled portrait after its map has been read by the standard material. */
export function fallenPortraitFragment(shader:string):string {
  return shader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));');
}
