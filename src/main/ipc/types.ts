/**
 * Re-exports all shared types from src/shared/types.ts.
 * Main-process code should import from here; renderer code should import from
 * '../../shared/types' (or the appropriate relative path) to avoid crossing
 * the process boundary.
 */
export * from '../../shared/types';
