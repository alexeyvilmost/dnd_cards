#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import {
  MICRO_MVP_CERTIFICATION_VERSION,
  MICRO_MVP_ENTITY_LIMITATIONS,
  MICRO_MVP_LIMITATIONS,
  main,
  prepareMicroMvpCertifications,
} from './micro-mvp-certifications.mjs';

// Legacy import and CLI names remain a compatibility layer only.  The
// canonical implementation and certification identity now live in the
// correctly named micro-MVP module.
export * from './micro-mvp-certifications.mjs';
export const MICRO_MICRO_CERTIFICATION_VERSION = MICRO_MVP_CERTIFICATION_VERSION;
export const MICRO_MICRO_LIMITATIONS = MICRO_MVP_LIMITATIONS;
export const MICRO_MICRO_ENTITY_LIMITATIONS = MICRO_MVP_ENTITY_LIMITATIONS;
export const prepareMicroMicroCertifications = prepareMicroMvpCertifications;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
