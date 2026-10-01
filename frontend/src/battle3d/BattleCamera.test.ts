// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {PerspectiveCamera, Plane, Raycaster, Vector2, Vector3} from 'three';
import type {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {createBattleCameraControls, frameBattleCamera} from './BattleCamera';

describe('real battle camera pointer zoom', () => {
  let controls: OrbitControls;
  let canvas: HTMLCanvasElement;
  afterEach(() => {controls?.dispose(); canvas?.remove();});

  it.each([
    {width: 800, height: 600, left: 30, top: 60, boardWidth: 16, boardHeight: 12, mouseX: 180, mouseY: 220},
    {width: 390, height: 844, left: 15, top: 40, boardWidth: 30, boardHeight: 18, mouseX: 300, mouseY: 360},
  ])('preserves the ground point under an off-center pointer across zoom and clamps: $width×$height', (view) => {
    canvas = document.createElement('canvas'); document.body.append(canvas);
    canvas.getBoundingClientRect = () => ({...view, x: view.left, y: view.top,
      right: view.left + view.width, bottom: view.top + view.height, toJSON: () => ({})});
    const camera = new PerspectiveCamera(42, view.width / view.height, .1, 250);
    controls = createBattleCameraControls(camera, canvas, view.boardWidth, view.boardHeight);
    controls.target.copy(frameBattleCamera(camera, view.boardWidth, view.boardHeight));
    controls.update(); camera.updateMatrixWorld();
    const normalized = new Vector2((view.mouseX - view.left) / view.width * 2 - 1,
      1 - (view.mouseY - view.top) / view.height * 2);
    const ray = new Raycaster(); ray.setFromCamera(normalized, camera);
    const anchoredGround = ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())!;
    const projectAnchor = () => {
      camera.updateMatrixWorld();
      const point = anchoredGround.clone().project(camera);
      return {x: view.left + (point.x + 1) * view.width / 2, y: view.top + (1 - point.y) * view.height / 2};
    };
    const wheel = (deltaY: number) => {
      const event = new WheelEvent('wheel', {clientX: view.mouseX, clientY: view.mouseY, deltaY, cancelable: true});
      canvas.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      const projected = projectAnchor();
      expect(projected.x).toBeCloseTo(view.mouseX, 5);
      expect(projected.y).toBeCloseTo(view.mouseY, 5);
    };
    const initialDistance = camera.position.distanceTo(controls.target);
    wheel(-120);
    expect(camera.position.distanceTo(controls.target)).toBeLessThan(initialDistance);
    wheel(120);
    // The limits are part of the actual camera, not a mocked zoom policy.
    for (let step = 0; step < 80; step++) wheel(-240);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(controls.minDistance, 6);
    for (let step = 0; step < 100; step++) wheel(240);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(controls.maxDistance, 6);
    expect(controls.enableRotate).toBe(false);
    expect(controls.enablePan).toBe(true);
  });
});
