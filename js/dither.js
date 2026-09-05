// js/dither.js
//
// A reusable WebGL layer that draws whatever image is "current" through an
// ordered (Bayer) dither shader, in full color, with a slow drift so the
// pattern isn't perfectly static.
//
// Each call to DitherFactory.create() sets up its own independent canvas/
// shader/settings — so the main scene and every thumbnail on the location
// carousel can each run their own dither instance simultaneously.

const DitherFactory = (() => {
  const VERTEX_SRC = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SRC = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform vec2 u_uvScale;
    uniform float u_levels;
    uniform float u_cellSize;
    uniform float u_driftSpeed;

    float bayerValue(vec2 p) {
      int x = int(mod(p.x, 4.0));
      int y = int(mod(p.y, 4.0));
      int idx = x + y * 4;
      if (idx == 0) return 0.0;
      if (idx == 1) return 8.0;
      if (idx == 2) return 2.0;
      if (idx == 3) return 10.0;
      if (idx == 4) return 12.0;
      if (idx == 5) return 4.0;
      if (idx == 6) return 14.0;
      if (idx == 7) return 6.0;
      if (idx == 8) return 3.0;
      if (idx == 9) return 11.0;
      if (idx == 10) return 1.0;
      if (idx == 11) return 9.0;
      if (idx == 12) return 15.0;
      if (idx == 13) return 7.0;
      if (idx == 14) return 13.0;
      return 5.0;
    }

    void main() {
      vec2 uv = (v_uv - 0.5) * u_uvScale + 0.5;
      vec4 color = texture2D(u_texture, uv);

      vec2 fragCoord = v_uv * u_resolution;
      vec2 drift = vec2(u_time * u_driftSpeed, u_time * u_driftSpeed * 0.7);
      vec2 cellCoord = (fragCoord / u_cellSize) + drift;

      float threshold = (bayerValue(floor(cellCoord)) + 0.5) / 16.0;

      vec3 stepped = color.rgb * u_levels;
      vec3 fracPart = fract(stepped);
      vec3 quantized = floor(stepped) + step(threshold, fracPart.r) * vec3(1.0, 0.0, 0.0)
                                       + step(threshold, fracPart.g) * vec3(0.0, 1.0, 0.0)
                                       + step(threshold, fracPart.b) * vec3(0.0, 0.0, 1.0);
      vec3 finalColor = quantized / u_levels;

      gl_FragColor = vec4(finalColor, color.a);
    }
  `;

  function compileShader(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function create() {
    let gl, program, canvas;
    let currentTexture = null;
    let currentImage = null;
    let uniforms = {};
    let startTime = null;
    let running = false;

    const settings = {
      levels: 5,
      cellSize: 2.0,
      driftSpeed: 0.6,
    };

    function init(canvasEl) {
      canvas = canvasEl;
      gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) {
        console.error("WebGL not available — dither effect will not render.");
        return;
      }

      const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.useProgram(program);

      const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      const posLoc = gl.getAttribLocation(program, "a_position");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      uniforms = {
        time: gl.getUniformLocation(program, "u_time"),
        resolution: gl.getUniformLocation(program, "u_resolution"),
        uvScale: gl.getUniformLocation(program, "u_uvScale"),
        levels: gl.getUniformLocation(program, "u_levels"),
        cellSize: gl.getUniformLocation(program, "u_cellSize"),
        driftSpeed: gl.getUniformLocation(program, "u_driftSpeed"),
      };

      currentTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, currentTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      window.addEventListener("resize", resize);
      resize();
    }

    function resize() {
      if (!canvas) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      if (gl) gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function setImage(imageEl) {
      if (!gl || !imageEl) return;
      currentImage = imageEl;
      gl.bindTexture(gl.TEXTURE_2D, currentTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageEl);
    }

    function computeUvScale() {
      if (!currentImage || !canvas.height) return [1, 1];
      const canvasAspect = canvas.width / canvas.height;
      const imageAspect = currentImage.naturalWidth / currentImage.naturalHeight;
      if (imageAspect > canvasAspect) {
        return [canvasAspect / imageAspect, 1];
      }
      return [1, imageAspect / canvasAspect];
    }

    function frame(now) {
      if (!running) return;
      if (!startTime) startTime = now;
      const elapsed = (now - startTime) / 1000;

      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        resize();
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      const [su, sv] = computeUvScale();
      gl.uniform2f(uniforms.uvScale, su, sv);
      gl.uniform1f(uniforms.levels, settings.levels);
      gl.uniform1f(uniforms.cellSize, settings.cellSize);
      gl.uniform1f(uniforms.driftSpeed, settings.driftSpeed);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    }

    return { init, setImage, start, settings };
  }

  return { create };
})();

const Dither = DitherFactory.create();
