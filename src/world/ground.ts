import * as THREE from 'three';

export interface GroundBundle {
  mesh: THREE.Mesh;
  heightAt: (x: number, z: number) => number;
  dispose: () => void;
}

function fbm2(x: number, z: number): number {
  let v = 0;
  let a = 0.5;
  let fx = x;
  let fz = z;
  for (let i = 0; i < 5; i++) {
    v += a * Math.sin(fx * 1.7 + Math.cos(fz * 1.3)) * Math.cos(fz * 1.1 - Math.sin(fx * 0.9));
    fx *= 2.03;
    fz *= 1.97;
    a *= 0.5;
  }
  return v;
}

/** P0 placeholder ground: undulating meadow with the shared PBR scan set. */
export function buildGround(textureLoader: THREE.TextureLoader): GroundBundle {
  const geo = new THREE.PlaneGeometry(600, 600, 240, 240);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = fbm2(x * 0.02, z * 0.02) * 1.6 + fbm2(x * 0.11, z * 0.11) * 0.22;
    pos.setY(i, y);
  }
  geo.computeVertexNormals();

  const load = (name: string, srgb: boolean): THREE.Texture => {
    const t = textureLoader.load(`/textures/pbr/meadow/${name}`);
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    t.repeat.set(90, 90);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  const material = new THREE.MeshStandardMaterial({
    map: load('albedo.jpg', true),
    normalMap: load('normal.png', false),
    roughnessMap: load('rough.jpg', false),
    color: 0x9aa87a,
    roughness: 0.94,
    metalness: 0,
    normalScale: new THREE.Vector2(1.1, 1.1),
    envMapIntensity: 0.55
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'p0-ground';

  return {
    mesh,
    heightAt: (x, z) => fbm2(x * 0.02, z * 0.02) * 1.6 + fbm2(x * 0.11, z * 0.11) * 0.22,
    dispose: () => {
      geo.dispose();
      material.dispose();
    }
  };
}
