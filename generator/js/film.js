// Darkroom pass, applied after tone mapping. Turns the render into an
// archival print (panchromatic film + coloured filter, toning, grain,
// vignetting, dust), a hand-tinted postcard, a clean colour image, or a
// drawing on paper.
export const FilmShader = {
  name: 'FilmShader',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: [1, 1] },
    mode: { value: 0 },
    filterW: { value: [0.3, 0.59, 0.11] },
    exposure: { value: 1.0 },
    contrast: { value: 1.25 },
    grain: { value: 0.5 },
    grainSize: { value: 1.0 },
    vignette: { value: 0.5 },
    soft: { value: 0.25 },
    seed: { value: 0.0 },
    toneShadow: { value: [0.1, 0.095, 0.09] },
    toneLight: { value: [1.0, 0.985, 0.95] },
    dust: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float mode, exposure, contrast, grain, grainSize, vignette, soft, seed, dust;
    uniform vec3 filterW, toneShadow, toneLight;
    varying vec2 vUv;

    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float curve(float x, float k) { // contrast around mid-grey with soft toe and shoulder
      x = clamp(x, 0.0, 1.0);
      float y = (x - 0.5) * k + 0.5;
      y = clamp(y, 0.0, 1.0);
      return mix(y, y * y * (3.0 - 2.0 * y), 0.35);
    }

    void main() {
      vec2 px = 1.0 / resolution;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (soft > 0.001) {
        vec3 b = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
        c = mix(c, b * 0.25, soft);
      }
      vec3 outc;
      float l;
      if (mode < 0.5) {            // archival silver print
        l = dot(c, filterW) * exposure;
        l = curve(l, contrast);
        outc = mix(toneShadow, toneLight, l) * mix(0.92, 1.0, l);
      } else if (mode < 1.5) {     // hand-tinted postcard
        l = dot(c, vec3(0.3, 0.59, 0.11));
        vec3 s = mix(vec3(l), c, 0.5) * exposure;
        s = (s - 0.5) * (contrast * 0.8) + 0.5;
        outc = s * vec3(1.04, 0.97, 0.82) + vec3(0.05, 0.035, 0.0);
        l = dot(outc, vec3(0.33));
      } else if (mode < 2.5) {     // colour
        outc = (c * exposure - 0.5) * mix(1.0, contrast, 0.4) + 0.5;
        l = dot(outc, vec3(0.3, 0.59, 0.11));
      } else {                     // drawing on paper
        l = dot(c, vec3(0.3, 0.59, 0.11));
        outc = mix(vec3(0.16, 0.15, 0.14), vec3(0.965, 0.955, 0.93), clamp(l * 1.08, 0.0, 1.0));
      }
      vec2 q = vUv - 0.5;
      q.x *= resolution.x / resolution.y;
      float v = 1.0 - dot(q, q) * vignette * 1.1;
      outc *= clamp(v, 0.0, 1.0);
      if (mode < 2.5) {
        vec2 gp = floor(gl_FragCoord.xy / grainSize);
        float n = hash12(gp + seed * 17.0) + hash12(gp * 0.5 + seed * 3.1) * 0.6 - 0.8;
        float amt = grain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));
        outc += n * amt * 0.22;
      }
      if (dust > 0.001) {
        vec2 grid = vec2(70.0, 70.0 * resolution.y / resolution.x);
        vec2 cell = floor(vUv * grid);
        float h = hash12(cell + seed * 1.37);
        if (h > 1.0 - dust * 0.012) {
          vec2 f = fract(vUv * grid) - vec2(hash12(cell + 7.0), hash12(cell + 11.0));
          f.x *= resolution.x / resolution.y;
          float d = length(f * grid.y);
          float r = 0.35 + hash12(cell + 3.0) * 0.8;
          float spot = smoothstep(r, r * 0.4, d);
          outc = mix(outc, vec3(h > 1.0 - dust * 0.004 ? 0.12 : 0.96), spot * 0.85);
        }
      }
      gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
    }`,
};
