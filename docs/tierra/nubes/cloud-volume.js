import * as THREE from 'three';

// Original deterministic noise generator for this project. The volume/density
// approach follows the concepts explained by Maxime Heckel (not copied code):
// https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/
// Three.js also demonstrates a locally generated Data3DTexture for cloud volumes:
// https://threejs.org/examples/webgl_volume_cloud.html
// R contains broad, rounded billows; G contains finer cellular erosion. Both
// channels are periodic in all three axes, including their filtered boundary.

const SIZE = 128;
const VOLUME_BYTES = SIZE * SIZE * SIZE * 2;

function randomField(count, seed) {
  const field = new Float32Array(count);
  let state = seed >>> 0;
  for (let i = 0; i < count; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    field[i] = (state >>> 0) / 4294967296;
  }
  return field;
}

function wrap(value, size) {
  return ((value % size) + size) % size;
}

function smooth(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lattice(field, size, x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  const x0 = wrap(ix, size);
  const x1 = (x0 + 1) % size;
  const y0 = wrap(iy, size) * size;
  const y1 = ((wrap(iy, size) + 1) % size) * size;
  const z0 = wrap(iz, size) * size * size;
  const z1 = ((wrap(iz, size) + 1) % size) * size * size;
  const a = field[x0 + y0 + z0] * (1 - fx) + field[x1 + y0 + z0] * fx;
  const b = field[x0 + y1 + z0] * (1 - fx) + field[x1 + y1 + z0] * fx;
  const c = field[x0 + y0 + z1] * (1 - fx) + field[x1 + y0 + z1] * fx;
  const d = field[x0 + y1 + z1] * (1 - fx) + field[x1 + y1 + z1] * fx;
  return (a * (1 - fy) + b * fy) * (1 - fz) + (c * (1 - fy) + d * fy) * fz;
}

function billows(points, size, x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let closest = 4;
  for (let dz = -1; dz <= 1; dz++) {
    const cellZ = iz + dz;
    const layer = wrap(cellZ, size) * size * size;
    for (let dy = -1; dy <= 1; dy++) {
      const cellY = iy + dy;
      const row = wrap(cellY, size) * size + layer;
      for (let dx = -1; dx <= 1; dx++) {
        const cellX = ix + dx;
        const index = (wrap(cellX, size) + row) * 3;
        const px = cellX + points[index] - x;
        const py = cellY + points[index + 1] - y;
        const pz = cellZ + points[index + 2] - z;
        closest = Math.min(closest, px * px + py * py + pz * pz);
      }
    }
  }
  // Smooth cellular lobes rather than hard Voronoi edges or cloudy white noise.
  const distance = Math.min(Math.max((Math.sqrt(closest) - 0.05) / 1.05, 0), 1);
  return 1 - distance * distance * (3 - 2 * distance);
}

function generateCloudNoiseData() {
  const coarse = randomField(4 ** 3 * 3, 0x71c8a391);
  const medium = randomField(8 ** 3 * 3, 0x2f6e924b);
  const fine = randomField(16 ** 3 * 3, 0x5b3a1d87);
  const broadField = randomField(8 ** 3, 0x6c43e219);
  const fineField = randomField(16 ** 3, 0x49d27b61);
  const data = new Uint8Array(VOLUME_BYTES);
  let index = 0;
  for (let z = 0; z < SIZE; z++) {
    const pz = (z + 0.5) / SIZE;
    for (let y = 0; y < SIZE; y++) {
      const py = (y + 0.5) / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const px = (x + 0.5) / SIZE;
        const broad = billows(coarse, 4, px * 4, py * 4, pz * 4);
        const middle = billows(medium, 8, px * 8, py * 8, pz * 8);
        const detail = billows(fine, 16, px * 16, py * 16, pz * 16);
        const gentle = lattice(broadField, 8, px * 8, py * 8, pz * 8);
        const erosion = lattice(fineField, 16, px * 16, py * 16, pz * 16);
        data[index++] = Math.round(255 * (broad * 0.62 + middle * 0.23 + gentle * 0.15));
        data[index++] = Math.round(255 * (detail * 0.76 + erosion * 0.24));
      }
    }
  }
  return data;
}

// Pass the precomputed asset to avoid running the reproducible generator during
// startup: createCloudNoiseTexture(new Uint8Array(await response.arrayBuffer())).
export function createCloudNoiseTexture(volumeData) {
  if (volumeData !== undefined && !(volumeData instanceof Uint8Array)) {
    throw new TypeError('Cloud volume must be a Uint8Array containing interleaved R/G voxels.');
  }
  if (volumeData !== undefined && volumeData.length !== VOLUME_BYTES) {
    throw new RangeError(`Cloud volume requires ${VOLUME_BYTES} bytes for 128 × 128 × 128 RG voxels.`);
  }
  const data = volumeData ?? generateCloudNoiseData();
  const texture = new THREE.Data3DTexture(data, SIZE, SIZE, SIZE);
  texture.name = 'Atlas — periodic cloud billows and erosion';
  texture.format = THREE.RGFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
