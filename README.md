# DDGI Cornell Box — Three.js (WebGL + WebGPU)

A single-page Three.js demo of probe-grid Dynamic Diffuse Global Illumination (DDGI-style) lighting a Cornell Box, with two switchable backends:

- **WebGL** (`MeshStandardMaterial` + `onBeforeCompile` shader patches) — a working reference implementation.
- **WebGPU** (`MeshStandardNodeMaterial` + TSL graph) — incremental rebuild, now reaching the shader successfully via a `uniformArray` workaround for a broken DataTexture upload path.

## Layout

| File | What |
|---|---|
| `ddgi.html` | Latest combined version. Scene picker switches between WebGL (stable) and WebGPU (uniformArray-based GI with diagnostic phase selector). |
| `versions/webgl-stable.html` | WebGL-only snapshot, known-good. Reference for the visual target. |
| `versions/webgpu-probes.html` | Phase 3 — bare WebGPU pipeline + probe capture + SH integration verified via debug spheres. No GI shading. |
| `versions/webgpu-shader-diagnostic.html` | Phase 4 with the 5-phase diagnostic mode selector. Used to bisect where the GI shader breaks. |
| `versions/webgpu-shader-uniformarray.html` | Phase 4 fix — DataTexture replaced with TSL `uniformArray`. GI reaches the fragment shader successfully. |

## What works in the WebGL scene (stable)

- 4×4×4 grid of irradiance probes inside the Cornell Box.
- Each probe captures the scene via a 16×16 `CubeCamera` render to a half-float cube target.
- Manual SH integration on CPU: 9 vec3 cosine-convolved L2 spherical harmonic coefficients per probe.
- Coefficients passed to all wall materials as `uniform vec3[576]`, sampled per-fragment via an `onBeforeCompile` patch hooked into `<lights_fragment_maps>` so the GI lands in `iblIrradiance`.
- 8-probe trilinear blend per fragment.
- Probes update on a round-robin schedule (~4 per frame); multi-bounce GI accumulates passively because probe captures themselves go through the patched shader.
- GUI: GI on/off, GI intensity, probe debug visualisation, mover animation, exposure.

## WebGPU rebuild progress

| Phase | Status | Notes |
|---|---|---|
| 1. Diagnostics | ✓ | Status overlay shows scene tag + stack trace + breadcrumb history; window error/unhandledrejection listeners surface failures |
| 2. Bare WebGPU pipeline | ✓ | `WebGPURenderer` + `MeshStandardNodeMaterial` Cornell Box renders correctly with direct lighting |
| 3. Probe capture + SH integration | ✓ | Per-probe radiance cubemap, async readback, CPU SH integration, debug spheres show real captured colors |
| 4a. emissiveNode plumbing | ✓ | Constant emissive (mode 1) verified via diagnostic selector |
| 4b. SH data → shader (DataTexture) | ✗ | `texture(probeSHTex, ...)` returned vec3(0,0,0) — silent upload failure |
| 4c. SH data → shader (uniformArray) | ✓ | `uniformArray(probeSHFlat, 'vec3').element(idx)` works; subtle but correct color bleed visible at wall/floor corners |
| 5. Tune GI intensity to match WebGL | partial | Color bleed is subtle compared to WebGL; needs intensity scaling and possibly a multi-bounce priming pass |
| 6. Depth-aware Chebyshev visibility | not started | The "real" DDGI correctness fix |

## The 5-phase diagnostic selector

When the full GI shader produced visual artifacts (black walls with white edges in earlier attempts; bright walls with cell-shaped dark patches once SH was wired), it was hard to localise the failure. The diagnostic GI mode selector — exposed in the GUI — switches the emissive contribution between progressively-more-complex graph branches:

| Mode | Emissive output | Tests |
|---|---|---|
| 0 | `vec3(0)` | Direct-lighting baseline |
| 1 | `vec3(0.20, 0.10, 0)` | Verifies `emissiveNode` plumbing reaches the lighting model |
| 2 | grid-space position mapped to RGB | Verifies `positionWorld` is accessible in the fragment stage |
| 3 | world-normal mapped to RGB | Verifies `normalWorld.normalize()` accessibility |
| 4 | `probeSHArray.element(0)` directly (raw read of probe[0]'s ambient SH coefficient) | Verifies SH data reaches the shader |
| 5 | full trilinear-blended SH GI | Production path |

Mode is selected via an arithmetic mask (`modeMask(target)` in the JS) instead of `.equal()/.select()` so the same graph compiles cleanly across TSL revisions.

This is what bisected the bug: mode 1 worked, mode 4 didn't — narrowing the fault to SH data flow, not emissive plumbing.

## Bug log from the rebuild

1. **`'three/webgpu'` not in importmap.** The `three/tsl` bundle internally does `import { TSL } from 'three/webgpu'`. Without that mapping the page errors with `bare specifier was not remapped`. Splitting `three` → `three.module.js` (has `UniformsLib` for `RectAreaLightUniformsLib`) and `three/webgpu` → `three.webgpu.js` (has `WebGPURenderer` + node materials) keeps both backends happy.
2. **`LightProbeGenerator.fromCubeRenderTarget` is async in r172.** Without `await` you get `lp.sh` undefined → `Cannot read properties of undefined (reading 'coefficients')`. Easier to bypass it entirely with manual SH integration.
3. **`readRenderTargetPixelsAsync` parameter slots.** Signature is `(rt, x, y, w, h, textureIndex = 0, faceIndex = 0)` — passing the cube face in slot 6 reads the wrong texture every time.
4. **Temporal Dead Zone on `stats`.** A fire-and-forget probe update inside priming referenced a `const stats` declared later in the function, killing every probe's SH integration silently.
5. **HDR emission via `MeshBasicNodeMaterial.colorNode`.** Setting `colorNode = vec3(8, 8, 7)` works only if you also set `material.toneMapped = false` to keep tone mapping out of it for the probe captures.
6. **DataTexture upload to WebGPU.** `DataTexture(Float32Array, w, h, RGBAFormat, FloatType)` populated with SH coefficients, marked `needsUpdate = true` after each frame's CPU integration — never reaches the bind group from `texture(...)` in TSL. Returns `vec3(0)` to the shader. Workaround: keep the SH data as `Vector3[]` and expose via `uniformArray(arr, 'vec3').element(idx)` instead. 64 probes × 9 vec3 = 576 entries (≈6.75 KB) fits comfortably in WebGPU's uniform buffer limits.

## Key architectural notes

- The WebGL scene's GI integration point is `iblIrradiance` because that's where three.js's standard PBR lighting model accumulates indirect diffuse — adding to it gives proper energy-conserving contribution.
- The WebGPU scene uses `material.emissiveNode` instead, which is added directly to the lit output post-light-model. For purely Lambertian surfaces (`roughness = 1.0, metalness = 0.0`) the math is equivalent: `albedo / π × irradiance`. For other materials this is an approximation.
- The probe grid is offset 15% inside the box bounds to avoid putting probes on top of walls. A few probes still land inside the tall and short interior boxes — that's the "probes inside geometry contribute wrong values" problem that depth-aware visibility is supposed to solve (Phase 6, not started).

## Running

Open any `*.html` file in a recent browser. Three.js is loaded from jsDelivr (`r172`). WebGPU scene requires Chrome 113+, Edge 113+, or Safari 26+.

## License

MIT.
