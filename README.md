# DDGI Cornell Box — Three.js (WebGL + WebGPU)

A single-page Three.js demo of probe-grid Dynamic Diffuse Global Illumination (DDGI-style) lighting a Cornell Box, with two switchable backends:

- **WebGL** (`MeshStandardMaterial` + `onBeforeCompile` shader patches) — a faithful working baseline.
- **WebGPU** (`MeshStandardNodeMaterial` + TSL graph) — an experimental rebuild that adds per-fragment Chebyshev visibility on top of the same probe data.

## What's implemented

### WebGL scene (stable, fully working)

- 4×4×4 grid of irradiance probes inside the Cornell Box.
- Each probe captures the scene via a 16×16 `CubeCamera` render to a half-float cube target.
- Manual SH integration on CPU: 9 vec3 cosine-convolved L2 spherical harmonic coefficients per probe.
- Coefficients passed to all wall materials as a `uniform vec3[576]` array, sampled per-fragment via an `onBeforeCompile` patch hooked into `<lights_fragment_maps>` so the GI contribution lands in `iblIrradiance`.
- 8-probe trilinear blend per fragment.
- Probes update on a round-robin schedule (~4 per frame) so the scene reacts to the moving emissive sphere — multi-bounce GI accumulates passively because probe captures themselves go through the patched shader.
- GUI: GI on/off, GI intensity, probe debug visualisation, mover animation, exposure.

### WebGPU scene (incremental rebuild)

This was rebuilt phase-by-phase after a bunch of three.js r172 API gotchas. Each phase verified in-browser before the next was added:

| Phase | Status | Notes |
|---|---|---|
| 1. Diagnostics | ✓ | Error overlay shows scene tag + stack trace + breadcrumb history |
| 2. Bare WebGPU pipeline | ✓ | `WebGPURenderer` + `MeshStandardNodeMaterial` + direct lighting; Cornell Box renders correctly |
| 3. Probe capture + SH integration | ✓ | Per-probe radiance cubemap, async readback (`readRenderTargetPixelsAsync(rt, x, y, w, h, textureIndex, faceIndex)` — note the parameter order!), CPU SH integration, debug spheres show real captured colors |
| 4. TSL GI shader | WIP | `Fn(([wp, n]) => ...)` graph that reads SH from a `DataTexture`, evaluates per-direction, trilinearly blends 8 probes — produces correct probe-grid SH lookups but the emissiveNode hookup currently produces visual artifacts that need debugging |
| 5. Depth-aware Chebyshev visibility | not started | The "real" DDGI correctness fix — would store moments (mean depth, mean depth²) per probe and reject probes occluded from the shading point |

### Key bugs found during the rebuild

1. **`'three/webgpu'` not in importmap.** The `three/tsl` bundle internally does `import { TSL } from 'three/webgpu'`. Without that mapping you get `bare specifier was not remapped`. Splitting `three` → `three.module.js` (has `UniformsLib` for `RectAreaLightUniformsLib`) and `three/webgpu` → `three.webgpu.js` (has `WebGPURenderer` + node materials) keeps both backends happy.
2. **`LightProbeGenerator.fromCubeRenderTarget` is async in r172.** Without `await` you get `lp.sh` undefined → `Cannot read properties of undefined (reading 'coefficients')`. Easier to bypass it entirely with manual SH integration.
3. **`readRenderTargetPixelsAsync` parameter slots.** Signature is `(rt, x, y, w, h, textureIndex = 0, faceIndex = 0)` — passing the cube face in slot 6 reads the wrong texture every time.
4. **Temporal Dead Zone on `stats`.** A fire-and-forget probe update inside priming referenced a `const stats` declared later in the function, killing every probe's SH integration silently.
5. **Custom WebGPU `MeshBasicNodeMaterial.colorNode` for HDR emission.** `colorNode = vec3(8, 8, 7)` works but you also need `material.toneMapped = false` if you want HDR through the panel.

## Files

| File | What |
|---|---|
| `ddgi.html` | Latest combined version with scene picker. WebGL works fully, WebGPU shows the bare scene and probe capture. |
| `versions/webgl-stable.html` | WebGL-only version, known-good. |
| `versions/webgpu-probes.html` | WebGPU phase 3 — bare pipeline + probe capture verified, GUI shows captured probe colors via debug spheres. |
| `versions/webgpu-shader-wip.html` | WebGPU phase 4 in-progress — TSL GI graph wired but rendering artifacts under investigation. |

## Running

Open any `*.html` file in a recent browser. Three.js is loaded from jsDelivr (`r172`). WebGPU scene requires Chrome 113+, Edge 113+, or Safari 26+.

## Architecture notes

The WebGL scene's GI integration point is `iblIrradiance` because that's where three.js's standard PBR lighting model accumulates indirect diffuse — adding to it gives proper energy-conserving contribution.

The WebGPU scene uses `material.emissiveNode` instead, which is added directly to the lit output post-light-model. For purely Lambertian surfaces (`roughness = 1.0, metalness = 0.0`) the math is equivalent: `albedo / π × irradiance`. For other materials this is an approximation.

The probe grid is offset 15% inside the box bounds to avoid putting probes on top of walls. A few probes still land inside the tall and short interior boxes — that's the "probes inside geometry contribute wrong values" problem that depth-aware visibility is supposed to solve.

## License

MIT.
