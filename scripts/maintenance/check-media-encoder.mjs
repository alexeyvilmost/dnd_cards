#!/usr/bin/env node
// Explicit native-codec acceptance, separate from dependency-free default tests.
import assert from 'node:assert/strict';
import {loadEncoder,encodeVerifiedPNG} from './build-media-variants.mjs';
const {sharp,provenance}=loadEncoder(process.argv[2]??'sharp');
const width=128,height=128,rgba=Buffer.alloc(width*height*4);
for(let i=0;i<width*height;i++){rgba[i*4]=23;rgba[i*4+1]=77;rgba[i*4+2]=201;rgba[i*4+3]=i%2?255:0;}
const source=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer();
const decoded=await sharp(source).ensureAlpha().raw().toBuffer();assert.deepEqual(decoded,rgba);
const exact=await encodeVerifiedPNG(source,sharp);assert.equal(exact.status,'variant');assert.equal(exact.proof.transparentRGB,'exact_compared');
assert.deepEqual(await sharp(exact.output).ensureAlpha().raw().toBuffer(),rgba);
rgba[3]=128;
const partial=await sharp(rgba,{raw:{width,height,channels:4}}).png().toBuffer();
assert.equal((await encodeVerifiedPNG(partial,sharp)).reason,'partial_alpha_browser_rounding_original_preserved');
const profileSource=await sharp(source).withIccProfile('srgb').png().toBuffer();
const profile=await encodeVerifiedPNG(profileSource,sharp);assert.ok(profile.proof);assert.ok(profile.proof.iccBytes>0);assert.notEqual(profile.reason,'ICC_not_preserved_byte_for_byte');
if(profile.status==='variant')assert.deepEqual((await sharp(profile.output).metadata()).icc,(await sharp(profileSource).metadata()).icc);
console.log(JSON.stringify({status:'passed',cases:['transparent_RGB_exact_including_zero_alpha','partial_alpha_retains_original_for_browser_equivalence','ICC_byte_identical'],encoder:provenance.versions,sourceBytes:source.length,variantBytes:exact.output.length,iccBytes:profile.proof.iccBytes},null,2));
