// KESTREL LAGOON — bloom: an UnrealBloomPass-style glow (luminance
// high-pass + a 3-level separable Gaussian mip chain + a weighted
// composite, blended additively over the frame). Kestrel's own code,
// written from the published UnrealBloomPass algorithm — the three.js
// addon source (r187, read in full before writing) was the reference
// for the algorithm, not the code: the addon files themselves are NOT
// vendored (non-minified library files count against the authored-code
// transcript gate, and the composer would have rerouted the whole
// render path including the staged captures).
//
// LDR post-pass by design: instead of a composer, this module runs
// AFTER the normal scene render and copies the finished frame back
// (copyFramebufferToTexture), so when bloom is OFF the render path is
// byte-for-byte the pre-v8c one — the four staged shots cannot change
// — and when it is ON the base image is identical plus additive glow.
// The trade-off is honest: the threshold works on tonemapped sRGB
// values, not HDR linear light, so the glow is a look, not a physical
// bloom. Strength 0.55 / threshold 0.75 follow neonbay's bloom tuning
// (UnrealBloomPass(res, 0.55, 0.55, 0.82), MIT) adapted to LDR.
//
// Resources are built lazily on the first enable and rebuilt on resize
// / pixel-ratio change; while disabled this module allocates nothing
// and its render() is a no-op.
import * as THREE from 'three';

