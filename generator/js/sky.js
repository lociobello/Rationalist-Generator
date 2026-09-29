// Procedural sky dome: gradient, sun glow and fbm cumulus on a virtual plane.
// Output is linear radiance; the composer's OutputPass tone-maps it.
import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 sunDir;
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 groundCol;
uniform float cover;
uniform vec2 offset;
uniform float cloudBright;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = m * p; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.38));
  if (h < 0.0) col = mix(horizon, groundCol, smoothstep(0.0, -0.06, h));
  float sd = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.94, 0.82) * (pow(sd, 900.0) * 30.0 + pow(sd, 10.0) * 0.18);
  if (h > 0.0 && cover > 0.001) {
    vec2 uv = d.xz / (h + 0.1) * 0.55 + offset;
    float n = fbm(uv);
    float edge = 1.0 - cover;
    float c = smoothstep(edge, edge + 0.22, n);
    float n2 = fbm(uv - sunDir.xz * 0.06);
    float lit = clamp(0.62 + (n - n2) * 3.2, 0.28, 1.15);
    vec3 cc = vec3(cloudBright) * lit * (0.8 + 0.4 * pow(sd, 3.0));
    float fade = smoothstep(0.0, 0.04, h);
    col = mix(col, cc, c * fade);
  }
  // atmospheric haze toward the horizon
  vec3 haze = mix(horizon, vec3(dot(horizon, vec3(0.333))), 0.35) * 1.18;
  col = mix(haze, col, smoothstep(-0.02, 0.22, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky() {
  const uniforms = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    zenith: { value: new THREE.Color(0.07, 0.19, 0.52) },
    horizon: { value: new THREE.Color(0.42, 0.55, 0.72) },
    groundCol: { value: new THREE.Color(0.32, 0.3, 0.27) },
    cover: { value: 0.45 },
    offset: { value: new THREE.Vector2(0, 0) },
    cloudBright: { value: 1.25 },
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return { mesh, uniforms };
}
