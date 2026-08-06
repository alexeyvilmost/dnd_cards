/**
 * Legacy import path for micro-MVP automation.
 *
 * Keep the old public names while all data and validation live in the
 * canonical schema-v2 module.
 */
export * from './micro-mvp-manifest.mjs';
export {
  MICRO_MVP_MANIFEST as MICRO_MICRO_MANIFEST,
  MICRO_MVP_COLLECTION_SIZES as MICRO_MICRO_COLLECTION_SIZES,
  flattenMicroMvpManifest as flattenMicroMicroManifest,
  validateMicroMvpManifest as validateMicroMicroManifest,
} from './micro-mvp-manifest.mjs';
