import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ANCHORS,
  buildPaintedFogChunk,
  buildPaintedLightsChunk,
  extractDirectionalShadowStatement,
} from '../painted-light';

/**
 * three is pinned at 0.185.1; the painted light is string surgery on its
 * chunks. Every anchor it relies on must exist exactly where the patch
 * expects it, or this fails before a silently unpainted build ships.
 */
describe('painted light — three 0.185.1 shader anchors', () => {
  const lights = THREE.ShaderChunk.lights_fragment_begin;
  const physicalFrag = THREE.ShaderLib.physical.fragmentShader;
  const standardFrag = THREE.ShaderLib.standard.fragmentShader;
  const pars = THREE.ShaderChunk.lights_physical_pars_fragment;

  it('is running against three r185', () => {
    expect(THREE.REVISION).toBe('185');
  });

  it('lights_fragment_begin has one directional block with the getShadow statement and RE_Direct call', () => {
    const start = lights.indexOf(ANCHORS.dirBlockStart);
    const end = lights.indexOf(ANCHORS.dirBlockEnd);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(lights.indexOf(ANCHORS.dirBlockStart, start + 1)).toBe(-1);
    const block = lights.slice(start, end);
    expect(block).toContain(ANCHORS.dirDeclare);
    expect(block).toContain(ANCHORS.dirInfo);
    expect(block).toContain(ANCHORS.reDirectCall);
    const statement = extractDirectionalShadowStatement(block);
    expect(statement.startsWith('directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]')).toBe(true);
    expect(statement.endsWith(': 1.0;')).toBe(true);
    // One RE_Direct call in the directional block — the one the patch swaps.
    expect(block.split(ANCHORS.reDirectCall)).toHaveLength(2);
  });

  it('lights_physical_pars_fragment defines RE_Direct_Physical, BRDF_Lambert and diffuseContribution', () => {
    expect(pars).toContain('void RE_Direct_Physical(');
    expect(pars).toMatch(/#define\s+RE_Direct\s+RE_Direct_Physical/);
    expect(pars).toContain(ANCHORS.diffuseContribution);
    expect(THREE.ShaderChunk.common).toContain('vec3 BRDF_Lambert(');
    expect(THREE.ShaderChunk.common).toMatch(/#define saturate\(\s*a\s*\)/);
    expect(THREE.ShaderChunk.common).toContain('struct ReflectedLight');
    expect(THREE.ShaderChunk.common).toContain('struct IncidentLight');
  });

  it('the physical and standard fragments include every anchor once', () => {
    for (const frag of [physicalFrag, standardFrag]) {
      for (const anchor of [ANCHORS.lightsBeginInclude, ANCHORS.parsInclude, ANCHORS.fogInclude]) {
        expect(frag.split(anchor)).toHaveLength(2);
      }
      expect(frag).toContain('varying vec3 vViewPosition;');
      expect(frag.indexOf(ANCHORS.parsInclude)).toBeLessThan(frag.indexOf(ANCHORS.lightsBeginInclude));
      expect(frag.indexOf(ANCHORS.lightsBeginInclude)).toBeLessThan(frag.indexOf(ANCHORS.fogInclude));
    }
  });

  it('fog_fragment is the FogExp2 / linear block closed by #endif', () => {
    const fog = THREE.ShaderChunk.fog_fragment;
    expect(fog).toContain('#ifdef USE_FOG');
    expect(fog).toContain('float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );');
    expect(fog.trimEnd().endsWith(ANCHORS.fogEnd)).toBe(true);
  });

  it('the patched chunks build from the live three chunks', () => {
    expect(() => buildPaintedLightsChunk()).not.toThrow();
    expect(() => buildPaintedFogChunk()).not.toThrow();
  });
});
