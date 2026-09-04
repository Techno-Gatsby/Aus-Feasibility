'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// A real 3D surface of the tract built from USGS 3DEP samples. This is terrain,
// not photography — it answers "where does water go and what will I have to cut
// and fill", which is the question that actually costs money on raw land.

const FT_PER_DEG_LAT = 364000;

export default function Terrain3D({
  bbox, rings, verticalExaggeration = 3,
}: {
  bbox: [number, number, number, number] | null;
  rings: [number, number][][];
  verticalExaggeration?: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [msg, setMsg] = useState<string>('');
  const [stats, setStats] = useState<{ min: number; max: number } | null>(null);
  const exagRef = useRef(verticalExaggeration);
  exagRef.current = verticalExaggeration;

  useEffect(() => {
    if (!bbox || !mountRef.current) return;
    const mount = mountRef.current;
    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;

    (async () => {
      setState('loading'); setMsg('Sampling USGS elevation…');
      let data: any;
      try {
        const r = await fetch(`/api/terrain?bbox=${bbox.map((v) => v.toFixed(6)).join(',')}`);
        data = await r.json();
        if (!r.ok || data.error) throw new Error(data.error ?? 'terrain failed');
      } catch (e) {
        if (!disposed) {
          setState('error');
          setMsg(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      if (disposed) return;

      const { n, grid, minFt, maxFt } = data as {
        n: number; grid: number[]; minFt: number; maxFt: number;
      };
      setStats({ min: minFt, max: maxFt });

      // Project the bbox to feet so the vertical scale is honest.
      const [xmin, ymin, xmax, ymax] = bbox;
      const midLat = (ymin + ymax) / 2;
      const ftPerDegLon = FT_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
      const widthFt = (xmax - xmin) * ftPerDegLon;
      const depthFt = (ymax - ymin) * FT_PER_DEG_LAT;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#0d1520');

      const camera = new THREE.PerspectiveCamera(
        45, mount.clientWidth / mount.clientHeight, 1, 200000,
      );

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      // Surface
      const geo = new THREE.PlaneGeometry(widthFt, depthFt, n - 1, n - 1);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      const span = Math.max(maxFt - minFt, 1);
      const lo = new THREE.Color('#1f6f4a');
      const mid = new THREE.Color('#d9c77a');
      const hi = new THREE.Color('#a8543a');

      for (let i = 0; i < pos.count; i++) {
        // PlaneGeometry rows run +x then -z; grid rows run south→north.
        const col = i % n;
        const row = Math.floor(i / n);
        const z = grid[(n - 1 - row) * n + col];
        pos.setY(i, (z - minFt) * exagRef.current);
        const t = (z - minFt) / span;
        const c = t < 0.5
          ? lo.clone().lerp(mid, t * 2)
          : mid.clone().lerp(hi, (t - 0.5) * 2);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      const surface = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false,
        }),
      );
      scene.add(surface);

      const wire = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0x000000, wireframe: true, transparent: true, opacity: 0.06,
        }),
      );
      scene.add(wire);

      // Parcel outline draped on the surface
      const sampleZ = (lon: number, lat: number) => {
        const fx = ((lon - xmin) / (xmax - xmin)) * (n - 1);
        const fy = ((lat - ymin) / (ymax - ymin)) * (n - 1);
        const cx = Math.max(0, Math.min(n - 1, Math.round(fx)));
        const cy = Math.max(0, Math.min(n - 1, Math.round(fy)));
        return grid[cy * n + cx];
      };
      for (const ring of rings) {
        const pts = ring.map(([lon, lat]) => new THREE.Vector3(
          (lon - xmin) * ftPerDegLon - widthFt / 2,
          (sampleZ(lon, lat) - minFt) * exagRef.current + 12,
          -((lat - ymin) * FT_PER_DEG_LAT - depthFt / 2),
        ));
        scene.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 }),
        ));
      }

      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const sun = new THREE.DirectionalLight(0xffffff, 1.15);
      sun.position.set(-widthFt, span * exagRef.current * 6 + 3000, depthFt);
      scene.add(sun);

      // Simple orbit: drag to rotate, wheel to zoom.
      const radius0 = Math.max(widthFt, depthFt) * 1.5;
      let theta = -0.7, phi = 0.95, radius = radius0;
      const applyCam = () => {
        camera.position.set(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta),
        );
        camera.lookAt(0, span * exagRef.current * 0.3, 0);
      };
      applyCam();

      let dragging = false, lx = 0, ly = 0;
      const el = renderer.domElement;
      const down = (e: PointerEvent) => {
        dragging = true; lx = e.clientX; ly = e.clientY;
        el.setPointerCapture(e.pointerId);
      };
      const move = (e: PointerEvent) => {
        if (!dragging) return;
        theta -= (e.clientX - lx) * 0.005;
        phi = Math.max(0.15, Math.min(1.5, phi - (e.clientY - ly) * 0.005));
        lx = e.clientX; ly = e.clientY;
        applyCam();
      };
      const up = (e: PointerEvent) => {
        dragging = false;
        try { el.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        radius = Math.max(radius0 * 0.25,
          Math.min(radius0 * 3, radius * (1 + Math.sign(e.deltaY) * 0.12)));
        applyCam();
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('wheel', wheel, { passive: false });

      const ro = new ResizeObserver(() => {
        if (!renderer) return;
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      });
      ro.observe(mount);

      const loop = () => {
        raf = requestAnimationFrame(loop);
        renderer!.render(scene, camera);
      };
      loop();
      setState('ready');

      return () => {
        ro.disconnect();
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.removeEventListener('wheel', wheel);
      };
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
      }
    };
  }, [bbox, rings, verticalExaggeration]);

  return (
    <div className="t3d">
      <div ref={mountRef} className="t3dcanvas" />
      {state !== 'ready' && (
        <div className="t3dmsg">
          {state === 'loading' && 'Sampling USGS elevation…'}
          {state === 'error' && `Terrain unavailable: ${msg}`}
          {state === 'idle' &&
            'Search a tract, or click any parcel on the map, then reopen this tab.'}
        </div>
      )}
      {state === 'ready' && stats && (
        <div className="t3dlegend">
          {Math.round(stats.min)}–{Math.round(stats.max)} ft ·{' '}
          {Math.round(stats.max - stats.min)} ft relief · {verticalExaggeration}×
          vertical · drag to rotate, scroll to zoom
        </div>
      )}
    </div>
  );
}