const MIP_KERNELS = [6, 10, 14]; // blur radius per mip level (UnrealBloomPass uses 6..22 over 5 mips)
const BLOOM_FACTORS = [1.0, 0.8, 0.6]; // composite weight per mip
const STRENGTH = 0.55; // neonbay's bloom strength
const RADIUS = 0.55; // neonbay's bloom radius (mixes the factors toward their mirror)
const THRESHOLD = 0.75; // LDR luminance threshold (sky sun, neon, muzzle flash pass; the street does not)
const SMOOTH_WIDTH = 0.15;

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const HIGH_PASS_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform float luminosityThreshold;
uniform float smoothWidth;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float v = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
  float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
  gl_FragColor = vec4(texel.rgb * alpha, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D colorTexture;
uniform vec2 invSize;
uniform vec2 direction;
uniform float centerWeight;
uniform float gaussianOffsets[KERNEL_PAIRS];
uniform float gaussianWeights[KERNEL_PAIRS];
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(colorTexture, vUv).rgb * centerWeight;
  for (int i = 0; i < KERNEL_PAIRS; i++) {
    vec2 off = direction * invSize * gaussianOffsets[i];
    sum += (texture2D(colorTexture, vUv + off).rgb + texture2D(colorTexture, vUv - off).rgb) * gaussianWeights[i];
  }
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D blurTexture1;
uniform sampler2D blurTexture2;
uniform sampler2D blurTexture3;
uniform float bloomStrength;
uniform float bloomRadius;
uniform float bloomFactors[3];
varying vec2 vUv;
float lerpBloomFactor(float f) {
  float mirrorFactor = 1.2 - f;
  return mix(f, mirrorFactor, bloomRadius);
}
void main() {
  vec3 bloom = bloomStrength * (
    lerpBloomFactor(bloomFactors[0]) * texture2D(blurTexture1, vUv).rgb +
    lerpBloomFactor(bloomFactors[1]) * texture2D(blurTexture2, vUv).rgb +
    lerpBloomFactor(bloomFactors[2]) * texture2D(blurTexture3, vUv).rgb);
  gl_FragColor = vec4(bloom, 1.0);
}`;

// Gaussian coefficients with the linear-sampling merge (adjacent taps
// folded into single bilinear fetches) — the same construction
// UnrealBloomPass uses, derived here from the Gaussian formula.
function makeBlurMaterial(kernelRadius) {
  const sigma = kernelRadius / 3;
  const coefficients = [];
  for (let i = 0; i < kernelRadius; i++) {
    coefficients.push(0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma);
  }
  const offsets = [];
  const weights = [];
  for (let i = 1; i < kernelRadius; i += 2) {
    const wa = coefficients[i];
    const wb = (i + 1 < kernelRadius) ? coefficients[i + 1] : 0;
    const w = wa + wb;
    offsets.push((i * wa + (i + 1) * wb) / w);
    weights.push(w);
  }
  return new THREE.ShaderMaterial({
    defines: { KERNEL_PAIRS: offsets.length },
    uniforms: {
      colorTexture: { value: null },
      invSize: { value: new THREE.Vector2(0.5, 0.5) },
      direction: { value: new THREE.Vector2(0.5, 0.5) },
      centerWeight: { value: coefficients[0] },
      gaussianOffsets: { value: offsets },
      gaussianWeights: { value: weights },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: BLUR_FRAG,
  });
}

export function createBloom(renderer) {
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const highPassMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      luminosityThreshold: { value: THRESHOLD },
      smoothWidth: { value: SMOOTH_WIDTH },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: HIGH_PASS_FRAG,
  });
  const blurMats = MIP_KERNELS.map((k) => makeBlurMaterial(k));
  const compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      blurTexture1: { value: null },
      blurTexture2: { value: null },
      blurTexture3: { value: null },
      bloomStrength: { value: STRENGTH },
      bloomRadius: { value: RADIUS },
      bloomFactors: { value: BLOOM_FACTORS },
    },
    vertexShader: QUAD_VERT,
    fragmentShader: COMPOSITE_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  let enabled = false;
  let ready = false;
  let size = { w: 0, h: 0 };
  let sourceTex = null;
  let brightRT = null;
  const hRT = [];
  const vRT = [];

  function disposeResources() {
    if (sourceTex) { sourceTex.dispose(); sourceTex = null; }
    if (brightRT) { brightRT.dispose(); brightRT = null; }
    for (const rt of [...hRT, ...vRT]) rt.dispose();
    hRT.length = 0; vRT.length = 0;
    ready = false;
  }

  function buildResources(w, h) {
    // The finished frame, copied back from the drawing buffer each
    // frame bloom runs. A DataTexture carries the size the copy call
    // needs; its pixels are overwritten by the copy, never read as-is.
    sourceTex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h);
    sourceTex.minFilter = THREE.LinearFilter;
    sourceTex.magFilter = THREE.LinearFilter;
    sourceTex.generateMipmaps = false;
    sourceTex.needsUpdate = true;
    let rw = Math.max(2, Math.round(w / 2));
    let rh = Math.max(2, Math.round(h / 2));
    brightRT = new THREE.WebGLRenderTarget(rw, rh, { depthBuffer: false });
    for (let i = 0; i < MIP_KERNELS.length; i++) {
      hRT.push(new THREE.WebGLRenderTarget(rw, rh, { depthBuffer: false }));
      vRT.push(new THREE.WebGLRenderTarget(rw, rh, { depthBuffer: false }));
      blurMats[i].uniforms.invSize.value.set(1 / rw, 1 / rh);
      rw = Math.max(2, Math.round(rw / 2));
      rh = Math.max(2, Math.round(rh / 2));
    }
    compositeMat.uniforms.blurTexture1.value = vRT[0].texture;
    compositeMat.uniforms.blurTexture2.value = vRT[1].texture;
    compositeMat.uniforms.blurTexture3.value = vRT[2].texture;
    ready = true;
  }

  // Rebuild the targets when the drawing-buffer size changes (window
  // resize, pixel-ratio change). No-op while disabled — resources are
  // built on the first enable instead.
  function resize() {
    if (!enabled) return;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(s.x));
    const h = Math.max(2, Math.round(s.y));
    if (ready && w === size.w && h === size.h) return;
    size = { w, h };
    disposeResources();
    buildResources(w, h);
  }

  function setEnabled(on) {
    enabled = !!on;
    if (enabled) resize();
  }

  const ZERO = new THREE.Vector2(0, 0);

  // Runs after the normal scene render (render.js post hook). With
  // autoClear off, the final composite quad adds its light onto the
  // finished frame instead of wiping it.
  function render() {
    if (!enabled || !ready) return;
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // 1. Copy the finished frame.
    renderer.copyFramebufferToTexture(ZERO, sourceTex);
    // 2. Extract the bright areas at half resolution.
    highPassMat.uniforms.tDiffuse.value = sourceTex;
    renderer.setRenderTarget(brightRT);
    renderer.clear();
    quad.material = highPassMat;
    renderer.render(quadScene, quadCam);
    // 3. Blur the mip chain, each level half the previous.
    let input = brightRT.texture;
    for (let i = 0; i < MIP_KERNELS.length; i++) {
      const m = blurMats[i];
      m.uniforms.colorTexture.value = input;
      m.uniforms.direction.value.set(1, 0);
      renderer.setRenderTarget(hRT[i]);
      renderer.clear();
      quad.material = m;
      renderer.render(quadScene, quadCam);
      m.uniforms.colorTexture.value = hRT[i].texture;
      m.uniforms.direction.value.set(0, 1);
      renderer.setRenderTarget(vRT[i]);
      renderer.clear();
      renderer.render(quadScene, quadCam);
      input = vRT[i].texture;
    }
    // 4. Composite additively over the finished frame.
    renderer.setRenderTarget(null);
    quad.material = compositeMat;
    renderer.render(quadScene, quadCam);
    renderer.autoClear = oldAutoClear;
  }

  return {
    setEnabled, resize, render,
    state() { return { enabled, ready, threshold: THRESHOLD, strength: STRENGTH }; },
  };
}
